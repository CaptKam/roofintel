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
  unit?: string;
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
  mobile?: string;
  landline?: string;
  otherPhone?: string;
  email?: string;
  owner1FirstName?: string;
  owner1LastName?: string;
  owner2FirstName?: string;
  owner2LastName?: string;
  mailingCareOf?: string;
  mailingAddress?: string;
  mailingUnit?: string;
  mailingCity?: string;
  mailingState?: string;
  mailingZip?: string;
  mailingCounty?: string;
  ownerOccupied?: string;
  doNotMail?: string;
  totalAssessedValue?: string;
  totalOpenLoans?: string;
  estRemainingBalance?: string;
  estValue?: string;
  estLtv?: string;
  estEquity?: string;
  totalCondition?: string;
  interiorCondition?: string;
  exteriorCondition?: string;
  foreclosureFactor?: string;
  mlsStatus?: string;
  mlsAmount?: string;
  lienAmount?: string;
}

const HEADER_PATTERNS: Record<keyof PropStreamColumnMapping, RegExp[]> = {
  address: [/property\s*address/i, /situs\s*address/i, /^address$/i, /street\s*address/i, /site\s*address/i],
  unit: [/^unit\s*#?$/i, /^unit\s*number$/i],
  city: [/^city$/i, /situs\s*city/i, /property\s*city/i],
  state: [/^state$/i, /situs\s*state/i],
  zip: [/^zip$/i, /zip\s*code/i, /postal/i, /situs\s*zip/i],
  county: [/^county$/i],
  yearBuilt: [/effective\s*year\s*built/i, /year\s*built/i, /yr\s*built/i, /year\s*blt/i],
  lastSaleDate: [/last\s*sale\s*recording\s*date/i, /last\s*sale\s*date/i, /sale\s*date/i, /transfer\s*date/i, /deed\s*date/i, /closing\s*date/i],
  lastSaleAmount: [/last\s*sale\s*amount/i, /sale\s*(?:amount|price)/i, /transfer\s*(?:amount|price)/i],
  lotSizeSqft: [/lot\s*(?:size\s*)?sq\s*ft/i, /lot\s*(?:size\s*)?sqft/i, /land\s*sq\s*ft/i, /lot\s*area.*sqft/i],
  lotSizeAcres: [/lot\s*(?:size\s*)?acres/i, /land\s*acres/i, /acreage/i, /lot\s*area.*acre/i],
  landUse: [/land\s*use/i, /use\s*code/i, /use\s*description/i],
  propertyType: [/property\s*type/i, /prop\s*type/i],
  livingSqft: [/building\s*sq\s*ft/i, /building\s*sqft/i, /living\s*sq\s*ft/i, /living\s*sqft/i, /building\s*area/i, /heated\s*sq/i, /total\s*sq\s*ft/i],
  schoolDistrict: [/school\s*district/i, /school/i],
  subdivision: [/subdivision/i, /subdiv/i, /plat\s*name/i],
  ownerName: [/owner\s*(?:1\s*)?name/i, /^owner$/i],
  apn: [/^apn$/i, /parcel\s*(?:number|id|num)/i, /account\s*(?:number|num|id)/i, /tax\s*id/i, /prop\s*id/i],
  bedrooms: [/bed(?:room)?s?$/i, /^beds$/i],
  bathrooms: [/bath(?:room)?s?$/i, /^baths$/i, /total\s*bathrooms/i],
  mobile: [/^mobile$/i, /mobile\s*phone/i, /cell\s*phone/i, /cell/i],
  landline: [/^landline$/i, /land\s*line/i, /home\s*phone/i],
  otherPhone: [/^other$/i, /other\s*phone/i],
  email: [/^email$/i, /e-?mail\s*address/i],
  owner1FirstName: [/owner\s*1\s*first\s*name/i],
  owner1LastName: [/owner\s*1\s*last\s*name/i],
  owner2FirstName: [/owner\s*2\s*first\s*name/i],
  owner2LastName: [/owner\s*2\s*last\s*name/i],
  mailingCareOf: [/mailing\s*care\s*of/i, /care\s*of\s*name/i],
  mailingAddress: [/mailing\s*address/i],
  mailingUnit: [/mailing\s*unit/i],
  mailingCity: [/mailing\s*city/i],
  mailingState: [/mailing\s*state/i],
  mailingZip: [/mailing\s*zip/i],
  mailingCounty: [/mailing\s*county/i],
  ownerOccupied: [/owner\s*occupied/i],
  doNotMail: [/do\s*not\s*mail/i],
  totalAssessedValue: [/total\s*assessed\s*value/i, /assessed\s*value/i],
  totalOpenLoans: [/total\s*open\s*loans/i, /open\s*loans/i],
  estRemainingBalance: [/est\.?\s*remaining\s*balance/i, /remaining\s*balance/i, /loan\s*balance/i],
  estValue: [/est\.?\s*value/i, /estimated\s*value/i],
  estLtv: [/est\.?\s*loan.to.value/i, /loan.to.value/i, /ltv/i],
  estEquity: [/est\.?\s*equity/i, /estimated\s*equity/i],
  totalCondition: [/total\s*condition/i, /overall\s*condition/i],
  interiorCondition: [/interior\s*condition/i],
  exteriorCondition: [/exterior\s*condition/i],
  foreclosureFactor: [/foreclosure\s*factor/i],
  mlsStatus: [/mls\s*status/i],
  mlsAmount: [/mls\s*amount/i],
  lienAmount: [/lien\s*amount/i],
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
  const cleaned = val.replace(/[$,\s]/g, "").replace(/\s*Est\.?$/i, "");
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

function parsePhoneNumbers(val: string | undefined): string[] {
  if (!val || !val.trim()) return [];
  return val.split(",").map(p => p.trim()).filter(p => p.length >= 7);
}

function parseEmails(val: string | undefined): string[] {
  if (!val || !val.trim()) return [];
  return val.split(",").map(e => e.trim().toLowerCase()).filter(e => e.includes("@") && e.includes("."));
}

function buildFullMailingAddress(
  address: string | undefined,
  unit: string | undefined,
  city: string | undefined,
  state: string | undefined,
  zip: string | undefined
): string | null {
  const parts: string[] = [];
  if (address) {
    let addr = address.trim();
    if (unit && unit.trim()) addr += ` #${unit.trim()}`;
    parts.push(addr);
  }
  if (city) parts.push(city.trim());
  if (state) parts.push(state.trim());
  if (zip) parts.push(zip.trim());
  const result = parts.join(", ");
  return result.length > 5 ? result : null;
}

interface ParsedRow {
  [key: string]: string;
}

async function parseXlsxBuffer(buffer: Buffer): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rawData.length < 2) {
    throw new Error("Excel file is empty or has no data rows");
  }
  const headers = rawData[0].map((h: any) => String(h).trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const row: ParsedRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = String(rawData[i][j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

function parseCsvContent(csvContent: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows");
  }
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: ParsedRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

export async function importPropStreamFile(fileBuffer: Buffer, fileName: string): Promise<PropStreamImportProgress> {
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
    const isExcel = /\.xlsx?$/i.test(fileName);
    let headers: string[];
    let dataRows: ParsedRow[];

    if (isExcel) {
      const parsed = await parseXlsxBuffer(fileBuffer);
      headers = parsed.headers;
      dataRows = parsed.rows;
      console.log(`[PropStream Import] Parsed Excel file: ${dataRows.length} rows, ${headers.length} columns`);
    } else {
      const csvContent = fileBuffer.toString("utf-8");
      const parsed = parseCsvContent(csvContent);
      headers = parsed.headers;
      dataRows = parsed.rows;
      console.log(`[PropStream Import] Parsed CSV file: ${dataRows.length} rows, ${headers.length} columns`);
    }

    const mapping = detectColumnMapping(headers);
    if (!mapping.address) {
      throw new Error("Could not detect an address column. Expected headers like 'Property Address', 'Address', or 'Situs Address'.");
    }

    const detectedFields = Object.entries(mapping).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    console.log(`[PropStream Import] Detected ${detectedFields.length} columns: ${detectedFields.join(", ")}`);

    importProgress.totalRows = dataRows.length;

    const allLeads = await db.select({
      id: leads.id,
      address: leads.address,
      city: leads.city,
      zipCode: leads.zipCode,
      yearBuilt: leads.yearBuilt,
      effectiveYearBuilt: leads.effectiveYearBuilt,
      lastDeedDate: leads.lastDeedDate,
      landAcreage: leads.landAcreage,
      landSqft: leads.landSqft,
      subdivisionName: leads.subdivisionName,
      schoolDistrict: leads.schoolDistrict,
      propertyUseDescription: leads.propertyUseDescription,
      previousMarketValue: leads.previousMarketValue,
      sqft: leads.sqft,
      sourceId: leads.sourceId,
      ownerPhone: leads.ownerPhone,
      ownerEmail: leads.ownerEmail,
      contactName: leads.contactName,
      contactPhone: leads.contactPhone,
      contactEmail: leads.contactEmail,
      secondOwner: leads.secondOwner,
      ownerAddress: leads.ownerAddress,
      dncRegistered: leads.dncRegistered,
      totalValue: leads.totalValue,
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

    function getVal(row: ParsedRow, columnName: string | undefined): string | undefined {
      if (!columnName) return undefined;
      const val = row[columnName]?.trim();
      return val || undefined;
    }

    for (let i = 0; i < dataRows.length; i++) {
      try {
        const row = dataRows[i];

        let rawAddress = getVal(row, mapping.address);
        const rawUnit = getVal(row, mapping.unit);
        const rawCity = getVal(row, mapping.city);
        const rawZip = getVal(row, mapping.zip);

        if (!rawAddress) {
          importProgress.skipped++;
          importProgress.processed++;
          continue;
        }

        if (rawUnit) {
          rawAddress = `${rawAddress} #${rawUnit}`;
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

          function trackField(fieldName: string) {
            fieldCount++;
            importProgress.fieldsUpdated[fieldName] = (importProgress.fieldsUpdated[fieldName] || 0) + 1;
          }

          const csvYearBuilt = parseYear(getVal(row, mapping.yearBuilt));
          if (csvYearBuilt && (lead.yearBuilt === null || lead.yearBuilt === 1995 || lead.yearBuilt === 1900 || lead.yearBuilt === 0)) {
            updates.yearBuilt = csvYearBuilt;
            trackField("yearBuilt");
          }

          if (csvYearBuilt && (lead.effectiveYearBuilt === null || lead.effectiveYearBuilt === 1995 || lead.effectiveYearBuilt === 1900 || lead.effectiveYearBuilt === 0)) {
            updates.effectiveYearBuilt = csvYearBuilt;
            trackField("effectiveYearBuilt");
          }

          const csvSaleDate = parseDate(getVal(row, mapping.lastSaleDate));
          if (csvSaleDate && !lead.lastDeedDate) {
            updates.lastDeedDate = csvSaleDate;
            trackField("lastDeedDate");
          }

          const csvSaleAmount = parseNumber(getVal(row, mapping.lastSaleAmount));
          if (csvSaleAmount && csvSaleAmount > 0 && !lead.previousMarketValue) {
            updates.previousMarketValue = Math.round(csvSaleAmount);
            trackField("previousMarketValue");
          }

          const csvLotAcres = parseNumber(getVal(row, mapping.lotSizeAcres));
          if (csvLotAcres && csvLotAcres > 0 && !lead.landAcreage) {
            updates.landAcreage = csvLotAcres;
            trackField("landAcreage");
          }

          const csvLotSqft = parseNumber(getVal(row, mapping.lotSizeSqft));
          if (csvLotSqft && csvLotSqft > 0 && !lead.landSqft) {
            updates.landSqft = Math.round(csvLotSqft);
            trackField("landSqft");
          }

          const csvSubdivision = getVal(row, mapping.subdivision);
          if (csvSubdivision && !lead.subdivisionName) {
            updates.subdivisionName = csvSubdivision;
            trackField("subdivisionName");
          }

          const csvSchool = getVal(row, mapping.schoolDistrict);
          if (csvSchool && !lead.schoolDistrict) {
            updates.schoolDistrict = csvSchool;
            trackField("schoolDistrict");
          }

          const csvLandUse = getVal(row, mapping.landUse) || getVal(row, mapping.propertyType);
          if (csvLandUse && !lead.propertyUseDescription) {
            updates.propertyUseDescription = csvLandUse;
            trackField("propertyUseDescription");
          }

          const csvLivingSqft = parseNumber(getVal(row, mapping.livingSqft));
          if (csvLivingSqft && csvLivingSqft > 0 && (!lead.sqft || lead.sqft === 0)) {
            updates.sqft = Math.round(csvLivingSqft);
            trackField("sqft");
          }

          const csvAssessedValue = parseNumber(getVal(row, mapping.totalAssessedValue));
          if (csvAssessedValue && csvAssessedValue > 0 && (!lead.totalValue || lead.totalValue === 0)) {
            updates.totalValue = Math.round(csvAssessedValue);
            trackField("totalValue");
          }

          const mobilePhones = parsePhoneNumbers(getVal(row, mapping.mobile));
          const landlinePhones = parsePhoneNumbers(getVal(row, mapping.landline));
          const otherPhones = parsePhoneNumbers(getVal(row, mapping.otherPhone));
          const allPhones = [...mobilePhones, ...landlinePhones, ...otherPhones];

          if (allPhones.length > 0 && !lead.ownerPhone) {
            updates.ownerPhone = allPhones[0];
            trackField("ownerPhone");
          }
          if (allPhones.length > 1 && !lead.contactPhone) {
            updates.contactPhone = allPhones[1];
            trackField("contactPhone");
          }

          const emails = parseEmails(getVal(row, mapping.email));
          if (emails.length > 0 && !lead.ownerEmail) {
            updates.ownerEmail = emails[0];
            trackField("ownerEmail");
          }
          if (emails.length > 1 && !lead.contactEmail) {
            updates.contactEmail = emails[1];
            trackField("contactEmail");
          }

          const firstName = getVal(row, mapping.owner1FirstName);
          const lastName = getVal(row, mapping.owner1LastName);
          if (firstName && lastName && !lead.contactName) {
            updates.contactName = `${firstName} ${lastName}`;
            trackField("contactName");
          } else if (firstName && !lastName && !lead.contactName) {
            updates.contactName = firstName;
            trackField("contactName");
          }

          const owner2First = getVal(row, mapping.owner2FirstName);
          const owner2Last = getVal(row, mapping.owner2LastName);
          if ((owner2First || owner2Last) && !lead.secondOwner) {
            const name2 = [owner2First, owner2Last].filter(Boolean).join(" ");
            if (name2) {
              updates.secondOwner = name2;
              trackField("secondOwner");
            }
          }

          const fullMailing = buildFullMailingAddress(
            getVal(row, mapping.mailingAddress),
            getVal(row, mapping.mailingUnit),
            getVal(row, mapping.mailingCity),
            getVal(row, mapping.mailingState),
            getVal(row, mapping.mailingZip)
          );
          if (fullMailing && !lead.ownerAddress) {
            updates.ownerAddress = fullMailing;
            trackField("ownerAddress");
          }

          const doNotMail = getVal(row, mapping.doNotMail);
          if (doNotMail && doNotMail.toLowerCase() === "yes" && !lead.dncRegistered) {
            updates.dncRegistered = true;
            trackField("dncRegistered");
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

export async function importPropStreamCsv(csvContent: string): Promise<PropStreamImportProgress> {
  return importPropStreamFile(Buffer.from(csvContent, "utf-8"), "import.csv");
}
