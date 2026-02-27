import { db } from "./storage";
import { leads } from "@shared/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";

export interface PropStreamImportProgress {
  status: "idle" | "running" | "completed" | "failed";
  totalRows: number;
  processed: number;
  matched: number;
  updated: number;
  skipped: number;
  unmatched: number;
  fieldsUpdated: Record<string, number>;
  errors: number;
  errorMessages: string[];
  startedAt: string | null;
  completedAt: string | null;
}

let importProgress: PropStreamImportProgress = {
  status: "idle",
  totalRows: 0,
  processed: 0,
  matched: 0,
  updated: 0,
  skipped: 0,
  unmatched: 0,
  fieldsUpdated: {},
  errors: 0,
  errorMessages: [],
  startedAt: null,
  completedAt: null,
};

export function getPropStreamImportProgress(): PropStreamImportProgress {
  return { ...importProgress };
}

interface PropStreamColumnMapping {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  yearBuilt?: string;
  lastSaleDate?: string;
  lastSaleAmount?: string;
  lotSizeSqft?: string;
  lotSizeAcres?: string;
  landUse?: string;
  propertyType?: string;
  livingSqft?: string;
  schoolDistrict?: string;
  subdivision?: string;
  ownerName?: string;
  apn?: string;
  bedrooms?: string;
  bathrooms?: string;
}

const HEADER_PATTERNS: Record<keyof PropStreamColumnMapping, RegExp[]> = {
  address: [/property\s*address/i, /situs\s*address/i, /^address$/i, /street\s*address/i, /site\s*address/i],
  city: [/^city$/i, /situs\s*city/i, /property\s*city/i],
  state: [/^state$/i, /situs\s*state/i],
  zip: [/^zip$/i, /zip\s*code/i, /postal/i, /situs\s*zip/i],
  county: [/^county$/i],
  yearBuilt: [/year\s*built/i, /yr\s*built/i, /year\s*blt/i],
  lastSaleDate: [/last\s*sale\s*date/i, /sale\s*date/i, /transfer\s*date/i, /deed\s*date/i, /closing\s*date/i],
  lastSaleAmount: [/last\s*sale\s*(?:amount|price)/i, /sale\s*(?:amount|price)/i, /transfer\s*(?:amount|price)/i],
  lotSizeSqft: [/lot\s*(?:size\s*)?sq\s*ft/i, /lot\s*(?:size\s*)?sqft/i, /land\s*sq\s*ft/i, /lot\s*area.*sqft/i],
  lotSizeAcres: [/lot\s*(?:size\s*)?acres/i, /land\s*acres/i, /acreage/i, /lot\s*area.*acre/i],
  landUse: [/land\s*use/i, /use\s*code/i, /property\s*use/i, /use\s*description/i],
  propertyType: [/property\s*type/i, /prop\s*type/i],
  livingSqft: [/living\s*sq\s*ft/i, /living\s*sqft/i, /building\s*sq\s*ft/i, /building\s*area/i, /heated\s*sq/i, /total\s*sq\s*ft/i],
  schoolDistrict: [/school\s*district/i, /school/i],
  subdivision: [/subdivision/i, /subdiv/i, /plat\s*name/i],
  ownerName: [/owner\s*(?:1\s*)?name/i, /^owner$/i, /owner\s*1/i],
  apn: [/^apn$/i, /parcel\s*(?:number|id|num)/i, /account\s*(?:number|num|id)/i, /tax\s*id/i, /prop\s*id/i],
  bedrooms: [/bed(?:room)?s?$/i, /^beds$/i],
  bathrooms: [/bath(?:room)?s?$/i, /^baths$/i],
};

function detectColumnMapping(headers: string[]): PropStreamColumnMapping {
  const mapping: PropStreamColumnMapping = {};
  const usedIndices = new Set<number>();

  for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
    for (const pattern of patterns) {
      const idx = headers.findIndex((h, i) => !usedIndices.has(i) && pattern.test(h.trim()));
      if (idx !== -1) {
        (mapping as any)[field] = headers[idx].trim();
        usedIndices.add(idx);
        break;
      }
    }
  }

  return mapping;
}

function normalizeAddress(addr: string): string {
  if (!addr) return "";
  let normalized = addr.toUpperCase().trim();
  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.replace(/\bSTREET\b/g, "ST");
  normalized = normalized.replace(/\bAVENUE\b/g, "AVE");
  normalized = normalized.replace(/\bBOULEVARD\b/g, "BLVD");
  normalized = normalized.replace(/\bDRIVE\b/g, "DR");
  normalized = normalized.replace(/\bLANE\b/g, "LN");
  normalized = normalized.replace(/\bROAD\b/g, "RD");
  normalized = normalized.replace(/\bCOURT\b/g, "CT");
  normalized = normalized.replace(/\bCIRCLE\b/g, "CIR");
  normalized = normalized.replace(/\bPLACE\b/g, "PL");
  normalized = normalized.replace(/\bPARKWAY\b/g, "PKWY");
  normalized = normalized.replace(/\bEXPRESSWAY\b/g, "EXPY");
  normalized = normalized.replace(/\bHIGHWAY\b/g, "HWY");
  normalized = normalized.replace(/\bFREEWAY\b/g, "FWY");
  normalized = normalized.replace(/\bTERRACE\b/g, "TER");
  normalized = normalized.replace(/\bTRAIL\b/g, "TRL");
  normalized = normalized.replace(/\bWAY\b/g, "WAY");
  normalized = normalized.replace(/\bNORTH\b/g, "N");
  normalized = normalized.replace(/\bSOUTH\b/g, "S");
  normalized = normalized.replace(/\bEAST\b/g, "E");
  normalized = normalized.replace(/\bWEST\b/g, "W");
  normalized = normalized.replace(/\bSUITE\s*/gi, "STE ");
  normalized = normalized.replace(/\bAPT\.?\s*/gi, "APT ");
  normalized = normalized.replace(/\bUNIT\s*/gi, "UNIT ");
  normalized = normalized.replace(/\s*#\s*/g, " #");
  normalized = normalized.replace(/[.,]/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

function getBaseAddress(addr: string): string {
  const normalized = normalizeAddress(addr);
  return normalized
    .replace(/\s+(STE|APT|UNIT|#|BLDG|FL|FLOOR|RM|ROOM)\s+.*$/i, "")
    .trim();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  const cleaned = dateStr.trim();
  const mmddyyyy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const yyyymmdd = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const [, y, m, d] = yyyymmdd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return null;
}

function parseNumber(val: string | undefined): number | null {
  if (!val || !val.trim()) return null;
  const cleaned = val.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseYear(val: string | undefined): number | null {
  if (!val || !val.trim()) return null;
  const num = parseInt(val.trim());
  if (isNaN(num)) return null;
  if (num >= 1800 && num <= 2030) return num;
  return null;
}

export async function importPropStreamCsv(csvContent: string): Promise<PropStreamImportProgress> {
  if (importProgress.status === "running") {
    throw new Error("An import is already in progress");
  }

  importProgress = {
    status: "running",
    totalRows: 0,
    processed: 0,
    matched: 0,
    updated: 0,
    skipped: 0,
    unmatched: 0,
    fieldsUpdated: {},
    errors: 0,
    errorMessages: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  try {
    const lines = csvContent.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      throw new Error("CSV file is empty or has no data rows");
    }

    const headers = parseCsvLine(lines[0]);
    const mapping = detectColumnMapping(headers);

    if (!mapping.address) {
      throw new Error("Could not detect an address column in the CSV. Expected headers like 'Property Address', 'Address', or 'Situs Address'.");
    }

    console.log(`[PropStream Import] Detected columns:`, Object.entries(mapping).map(([k, v]) => `${k}=${v}`).join(", "));

    const dataRows = lines.slice(1);
    importProgress.totalRows = dataRows.length;

    const allLeads = await db.select({
      id: leads.id,
      address: leads.address,
      city: leads.city,
      zipCode: leads.zipCode,
      yearBuilt: leads.yearBuilt,
      lastDeedDate: leads.lastDeedDate,
      landAcreage: leads.landAcreage,
      landSqft: leads.landSqft,
      subdivisionName: leads.subdivisionName,
      schoolDistrict: leads.schoolDistrict,
      propertyUseDescription: leads.propertyUseDescription,
      previousMarketValue: leads.previousMarketValue,
      sqft: leads.sqft,
      sourceId: leads.sourceId,
    }).from(leads);

    const addressIndex = new Map<string, typeof allLeads[0][]>();
    for (const lead of allLeads) {
      const baseAddr = getBaseAddress(lead.address || "");
      const city = (lead.city || "").toUpperCase().trim();
      const key = `${baseAddr}|${city}`;
      if (!addressIndex.has(key)) addressIndex.set(key, []);
      addressIndex.get(key)!.push(lead);

      const zipKey = `${baseAddr}|${(lead.zipCode || "").replace(/\D/g, "").slice(0, 5)}`;
      if (zipKey !== key) {
        if (!addressIndex.has(zipKey)) addressIndex.set(zipKey, []);
        addressIndex.get(zipKey)!.push(lead);
      }
    }

    console.log(`[PropStream Import] Built address index with ${addressIndex.size} entries from ${allLeads.length} leads`);

    const headerIndexMap: Record<string, number> = {};
    for (const header of headers) {
      headerIndexMap[header.trim()] = headers.indexOf(header);
    }

    function getVal(row: string[], columnName: string | undefined): string | undefined {
      if (!columnName) return undefined;
      const idx = headerIndexMap[columnName];
      if (idx === undefined || idx < 0 || idx >= row.length) return undefined;
      const val = row[idx]?.trim();
      return val || undefined;
    }

    for (let i = 0; i < dataRows.length; i++) {
      try {
        const values = parseCsvLine(dataRows[i]);
        if (values.length < 3) {
          importProgress.skipped++;
          importProgress.processed++;
          continue;
        }

        const rawAddress = getVal(values, mapping.address);
        const rawCity = getVal(values, mapping.city);
        const rawZip = getVal(values, mapping.zip);

        if (!rawAddress) {
          importProgress.skipped++;
          importProgress.processed++;
          continue;
        }

        const baseAddr = getBaseAddress(rawAddress);
        const city = (rawCity || "").toUpperCase().trim();
        const zip = (rawZip || "").replace(/\D/g, "").slice(0, 5);

        let matchedLeads = addressIndex.get(`${baseAddr}|${city}`) || [];
        if (matchedLeads.length === 0 && zip) {
          matchedLeads = addressIndex.get(`${baseAddr}|${zip}`) || [];
        }

        if (matchedLeads.length === 0) {
          const fuzzyKey = [...addressIndex.keys()].find(k => {
            const [addr] = k.split("|");
            return addr === baseAddr;
          });
          if (fuzzyKey) {
            matchedLeads = addressIndex.get(fuzzyKey) || [];
          }
        }

        if (matchedLeads.length === 0) {
          importProgress.unmatched++;
          importProgress.processed++;
          continue;
        }

        importProgress.matched++;

        const uniqueLeadIds = new Set<string>();
        const uniqueLeads = matchedLeads.filter(l => {
          if (uniqueLeadIds.has(l.id)) return false;
          uniqueLeadIds.add(l.id);
          return true;
        });

        for (const lead of uniqueLeads) {
          const updates: Record<string, any> = {};
          let fieldCount = 0;

          const csvYearBuilt = parseYear(getVal(values, mapping.yearBuilt));
          if (csvYearBuilt && (lead.yearBuilt === null || lead.yearBuilt === 1995 || lead.yearBuilt === 1900 || lead.yearBuilt === 0)) {
            updates.yearBuilt = csvYearBuilt;
            fieldCount++;
            importProgress.fieldsUpdated["yearBuilt"] = (importProgress.fieldsUpdated["yearBuilt"] || 0) + 1;
          }

          const csvSaleDate = parseDate(getVal(values, mapping.lastSaleDate));
          if (csvSaleDate && !lead.lastDeedDate) {
            updates.lastDeedDate = csvSaleDate;
            fieldCount++;
            importProgress.fieldsUpdated["lastDeedDate"] = (importProgress.fieldsUpdated["lastDeedDate"] || 0) + 1;
          }

          const csvSaleAmount = parseNumber(getVal(values, mapping.lastSaleAmount));
          if (csvSaleAmount && csvSaleAmount > 0 && !lead.previousMarketValue) {
            updates.previousMarketValue = Math.round(csvSaleAmount);
            fieldCount++;
            importProgress.fieldsUpdated["previousMarketValue"] = (importProgress.fieldsUpdated["previousMarketValue"] || 0) + 1;
          }

          const csvLotAcres = parseNumber(getVal(values, mapping.lotSizeAcres));
          if (csvLotAcres && csvLotAcres > 0 && !lead.landAcreage) {
            updates.landAcreage = csvLotAcres;
            fieldCount++;
            importProgress.fieldsUpdated["landAcreage"] = (importProgress.fieldsUpdated["landAcreage"] || 0) + 1;
          }

          const csvLotSqft = parseNumber(getVal(values, mapping.lotSizeSqft));
          if (csvLotSqft && csvLotSqft > 0 && !lead.landSqft) {
            updates.landSqft = Math.round(csvLotSqft);
            fieldCount++;
            importProgress.fieldsUpdated["landSqft"] = (importProgress.fieldsUpdated["landSqft"] || 0) + 1;
          }

          const csvSubdivision = getVal(values, mapping.subdivision);
          if (csvSubdivision && !lead.subdivisionName) {
            updates.subdivisionName = csvSubdivision;
            fieldCount++;
            importProgress.fieldsUpdated["subdivisionName"] = (importProgress.fieldsUpdated["subdivisionName"] || 0) + 1;
          }

          const csvSchool = getVal(values, mapping.schoolDistrict);
          if (csvSchool && !lead.schoolDistrict) {
            updates.schoolDistrict = csvSchool;
            fieldCount++;
            importProgress.fieldsUpdated["schoolDistrict"] = (importProgress.fieldsUpdated["schoolDistrict"] || 0) + 1;
          }

          const csvLandUse = getVal(values, mapping.landUse) || getVal(values, mapping.propertyType);
          if (csvLandUse && !lead.propertyUseDescription) {
            updates.propertyUseDescription = csvLandUse;
            fieldCount++;
            importProgress.fieldsUpdated["propertyUseDescription"] = (importProgress.fieldsUpdated["propertyUseDescription"] || 0) + 1;
          }

          const csvLivingSqft = parseNumber(getVal(values, mapping.livingSqft));
          if (csvLivingSqft && csvLivingSqft > 0 && (!lead.sqft || lead.sqft === 0)) {
            updates.sqft = Math.round(csvLivingSqft);
            fieldCount++;
            importProgress.fieldsUpdated["sqft"] = (importProgress.fieldsUpdated["sqft"] || 0) + 1;
          }

          if (fieldCount > 0) {
            await db.update(leads).set(updates).where(eq(leads.id, lead.id));
            importProgress.updated++;
          } else {
            importProgress.skipped++;
          }
        }

        importProgress.processed++;

        if (i % 500 === 0 && i > 0) {
          console.log(`[PropStream Import] Progress: ${i}/${dataRows.length} rows, ${importProgress.matched} matched, ${importProgress.updated} updated`);
        }
      } catch (rowErr: any) {
        importProgress.errors++;
        if (importProgress.errorMessages.length < 20) {
          importProgress.errorMessages.push(`Row ${i + 2}: ${rowErr.message}`);
        }
        importProgress.processed++;
      }
    }

    importProgress.status = "completed";
    importProgress.completedAt = new Date().toISOString();
    console.log(`[PropStream Import] Complete: ${importProgress.matched} matched, ${importProgress.updated} updated, ${importProgress.unmatched} unmatched, ${importProgress.errors} errors`);
    console.log(`[PropStream Import] Fields updated:`, importProgress.fieldsUpdated);

  } catch (err: any) {
    importProgress.status = "failed";
    importProgress.completedAt = new Date().toISOString();
    importProgress.errorMessages.push(err.message);
    console.error(`[PropStream Import] Failed:`, err.message);
  }

  return importProgress;
}
