import { storage } from "./storage";
import { calculateScore } from "./seed";
import type { InsertLead } from "@shared/schema";

const COLLIN_CAD_API_BASE = "https://map.collincad.org/Arcgis/rest/services/Public/General/MapServer/0/query";
const COLLIN_CAD_PARCEL_API = "https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1/query";
const MAX_RECORDS_PER_REQUEST = 1000;
const BATCH_INSERT_SIZE = 100;

interface CollinCadFeature {
  attributes: {
    prop_id?: string;
    geo_id?: string;
    PROP_ID?: string;
    GEO_ID?: string;
    owner_name?: string;
    OWNER_NAME?: string;
    owner_name2?: string;
    OWNER_NAME2?: string;
    situs_addr?: string;
    SITUS_ADDR?: string;
    situs_city?: string;
    SITUS_CITY?: string;
    situs_zip?: string;
    SITUS_ZIP?: string;
    market_value?: number;
    MARKET_VALUE?: number;
    impr_value?: number;
    IMPR_VALUE?: number;
    land_value?: number;
    LAND_VALUE?: number;
    impr_sqft?: number;
    IMPR_SQFT?: number;
    yr_built?: number;
    YR_BUILT?: number;
    eff_yr_blt?: number;
    EFF_YR_BLT?: number;
    land_use?: string;
    LAND_USE?: string;
    land_use_desc?: string;
    LAND_USE_DESC?: string;
    prop_type?: string;
    PROP_TYPE?: string;
    dba?: string;
    DBA?: string;
    dba_name?: string;
    DBA_NAME?: string;
    mail_addr?: string;
    MAIL_ADDR?: string;
    mail_city?: string;
    MAIL_CITY?: string;
    mail_state?: string;
    MAIL_STATE?: string;
    mail_zip?: string;
    MAIL_ZIP?: string;
    stories?: number;
    STORIES?: number;
    struc_type?: string;
    STRUC_TYPE?: string;
    deed_dt?: string;
    DEED_DT?: string;
    deed_book_id?: string;
    DEED_BOOK_ID?: string;
    deed_book_pag?: string;
    DEED_BOOK_PAG?: string;
    deed_num?: string;
    DEED_NUM?: string;
    legal_acreage?: number;
    LEGAL_ACREAGE?: number;
    eff_size_acre?: number;
    EFF_SIZE_ACRE?: number;
    land_total_sq?: number;
    LAND_TOTAL_SQ?: number;
    abs_subdv_des?: string;
    ABS_SUBDV_DES?: string;
    school?: string;
    SCHOOL?: string;
    city?: string;
    CITY?: string;
    tif?: string;
    TIF?: string;
    exemptions?: string;
    EXEMPTIONS?: string;
    pct_ownership?: number;
    PCT_OWNERSHIP?: number;
    addr_line1?: string;
    ADDR_LINE1?: string;
    property_use_?: string;
    PROPERTY_USE_?: string;
    percent_compl?: number;
    PERCENT_COMPL?: number;
    prop_create_d?: string;
    PROP_CREATE_D?: string;
    parent_id?: string;
    PARENT_ID?: string;
  };
  geometry?: {
    rings?: number[][][];
  };
}

function getAttr(feature: CollinCadFeature, ...keys: string[]): any {
  for (const key of keys) {
    const val = (feature.attributes as any)[key] ?? (feature.attributes as any)[key.toUpperCase()] ?? (feature.attributes as any)[key.toLowerCase()];
    if (val !== undefined && val !== null) return val;
  }
  return null;
}

function getCentroid(geometry?: { rings?: number[][][] }): [number, number] {
  if (!geometry?.rings?.[0]?.length) return [33.0198, -96.6989];
  const pts = geometry.rings[0];
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lng];
}

function inferOwnerType(name: string): string {
  const upper = (name || "").toUpperCase();
  if (upper.includes("LLC") || upper.includes("L.L.C.") || upper.includes("LIMITED LIABILITY")) return "LLC";
  if (upper.includes("INC") || upper.includes("CORP") || upper.includes("CORPORATION") || upper.includes("CO.")) return "Corporation";
  if (upper.includes("LP") || upper.includes("L.P.") || upper.includes("LIMITED PARTNERSHIP")) return "LP";
  if (upper.includes("TRUST") || upper.includes("TRUSTEE")) return "Trust";
  if (upper.includes("CHURCH") || upper.includes("SCHOOL") || upper.includes("DISTRICT") || upper.includes("CITY OF") || upper.includes("COUNTY OF") || upper.includes("STATE OF")) return "Government";
  return "Individual";
}

function inferZoning(landUse: string): string {
  const upper = (landUse || "").toUpperCase();
  if (upper.includes("MULTI") || upper.includes("MFR") || upper.includes("APARTMENT") || upper.includes("DUPLEX")) return "Multi-Family";
  if (upper.includes("INDUSTRIAL") || upper.includes("WAREHOUSE") || upper.includes("MANUFACTURING")) return "Industrial";
  if (upper.includes("OFFICE")) return "Commercial";
  if (upper.includes("RETAIL")) return "Commercial";
  if (upper.includes("MIXED")) return "Mixed Use";
  if (upper.includes("COMMERCIAL") || upper.includes("COMM")) return "Commercial";
  return "Commercial";
}

const COLLIN_COUNTY_CITIES: Record<string, { lat: number; lng: number }> = {
  "PLANO": { lat: 33.0198, lng: -96.6989 },
  "FRISCO": { lat: 33.1507, lng: -96.8236 },
  "MCKINNEY": { lat: 33.1972, lng: -96.6397 },
  "ALLEN": { lat: 33.1032, lng: -96.6706 },
  "WYLIE": { lat: 33.0151, lng: -96.5389 },
  "CELINA": { lat: 33.3246, lng: -96.7845 },
  "PROSPER": { lat: 33.2362, lng: -96.8011 },
  "ANNA": { lat: 33.3490, lng: -96.5486 },
  "MURPHY": { lat: 33.0151, lng: -96.6131 },
  "SACHSE": { lat: 32.9762, lng: -96.5953 },
  "LUCAS": { lat: 33.0843, lng: -96.5778 },
  "FAIRVIEW": { lat: 33.1582, lng: -96.6317 },
  "PRINCETON": { lat: 33.1801, lng: -96.4981 },
  "FARMERSVILLE": { lat: 33.1637, lng: -96.3597 },
  "LAVON": { lat: 33.0276, lng: -96.4342 },
};

function inferCityCoords(city: string): { lat: number; lng: number } {
  const upper = (city || "").toUpperCase().trim();
  return COLLIN_COUNTY_CITIES[upper] || { lat: 33.0198, lng: -96.6989 };
}

async function fetchCollinCadPage(offset: number, minImpValue: number): Promise<{ features: CollinCadFeature[]; hasMore: boolean }> {
  const where = `IMPR_VALUE>${minImpValue}`;
  const outFields = "*";

  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    resultRecordCount: String(MAX_RECORDS_PER_REQUEST),
    resultOffset: String(offset),
  });

  const url = `${COLLIN_CAD_PARCEL_API}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Collin CAD API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Collin CAD API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return {
    features: data.features || [],
    hasMore: data.exceededTransferLimit === true,
  };
}

export interface CollinCadImportResult {
  totalFetched: number;
  imported: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

export async function importCollinCadProperties(
  marketId: string,
  options: {
    minImpValue?: number;
    maxRecords?: number;
    minSqft?: number;
    skipGovernment?: boolean;
  } = {}
): Promise<CollinCadImportResult> {
  const minImpValue = options.minImpValue ?? 200000;
  const maxRecords = options.maxRecords ?? 4000;
  const minSqft = options.minSqft ?? 0;
  const skipGovernment = options.skipGovernment ?? true;

  const run = await storage.createImportRun({
    type: "collin_cad_api",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "Collin CAD ArcGIS REST API", minImpValue, maxRecords } as any,
  });

  const result: CollinCadImportResult = {
    totalFetched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  try {
    let offset = 0;
    let hasMore = true;
    const leadsBatch: InsertLead[] = [];

    while (hasMore && result.totalFetched < maxRecords) {
      console.log(`[Collin CAD Agent] Fetching page at offset ${offset}...`);
      const page = await fetchCollinCadPage(offset, minImpValue);
      const features = page.features;
      hasMore = page.hasMore;
      result.totalFetched += features.length;

      for (const feature of features) {
        try {
          const ownerName = getAttr(feature, "owner_name", "OWNER_NAME");
          const address = getAttr(feature, "situs_addr", "SITUS_ADDR");

          if (!address || !ownerName) {
            result.skipped++;
            continue;
          }

          const ownerType = inferOwnerType(ownerName);
          if (skipGovernment && ownerType === "Government") {
            result.skipped++;
            continue;
          }

          const sqft = getAttr(feature, "impr_sqft", "IMPR_SQFT") || 0;
          if (minSqft > 0 && sqft > 0 && sqft < minSqft) {
            result.skipped++;
            continue;
          }

          const sourceId = String(getAttr(feature, "prop_id", "PROP_ID") || getAttr(feature, "geo_id", "GEO_ID") || "");
          if (!sourceId) {
            result.skipped++;
            continue;
          }

          const existing = await storage.getLeadBySourceId("collin_cad_api", sourceId);
          if (existing) {
            result.skipped++;
            continue;
          }

          const city = getAttr(feature, "situs_city", "SITUS_CITY") || "Plano";
          const zipCode = getAttr(feature, "situs_zip", "SITUS_ZIP") || "75023";
          const impValue = getAttr(feature, "impr_value", "IMPR_VALUE") || 0;
          const landValue = getAttr(feature, "land_value", "LAND_VALUE") || 0;
          const totalValue = getAttr(feature, "market_value", "MARKET_VALUE") || (impValue + landValue);
          const rawYearBuilt = getAttr(feature, "yr_built", "YR_BUILT");
          const yearBuilt = (rawYearBuilt && rawYearBuilt > 0) ? rawYearBuilt : null;
          const effectiveYearBuilt = getAttr(feature, "eff_yr_blt", "EFF_YR_BLT") || undefined;
          const landUse = getAttr(feature, "land_use_desc", "LAND_USE_DESC") || getAttr(feature, "land_use", "LAND_USE") || "";
          const zoning = inferZoning(landUse);
          const stories = getAttr(feature, "stories", "STORIES") || 1;
          const structType = getAttr(feature, "struc_type", "STRUC_TYPE") || "Masonry";
          const dba = getAttr(feature, "dba", "DBA");
          const dbaName = getAttr(feature, "dba_name", "DBA_NAME") || dba || undefined;
          const llcName = ownerType === "LLC" ? ownerName : undefined;

          const deedDt = getAttr(feature, "deed_dt", "DEED_DT") || undefined;
          const deedNum = getAttr(feature, "deed_num", "DEED_NUM") || undefined;
          const deedBookId = getAttr(feature, "deed_book_id", "DEED_BOOK_ID") || undefined;
          const deedBookPag = getAttr(feature, "deed_book_pag", "DEED_BOOK_PAG") || undefined;
          const deedInstrument = deedNum || (deedBookId && deedBookPag ? `${deedBookId}/${deedBookPag}` : undefined);

          const legalAcreage = getAttr(feature, "legal_acreage", "LEGAL_ACREAGE") || getAttr(feature, "eff_size_acre", "EFF_SIZE_ACRE") || undefined;
          const landTotalSq = getAttr(feature, "land_total_sq", "LAND_TOTAL_SQ") || undefined;
          const subdivisionName = getAttr(feature, "abs_subdv_des", "ABS_SUBDV_DES") || undefined;
          const schoolDistrict = getAttr(feature, "school", "SCHOOL") || undefined;
          const taxDistrict = getAttr(feature, "city", "CITY") || getAttr(feature, "tif", "TIF") || undefined;
          const exemptions = getAttr(feature, "exemptions", "EXEMPTIONS") || undefined;
          const pctOwnership = getAttr(feature, "pct_ownership", "PCT_OWNERSHIP") || undefined;
          const secondOwner = getAttr(feature, "owner_name2", "OWNER_NAME2") || getAttr(feature, "addr_line1", "ADDR_LINE1") || undefined;
          const propertyUseDesc = getAttr(feature, "property_use_", "PROPERTY_USE_") || undefined;
          const propCreateDate = getAttr(feature, "prop_create_d", "PROP_CREATE_D") || undefined;

          let lat: number, lng: number;
          const [geoLat, geoLng] = getCentroid(feature.geometry);
          if (geoLat !== 33.0198 || geoLng !== -96.6989) {
            lat = geoLat;
            lng = geoLng;
          } else {
            const coords = inferCityCoords(city);
            lat = coords.lat + (Math.random() - 0.5) * 0.01;
            lng = coords.lng + (Math.random() - 0.5) * 0.01;
          }

          const mailAddr = getAttr(feature, "mail_addr", "MAIL_ADDR");
          const mailCity = getAttr(feature, "mail_city", "MAIL_CITY");
          const mailState = getAttr(feature, "mail_state", "MAIL_STATE");
          const mailZip = getAttr(feature, "mail_zip", "MAIL_ZIP");
          const ownerAddress = mailAddr
            ? `${mailAddr}, ${mailCity || ""} ${mailState || "TX"} ${mailZip || ""}`
            : undefined;

          const leadData: InsertLead = {
            marketId,
            address: String(address),
            city: String(city),
            county: "Collin",
            state: "TX",
            zipCode: String(zipCode),
            latitude: lat,
            longitude: lng,
            sqft: sqft || Math.round(impValue / 120),
            yearBuilt,
            effectiveYearBuilt: (effectiveYearBuilt && effectiveYearBuilt > 0) ? effectiveYearBuilt : undefined,
            constructionType: String(structType),
            zoning,
            stories,
            units: 1,
            ownerName: String(ownerName),
            ownerType,
            ownerAddress,
            llcName,
            businessName: dbaName || undefined,
            dbaName: dbaName || undefined,
            improvementValue: impValue || undefined,
            landValue: landValue || undefined,
            totalValue: totalValue || undefined,
            lastDeedDate: deedDt || undefined,
            deedInstrument: deedInstrument || undefined,
            landAcreage: legalAcreage || undefined,
            landSqft: landTotalSq ? Math.round(landTotalSq) : undefined,
            subdivisionName: subdivisionName || undefined,
            schoolDistrict: schoolDistrict || undefined,
            taxDistrict: taxDistrict || undefined,
            taxExemptions: exemptions || undefined,
            ownerPercentage: pctOwnership || undefined,
            secondOwner: secondOwner || undefined,
            propertyUseDescription: propertyUseDesc || undefined,
            lastAppraisalDate: propCreateDate || undefined,
            sourceType: "collin_cad_api",
            sourceId,
            leadScore: 0,
            status: "new",
          };

          leadData.leadScore = calculateScore(leadData);
          leadsBatch.push(leadData);

          if (leadsBatch.length >= BATCH_INSERT_SIZE) {
            await storage.createLeadsBatch(leadsBatch);
            result.imported += leadsBatch.length;
            leadsBatch.length = 0;

            await storage.updateImportRun(run.id, {
              recordsProcessed: result.totalFetched,
              recordsImported: result.imported,
              recordsSkipped: result.skipped,
            });
          }
        } catch (err: any) {
          result.errors++;
          if (result.errorMessages.length < 10) {
            result.errorMessages.push(err.message);
          }
        }
      }

      offset += features.length;
      if (features.length === 0) break;

      await new Promise((r) => setTimeout(r, 500));
    }

    if (leadsBatch.length > 0) {
      await storage.createLeadsBatch(leadsBatch);
      result.imported += leadsBatch.length;
    }

    await storage.updateImportRun(run.id, {
      status: result.errors > 0 && result.imported === 0 ? "failed" : "completed",
      completedAt: new Date(),
      recordsProcessed: result.totalFetched,
      recordsImported: result.imported,
      recordsSkipped: result.skipped,
      errors: result.errorMessages.length > 0 ? result.errorMessages.join("; ") : null,
    });

    console.log(`[Collin CAD Agent] Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (err: any) {
    console.error("[Collin CAD Agent] Import failed:", err);
    result.errorMessages.push(err.message);
    await storage.updateImportRun(run.id, {
      status: "failed",
      completedAt: new Date(),
      recordsProcessed: result.totalFetched,
      recordsImported: result.imported,
      recordsSkipped: result.skipped,
      errors: err.message,
    });
  }

  return result;
}
