import { buildingPermits, leads, type InsertBuildingPermit, type Lead } from "@shared/schema";
import { db } from "./storage";
import { eq, and, sql, ilike } from "drizzle-orm";

const DALLAS_PERMITS_URL = "https://www.dallasopendata.com/resource/e7gq-4sah.json";
const FORT_WORTH_PERMITS_URL = "https://data.fortworthtexas.gov/resource/quz7-xnsy.json";
const PAGE_SIZE = 5000;
const RATE_LIMIT_MS = 300;

const COMMERCIAL_LAND_USE_KEYWORDS = [
  "COMMERCIAL",
  "INDUSTRIAL",
  "RETAIL",
  "OFFICE",
  "WAREHOUSE",
  "MULTI",
  "BANK",
  "HOTEL",
  "MOTEL",
  "RESTAURANT",
  "HOSPITAL",
  "CLINIC",
  "CHURCH",
  "COLLEGE",
  "UNIVERSITY",
  "COMMUNICATIONS",
  "PARKING",
  "AUTO SERVICE",
  "CAR WASH",
  "AMUSEMENT",
  "CONVALESCENT",
  "NURSING",
  "DEPARTMENT STORE",
  "DENTIST",
  "ALCOHOLIC",
  "AIRPORT",
  "CHILD CARE",
  "COMMUNITY SERVICE",
  "COUNTRY CLUB",
  "CATERING",
  "BUS STATION",
  "CONTRACTOR",
  "CLEANING",
  "LAUNDRY",
  "ANIMAL",
  "AMBULANCE",
  "SEMINARY",
  "GALLERY",
  "TRANSIT",
  "BUILDING REPAIR",
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
    .replace(/\s*(DALLAS|FORT WORTH|TX|TEXAS|,)\s*\d{5}(-\d{4})?$/gi, '')
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

function extractPhoneFromContractor(contractor: string | undefined): string | null {
  if (!contractor) return null;
  const parenMatch = contractor.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
  if (parenMatch) return `(${parenMatch[1]}) ${parenMatch[2]}-${parenMatch[3]}`;
  const dashMatch = contractor.match(/(\d{3})-(\d{3})-(\d{4})/);
  if (dashMatch) return `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`;
  return null;
}

function parseDallasDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return dateStr.split("T")[0] || null;
  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  let year = match[3];
  if (year.length === 2) {
    const num = parseInt(year, 10);
    year = num > 50 ? `19${year}` : `20${year}`;
  }
  return `${year}-${month}-${day}`;
}

function isCommercialLandUse(landUse: string | undefined): boolean {
  if (!landUse) return false;
  const upper = landUse.toUpperCase();
  return COMMERCIAL_LAND_USE_KEYWORDS.some((kw) => upper.includes(kw));
}

export async function importDallasPermits(
  marketId: string,
  options?: { daysBack?: number; commercialOnly?: boolean }
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const daysBack = options?.daysBack ?? 90;
  const commercialOnly = options?.commercialOnly ?? true;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  let offset = 0;
  let hasMore = true;

  console.log(`[Dallas Permits] Starting import for market ${marketId}, daysBack=${daysBack}, commercialOnly=${commercialOnly}`);

  while (hasMore) {
    const params = new URLSearchParams({
      "$limit": String(PAGE_SIZE),
      "$offset": String(offset),
      "$order": "issued_date DESC",
    });

    try {
      const response = await fetchWithTimeout(`${DALLAS_PERMITS_URL}?${params}`);
      if (!response.ok) {
        errors.push(`Dallas Permits API error ${response.status}: ${response.statusText}`);
        break;
      }

      const records: any[] = await response.json();
      if (records.length === 0) {
        hasMore = false;
        break;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      const cutoffISO = cutoffDate.toISOString().split("T")[0];

      const batch: InsertBuildingPermit[] = [];

      for (const record of records) {
        const issuedDate = parseDallasDate(record.issued_date);
        if (issuedDate && issuedDate < cutoffISO) {
          continue;
        }

        if (commercialOnly && !isCommercialLandUse(record.land_use)) {
          continue;
        }

        const permitNumber = record.permit_number;
        if (!permitNumber) continue;

        const address = record.street_address?.trim();
        if (!address) continue;

        const sourcePermitId = `dallas_permit_${permitNumber}`;

        const existing = await db
          .select({ id: buildingPermits.id })
          .from(buildingPermits)
          .where(eq(buildingPermits.sourcePermitId, sourcePermitId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const contractorPhone = extractPhoneFromContractor(record.contractor);
        const estimatedValue = record.value ? parseFloat(record.value) : null;
        const sqft = record.area ? parseInt(record.area, 10) : null;

        batch.push({
          marketId,
          permitNumber,
          permitType: record.permit_type || "Unknown",
          issuedDate,
          address,
          city: "Dallas",
          zipCode: record.zip_code || null,
          contractor: record.contractor || null,
          contractorPhone,
          owner: null,
          workDescription: record.work_description || null,
          estimatedValue: isNaN(estimatedValue as number) ? null : estimatedValue,
          sqft: isNaN(sqft as number) ? null : sqft,
          landUse: record.land_use || null,
          status: null,
          source: "dallas_open_data",
          sourcePermitId,
          metadata: {
            mapsco: record.mapsco,
          },
        });

        if (batch.length >= 100) {
          await db.insert(buildingPermits).values(batch);
          imported += batch.length;
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await db.insert(buildingPermits).values(batch);
        imported += batch.length;
      }

      if (records.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err: any) {
      errors.push(`Dallas Permits fetch error at offset ${offset}: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`[Dallas Permits] Complete: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
  return { imported, skipped, errors };
}

export async function importFortWorthPermits(
  marketId: string,
  options?: { daysBack?: number }
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const daysBack = options?.daysBack ?? 90;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  let offset = 0;
  let hasMore = true;

  console.log(`[Fort Worth Permits] Starting import for market ${marketId}, daysBack=${daysBack}`);

  while (hasMore) {
    const params = new URLSearchParams({
      "$limit": String(PAGE_SIZE),
      "$offset": String(offset),
      "$order": "filing_date DESC",
    });

    try {
      const response = await fetchWithTimeout(`${FORT_WORTH_PERMITS_URL}?${params}`);
      if (!response.ok) {
        console.log(`[Fort Worth Permits] API returned ${response.status}, endpoint may be unavailable. Returning 0 imported.`);
        return { imported: 0, skipped: 0, errors: [`Fort Worth API returned ${response.status}`] };
      }

      const records: any[] = await response.json();
      if (records.length === 0) {
        hasMore = false;
        break;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      const cutoffISO = cutoffDate.toISOString().split("T")[0];

      const batch: InsertBuildingPermit[] = [];

      for (const record of records) {
        const filingDate = record.filing_date?.split("T")[0] || null;
        if (filingDate && filingDate < cutoffISO) {
          continue;
        }

        const permitNumber = record.permit_number;
        if (!permitNumber) continue;

        const address = record.location?.trim();
        if (!address) continue;

        const sourcePermitId = `fw_permit_${permitNumber}`;

        const existing = await db
          .select({ id: buildingPermits.id })
          .from(buildingPermits)
          .where(eq(buildingPermits.sourcePermitId, sourcePermitId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const jobValue = record.job_value ? parseFloat(record.job_value) : null;
        const sqft = record.sqft ? parseInt(record.sqft, 10) : null;

        batch.push({
          marketId,
          permitNumber,
          permitType: record.permit_type || "Unknown",
          issuedDate: filingDate,
          address,
          city: "Fort Worth",
          zipCode: null,
          contractor: null,
          contractorPhone: null,
          owner: record.owners_name || null,
          workDescription: record.work_description || null,
          estimatedValue: isNaN(jobValue as number) ? null : jobValue,
          sqft: isNaN(sqft as number) ? null : sqft,
          landUse: null,
          status: record.status || null,
          source: "fort_worth_open_data",
          sourcePermitId,
          metadata: {
            legalDescription: record.legal_description,
            units: record.units,
          },
        });

        if (batch.length >= 100) {
          await db.insert(buildingPermits).values(batch);
          imported += batch.length;
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await db.insert(buildingPermits).values(batch);
        imported += batch.length;
      }

      if (records.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err: any) {
      console.log(`[Fort Worth Permits] Endpoint failed: ${err.message}. Returning 0 imported.`);
      return { imported: 0, skipped: 0, errors: [`Fort Worth fetch error: ${err.message}`] };
    }
  }

  console.log(`[Fort Worth Permits] Complete: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
  return { imported, skipped, errors };
}

export async function matchPermitsToLeads(
  marketId: string
): Promise<{ matched: number; unmatched: number }> {
  console.log(`[Permit Matching] Starting for market ${marketId}`);

  const allPermits = await db
    .select()
    .from(buildingPermits)
    .where(eq(buildingPermits.marketId, marketId));

  const allLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.marketId, marketId));

  const leadsByNormalizedAddress = new Map<string, Lead>();
  for (const lead of allLeads) {
    const normalized = normalizeAddress(lead.address);
    leadsByNormalizedAddress.set(normalized, lead);
  }

  const leadPermitStats = new Map<string, {
    total: number;
    lastDate: string | null;
    contractors: { name: string; phone: string | null }[];
  }>();

  let matched = 0;
  let unmatched = 0;

  for (const permit of allPermits) {
    const normalizedAddr = normalizeAddress(permit.address);
    const lead = leadsByNormalizedAddress.get(normalizedAddr);

    if (!lead) {
      unmatched++;
      continue;
    }

    matched++;

    if (!permit.leadId) {
      await db
        .update(buildingPermits)
        .set({ leadId: lead.id })
        .where(eq(buildingPermits.id, permit.id));
    }

    const stats = leadPermitStats.get(lead.id) || { total: 0, lastDate: null, contractors: [] };
    stats.total++;
    if (permit.issuedDate) {
      if (!stats.lastDate || permit.issuedDate > stats.lastDate) {
        stats.lastDate = permit.issuedDate;
      }
    }
    if (permit.contractor) {
      const existing = stats.contractors.find((c) => c.name === permit.contractor);
      if (!existing) {
        stats.contractors.push({
          name: permit.contractor,
          phone: permit.contractorPhone,
        });
      }
    }
    leadPermitStats.set(lead.id, stats);
  }

  for (const [leadId, stats] of Array.from(leadPermitStats.entries())) {
    const updates: Partial<Lead> = {
      permitCount: stats.total,
      lastPermitDate: stats.lastDate,
    };

    if (stats.contractors.length > 0) {
      const lead = allLeads.find((l) => l.id === leadId);
      const existingContacts = (lead?.buildingContacts as any[]) || [];
      const newContacts = stats.contractors
        .filter((c) => !existingContacts.some((ec: any) => ec.name === c.name))
        .map((c) => ({
          name: c.name,
          phone: c.phone,
          source: "building_permit",
          role: "contractor",
        }));
      if (newContacts.length > 0) {
        updates.buildingContacts = [...existingContacts, ...newContacts] as any;
      }
    }

    await db
      .update(leads)
      .set(updates)
      .where(eq(leads.id, leadId));
  }

  console.log(`[Permit Matching] Complete: matched=${matched}, unmatched=${unmatched}, leadsUpdated=${leadPermitStats.size}`);
  return { matched, unmatched };
}

const ROOFING_KEYWORDS = [
  "ROOF", "RE-ROOF", "REROOF", "ROOFING", "TEAR OFF", "TEAR-OFF",
  "SHINGLE", "TPO", "EPDM", "MODIFIED BITUMEN", "MOD BIT", "BUILT-UP",
  "BUR ", "METAL ROOF", "FLAT ROOF",
];

export async function importDallasRoofingPermits(
  marketId: string,
  options?: { yearsBack?: number; commercialOnly?: boolean }
): Promise<{ imported: number; skipped: number; total: number; errors: string[] }> {
  const yearsBack = options?.yearsBack ?? 10;
  const commercialOnly = options?.commercialOnly ?? false;

  let imported = 0;
  let skipped = 0;
  let total = 0;
  const errors: string[] = [];
  let offset = 0;
  let hasMore = true;

  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
  const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}T00:00:00`;

  console.log(`[Dallas Roofing Permits] Starting import for market ${marketId}, yearsBack=${yearsBack}, cutoff=${cutoffStr}`);

  while (hasMore) {
    const whereClause = `upper(work_description) like '%ROOF%' OR upper(permit_type) like '%ROOF%'`;
    const params = new URLSearchParams({
      "$limit": String(PAGE_SIZE),
      "$offset": String(offset),
      "$order": "issued_date DESC",
      "$where": whereClause,
    });

    try {
      const response = await fetchWithTimeout(`${DALLAS_PERMITS_URL}?${params}`, 60000);
      if (!response.ok) {
        errors.push(`Dallas Roofing Permits API error ${response.status}: ${response.statusText}`);
        break;
      }

      const records: any[] = await response.json();
      if (records.length === 0) {
        hasMore = false;
        break;
      }

      total += records.length;
      const batch: InsertBuildingPermit[] = [];

      let hitCutoff = false;
      for (const record of records) {
        const issuedDate = parseDallasDate(record.issued_date);
        if (issuedDate && issuedDate < cutoffStr.split("T")[0]) {
          hitCutoff = true;
          continue;
        }

        if (commercialOnly && !isCommercialLandUse(record.land_use)) {
          continue;
        }

        const permitNumber = record.permit_number;
        if (!permitNumber) continue;

        const address = record.street_address?.trim();
        if (!address) continue;

        const sourcePermitId = `dallas_permit_${permitNumber}`;

        const existing = await db
          .select({ id: buildingPermits.id })
          .from(buildingPermits)
          .where(eq(buildingPermits.sourcePermitId, sourcePermitId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const contractorPhone = extractPhoneFromContractor(record.contractor);
        const estimatedValue = record.value ? parseFloat(record.value) : null;
        const sqftVal = record.area ? parseInt(record.area, 10) : null;

        batch.push({
          marketId,
          permitNumber,
          permitType: record.permit_type || "Unknown",
          issuedDate,
          address,
          city: "Dallas",
          zipCode: record.zip_code || null,
          contractor: record.contractor || null,
          contractorPhone,
          owner: null,
          workDescription: record.work_description || null,
          estimatedValue: isNaN(estimatedValue as number) ? null : estimatedValue,
          sqft: isNaN(sqftVal as number) ? null : sqftVal,
          landUse: record.land_use || null,
          status: null,
          source: "dallas_open_data",
          sourcePermitId,
          metadata: {
            mapsco: record.mapsco,
            roofingImport: true,
          },
        });

        if (batch.length >= 100) {
          await db.insert(buildingPermits).values(batch);
          imported += batch.length;
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await db.insert(buildingPermits).values(batch);
        imported += batch.length;
      }

      if (hitCutoff || records.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await sleep(RATE_LIMIT_MS);
      }
    } catch (err: any) {
      errors.push(`Dallas Roofing Permits fetch error at offset ${offset}: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`[Dallas Roofing Permits] Complete: imported=${imported}, skipped=${skipped}, totalFetched=${total}, errors=${errors.length}`);
  return { imported, skipped, total, errors };
}

export async function getRoofingPermitStats(): Promise<{
  totalRoofingPermits: number;
  matchedToLeads: number;
  byYear: { year: string; count: number }[];
  topContractors: { name: string; count: number }[];
}> {
  const roofingWhere = sql`(${buildingPermits.workDescription} ILIKE '%roof%' OR ${buildingPermits.permitType} ILIKE '%roof%')`;

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(roofingWhere);
  const totalRoofingPermits = totalResult[0]?.count ?? 0;

  const matchedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(sql`${roofingWhere} AND ${buildingPermits.leadId} IS NOT NULL`);
  const matchedToLeads = matchedResult[0]?.count ?? 0;

  const byYearResult = await db
    .select({
      year: sql<string>`COALESCE(LEFT(${buildingPermits.issuedDate}, 4), 'Unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(buildingPermits)
    .where(roofingWhere)
    .groupBy(sql`COALESCE(LEFT(${buildingPermits.issuedDate}, 4), 'Unknown')`)
    .orderBy(sql`COALESCE(LEFT(${buildingPermits.issuedDate}, 4), 'Unknown') DESC`);

  const byYear = byYearResult.map((r) => ({ year: r.year, count: r.count }));

  const contractorResult = await db
    .select({
      name: buildingPermits.contractor,
      count: sql<number>`count(*)::int`,
    })
    .from(buildingPermits)
    .where(sql`${roofingWhere} AND ${buildingPermits.contractor} IS NOT NULL AND ${buildingPermits.contractor} != ''`)
    .groupBy(buildingPermits.contractor)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  const topContractors = contractorResult.map((r) => ({
    name: r.name || "Unknown",
    count: r.count,
  }));

  return { totalRoofingPermits, matchedToLeads, byYear, topContractors };
}

export async function getPermitStats(): Promise<{
  totalPermits: number;
  permitsBySource: { source: string; count: number }[];
  matchedPermits: number;
  unmatchedPermits: number;
  recentPermits: number;
}> {
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits);
  const totalPermits = totalResult[0]?.count ?? 0;

  const bySourceResult = await db
    .select({
      source: buildingPermits.source,
      count: sql<number>`count(*)::int`,
    })
    .from(buildingPermits)
    .groupBy(buildingPermits.source);

  const permitsBySource = bySourceResult.map((r) => ({
    source: r.source,
    count: r.count,
  }));

  const matchedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(sql`${buildingPermits.leadId} IS NOT NULL`);
  const matchedPermits = matchedResult[0]?.count ?? 0;

  const unmatchedPermits = totalPermits - matchedPermits;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentCutoff = thirtyDaysAgo.toISOString().split("T")[0];
  const recentResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(sql`${buildingPermits.issuedDate} >= ${recentCutoff}`);
  const recentPermits = recentResult[0]?.count ?? 0;

  return {
    totalPermits,
    permitsBySource,
    matchedPermits,
    unmatchedPermits,
    recentPermits,
  };
}
