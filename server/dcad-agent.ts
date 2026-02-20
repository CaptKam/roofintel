import { storage } from "./storage";
import { calculateScore } from "./seed";
import type { InsertLead } from "@shared/schema";

const DCAD_API_BASE = "https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query";
const MAX_RECORDS_PER_REQUEST = 1000;
const BATCH_INSERT_SIZE = 100;

const COMMERCIAL_USE_CODES = ["2"];

const COMMERCIAL_CLASSES = [
  "COMMERCIAL IMPROVEMENTS",
  "INDUSTRIAL IMPROVEMENTS",
  "COMMERCIAL - MULTI-FAMILY",
];

interface DcadFeature {
  attributes: {
    PARCELID: string;
    SITEADDRESS: string;
    OWNERNME1: string;
    OWNERNME2: string | null;
    BLDGAREA: number | null;
    CNTASSDVAL: number | null;
    USECD: string;
    USEDSCRP: string;
    CLASSDSCRP: string;
    FLOORCOUNT: number | null;
    IMPVALUE: number | null;
    LNDVALUE: number | null;
    RESYRBLT: number | null;
    PSTLZIP5: string | null;
    PSTLADDRESS: string | null;
    PSTLCITY: string | null;
    PSTLSTATE: string | null;
    STRCLASS: string | null;
    DBA1: string | null;
  };
  geometry?: {
    rings?: number[][][];
  };
}

function getCentroid(geometry?: { rings?: number[][][] }): [number, number] {
  if (!geometry?.rings?.[0]?.length) return [32.7767, -96.7970];
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

function inferZoning(classDesc: string): string {
  const upper = (classDesc || "").toUpperCase();
  if (upper.includes("MULTI-FAMILY") || upper.includes("MFR") || upper.includes("APARTMENT") || upper.includes("DUPLEX")) return "Multi-Family";
  if (upper.includes("INDUSTRIAL") || upper.includes("WAREHOUSE") || upper.includes("MANUFACTURING")) return "Industrial";
  if (upper.includes("OFFICE")) return "Commercial";
  if (upper.includes("RETAIL")) return "Commercial";
  if (upper.includes("MIXED")) return "Mixed Use";
  return "Commercial";
}

function estimateSqft(impValue: number | null): number {
  if (!impValue || impValue <= 0) return 5000;
  if (impValue > 10000000) return Math.round(impValue / 150);
  if (impValue > 1000000) return Math.round(impValue / 120);
  return Math.round(impValue / 100);
}

const DALLAS_COUNTY_ZIP_REGIONS: Array<{ zip: string; city: string; latMin: number; latMax: number; lngMin: number; lngMax: number }> = [
  { zip: "75201", city: "Dallas", latMin: 32.785, latMax: 32.800, lngMin: -96.810, lngMax: -96.790 },
  { zip: "75202", city: "Dallas", latMin: 32.775, latMax: 32.790, lngMin: -96.815, lngMax: -96.795 },
  { zip: "75204", city: "Dallas", latMin: 32.790, latMax: 32.810, lngMin: -96.800, lngMax: -96.780 },
  { zip: "75205", city: "Dallas", latMin: 32.820, latMax: 32.845, lngMin: -96.810, lngMax: -96.780 },
  { zip: "75206", city: "Dallas", latMin: 32.810, latMax: 32.835, lngMin: -96.780, lngMax: -96.760 },
  { zip: "75207", city: "Dallas", latMin: 32.775, latMax: 32.795, lngMin: -96.830, lngMax: -96.805 },
  { zip: "75208", city: "Dallas", latMin: 32.745, latMax: 32.775, lngMin: -96.845, lngMax: -96.815 },
  { zip: "75209", city: "Dallas", latMin: 32.830, latMax: 32.850, lngMin: -96.830, lngMax: -96.810 },
  { zip: "75210", city: "Dallas", latMin: 32.760, latMax: 32.785, lngMin: -96.790, lngMax: -96.760 },
  { zip: "75211", city: "Dallas", latMin: 32.730, latMax: 32.760, lngMin: -96.880, lngMax: -96.845 },
  { zip: "75212", city: "Dallas", latMin: 32.770, latMax: 32.800, lngMin: -96.870, lngMax: -96.840 },
  { zip: "75214", city: "Dallas", latMin: 32.810, latMax: 32.840, lngMin: -96.760, lngMax: -96.730 },
  { zip: "75215", city: "Dallas", latMin: 32.740, latMax: 32.770, lngMin: -96.790, lngMax: -96.755 },
  { zip: "75216", city: "Dallas", latMin: 32.700, latMax: 32.740, lngMin: -96.800, lngMax: -96.760 },
  { zip: "75217", city: "Dallas", latMin: 32.700, latMax: 32.740, lngMin: -96.750, lngMax: -96.700 },
  { zip: "75218", city: "Dallas", latMin: 32.830, latMax: 32.860, lngMin: -96.730, lngMax: -96.690 },
  { zip: "75219", city: "Dallas", latMin: 32.800, latMax: 32.830, lngMin: -96.820, lngMax: -96.795 },
  { zip: "75220", city: "Dallas", latMin: 32.850, latMax: 32.875, lngMin: -96.870, lngMax: -96.830 },
  { zip: "75223", city: "Dallas", latMin: 32.770, latMax: 32.800, lngMin: -96.760, lngMax: -96.730 },
  { zip: "75224", city: "Dallas", latMin: 32.700, latMax: 32.740, lngMin: -96.850, lngMax: -96.800 },
  { zip: "75225", city: "Dallas", latMin: 32.845, latMax: 32.870, lngMin: -96.800, lngMax: -96.770 },
  { zip: "75226", city: "Dallas", latMin: 32.775, latMax: 32.800, lngMin: -96.780, lngMax: -96.755 },
  { zip: "75227", city: "Dallas", latMin: 32.760, latMax: 32.800, lngMin: -96.730, lngMax: -96.690 },
  { zip: "75228", city: "Dallas", latMin: 32.800, latMax: 32.840, lngMin: -96.720, lngMax: -96.680 },
  { zip: "75229", city: "Dallas", latMin: 32.880, latMax: 32.910, lngMin: -96.870, lngMax: -96.830 },
  { zip: "75230", city: "Dallas", latMin: 32.890, latMax: 32.920, lngMin: -96.810, lngMax: -96.770 },
  { zip: "75231", city: "Dallas", latMin: 32.870, latMax: 32.900, lngMin: -96.770, lngMax: -96.740 },
  { zip: "75232", city: "Dallas", latMin: 32.660, latMax: 32.700, lngMin: -96.870, lngMax: -96.830 },
  { zip: "75233", city: "Dallas", latMin: 32.700, latMax: 32.730, lngMin: -96.870, lngMax: -96.840 },
  { zip: "75234", city: "Farmers Branch", latMin: 32.910, latMax: 32.940, lngMin: -96.920, lngMax: -96.870 },
  { zip: "75235", city: "Dallas", latMin: 32.845, latMax: 32.870, lngMin: -96.855, lngMax: -96.830 },
  { zip: "75236", city: "Dallas", latMin: 32.660, latMax: 32.700, lngMin: -96.920, lngMax: -96.870 },
  { zip: "75237", city: "Dallas", latMin: 32.640, latMax: 32.670, lngMin: -96.870, lngMax: -96.830 },
  { zip: "75238", city: "Dallas", latMin: 32.860, latMax: 32.890, lngMin: -96.730, lngMax: -96.690 },
  { zip: "75240", city: "Dallas", latMin: 32.920, latMax: 32.950, lngMin: -96.810, lngMax: -96.770 },
  { zip: "75241", city: "Dallas", latMin: 32.640, latMax: 32.680, lngMin: -96.790, lngMax: -96.740 },
  { zip: "75243", city: "Dallas", latMin: 32.890, latMax: 32.920, lngMin: -96.770, lngMax: -96.730 },
  { zip: "75244", city: "Dallas", latMin: 32.930, latMax: 32.960, lngMin: -96.860, lngMax: -96.820 },
  { zip: "75246", city: "Dallas", latMin: 32.785, latMax: 32.810, lngMin: -96.790, lngMax: -96.770 },
  { zip: "75247", city: "Dallas", latMin: 32.810, latMax: 32.840, lngMin: -96.870, lngMax: -96.840 },
  { zip: "75248", city: "Dallas", latMin: 32.950, latMax: 32.980, lngMin: -96.830, lngMax: -96.790 },
  { zip: "75006", city: "Carrollton", latMin: 32.950, latMax: 32.980, lngMin: -96.920, lngMax: -96.870 },
  { zip: "75007", city: "Carrollton", latMin: 32.980, latMax: 33.010, lngMin: -96.920, lngMax: -96.870 },
  { zip: "75019", city: "Coppell", latMin: 32.940, latMax: 32.980, lngMin: -96.990, lngMax: -96.940 },
  { zip: "75038", city: "Irving", latMin: 32.860, latMax: 32.890, lngMin: -96.970, lngMax: -96.930 },
  { zip: "75039", city: "Irving", latMin: 32.870, latMax: 32.900, lngMin: -96.960, lngMax: -96.920 },
  { zip: "75060", city: "Irving", latMin: 32.810, latMax: 32.840, lngMin: -96.970, lngMax: -96.930 },
  { zip: "75061", city: "Irving", latMin: 32.830, latMax: 32.860, lngMin: -96.960, lngMax: -96.920 },
  { zip: "75062", city: "Irving", latMin: 32.850, latMax: 32.880, lngMin: -96.990, lngMax: -96.950 },
  { zip: "75040", city: "Garland", latMin: 32.890, latMax: 32.930, lngMin: -96.660, lngMax: -96.620 },
  { zip: "75041", city: "Garland", latMin: 32.850, latMax: 32.890, lngMin: -96.680, lngMax: -96.640 },
  { zip: "75042", city: "Garland", latMin: 32.880, latMax: 32.920, lngMin: -96.700, lngMax: -96.660 },
  { zip: "75043", city: "Garland", latMin: 32.840, latMax: 32.880, lngMin: -96.640, lngMax: -96.590 },
  { zip: "75044", city: "Garland", latMin: 32.930, latMax: 32.970, lngMin: -96.670, lngMax: -96.630 },
  { zip: "75080", city: "Richardson", latMin: 32.930, latMax: 32.960, lngMin: -96.760, lngMax: -96.720 },
  { zip: "75081", city: "Richardson", latMin: 32.940, latMax: 32.970, lngMin: -96.730, lngMax: -96.690 },
  { zip: "75082", city: "Richardson", latMin: 32.960, latMax: 32.990, lngMin: -96.730, lngMax: -96.680 },
  { zip: "75150", city: "Mesquite", latMin: 32.750, latMax: 32.790, lngMin: -96.660, lngMax: -96.610 },
  { zip: "75149", city: "Mesquite", latMin: 32.740, latMax: 32.780, lngMin: -96.630, lngMax: -96.580 },
  { zip: "75180", city: "Balch Springs", latMin: 32.710, latMax: 32.750, lngMin: -96.660, lngMax: -96.610 },
  { zip: "75104", city: "Cedar Hill", latMin: 32.570, latMax: 32.620, lngMin: -96.980, lngMax: -96.920 },
  { zip: "75115", city: "DeSoto", latMin: 32.580, latMax: 32.620, lngMin: -96.880, lngMax: -96.830 },
  { zip: "75116", city: "Duncanville", latMin: 32.630, latMax: 32.670, lngMin: -96.920, lngMax: -96.880 },
  { zip: "75134", city: "Lancaster", latMin: 32.580, latMax: 32.620, lngMin: -96.790, lngMax: -96.750 },
  { zip: "75146", city: "Lancaster", latMin: 32.560, latMax: 32.600, lngMin: -96.810, lngMax: -96.760 },
  { zip: "75159", city: "Seagoville", latMin: 32.620, latMax: 32.660, lngMin: -96.560, lngMax: -96.510 },
  { zip: "75172", city: "Wilmer", latMin: 32.580, latMax: 32.620, lngMin: -96.710, lngMax: -96.670 },
  { zip: "76092", city: "Southlake", latMin: 32.920, latMax: 32.960, lngMin: -97.160, lngMax: -97.100 },
  { zip: "76034", city: "Colleyville", latMin: 32.870, latMax: 32.910, lngMin: -97.180, lngMax: -97.130 },
  { zip: "76001", city: "Arlington", latMin: 32.660, latMax: 32.710, lngMin: -97.130, lngMax: -97.070 },
  { zip: "76010", city: "Arlington", latMin: 32.720, latMax: 32.760, lngMin: -97.120, lngMax: -97.060 },
  { zip: "76011", city: "Arlington", latMin: 32.750, latMax: 32.790, lngMin: -97.140, lngMax: -97.080 },
  { zip: "76012", city: "Arlington", latMin: 32.730, latMax: 32.770, lngMin: -97.160, lngMax: -97.100 },
  { zip: "76013", city: "Arlington", latMin: 32.700, latMax: 32.740, lngMin: -97.170, lngMax: -97.120 },
  { zip: "76014", city: "Arlington", latMin: 32.680, latMax: 32.720, lngMin: -97.090, lngMax: -97.030 },
  { zip: "76015", city: "Arlington", latMin: 32.690, latMax: 32.730, lngMin: -97.150, lngMax: -97.090 },
  { zip: "76016", city: "Arlington", latMin: 32.710, latMax: 32.750, lngMin: -97.200, lngMax: -97.140 },
  { zip: "76017", city: "Arlington", latMin: 32.670, latMax: 32.710, lngMin: -97.190, lngMax: -97.130 },
  { zip: "76018", city: "Arlington", latMin: 32.650, latMax: 32.690, lngMin: -97.120, lngMax: -97.060 },
  { zip: "76019", city: "Arlington", latMin: 32.710, latMax: 32.750, lngMin: -97.070, lngMax: -97.010 },
  { zip: "75050", city: "Grand Prairie", latMin: 32.730, latMax: 32.770, lngMin: -97.000, lngMax: -96.950 },
  { zip: "75051", city: "Grand Prairie", latMin: 32.700, latMax: 32.740, lngMin: -97.010, lngMax: -96.960 },
  { zip: "75052", city: "Grand Prairie", latMin: 32.660, latMax: 32.700, lngMin: -97.020, lngMax: -96.960 },
  { zip: "75054", city: "Grand Prairie", latMin: 32.640, latMax: 32.680, lngMin: -97.050, lngMax: -96.990 },
];

const DFW_BOUNDS = { latMin: 32.50, latMax: 33.10, lngMin: -97.30, lngMax: -96.45 };

export function inferCityFromCoords(lat: number, lng: number): { city: string; zip: string } {
  if (lat < DFW_BOUNDS.latMin || lat > DFW_BOUNDS.latMax || lng < DFW_BOUNDS.lngMin || lng > DFW_BOUNDS.lngMax) {
    return { city: "Dallas", zip: "75201" };
  }

  let bestMatch: { city: string; zip: string; dist: number } | null = null;

  for (const region of DALLAS_COUNTY_ZIP_REGIONS) {
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
    return { city: "Dallas", zip: "75201" };
  }

  return bestMatch ? { city: bestMatch.city, zip: bestMatch.zip } : { city: "Dallas", zip: "75201" };
}

function isDallasCountyZip(zip: string): boolean {
  return DALLAS_COUNTY_ZIP_REGIONS.some(r => r.zip === zip);
}

async function fetchDcadPage(offset: number, minImpValue: number): Promise<{ features: DcadFeature[]; hasMore: boolean }> {
  const where = `USECD='2' AND IMPVALUE>${minImpValue}`;
  const outFields = [
    "PARCELID", "SITEADDRESS", "OWNERNME1", "OWNERNME2", "BLDGAREA",
    "CNTASSDVAL", "USECD", "USEDSCRP", "CLASSDSCRP", "FLOORCOUNT",
    "IMPVALUE", "LNDVALUE", "RESYRBLT", "PSTLZIP5", "PSTLADDRESS",
    "PSTLCITY", "PSTLSTATE", "STRCLASS", "DBA1",
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

  const url = `${DCAD_API_BASE}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DCAD API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`DCAD API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return {
    features: data.features || [],
    hasMore: data.exceededTransferLimit === true,
  };
}

export interface DcadImportResult {
  totalFetched: number;
  imported: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

export async function importDcadProperties(
  marketId: string,
  options: {
    minImpValue?: number;
    maxRecords?: number;
    minSqft?: number;
    skipGovernment?: boolean;
  } = {}
): Promise<DcadImportResult> {
  const minImpValue = options.minImpValue ?? 200000;
  const maxRecords = options.maxRecords ?? 4000;
  const minSqft = options.minSqft ?? 0;
  const skipGovernment = options.skipGovernment ?? true;

  const run = await storage.createImportRun({
    type: "dcad_api",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "DCAD ArcGIS REST API", minImpValue, maxRecords } as any,
  });

  const result: DcadImportResult = {
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
      console.log(`[DCAD Agent] Fetching page at offset ${offset}...`);
      const page = await fetchDcadPage(offset, minImpValue);
      const features = page.features;
      hasMore = page.hasMore;
      result.totalFetched += features.length;

      for (const feature of features) {
        try {
          const a = feature.attributes;

          if (!a.SITEADDRESS || !a.OWNERNME1) {
            result.skipped++;
            continue;
          }

          const classDesc = (a.CLASSDSCRP || "").trim();
          if (classDesc.includes("VACANT")) {
            result.skipped++;
            continue;
          }

          const ownerType = inferOwnerType(a.OWNERNME1);
          if (skipGovernment && ownerType === "Government") {
            result.skipped++;
            continue;
          }

          const rawSqft = a.BLDGAREA || 0;
          if (minSqft > 0 && rawSqft > 0 && rawSqft < minSqft) {
            result.skipped++;
            continue;
          }

          const sourceId = a.PARCELID;
          const existing = await storage.getLeadBySourceId("dcad_api", sourceId);
          if (existing) {
            result.skipped++;
            continue;
          }

          const [lat, lng] = getCentroid(feature.geometry);
          const impValue = a.IMPVALUE || 0;
          const landValue = a.LNDVALUE || 0;
          const totalValue = a.CNTASSDVAL || (impValue + landValue);
          const sqft = a.BLDGAREA || estimateSqft(impValue);
          const yearBuilt = a.RESYRBLT || 1995;
          const zoning = inferZoning(classDesc);
          const llcName = ownerType === "LLC" ? a.OWNERNME1 : undefined;

          const propertyLocation = inferCityFromCoords(lat, lng);

          const ownerAddress = a.PSTLADDRESS
            ? `${a.PSTLADDRESS}, ${a.PSTLCITY || ""} ${a.PSTLSTATE || "TX"} ${a.PSTLZIP5 || ""}`
            : undefined;

          const leadData: InsertLead = {
            marketId,
            address: a.SITEADDRESS,
            city: propertyLocation.city,
            county: "Dallas",
            state: "TX",
            zipCode: propertyLocation.zip,
            latitude: lat,
            longitude: lng,
            sqft,
            yearBuilt,
            constructionType: a.STRCLASS || "Masonry",
            zoning,
            stories: a.FLOORCOUNT || 1,
            units: 1,
            ownerName: a.OWNERNME1,
            ownerType,
            ownerAddress,
            llcName,
            improvementValue: impValue || undefined,
            landValue: landValue || undefined,
            totalValue: totalValue || undefined,
            sourceType: "dcad_api",
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

    console.log(`[DCAD Agent] Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (err: any) {
    console.error("[DCAD Agent] Import failed:", err);
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
