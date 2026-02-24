import { db } from "./storage";
import { leads as leadsTable } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { recordEvidence } from "./evidence-recorder";

export interface DeedRecord {
  grantorName: string;
  granteeName: string;
  instrumentType: string;
  recordDate: string;
  documentNumber: string;
  county: string;
  consideration?: string;
}

export interface CountyClerkResult {
  success: boolean;
  records: DeedRecord[];
  error?: string;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function searchDallasCountyRecords(ownerName: string): Promise<DeedRecord[]> {
  try {
    const cleanName = ownerName
      .replace(/\b(LLC|L\.L\.C|LP|L\.P|INC|CORP|LTD|CO\.|COMPANY)\b\.?/gi, "")
      .trim()
      .toUpperCase();

    const resp = await fetchWithTimeout(
      `https://www.dallascounty.org/services/recording-search/api/search?name=${encodeURIComponent(cleanName)}&docType=DEED`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "RoofIntel/1.0",
        },
      }
    );

    if (!resp || !resp.ok) {
      return await searchViaSocrataFallback(cleanName, "Dallas");
    }

    const data = (await resp.json()) as any[];
    return data.map((r: any) => ({
      grantorName: r.grantor || r.grantor_1 || "",
      granteeName: r.grantee || r.grantee_1 || "",
      instrumentType: r.instrument_type || r.doc_type || "DEED",
      recordDate: r.record_date || r.filing_date || "",
      documentNumber: r.document_number || r.instrument_number || "",
      county: "Dallas",
      consideration: r.consideration || undefined,
    }));
  } catch {
    return [];
  }
}

async function searchViaSocrataFallback(ownerName: string, county: string): Promise<DeedRecord[]> {
  const datasetIds: Record<string, string[]> = {
    Dallas: ["qe5p-jmwg", "x3v4-mu7b"],
    Tarrant: [],
    Collin: [],
    Denton: [],
  };

  const ids = datasetIds[county] || [];
  for (const dsId of ids) {
    try {
      const resp = await fetchWithTimeout(
        `https://data.${county.toLowerCase()}county.org/resource/${dsId}.json?$where=upper(grantor_1) like '%25${encodeURIComponent(ownerName)}%25'&$limit=20`,
        { headers: { Accept: "application/json" } }
      );
      if (resp && resp.ok) {
        const data = (await resp.json()) as any[];
        if (data.length > 0 && !data[0]?.error) {
          return data.map((r: any) => ({
            grantorName: r.grantor_1 || r.grantor || "",
            granteeName: r.grantee_1 || r.grantee || "",
            instrumentType: r.instrument_type || "DEED",
            recordDate: r.record_date || r.filed_date || "",
            documentNumber: r.instrument_number || r.doc_num || "",
            county,
            consideration: r.consideration || undefined,
          }));
        }
      }
    } catch {
      continue;
    }
  }
  return [];
}

export async function searchCountyRecords(ownerName: string, county: string): Promise<CountyClerkResult> {
  if (!ownerName) {
    return { success: false, records: [], error: "No owner name provided" };
  }

  let records: DeedRecord[] = [];

  switch (county.toLowerCase()) {
    case "dallas":
      records = await searchDallasCountyRecords(ownerName);
      break;
    default:
      records = await searchViaSocrataFallback(
        ownerName.replace(/\b(LLC|LP|INC|CORP|LTD)\b\.?/gi, "").trim().toUpperCase(),
        county
      );
  }

  return {
    success: true,
    records,
  };
}

export async function enrichLeadFromCountyClerk(leadId: string): Promise<CountyClerkResult> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) return { success: false, records: [], error: "Lead not found" };

  const ownerName = lead.llcName || lead.ownerName;
  if (!ownerName) {
    return { success: false, records: [], error: "No owner/LLC name available for deed search" };
  }

  const result = await searchCountyRecords(ownerName, lead.county);

  for (const record of result.records) {
    if (record.granteeName && record.granteeName !== ownerName) {
      await recordEvidence({
        leadId,
        contactType: "PERSON",
        contactValue: record.granteeName,
        sourceName: `${record.county} County Clerk`,
        sourceType: "GOV_DB",
        extractorMethod: "COUNTY_DEED_RECORD",
        confidence: 85,
        rawSnippet: `${record.instrumentType} recorded ${record.recordDate} - Doc #${record.documentNumber}`,
      });
    }
  }

  return result;
}
