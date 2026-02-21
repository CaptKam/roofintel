import { codeViolations, leads, recordedDocuments, type InsertCodeViolation, type InsertRecordedDocument, type Lead } from "@shared/schema";
import { db } from "./storage";
import { eq, and, sql, ilike } from "drizzle-orm";

const DALLAS_311_URL = "https://www.dallasopendata.com/resource/gc4d-8a49.json";
const DALLAS_CODE_VIOLATIONS_URL = "https://www.dallasopendata.com/resource/x9pz-kdq9.json";
const PAGE_SIZE = 5000;
const RATE_LIMIT_MS = 300;

const COMPLIANCE_KEYWORDS = [
  "Code Compliance",
  "High Weeds",
  "Junk Vehicle",
  "Litter/Dumping",
  "Structural",
];

function normalizeAddress(addr: string): string {
  return addr.toUpperCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\s*(DALLAS|TX|TEXAS|,)\s*\d{5}(-\d{4})?$/gi, '')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function isComplianceRelated(department: string | undefined, requestType: string | undefined): boolean {
  const combined = `${department || ""} ${requestType || ""}`;
  return COMPLIANCE_KEYWORDS.some((kw) => combined.toUpperCase().includes(kw.toUpperCase()));
}

function parseLatLng(latLocation: string | undefined): { lat: number | null; lng: number | null } {
  if (!latLocation) return { lat: null, lng: null };
  const match = latLocation.match(/\(?\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\)?/);
  if (!match) return { lat: null, lng: null };
  return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
}

export async function importDallas311(
  marketId: string,
  options?: { daysBack?: number; batchSize?: number }
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const daysBack = options?.daysBack ?? 90;
  const batchSize = options?.batchSize ?? 100;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffISO = cutoffDate.toISOString().split("T")[0];

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  let offset = 0;
  let hasMore = true;

  console.log(`[Dallas 311] Starting import for market ${marketId}, daysBack=${daysBack}`);

  while (hasMore) {
    const params = new URLSearchParams({
      "$limit": String(PAGE_SIZE),
      "$offset": String(offset),
      "$where": `created_date >= '${cutoffISO}'`,
      "$order": "created_date DESC",
    });

    try {
      const response = await fetchWithTimeout(`${DALLAS_311_URL}?${params}`);
      if (!response.ok) {
        errors.push(`API error ${response.status}: ${response.statusText}`);
        break;
      }

      const records: any[] = await response.json();
      if (records.length === 0) {
        hasMore = false;
        break;
      }

      const complianceRecords = records.filter((r) =>
        isComplianceRelated(r.department, r.service_request_type)
      );

      const batch: InsertCodeViolation[] = [];

      for (const record of complianceRecords) {
        const sourceId = `dallas311_${record.service_request_number}`;
        const address = record.address?.trim();
        if (!address) continue;

        const existing = await db
          .select({ id: codeViolations.id })
          .from(codeViolations)
          .where(eq(codeViolations.sourceId, sourceId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const { lat, lng } = parseLatLng(record.lat_location);

        batch.push({
          marketId,
          serviceRequestNumber: record.service_request_number || null,
          address,
          violationType: record.service_request_type || "Unknown",
          category: record.department || null,
          status: record.status || "open",
          priority: record.priority || null,
          createdDate: record.created_date?.split("T")[0] || null,
          closedDate: record.update_date?.split("T")[0] || null,
          department: record.department || null,
          latitude: lat,
          longitude: lng,
          source: "dallas_311",
          sourceId,
          metadata: {
            rawStatus: record.status,
            updateDate: record.update_date,
          },
        });

        if (batch.length >= batchSize) {
          await db.insert(codeViolations).values(batch);
          imported += batch.length;
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await db.insert(codeViolations).values(batch);
        imported += batch.length;
      }

      if (records.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err: any) {
      errors.push(`Fetch error at offset ${offset}: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`[Dallas 311] Complete: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
  return { imported, skipped, errors };
}

export async function importDallasCodeViolations(
  marketId: string,
  options?: { daysBack?: number }
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const daysBack = options?.daysBack ?? 180;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffISO = cutoffDate.toISOString().split("T")[0];

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  let offset = 0;
  let hasMore = true;

  console.log(`[Dallas Code Violations] Starting import for market ${marketId}, daysBack=${daysBack}`);

  while (hasMore) {
    const params = new URLSearchParams({
      "$limit": String(PAGE_SIZE),
      "$offset": String(offset),
      "$where": `created >= '${cutoffISO}'`,
      "$order": "created DESC",
    });

    try {
      const response = await fetchWithTimeout(`${DALLAS_CODE_VIOLATIONS_URL}?${params}`);
      if (!response.ok) {
        errors.push(`API error ${response.status}: ${response.statusText}`);
        break;
      }

      const records: any[] = await response.json();
      if (records.length === 0) {
        hasMore = false;
        break;
      }

      const batch: InsertCodeViolation[] = [];

      for (const record of records) {
        const sourceId = `dallas_cv_${record.service_request}`;
        if (!record.service_request) continue;

        const existing = await db
          .select({ id: codeViolations.id })
          .from(codeViolations)
          .where(eq(codeViolations.sourceId, sourceId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const addressParts = [
          record.str_num,
          record.str_nam,
          record.str_suffix,
        ].filter(Boolean);
        const address = addressParts.join(" ").trim();
        if (!address) continue;

        let lat: number | null = null;
        let lng: number | null = null;
        if (record.location?.human_address) {
          try {
            const loc = typeof record.location.human_address === "string"
              ? JSON.parse(record.location.human_address)
              : record.location.human_address;
            if (loc.latitude) lat = parseFloat(loc.latitude);
            if (loc.longitude) lng = parseFloat(loc.longitude);
          } catch {}
        }
        if (record.location?.latitude) lat = parseFloat(record.location.latitude);
        if (record.location?.longitude) lng = parseFloat(record.location.longitude);

        batch.push({
          marketId,
          serviceRequestNumber: record.service_request || null,
          address,
          violationType: record.nuisance || record.type || "Unknown",
          category: record.department || null,
          status: record.status || "open",
          priority: null,
          createdDate: record.created?.split("T")[0] || null,
          closedDate: null,
          department: record.department || null,
          latitude: lat,
          longitude: lng,
          source: "dallas_code_violations",
          sourceId,
          metadata: {
            zone: record.zone,
            type: record.type,
            nuisance: record.nuisance,
          },
        });

        if (batch.length >= 100) {
          await db.insert(codeViolations).values(batch);
          imported += batch.length;
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await db.insert(codeViolations).values(batch);
        imported += batch.length;
      }

      if (records.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err: any) {
      errors.push(`Fetch error at offset ${offset}: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`[Dallas Code Violations] Complete: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
  return { imported, skipped, errors };
}

export async function matchViolationsToLeads(
  marketId: string
): Promise<{ matched: number; unmatched: number }> {
  console.log(`[Violation Matching] Starting for market ${marketId}`);

  const allViolations = await db
    .select()
    .from(codeViolations)
    .where(eq(codeViolations.marketId, marketId));

  const allLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.marketId, marketId));

  const leadsByNormalizedAddress = new Map<string, Lead>();
  for (const lead of allLeads) {
    const normalized = normalizeAddress(lead.address);
    leadsByNormalizedAddress.set(normalized, lead);
  }

  const leadViolationStats = new Map<string, {
    total: number;
    open: number;
    lastDate: string | null;
  }>();

  let matched = 0;
  let unmatched = 0;

  for (const violation of allViolations) {
    const normalizedAddr = normalizeAddress(violation.address);
    const lead = leadsByNormalizedAddress.get(normalizedAddr);

    if (!lead) {
      unmatched++;
      continue;
    }

    matched++;

    if (!violation.leadId) {
      await db
        .update(codeViolations)
        .set({ leadId: lead.id })
        .where(eq(codeViolations.id, violation.id));
    }

    const stats = leadViolationStats.get(lead.id) || { total: 0, open: 0, lastDate: null };
    stats.total++;
    if (violation.status?.toLowerCase() === "open" || violation.status?.toLowerCase() === "active") {
      stats.open++;
    }
    if (violation.createdDate) {
      if (!stats.lastDate || violation.createdDate > stats.lastDate) {
        stats.lastDate = violation.createdDate;
      }
    }
    leadViolationStats.set(lead.id, stats);
  }

  for (const [leadId, stats] of Array.from(leadViolationStats.entries())) {
    await db
      .update(leads)
      .set({
        violationCount: stats.total,
        openViolations: stats.open,
        lastViolationDate: stats.lastDate,
      })
      .where(eq(leads.id, leadId));
  }

  console.log(`[Violation Matching] Complete: matched=${matched}, unmatched=${unmatched}, leadsUpdated=${leadViolationStats.size}`);
  return { matched, unmatched };
}

export async function getDallasRecordsStatus(): Promise<{
  totalViolations: number;
  violationsBySource: { source: string; count: number }[];
  matchedViolations: number;
  unmatchedViolations: number;
  totalRecordedDocuments: number;
  recentViolations: number;
}> {
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(codeViolations);
  const totalViolations = totalResult[0]?.count ?? 0;

  const bySourceResult = await db
    .select({
      source: codeViolations.source,
      count: sql<number>`count(*)::int`,
    })
    .from(codeViolations)
    .groupBy(codeViolations.source);

  const violationsBySource = bySourceResult.map((r) => ({
    source: r.source,
    count: r.count,
  }));

  const matchedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(codeViolations)
    .where(sql`${codeViolations.leadId} IS NOT NULL`);
  const matchedViolations = matchedResult[0]?.count ?? 0;

  const unmatchedViolations = totalViolations - matchedViolations;

  const docsResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordedDocuments);
  const totalRecordedDocuments = docsResult[0]?.count ?? 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(codeViolations)
    .where(sql`${codeViolations.createdDate} >= ${thirtyDaysAgo.toISOString().split("T")[0]}`);
  const recentViolations = recentResult[0]?.count ?? 0;

  return {
    totalViolations,
    violationsBySource,
    matchedViolations,
    unmatchedViolations,
    totalRecordedDocuments,
    recentViolations,
  };
}

export async function importRecordedDocuments(marketId: string): Promise<{
  message: string;
  portalUrl: string;
}> {
  return {
    message:
      "Dallas County Clerk recorded documents are not available via public API. " +
      "The county uses an HTML-only portal at dallas.tx.publicsearch.us for deed, lien, " +
      "and foreclosure lookups. Manual lookup is required. Use addRecordedDocument() " +
      "to manually enter documents found through the portal.",
    portalUrl: "https://dallas.tx.publicsearch.us",
  };
}

export async function addRecordedDocument(
  doc: InsertRecordedDocument
): Promise<{ id: string }> {
  const result = await db.insert(recordedDocuments).values(doc).returning({ id: recordedDocuments.id });
  console.log(`[Recorded Documents] Added document: ${doc.documentType} - ${doc.instrumentNumber || "no instrument #"}`);
  return { id: result[0].id };
}
