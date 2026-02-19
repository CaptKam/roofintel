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

function inferCity(address: string, zip: string | null): string {
  const ZIP_TO_CITY: Record<string, string> = {
    "75201": "Dallas", "75202": "Dallas", "75203": "Dallas", "75204": "Dallas", "75205": "Dallas",
    "75206": "Dallas", "75207": "Dallas", "75208": "Dallas", "75209": "Dallas", "75210": "Dallas",
    "75211": "Dallas", "75212": "Dallas", "75214": "Dallas", "75215": "Dallas", "75216": "Dallas",
    "75217": "Dallas", "75218": "Dallas", "75219": "Dallas", "75220": "Dallas", "75223": "Dallas",
    "75224": "Dallas", "75225": "Dallas", "75226": "Dallas", "75227": "Dallas", "75228": "Dallas",
    "75229": "Dallas", "75230": "Dallas", "75231": "Dallas", "75232": "Dallas", "75233": "Dallas",
    "75234": "Farmers Branch", "75235": "Dallas", "75236": "Dallas", "75237": "Dallas",
    "75238": "Dallas", "75240": "Dallas", "75241": "Dallas", "75243": "Dallas", "75244": "Dallas",
    "75246": "Dallas", "75247": "Dallas", "75248": "Dallas", "75249": "Dallas", "75250": "Dallas",
    "75251": "Dallas", "75252": "Dallas", "75253": "Dallas", "75254": "Dallas",
    "75006": "Carrollton", "75007": "Carrollton", "75010": "Carrollton",
    "75019": "Coppell", "75038": "Irving", "75039": "Irving", "75060": "Irving", "75061": "Irving", "75062": "Irving",
    "75040": "Garland", "75041": "Garland", "75042": "Garland", "75043": "Garland", "75044": "Garland",
    "75043": "Garland", "75080": "Richardson", "75081": "Richardson", "75082": "Richardson",
    "75150": "Mesquite", "75149": "Mesquite", "75180": "Balch Springs",
    "75104": "Cedar Hill", "75115": "DeSoto", "75116": "Duncanville",
    "75134": "Lancaster", "75146": "Lancaster",
    "75159": "Seagoville", "75172": "Wilmer",
  };
  if (zip && ZIP_TO_CITY[zip]) return ZIP_TO_CITY[zip];
  return "Dallas";
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
    skipGovernment?: boolean;
  } = {}
): Promise<DcadImportResult> {
  const minImpValue = options.minImpValue ?? 200000;
  const maxRecords = options.maxRecords ?? 4000;
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
          const city = a.PSTLCITY || inferCity(a.SITEADDRESS, a.PSTLZIP5);
          const llcName = ownerType === "LLC" ? a.OWNERNME1 : undefined;

          const ownerAddress = a.PSTLADDRESS
            ? `${a.PSTLADDRESS}, ${a.PSTLCITY || ""} ${a.PSTLSTATE || "TX"} ${a.PSTLZIP5 || ""}`
            : undefined;

          const leadData: InsertLead = {
            marketId,
            address: a.SITEADDRESS,
            city,
            county: "Dallas",
            state: "TX",
            zipCode: a.PSTLZIP5 || "75201",
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
