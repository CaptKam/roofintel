import { storage } from "./storage";
import type { InsertLead } from "@shared/schema";

interface ColumnMapping {
  address?: string;
  city?: string;
  county?: string;
  state?: string;
  zipCode?: string;
  sqft?: string;
  yearBuilt?: string;
  zoning?: string;
  stories?: string;
  units?: string;
  ownerName?: string;
  ownerType?: string;
  ownerAddress?: string;
  llcName?: string;
  improvementValue?: string;
  landValue?: string;
  totalValue?: string;
  constructionType?: string;
  roofMaterial?: string;
  roofLastReplaced?: string;
  latitude?: string;
  longitude?: string;
  propertyId?: string;
}

const DEFAULT_COLUMN_MAPPINGS: Record<string, ColumnMapping> = {
  dcad: {
    address: "SITUS_ADDRESS",
    city: "SITUS_CITY",
    county: "COUNTY",
    state: "SITUS_STATE",
    zipCode: "SITUS_ZIP",
    sqft: "LIVING_AREA",
    yearBuilt: "YEAR_BUILT",
    zoning: "ZONING",
    stories: "NO_STORIES",
    units: "NO_UNITS",
    ownerName: "OWNER_NAME",
    ownerAddress: "OWNER_ADDRESS",
    improvementValue: "IMPROVEMENT_VALUE",
    landValue: "LAND_VALUE",
    totalValue: "TOTAL_VALUE",
    constructionType: "CONSTRUCTION_TYPE",
    propertyId: "ACCOUNT_NUM",
  },
  generic: {
    address: "address",
    city: "city",
    county: "county",
    state: "state",
    zipCode: "zip",
    sqft: "sqft",
    yearBuilt: "year_built",
    zoning: "zoning",
    ownerName: "owner_name",
    ownerType: "owner_type",
    improvementValue: "improvement_value",
    landValue: "land_value",
    totalValue: "total_value",
    propertyId: "property_id",
  },
};

const DFW_CITY_COORDS: Record<string, [number, number]> = {
  "DALLAS": [32.7767, -96.7970],
  "FORT WORTH": [32.7555, -97.3308],
  "ARLINGTON": [32.7357, -97.1081],
  "PLANO": [33.0198, -96.6989],
  "IRVING": [32.8140, -96.9489],
  "GARLAND": [32.9126, -96.6389],
  "GRAND PRAIRIE": [32.7460, -96.9978],
  "MCKINNEY": [33.1972, -96.6397],
  "FRISCO": [33.1507, -96.8236],
  "MESQUITE": [32.7668, -96.5992],
  "DENTON": [33.2148, -97.1331],
  "CARROLLTON": [32.9537, -96.8903],
  "RICHARDSON": [32.9483, -96.7299],
  "LEWISVILLE": [33.0462, -96.9942],
  "ALLEN": [33.1032, -96.6735],
  "FLOWER MOUND": [33.0146, -97.0969],
  "EULESS": [32.8371, -97.0820],
  "BEDFORD": [32.8440, -97.1431],
  "GRAPEVINE": [32.9343, -97.0781],
  "CEDAR HILL": [32.5885, -96.9561],
  "DESOTO": [32.5899, -96.8570],
  "DUNCANVILLE": [32.6518, -96.9083],
  "MANSFIELD": [32.5632, -97.1417],
  "ROWLETT": [32.9029, -96.5639],
  "THE COLONY": [33.0862, -96.8917],
  "WYLIE": [33.0151, -96.5389],
  "COPPELL": [32.9546, -97.0150],
  "KELLER": [32.9346, -97.2517],
  "SOUTHLAKE": [32.9412, -97.1342],
  "HURST": [32.8235, -97.1706],
  "LANCASTER": [32.5921, -96.7561],
  "BURLESON": [32.5421, -97.3208],
  "WEATHERFORD": [32.7593, -97.7972],
  "WAXAHACHIE": [32.3866, -96.8483],
  "ROCKWALL": [32.9312, -96.4597],
  "PROSPER": [33.2359, -96.8011],
  "CELINA": [33.3246, -96.7844],
  "FORNEY": [32.7479, -96.4719],
  "MIDLOTHIAN": [32.4824, -96.9945],
};

const COUNTY_CENTER_COORDS: Record<string, [number, number]> = {
  "DALLAS": [32.7767, -96.7970],
  "TARRANT": [32.7555, -97.3308],
  "COLLIN": [33.1972, -96.6397],
  "DENTON": [33.2148, -97.1331],
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
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
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function detectColumnMapping(headers: string[]): ColumnMapping {
  const upperHeaders = headers.map((h) => h.toUpperCase().trim());
  const mapping: ColumnMapping = {};

  const findHeader = (patterns: string[]): string | undefined => {
    for (const pattern of patterns) {
      const idx = upperHeaders.findIndex((h) => h === pattern || h.includes(pattern));
      if (idx >= 0) return headers[idx];
    }
    return undefined;
  };

  mapping.address = findHeader(["SITUS_ADDRESS", "PROPERTY_ADDRESS", "ADDRESS", "SITE_ADDRESS", "STREET_ADDRESS", "SITUS_ADDR"]);
  mapping.city = findHeader(["SITUS_CITY", "CITY", "PROPERTY_CITY", "SITE_CITY"]);
  mapping.county = findHeader(["COUNTY", "COUNTY_NAME"]);
  mapping.state = findHeader(["SITUS_STATE", "STATE", "PROPERTY_STATE"]);
  mapping.zipCode = findHeader(["SITUS_ZIP", "ZIP_CODE", "ZIP", "ZIPCODE", "POSTAL_CODE"]);
  mapping.sqft = findHeader(["LIVING_AREA", "SQFT", "SQUARE_FEET", "BUILDING_AREA", "TOTAL_AREA", "GROSS_AREA", "BLDG_AREA"]);
  mapping.yearBuilt = findHeader(["YEAR_BUILT", "YR_BUILT", "BUILT_YEAR", "YEAR_BLT"]);
  mapping.zoning = findHeader(["ZONING", "ZONE_CODE", "LAND_USE", "PROPERTY_TYPE", "USE_CODE"]);
  mapping.stories = findHeader(["NO_STORIES", "STORIES", "NUM_STORIES", "FLOORS"]);
  mapping.units = findHeader(["NO_UNITS", "UNITS", "NUM_UNITS", "UNIT_COUNT"]);
  mapping.ownerName = findHeader(["OWNER_NAME", "OWNER", "OWNER_1", "GRANTOR", "TAX_PAYER"]);
  mapping.ownerAddress = findHeader(["OWNER_ADDRESS", "MAIL_ADDRESS", "MAILING_ADDRESS"]);
  mapping.improvementValue = findHeader(["IMPROVEMENT_VALUE", "IMPR_VALUE", "IMPROVEMENT_VAL", "BLDG_VALUE"]);
  mapping.landValue = findHeader(["LAND_VALUE", "LAND_VAL"]);
  mapping.totalValue = findHeader(["TOTAL_VALUE", "MARKET_VALUE", "APPRAISED_VALUE", "ASSESSED_VALUE", "TOTAL_APPRAISED"]);
  mapping.constructionType = findHeader(["CONSTRUCTION_TYPE", "CONST_TYPE", "BUILDING_TYPE", "STRUCT_TYPE"]);
  mapping.roofMaterial = findHeader(["ROOF_MATERIAL", "ROOF_TYPE", "ROOF_COVER"]);
  mapping.propertyId = findHeader(["ACCOUNT_NUM", "PROPERTY_ID", "PARCEL_ID", "ACCT_NUM", "GEO_ID", "PROP_ID"]);
  mapping.latitude = findHeader(["LATITUDE", "LAT", "Y_COORD"]);
  mapping.longitude = findHeader(["LONGITUDE", "LNG", "LON", "X_COORD"]);

  return mapping;
}

function inferOwnerType(ownerName: string): string {
  const upper = ownerName.toUpperCase();
  if (upper.includes("LLC") || upper.includes("L.L.C.") || upper.includes("LIMITED LIABILITY")) return "LLC";
  if (upper.includes("INC") || upper.includes("CORP") || upper.includes("CORPORATION") || upper.includes("CO.")) return "Corporation";
  if (upper.includes("LP") || upper.includes("L.P.") || upper.includes("LIMITED PARTNERSHIP")) return "LP";
  if (upper.includes("TRUST") || upper.includes("TRUSTEE")) return "Trust";
  if (upper.includes("CHURCH") || upper.includes("SCHOOL") || upper.includes("DISTRICT") || upper.includes("CITY OF")) return "Government";
  return "Individual";
}

function inferZoning(value: string): string {
  const upper = (value || "").toUpperCase();
  if (upper.includes("COMM") || upper.includes("COM") || upper === "C" || upper.includes("RETAIL") || upper.includes("OFFICE")) return "Commercial";
  if (upper.includes("MULTI") || upper.includes("MF") || upper.includes("APARTMENT") || upper.includes("APT")) return "Multi-Family";
  if (upper.includes("IND") || upper.includes("WAREHOUSE") || upper.includes("MANUF")) return "Industrial";
  if (upper.includes("MIX")) return "Mixed Use";
  if (upper.includes("RES") || upper.includes("SFR") || upper.includes("SINGLE")) return "Residential";
  return "Commercial";
}

function getCoords(city?: string, county?: string): [number, number] {
  if (city) {
    const coords = DFW_CITY_COORDS[city.toUpperCase()];
    if (coords) return coords;
  }
  if (county) {
    const coords = COUNTY_CENTER_COORDS[county.toUpperCase()];
    if (coords) return coords;
  }
  return [32.7767, -96.7970];
}

function addJitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range;
}

export interface PropertyImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
  detectedMapping: ColumnMapping;
}

export async function importPropertyCsv(
  csvContent: string,
  marketId: string,
  options: {
    mappingPreset?: string;
    countyFilter?: string;
    minSqft?: number;
    zoningFilter?: string[];
  } = {}
): Promise<PropertyImportResult> {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { totalRows: 0, imported: 0, skipped: 0, errors: 0, errorMessages: ["File has no data rows"], detectedMapping: {} };
  }

  const headers = parseCsvLine(lines[0]);
  const mapping = options.mappingPreset && DEFAULT_COLUMN_MAPPINGS[options.mappingPreset]
    ? DEFAULT_COLUMN_MAPPINGS[options.mappingPreset]
    : detectColumnMapping(headers);

  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => headerIndex.set(h, i));

  const getVal = (row: string[], colName?: string): string => {
    if (!colName) return "";
    const idx = headerIndex.get(colName);
    if (idx === undefined) return "";
    return (row[idx] || "").trim();
  };

  const getNum = (row: string[], colName?: string): number => {
    const val = getVal(row, colName).replace(/[,$]/g, "");
    const num = parseInt(val, 10);
    return isNaN(num) ? 0 : num;
  };

  const getFloat = (row: string[], colName?: string): number => {
    const val = getVal(row, colName).replace(/[,$]/g, "");
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  };

  const run = await storage.createImportRun({
    type: "property_csv",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
  });

  const result: PropertyImportResult = {
    totalRows: lines.length - 1,
    imported: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
    detectedMapping: mapping,
  };

  const leadsBatch: InsertLead[] = [];
  const minSqft = options.minSqft || 2000;
  const countyFilter = options.countyFilter?.toUpperCase();
  const zoningFilters = options.zoningFilter?.map((z) => z.toUpperCase());

  for (let i = 1; i < lines.length; i++) {
    try {
      const row = parseCsvLine(lines[i]);
      if (row.length < 3) { result.skipped++; continue; }

      const address = getVal(row, mapping.address);
      const ownerName = getVal(row, mapping.ownerName);
      const sqft = getNum(row, mapping.sqft);

      if (!address || !ownerName) { result.skipped++; continue; }
      if (sqft < minSqft) { result.skipped++; continue; }

      const county = (getVal(row, mapping.county) || "Dallas").replace(/ COUNTY$/i, "");
      if (countyFilter && county.toUpperCase() !== countyFilter) { result.skipped++; continue; }

      const rawZoning = getVal(row, mapping.zoning);
      const zoning = rawZoning ? inferZoning(rawZoning) : "Commercial";

      if (zoningFilters && zoningFilters.length > 0) {
        if (!zoningFilters.includes(zoning.toUpperCase())) { result.skipped++; continue; }
      }

      const city = getVal(row, mapping.city) || "Dallas";
      const state = getVal(row, mapping.state) || "TX";
      const zipCode = getVal(row, mapping.zipCode) || "75201";
      const yearBuilt = getNum(row, mapping.yearBuilt) || 1990;
      const stories = getNum(row, mapping.stories) || 1;
      const units = getNum(row, mapping.units) || 1;
      const constructionType = getVal(row, mapping.constructionType) || "Masonry";
      const ownerType = inferOwnerType(ownerName);
      const ownerAddress = getVal(row, mapping.ownerAddress);
      const improvementValue = getNum(row, mapping.improvementValue);
      const landValue = getNum(row, mapping.landValue);
      const totalValue = getNum(row, mapping.totalValue) || (improvementValue + landValue);
      const roofMaterial = getVal(row, mapping.roofMaterial);
      const propertyId = getVal(row, mapping.propertyId);

      let lat = getFloat(row, mapping.latitude);
      let lng = getFloat(row, mapping.longitude);
      if (!lat || !lng || lat === 0 || lng === 0) {
        const [baseLat, baseLng] = getCoords(city, county);
        lat = addJitter(baseLat, 0.05);
        lng = addJitter(baseLng, 0.05);
      }

      const sourceId = propertyId || `${address}-${city}-${zipCode}`;

      const existing = await storage.getLeadBySourceId("cad_csv", sourceId);
      if (existing) { result.skipped++; continue; }

      const llcName = ownerType === "LLC" ? ownerName : undefined;

      leadsBatch.push({
        marketId,
        address,
        city,
        county,
        state,
        zipCode,
        latitude: lat,
        longitude: lng,
        sqft,
        yearBuilt,
        constructionType,
        zoning,
        stories,
        units,
        ownerName,
        ownerType,
        ownerAddress: ownerAddress || undefined,
        llcName,
        improvementValue: improvementValue || undefined,
        landValue: landValue || undefined,
        totalValue: totalValue || undefined,
        roofMaterial: roofMaterial || undefined,
        sourceType: "cad_csv",
        sourceId,
        leadScore: 0,
        status: "new",
      });

      if (leadsBatch.length >= 100) {
        await storage.createLeadsBatch(leadsBatch);
        result.imported += leadsBatch.length;
        leadsBatch.length = 0;
      }
    } catch (err: any) {
      result.errors++;
      if (result.errorMessages.length < 10) {
        result.errorMessages.push(`Row ${i}: ${err.message}`);
      }
    }
  }

  if (leadsBatch.length > 0) {
    await storage.createLeadsBatch(leadsBatch);
    result.imported += leadsBatch.length;
  }

  await storage.updateImportRun(run.id, {
    status: result.errors > 0 && result.imported === 0 ? "failed" : "completed",
    completedAt: new Date(),
    recordsProcessed: result.totalRows,
    recordsImported: result.imported,
    recordsSkipped: result.skipped,
    errors: result.errorMessages.join("; ") || null,
    metadata: { detectedMapping: mapping } as any,
  });

  return result;
}

export function generateSampleCsv(): string {
  const headers = [
    "ACCOUNT_NUM", "SITUS_ADDRESS", "SITUS_CITY", "COUNTY", "SITUS_STATE", "SITUS_ZIP",
    "LIVING_AREA", "YEAR_BUILT", "ZONING", "NO_STORIES", "NO_UNITS",
    "OWNER_NAME", "OWNER_ADDRESS", "CONSTRUCTION_TYPE", "ROOF_MATERIAL",
    "IMPROVEMENT_VALUE", "LAND_VALUE", "TOTAL_VALUE", "LATITUDE", "LONGITUDE"
  ];
  return headers.join(",") + "\n" +
    'R000001,"1300 Main St",Dallas,Dallas,TX,75201,45000,1985,Commercial,3,1,"Westgate Properties LLC","PO Box 12345 Dallas TX",Masonry,Built-Up,2850000,1200000,4050000,32.7821,-96.7990\n' +
    'R000002,"4500 Belt Line Rd",Irving,Dallas,TX,75038,28000,1992,Commercial,2,1,"ABC Holdings Inc","Suite 400 Irving TX",Steel Frame,TPO Membrane,1800000,900000,2700000,32.8509,-96.9472\n' +
    'R000003,"2200 Valley View Ln",Farmers Branch,Dallas,TX,75234,62000,1978,Multi-Family,3,48,"Oakwood Apartment Trust","1000 Main St Dallas TX",Wood Frame,Composition Shingle,4200000,1500000,5700000,32.9237,-96.8873\n';
}
