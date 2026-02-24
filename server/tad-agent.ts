import { storage } from "./storage";
import { calculateScore } from "./seed";
import type { InsertLead } from "@shared/schema";

const TAD_API_BASE = "https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0/query";
const MAX_RECORDS_PER_REQUEST = 1000;
const BATCH_INSERT_SIZE = 100;

interface TadFeature {
  attributes: {
    OBJECTID: number;
    TAXPIN: string | null;
    ACCOUNT: string;
    OWNER_NAME: string;
    OWNER_ADDR: string | null;
    OWNER_CITY: string | null;
    OWNER_ZIP: string | null;
    SITUS_ADDR: string;
    CITY: string | null;
    ZIPCODE: string | null;
    STATE: string | null;
    YEAR_BUILT: number | null;
    LIVING_ARE: number | null;
    LAND_VALUE: number | null;
    IMPR_VALUE: number | null;
    TOTAL_VALU: number | null;
    LAND_SQFT: number | null;
    LAND_ACRES: number | null;
    DESCR: string | null;
    PARCELTYPE: number | null;
    DEED_DATE: number | null;
    INSTRUMENT_NO: string | null;
    SubdivisionName: string | null;
  };
  geometry?: {
    rings?: number[][][];
  };
}

function getCentroid(geometry?: { rings?: number[][][] }): [number, number] {
  if (!geometry?.rings?.[0]?.length) return [32.7555, -97.3308];
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

function inferZoningFromDescription(descr: string | null, parcelType: number | null): string {
  const upper = (descr || "").toUpperCase();
  if (upper.includes("APARTMENT") || upper.includes("MULTI") || upper.includes("MFR") || upper.includes("DUPLEX") || upper.includes("TRIPLEX") || upper.includes("FOURPLEX")) return "Multi-Family";
  if (upper.includes("INDUSTRIAL") || upper.includes("WAREHOUSE") || upper.includes("MANUFACTURING")) return "Industrial";
  if (upper.includes("OFFICE")) return "Commercial";
  if (upper.includes("RETAIL") || upper.includes("SHOPPING") || upper.includes("STORE")) return "Commercial";
  if (upper.includes("MIXED")) return "Mixed Use";
  if (upper.includes("COMMERCIAL") || upper.includes("COMM")) return "Commercial";
  if (upper.includes("HOTEL") || upper.includes("MOTEL")) return "Commercial";
  if (upper.includes("RESTAURANT")) return "Commercial";
  if (upper.includes("MEDICAL") || upper.includes("HOSPITAL") || upper.includes("CLINIC")) return "Commercial";
  return "Commercial";
}

const TARRANT_COUNTY_ZIP_REGIONS: Array<{ zip: string; city: string; latMin: number; latMax: number; lngMin: number; lngMax: number }> = [
  { zip: "76102", city: "Fort Worth", latMin: 32.745, latMax: 32.765, lngMin: -97.340, lngMax: -97.315 },
  { zip: "76103", city: "Fort Worth", latMin: 32.740, latMax: 32.760, lngMin: -97.310, lngMax: -97.280 },
  { zip: "76104", city: "Fort Worth", latMin: 32.730, latMax: 32.750, lngMin: -97.340, lngMax: -97.310 },
  { zip: "76105", city: "Fort Worth", latMin: 32.720, latMax: 32.745, lngMin: -97.310, lngMax: -97.280 },
  { zip: "76106", city: "Fort Worth", latMin: 32.765, latMax: 32.795, lngMin: -97.370, lngMax: -97.330 },
  { zip: "76107", city: "Fort Worth", latMin: 32.740, latMax: 32.770, lngMin: -97.380, lngMax: -97.340 },
  { zip: "76108", city: "Fort Worth", latMin: 32.740, latMax: 32.780, lngMin: -97.450, lngMax: -97.400 },
  { zip: "76109", city: "Fort Worth", latMin: 32.700, latMax: 32.735, lngMin: -97.380, lngMax: -97.340 },
  { zip: "76110", city: "Fort Worth", latMin: 32.700, latMax: 32.730, lngMin: -97.340, lngMax: -97.300 },
  { zip: "76111", city: "Fort Worth", latMin: 32.760, latMax: 32.790, lngMin: -97.320, lngMax: -97.280 },
  { zip: "76112", city: "Fort Worth", latMin: 32.740, latMax: 32.770, lngMin: -97.260, lngMax: -97.220 },
  { zip: "76114", city: "Fort Worth", latMin: 32.770, latMax: 32.800, lngMin: -97.410, lngMax: -97.370 },
  { zip: "76115", city: "Fort Worth", latMin: 32.680, latMax: 32.710, lngMin: -97.360, lngMax: -97.320 },
  { zip: "76116", city: "Fort Worth", latMin: 32.720, latMax: 32.760, lngMin: -97.420, lngMax: -97.380 },
  { zip: "76117", city: "Haltom City", latMin: 32.790, latMax: 32.830, lngMin: -97.290, lngMax: -97.250 },
  { zip: "76118", city: "Fort Worth", latMin: 32.790, latMax: 32.830, lngMin: -97.260, lngMax: -97.220 },
  { zip: "76119", city: "Fort Worth", latMin: 32.690, latMax: 32.730, lngMin: -97.280, lngMax: -97.240 },
  { zip: "76120", city: "Fort Worth", latMin: 32.760, latMax: 32.790, lngMin: -97.250, lngMax: -97.210 },
  { zip: "76123", city: "Fort Worth", latMin: 32.630, latMax: 32.670, lngMin: -97.380, lngMax: -97.330 },
  { zip: "76126", city: "Fort Worth", latMin: 32.620, latMax: 32.660, lngMin: -97.440, lngMax: -97.390 },
  { zip: "76127", city: "Fort Worth", latMin: 32.770, latMax: 32.810, lngMin: -97.440, lngMax: -97.400 },
  { zip: "76129", city: "Fort Worth", latMin: 32.700, latMax: 32.730, lngMin: -97.370, lngMax: -97.340 },
  { zip: "76131", city: "Fort Worth", latMin: 32.830, latMax: 32.880, lngMin: -97.380, lngMax: -97.320 },
  { zip: "76132", city: "Fort Worth", latMin: 32.670, latMax: 32.700, lngMin: -97.410, lngMax: -97.360 },
  { zip: "76133", city: "Fort Worth", latMin: 32.660, latMax: 32.700, lngMin: -97.370, lngMax: -97.330 },
  { zip: "76134", city: "Fort Worth", latMin: 32.640, latMax: 32.680, lngMin: -97.350, lngMax: -97.300 },
  { zip: "76135", city: "Fort Worth", latMin: 32.800, latMax: 32.850, lngMin: -97.430, lngMax: -97.380 },
  { zip: "76137", city: "Fort Worth", latMin: 32.840, latMax: 32.880, lngMin: -97.340, lngMax: -97.290 },
  { zip: "76140", city: "Fort Worth", latMin: 32.620, latMax: 32.660, lngMin: -97.300, lngMax: -97.250 },
  { zip: "76148", city: "Fort Worth", latMin: 32.840, latMax: 32.880, lngMin: -97.290, lngMax: -97.240 },
  { zip: "76155", city: "Fort Worth", latMin: 32.820, latMax: 32.860, lngMin: -97.080, lngMax: -97.030 },
  { zip: "76164", city: "Fort Worth", latMin: 32.770, latMax: 32.800, lngMin: -97.380, lngMax: -97.340 },
  { zip: "76177", city: "Fort Worth", latMin: 32.880, latMax: 32.940, lngMin: -97.360, lngMax: -97.290 },
  { zip: "76001", city: "Arlington", latMin: 32.660, latMax: 32.710, lngMin: -97.130, lngMax: -97.070 },
  { zip: "76002", city: "Arlington", latMin: 32.660, latMax: 32.710, lngMin: -97.070, lngMax: -97.010 },
  { zip: "76006", city: "Arlington", latMin: 32.770, latMax: 32.810, lngMin: -97.090, lngMax: -97.040 },
  { zip: "76010", city: "Arlington", latMin: 32.720, latMax: 32.760, lngMin: -97.120, lngMax: -97.060 },
  { zip: "76011", city: "Arlington", latMin: 32.750, latMax: 32.790, lngMin: -97.140, lngMax: -97.080 },
  { zip: "76012", city: "Arlington", latMin: 32.730, latMax: 32.770, lngMin: -97.160, lngMax: -97.100 },
  { zip: "76013", city: "Arlington", latMin: 32.700, latMax: 32.740, lngMin: -97.170, lngMax: -97.120 },
  { zip: "76014", city: "Arlington", latMin: 32.680, latMax: 32.720, lngMin: -97.090, lngMax: -97.030 },
  { zip: "76015", city: "Arlington", latMin: 32.690, latMax: 32.730, lngMin: -97.150, lngMax: -97.090 },
  { zip: "76016", city: "Arlington", latMin: 32.710, latMax: 32.750, lngMin: -97.200, lngMax: -97.140 },
  { zip: "76017", city: "Arlington", latMin: 32.670, latMax: 32.710, lngMin: -97.190, lngMax: -97.130 },
  { zip: "76018", city: "Arlington", latMin: 32.650, latMax: 32.690, lngMin: -97.120, lngMax: -97.060 },
  { zip: "76040", city: "Euless", latMin: 32.830, latMax: 32.860, lngMin: -97.100, lngMax: -97.050 },
  { zip: "76039", city: "Euless", latMin: 32.840, latMax: 32.870, lngMin: -97.090, lngMax: -97.040 },
  { zip: "76021", city: "Bedford", latMin: 32.840, latMax: 32.870, lngMin: -97.160, lngMax: -97.120 },
  { zip: "76022", city: "Bedford", latMin: 32.840, latMax: 32.870, lngMin: -97.160, lngMax: -97.120 },
  { zip: "76034", city: "Colleyville", latMin: 32.870, latMax: 32.910, lngMin: -97.180, lngMax: -97.130 },
  { zip: "76051", city: "Grapevine", latMin: 32.900, latMax: 32.940, lngMin: -97.110, lngMax: -97.050 },
  { zip: "76053", city: "Hurst", latMin: 32.810, latMax: 32.850, lngMin: -97.200, lngMax: -97.150 },
  { zip: "76054", city: "Hurst", latMin: 32.850, latMax: 32.880, lngMin: -97.200, lngMax: -97.150 },
  { zip: "76060", city: "Kennedale", latMin: 32.640, latMax: 32.680, lngMin: -97.240, lngMax: -97.200 },
  { zip: "76063", city: "Mansfield", latMin: 32.560, latMax: 32.620, lngMin: -97.170, lngMax: -97.100 },
  { zip: "76092", city: "Southlake", latMin: 32.920, latMax: 32.960, lngMin: -97.160, lngMax: -97.100 },
  { zip: "76248", city: "Keller", latMin: 32.900, latMax: 32.940, lngMin: -97.280, lngMax: -97.220 },
  { zip: "76180", city: "North Richland Hills", latMin: 32.850, latMax: 32.890, lngMin: -97.250, lngMax: -97.200 },
  { zip: "76182", city: "North Richland Hills", latMin: 32.870, latMax: 32.910, lngMin: -97.260, lngMax: -97.210 },
];

const TARRANT_BOUNDS = { latMin: 32.50, latMax: 33.00, lngMin: -97.55, lngMax: -97.00 };

export function inferTarrantCityFromCoords(lat: number, lng: number): { city: string; zip: string } {
  if (lat < TARRANT_BOUNDS.latMin || lat > TARRANT_BOUNDS.latMax || lng < TARRANT_BOUNDS.lngMin || lng > TARRANT_BOUNDS.lngMax) {
    return { city: "Fort Worth", zip: "76102" };
  }

  let bestMatch: { city: string; zip: string; dist: number } | null = null;

  for (const region of TARRANT_COUNTY_ZIP_REGIONS) {
    const centerLat = (region.latMin + region.latMax) / 2;
    const centerLng = (region.lngMin + region.lngMax) / 2;
    const dist = Math.sqrt(Math.pow(lat - centerLat, 2) + Math.pow(lng - centerLng, 2));

    if (lat >= region.latMin && lat <= region.latMax && lng >= region.lngMin && lng <= region.lngMax) {
      return { city: region.city, zip: region.zip };
    }

    if (!bestMatch || dist < bestMatch.dist) {
      bestMatch = { city: region.city, zip: region.zip, dist };
    }
  }

  if (bestMatch && bestMatch.dist > 0.1) {
    return { city: "Fort Worth", zip: "76102" };
  }

  return bestMatch ? { city: bestMatch.city, zip: bestMatch.zip } : { city: "Fort Worth", zip: "76102" };
}

async function fetchTadPage(offset: number, minImprValue: number): Promise<{ features: TadFeature[]; hasMore: boolean }> {
  const where = `IMPR_VALUE>${minImprValue} AND IMPR_VALUE IS NOT NULL AND SITUS_ADDR IS NOT NULL AND OWNER_NAME IS NOT NULL`;
  const outFields = [
    "OBJECTID", "TAXPIN", "ACCOUNT", "OWNER_NAME", "OWNER_ADDR",
    "OWNER_CITY", "OWNER_ZIP", "SITUS_ADDR", "CITY", "ZIPCODE",
    "STATE", "YEAR_BUILT", "LIVING_ARE", "LAND_VALUE", "IMPR_VALUE",
    "TOTAL_VALU", "LAND_SQFT", "LAND_ACRES", "DESCR", "PARCELTYPE",
    "DEED_DATE", "INSTRUMENT_NO", "SubdivisionName",
  ].join(",");

  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    resultRecordCount: String(MAX_RECORDS_PER_REQUEST),
    resultOffset: String(offset),
  });

  const url = `${TAD_API_BASE}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TAD API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`TAD API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return {
    features: data.features || [],
    hasMore: data.exceededTransferLimit === true,
  };
}

export interface TadImportResult {
  totalFetched: number;
  imported: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

export async function importTadProperties(
  marketId: string,
  options: {
    minImprValue?: number;
    maxRecords?: number;
    minSqft?: number;
    skipGovernment?: boolean;
  } = {}
): Promise<TadImportResult> {
  const minImprValue = options.minImprValue ?? 200000;
  const maxRecords = options.maxRecords ?? 4000;
  const minSqft = options.minSqft ?? 0;
  const skipGovernment = options.skipGovernment ?? true;

  const run = await storage.createImportRun({
    type: "tad_api",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "Tarrant Appraisal District ArcGIS REST API", minImprValue, maxRecords } as any,
  });

  const result: TadImportResult = {
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
      console.log(`[TAD Agent] Fetching page at offset ${offset}...`);
      const page = await fetchTadPage(offset, minImprValue);
      const features = page.features;
      hasMore = page.hasMore;
      result.totalFetched += features.length;

      for (const feature of features) {
        try {
          const a = feature.attributes;

          if (!a.SITUS_ADDR || !a.OWNER_NAME) {
            result.skipped++;
            continue;
          }

          const ownerType = inferOwnerType(a.OWNER_NAME);
          if (skipGovernment && ownerType === "Government") {
            result.skipped++;
            continue;
          }

          const rawSqft = a.LIVING_ARE || 0;
          if (minSqft > 0 && rawSqft > 0 && rawSqft < minSqft) {
            result.skipped++;
            continue;
          }

          const sourceId = a.ACCOUNT;
          const existing = await storage.getLeadBySourceId("tad_api", sourceId);
          if (existing) {
            result.skipped++;
            continue;
          }

          const [lat, lng] = getCentroid(feature.geometry);
          const imprValue = a.IMPR_VALUE || 0;
          const landValue = a.LAND_VALUE || 0;
          const totalValue = a.TOTAL_VALU || (imprValue + landValue);
          const sqft = a.LIVING_ARE || (imprValue > 0 ? Math.round(imprValue / 120) : 5000);
          const yearBuilt = a.YEAR_BUILT || 1995;
          const zoning = inferZoningFromDescription(a.DESCR, a.PARCELTYPE);
          const llcName = ownerType === "LLC" ? a.OWNER_NAME : undefined;

          const cityFromAttr = a.CITY?.trim();
          const zipFromAttr = a.ZIPCODE?.trim();

          let city = cityFromAttr || "Fort Worth";
          let zipCode = zipFromAttr || "76102";

          if (!cityFromAttr || !zipFromAttr) {
            const inferred = inferTarrantCityFromCoords(lat, lng);
            city = cityFromAttr || inferred.city;
            zipCode = zipFromAttr || inferred.zip;
          }

          const ownerAddress = a.OWNER_ADDR
            ? `${a.OWNER_ADDR}, ${a.OWNER_CITY || ""} TX ${a.OWNER_ZIP || ""}`
            : undefined;

          const deedDate = a.DEED_DATE ? new Date(a.DEED_DATE).toISOString().slice(0, 10) : undefined;

          const leadData: InsertLead = {
            marketId,
            address: a.SITUS_ADDR,
            city,
            county: "Tarrant",
            state: "TX",
            zipCode,
            latitude: lat,
            longitude: lng,
            sqft,
            yearBuilt,
            constructionType: "Masonry",
            zoning,
            stories: 1,
            units: 1,
            ownerName: a.OWNER_NAME,
            ownerType,
            ownerAddress,
            llcName,
            improvementValue: imprValue || undefined,
            landValue: landValue || undefined,
            totalValue: totalValue || undefined,
            lastDeedDate: deedDate,
            sourceType: "tad_api",
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

    console.log(`[TAD Agent] Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (err: any) {
    console.error("[TAD Agent] Import failed:", err);
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
