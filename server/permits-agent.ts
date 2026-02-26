import { buildingPermits, leads, type InsertBuildingPermit, type Lead } from "@shared/schema";
import { db } from "./storage";
import { eq, and, sql, ilike } from "drizzle-orm";

const DALLAS_PERMITS_URL = "https://www.dallasopendata.com/resource/e7gq-4sah.json";
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

function parseDallasContractorBlob(raw: string): {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
} {
  const backslashMatch = raw.match(/^(.+?)\\(.+?)(?:\/(\d{7,10}))?$/);
  if (backslashMatch) {
    const bsName = backslashMatch[1].trim();
    const addressPart = backslashMatch[2].trim();
    const rawPhone = backslashMatch[3] || null;
    const phone = rawPhone ? `(${rawPhone.slice(0,3)}) ${rawPhone.slice(3,6)}-${rawPhone.slice(6)}` : null;

    const stateZipMatch = addressPart.match(/,?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
    const state = stateZipMatch ? stateZipMatch[1] : null;
    const zip = stateZipMatch ? stateZipMatch[2] : null;
    let addrText = stateZipMatch ? addressPart.replace(stateZipMatch[0], "").trim() : addressPart;

    const cityMatch = addrText.match(/,\s*([A-Za-z\s.]+)\s*$/);
    const city = cityMatch ? cityMatch[1].trim() : null;
    if (cityMatch) addrText = addrText.replace(cityMatch[0], "").trim();

    const address = addrText.replace(/,\s*$/, "").trim() || null;

    return { name: bsName, address, city, state, zip, phone };
  }

  const phoneMatch = raw.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
  const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : null;

  let text = phone ? raw.replace(/\(\d{3}\)\s*\d{3}-\d{4}/, "").trim() : raw;
  text = text.replace(/\(\)\s*-\s*$/, "").trim();

  const stateZipMatch = text.match(/,?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  const state = stateZipMatch ? stateZipMatch[1].toUpperCase() : null;
  const zip = stateZipMatch ? stateZipMatch[2] : null;
  if (stateZipMatch) text = text.replace(stateZipMatch[0], "").trim();

  const cityMatch = text.match(/,\s*([A-Za-z\s.]+)\s*$/);
  const city = cityMatch ? cityMatch[1].trim() : null;
  if (cityMatch) text = text.replace(cityMatch[0], "").trim();

  const addressMatch = text.match(/\s+((?:P\.?O\.?\s*BOX\s+\d+|\d+\s*[A-Za-z0-9\s.,#:]+))$/i);
  let name = text;
  let address: string | null = null;
  if (addressMatch) {
    address = addressMatch[1].trim().replace(/,\s*$/, "");
    name = text.replace(addressMatch[0], "").trim();
  }

  name = name.replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
  return { name, address, city, state, zip, phone };
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

        const parsed = record.contractor ? parseDallasContractorBlob(record.contractor) : null;
        const contractorPhone = parsed?.phone || extractPhoneFromContractor(record.contractor);
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
          contractor: parsed?.name || record.contractor || null,
          contractorPhone,
          contractorAddress: parsed?.address || null,
          contractorCity: parsed?.city || null,
          contractorState: parsed?.state || null,
          contractorZip: parsed?.zip || null,
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
            rawContractor: record.contractor,
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

const FORT_WORTH_ARCGIS_URL = "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query";
const ARCGIS_PAGE_SIZE = 2000;

export async function importFortWorthPermits(
  marketId: string,
  options?: { yearsBack?: number; commercialOnly?: boolean; roofingOnly?: boolean }
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const yearsBack = options?.yearsBack ?? 5;
  const commercialOnly = options?.commercialOnly ?? true;
  const roofingOnly = options?.roofingOnly ?? false;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  let resultOffset = 0;
  let hasMore = true;

  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
  const cutoffISO = cutoffDate.toISOString().split("T")[0] + " 00:00:00";

  console.log(`[Fort Worth Permits] Starting ArcGIS import for market ${marketId}, yearsBack=${yearsBack}, commercialOnly=${commercialOnly}, roofingOnly=${roofingOnly}`);

  let whereClause = `File_Date >= timestamp '${cutoffISO}'`;
  if (roofingOnly) {
    whereClause += ` AND (B1_WORK_DESC LIKE '%ROOF%' OR B1_WORK_DESC LIKE '%Roof%' OR B1_WORK_DESC LIKE '%roof%' OR Permit_Type LIKE '%Roof%')`;
  }
  if (commercialOnly) {
    whereClause += ` AND (Permit_Type LIKE '%Commercial%' OR Permit_Type LIKE '%commercial%' OR Permit_Category LIKE '%Commercial%' OR Use_Type LIKE '%Commercial%' OR Use_Type LIKE '%COMMERCIAL%' OR Use_Type LIKE '%Industrial%' OR Use_Type LIKE '%Multi%' OR Specific_Use LIKE '%Office%' OR Specific_Use LIKE '%Warehouse%' OR Specific_Use LIKE '%Retail%' OR Specific_Use LIKE '%Hotel%' OR Specific_Use LIKE '%Church%' OR Specific_Use LIKE '%Hospital%' OR Specific_Use LIKE '%Restaurant%')`;
  }

  while (hasMore) {
    try {
      const params = new URLSearchParams({
        where: whereClause,
        outFields: "Permit_No,Permit_Type,Permit_SubType,B1_WORK_DESC,Full_Street_Address,Zip_Code,Owner_Full_Name,File_Date,JobValue,SqFt,Use_Type,Specific_Use",
        f: "json",
        resultRecordCount: String(ARCGIS_PAGE_SIZE),
        resultOffset: String(resultOffset),
        orderByFields: "File_Date DESC",
      });

      const response = await fetchWithTimeout(`${FORT_WORTH_ARCGIS_URL}?${params}`, 60000);
      if (!response.ok) {
        errors.push(`Fort Worth ArcGIS API error ${response.status}`);
        break;
      }

      const data = await response.json();
      if (!data.features || !Array.isArray(data.features) || data.features.length === 0) {
        hasMore = false;
        break;
      }

      const batch: InsertBuildingPermit[] = [];

      for (const feature of data.features) {
        const attrs = feature.attributes || {};
        const permitNumber = attrs.Permit_No;
        if (!permitNumber) continue;

        const address = (attrs.Full_Street_Address || "").trim();
        if (!address) continue;

        const sourcePermitId = `fw_arcgis_${permitNumber}`;

        const existing = await db
          .select({ id: buildingPermits.id })
          .from(buildingPermits)
          .where(eq(buildingPermits.sourcePermitId, sourcePermitId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const fileDate = attrs.File_Date ? new Date(attrs.File_Date).toISOString().split("T")[0] : null;
        const jobValue = attrs.JobValue ? parseFloat(attrs.JobValue) : null;
        const sqft = attrs.SqFt ? parseInt(attrs.SqFt, 10) : null;

        batch.push({
          marketId,
          permitNumber,
          permitType: attrs.Permit_Type || attrs.Permit_SubType || "Unknown",
          issuedDate: fileDate,
          address,
          city: "Fort Worth",
          zipCode: attrs.Zip_Code || null,
          contractor: null,
          contractorPhone: null,
          owner: attrs.Owner_Full_Name || null,
          applicantName: attrs.Owner_Full_Name || null,
          workDescription: attrs.B1_WORK_DESC || null,
          estimatedValue: isNaN(jobValue as number) ? null : jobValue,
          sqft: isNaN(sqft as number) ? null : sqft,
          landUse: attrs.Use_Type || attrs.Specific_Use || null,
          status: null,
          source: "fort_worth_arcgis",
          sourcePermitId,
          metadata: {
            permitSubType: attrs.Permit_SubType,
            specificUse: attrs.Specific_Use,
            useType: attrs.Use_Type,
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

      if (data.exceededTransferLimit || data.features.length >= ARCGIS_PAGE_SIZE) {
        resultOffset += ARCGIS_PAGE_SIZE;
        await sleep(RATE_LIMIT_MS);
      } else {
        hasMore = false;
      }
    } catch (err: any) {
      errors.push(`Fort Worth ArcGIS fetch error at offset ${resultOffset}: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`[Fort Worth Permits] Complete: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
  return { imported, skipped, errors };
}

export async function matchPermitsToLeads(
  marketId: string
): Promise<{ matched: number; unmatched: number; evidenceRecorded: number }> {
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
    contractors: { name: string; phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; zip: string | null }[];
    owners: string[];
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

    const stats = leadPermitStats.get(lead.id) || { total: 0, lastDate: null, contractors: [], owners: [] };
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
          email: permit.contractorEmail,
          address: permit.contractorAddress,
          city: permit.contractorCity,
          state: permit.contractorState,
          zip: permit.contractorZip,
        });
      }
    }
    if (permit.owner && !stats.owners.includes(permit.owner)) {
      stats.owners.push(permit.owner);
    }
    if (permit.applicantName && !stats.owners.includes(permit.applicantName) && permit.applicantName !== permit.owner) {
      stats.owners.push(permit.applicantName);
    }
    leadPermitStats.set(lead.id, stats);
  }

  let evidenceRecorded = 0;
  let recordBatchEvidence: typeof import("./evidence-recorder").recordBatchEvidence | null = null;
  try {
    const evidenceModule = await import("./evidence-recorder");
    recordBatchEvidence = evidenceModule.recordBatchEvidence;
  } catch {}

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
          email: c.email,
          address: c.address ? `${c.address}${c.city ? `, ${c.city}` : ""}${c.state ? `, ${c.state}` : ""}${c.zip ? ` ${c.zip}` : ""}` : null,
          source: "building_permit",
          role: "contractor",
        }));
      if (newContacts.length > 0) {
        updates.buildingContacts = [...existingContacts, ...newContacts] as any;
      }
    }

    if ((stats.contractors.length > 0 || stats.owners.length > 0) && recordBatchEvidence) {
      const evidenceBatch: any[] = [];
      for (const c of stats.contractors) {
        if (c.phone) {
          evidenceBatch.push({
            leadId,
            contactType: "phone",
            contactValue: c.phone,
            sourceName: "Dallas Building Permits",
            sourceUrl: "https://www.dallasopendata.com/resource/e7gq-4sah.json",
            confidence: 70,
            extractorMethod: "RULE",
            rawSnippet: `Contractor: ${c.name}`,
          });
        }
        if (c.email) {
          evidenceBatch.push({
            leadId,
            contactType: "email",
            contactValue: c.email,
            sourceName: "Dallas Building Permits",
            sourceUrl: "https://www.dallasopendata.com/resource/e7gq-4sah.json",
            confidence: 70,
            extractorMethod: "RULE",
            rawSnippet: `Contractor: ${c.name}`,
          });
        }
      }
      for (const ownerName of stats.owners) {
        evidenceBatch.push({
          leadId,
          contactType: "name",
          contactValue: ownerName,
          sourceName: "Fort Worth Building Permits",
          sourceUrl: FORT_WORTH_ARCGIS_URL,
          confidence: 75,
          extractorMethod: "RULE",
          rawSnippet: `Permit Owner/Applicant: ${ownerName}`,
        });
      }
      if (evidenceBatch.length > 0) {
        try {
          await recordBatchEvidence(evidenceBatch);
          evidenceRecorded += evidenceBatch.length;
        } catch (err: any) {
          console.log(`[Permit Matching] Evidence recording failed for lead ${leadId}: ${err.message}`);
        }
      }
    }

    await db
      .update(leads)
      .set(updates)
      .where(eq(leads.id, leadId));
  }

  console.log(`[Permit Matching] Complete: matched=${matched}, unmatched=${unmatched}, leadsUpdated=${leadPermitStats.size}, evidenceRecorded=${evidenceRecorded}`);
  return { matched, unmatched, evidenceRecorded };
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

        const parsed = record.contractor ? parseDallasContractorBlob(record.contractor) : null;
        const contractorPhone = parsed?.phone || extractPhoneFromContractor(record.contractor);
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
          contractor: parsed?.name || record.contractor || null,
          contractorPhone,
          contractorAddress: parsed?.address || null,
          contractorCity: parsed?.city || null,
          contractorState: parsed?.state || null,
          contractorZip: parsed?.zip || null,
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

function isGarbageContractorValue(value: string): boolean {
  if (!value || value.trim().length === 0) return true;
  const cleaned = value.replace(/[,\s().\\-]/g, '');
  if (cleaned.length === 0) return true;
  if (cleaned.length < 3) return true;
  const upper = value.trim().toUpperCase();
  if (["N/A", "NONE", "UNKNOWN", "TBD", "NA", ".", "-", "--"].includes(upper)) return true;
  return false;
}

function extractEmailFromBlob(blob: string): string | null {
  const emailMatch = blob.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return emailMatch ? emailMatch[0].toLowerCase() : null;
}

export async function cleanupContractorData(): Promise<{
  totalProcessed: number;
  cleaned: number;
  nulled: number;
  phonesPopulated: number;
  addressesPopulated: number;
  emailsExtracted: number;
  errors: string[];
}> {
  let totalProcessed = 0;
  let cleaned = 0;
  let nulled = 0;
  let phonesPopulated = 0;
  let addressesPopulated = 0;
  let emailsExtracted = 0;
  const errors: string[] = [];

  console.log(`[Contractor Cleanup] Starting contractor data cleanup...`);

  const PAGE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const permits = await db
      .select({
        id: buildingPermits.id,
        contractor: buildingPermits.contractor,
        contractorPhone: buildingPermits.contractorPhone,
        contractorEmail: buildingPermits.contractorEmail,
        contractorAddress: buildingPermits.contractorAddress,
        contractorCity: buildingPermits.contractorCity,
        contractorState: buildingPermits.contractorState,
        contractorZip: buildingPermits.contractorZip,
        metadata: buildingPermits.metadata,
      })
      .from(buildingPermits)
      .where(sql`${buildingPermits.contractor} IS NOT NULL`)
      .limit(PAGE)
      .offset(offset);

    if (permits.length === 0) {
      hasMore = false;
      break;
    }

    for (const permit of permits) {
      totalProcessed++;
      try {
        const currentContractor = permit.contractor || "";

        if (isGarbageContractorValue(currentContractor)) {
          await db
            .update(buildingPermits)
            .set({
              contractor: null,
              contractorPhone: null,
              contractorAddress: null,
              contractorCity: null,
              contractorState: null,
              contractorZip: null,
            })
            .where(eq(buildingPermits.id, permit.id));
          nulled++;
          continue;
        }

        const rawBlob = (permit.metadata as any)?.rawContractor || currentContractor;

        const parsed = parseDallasContractorBlob(rawBlob);
        const updates: Record<string, any> = {};

        if (parsed.name && !isGarbageContractorValue(parsed.name) && parsed.name !== currentContractor) {
          updates.contractor = parsed.name;
          cleaned++;
        }

        if (!permit.contractorPhone && parsed.phone) {
          updates.contractorPhone = parsed.phone;
          phonesPopulated++;
        }
        if (!permit.contractorAddress && parsed.address) {
          updates.contractorAddress = parsed.address;
          addressesPopulated++;
        }
        if (!permit.contractorCity && parsed.city) {
          updates.contractorCity = parsed.city;
        }
        if (!permit.contractorState && parsed.state) {
          updates.contractorState = parsed.state;
        }
        if (!permit.contractorZip && parsed.zip) {
          updates.contractorZip = parsed.zip;
        }

        const email = extractEmailFromBlob(rawBlob);
        if (email && !permit.contractorEmail) {
          updates.contractorEmail = email;
          emailsExtracted++;
        }

        if (Object.keys(updates).length > 0) {
          await db
            .update(buildingPermits)
            .set(updates)
            .where(eq(buildingPermits.id, permit.id));
        }
      } catch (err: any) {
        errors.push(`Error processing permit ${permit.id}: ${err.message}`);
      }
    }

    if (permits.length < PAGE) {
      hasMore = false;
    } else {
      offset += PAGE;
    }
  }

  console.log(`[Contractor Cleanup] Complete: processed=${totalProcessed}, cleaned=${cleaned}, nulled=${nulled}, phones=${phonesPopulated}, addresses=${addressesPopulated}, emails=${emailsExtracted}, errors=${errors.length}`);
  return { totalProcessed, cleaned, nulled, phonesPopulated, addressesPopulated, emailsExtracted, errors };
}

export async function getPermitStats(): Promise<{
  totalPermits: number;
  permitsBySource: { source: string; count: number }[];
  matchedPermits: number;
  unmatchedPermits: number;
  recentPermits: number;
  withOwnerName: number;
  withContractorPhone: number;
  withContractorAddress: number;
  dateRange: { earliest: string | null; latest: string | null };
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

  const ownerResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(sql`${buildingPermits.owner} IS NOT NULL AND ${buildingPermits.owner} != ''`);
  const withOwnerName = ownerResult[0]?.count ?? 0;

  const phoneResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(sql`${buildingPermits.contractorPhone} IS NOT NULL AND ${buildingPermits.contractorPhone} != ''`);
  const withContractorPhone = phoneResult[0]?.count ?? 0;

  const addrResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(buildingPermits)
    .where(sql`${buildingPermits.contractorAddress} IS NOT NULL AND ${buildingPermits.contractorAddress} != ''`);
  const withContractorAddress = addrResult[0]?.count ?? 0;

  const dateRangeResult = await db
    .select({
      earliest: sql<string>`min(${buildingPermits.issuedDate})`,
      latest: sql<string>`max(${buildingPermits.issuedDate})`,
    })
    .from(buildingPermits);
  const dateRange = {
    earliest: dateRangeResult[0]?.earliest || null,
    latest: dateRangeResult[0]?.latest || null,
  };

  return {
    totalPermits,
    permitsBySource,
    matchedPermits,
    unmatchedPermits,
    recentPermits,
    withOwnerName,
    withContractorPhone,
    withContractorAddress,
    dateRange,
  };
}
