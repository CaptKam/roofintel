import { db } from "./storage";
import { leads as leadsTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { recordEvidence } from "./evidence-recorder";
import { isPersonName } from "./contact-validation";

const COMPTROLLER_SEARCH = "https://mycpa.cpa.state.tx.us/coa/coaSearchBtn";
const COMPTROLLER_DETAIL = "https://mycpa.cpa.state.tx.us/coa/coaSearchFn";

export interface SOSEntityResult {
  success: boolean;
  entity?: {
    name: string;
    sosFileNumber: string;
    taxpayerId: string;
    status: string;
    officers: Array<{ name: string; title: string }>;
    registeredAgent: string | null;
    formationDate: string | null;
    entityType: string | null;
    address: string | null;
  };
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

export async function searchComptrollerByName(name: string): Promise<any[]> {
  try {
    const cleanName = name
      .replace(/\b(LLC|L\.L\.C|LP|L\.P|INC|CORP|LTD|CO|COMPANY)\b\.?/gi, "")
      .trim();

    const resp = await fetchWithTimeout(
      `${COMPTROLLER_DETAIL}?pTaxpayerName=${encodeURIComponent(cleanName)}`,
      { headers: { Accept: "text/html" } }
    );
    if (!resp || !resp.ok) return [];

    const html = await resp.text();
    return parseComptrollerSearchResults(html);
  } catch {
    return [];
  }
}

export async function searchComptrollerByFileNumber(fileNumber: string): Promise<any> {
  try {
    const resp = await fetchWithTimeout(
      `${COMPTROLLER_DETAIL}?pTaxpayerNumber=${encodeURIComponent(fileNumber)}`,
      { headers: { Accept: "text/html" } }
    );
    if (!resp || !resp.ok) return null;

    const html = await resp.text();
    return parseComptrollerDetail(html);
  } catch {
    return null;
  }
}

function parseComptrollerSearchResults(html: string): any[] {
  const results: any[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length >= 3) {
      const getText = (cell: string) => cell.replace(/<[^>]+>/g, "").trim();
      results.push({
        taxpayerNumber: getText(cells[0]!),
        taxpayerName: getText(cells[1]),
        sosFileNumber: cells.length > 2 ? getText(cells[2]) : null,
      });
    }
  }
  return results;
}

function parseComptrollerDetail(html: string): any {
  const get = (label: string): string | null => {
    const regex = new RegExp(`${label}[\\s:]*</?(td|th|label)[^>]*>\\s*<?(td|span)[^>]*>([^<]+)`, "i");
    const m = html.match(regex);
    return m ? m[3].trim() : null;
  };

  return {
    taxpayerName: get("Taxpayer Name") || get("Name"),
    taxpayerNumber: get("Taxpayer Number") || get("Taxpayer ID"),
    sosFileNumber: get("SOS File Number") || get("Secretary of State"),
    status: get("Right to Transact") || get("Status"),
    address: get("Mailing Address") || get("Address"),
    stateOfFormation: get("State of Formation"),
    entityType: get("Entity Type"),
  };
}

export async function fetchSOSEntityOfficers(
  sosFileNumber: string,
  apiKey?: string
): Promise<SOSEntityResult> {
  if (!apiKey) apiKey = process.env.TX_COMPTROLLER_API_KEY;

  if (apiKey) {
    try {
      const resp = await fetchWithTimeout(
        `https://data.texas.gov/resource/jnfd-kphy.json?$where=secretary_of_state_sos_or_coa_file_number='${sosFileNumber}'`,
        {
          headers: {
            "X-App-Token": apiKey,
            Accept: "application/json",
          },
        }
      );

      if (resp && resp.ok) {
        const data = (await resp.json()) as any[];
        if (data.length > 0) {
          const entity = data[0];

          const officers: Array<{ name: string; title: string }> = [];

          if (entity.officer_director_or_manager_name) {
            officers.push({
              name: formatName(entity.officer_director_or_manager_name),
              title: entity.officer_director_or_manager_title || "Officer",
            });
          }
          if (entity.additional_officer_director_or_manager) {
            officers.push({
              name: formatName(entity.additional_officer_director_or_manager),
              title: entity.additional_officer_title || "Director",
            });
          }

          return {
            success: true,
            entity: {
              name: entity.taxpayer_name || "",
              sosFileNumber: entity.secretary_of_state_sos_or_coa_file_number || sosFileNumber,
              taxpayerId: entity.taxpayer_number || "",
              status: entity.right_to_transact_business_in_texas || "",
              officers,
              registeredAgent: entity.registered_agent_name
                ? formatName(entity.registered_agent_name)
                : null,
              formationDate: entity.beginning_date || null,
              entityType: entity.entity_type_description || null,
              address: [entity.mailing_address, entity.mailing_city, entity.mailing_state, entity.mailing_zip]
                .filter(Boolean)
                .join(", ") || null,
            },
          };
        }
      }
    } catch (err: any) {
      console.log("[TX SOS] Comptroller API lookup failed:", err.message);
    }
  }

  const comptrollerResult = await searchComptrollerByFileNumber(sosFileNumber);
  if (comptrollerResult) {
    return {
      success: true,
      entity: {
        name: comptrollerResult.taxpayerName || "",
        sosFileNumber,
        taxpayerId: comptrollerResult.taxpayerNumber || "",
        status: comptrollerResult.status || "",
        officers: [],
        registeredAgent: null,
        formationDate: null,
        entityType: comptrollerResult.entityType || null,
        address: comptrollerResult.address || null,
      },
    };
  }

  return { success: false, error: "Entity not found in TX SOS/Comptroller records" };
}

function formatName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function enrichLeadFromTXSOS(leadId: string): Promise<SOSEntityResult> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) return { success: false, error: "Lead not found" };

  let result: SOSEntityResult = { success: false, error: "No SOS file number or LLC name available" };

  if (lead.sosFileNumber) {
    result = await fetchSOSEntityOfficers(lead.sosFileNumber);
  } else if (lead.llcName || (lead.ownerName && !isPersonName(lead.ownerName))) {
    const searchName = lead.llcName || lead.ownerName;
    const searchResults = await searchComptrollerByName(searchName);
    if (searchResults.length > 0 && searchResults[0].sosFileNumber) {
      result = await fetchSOSEntityOfficers(searchResults[0].sosFileNumber);
    }
  }

  if (!result.success || !result.entity) return result;

  const entity = result.entity;

  for (const officer of entity.officers) {
    if (officer.name && isPersonName(officer.name)) {
      await recordEvidence({
        leadId,
        contactType: "PERSON",
        contactValue: officer.name,
        sourceName: "TX Secretary of State",
        sourceUrl: `https://mycpa.cpa.state.tx.us/coa/Index.html`,
        sourceType: "GOV_DB",
        extractorMethod: "TX_SOS_OFFICER",
        confidence: 90,
        rawSnippet: `${officer.title} of ${entity.name}`,
      });
    }
  }

  if (entity.registeredAgent && isPersonName(entity.registeredAgent)) {
    await recordEvidence({
      leadId,
      contactType: "PERSON",
      contactValue: entity.registeredAgent,
      sourceName: "TX Secretary of State",
      sourceType: "GOV_DB",
      extractorMethod: "TX_SOS_REG_AGENT",
      confidence: 85,
      rawSnippet: `Registered Agent for ${entity.name}`,
    });
  }

  const updates: Record<string, any> = {};
  if (!lead.sosFileNumber && entity.sosFileNumber) updates.sosFileNumber = entity.sosFileNumber;
  if (!lead.taxpayerId && entity.taxpayerId) updates.taxpayerId = entity.taxpayerId;
  if (!lead.registeredAgent && entity.registeredAgent) updates.registeredAgent = entity.registeredAgent;

  if (entity.officers.length > 0) {
    const primary = entity.officers[0];
    if (!lead.officerName) updates.officerName = primary.name;
    if (!lead.officerTitle) updates.officerTitle = primary.title;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(leadsTable).set(updates).where(eq(leadsTable.id, leadId));
  }

  return result;
}

