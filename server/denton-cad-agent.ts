import { storage } from "./storage";
import { calculateScore } from "./seed";
import type { InsertLead } from "@shared/schema";

const DENTON_CAD_API_BASE = "https://geo.dentoncad.com/arcgis/rest/services/Hosted/Parcels_with_CAMA_Data/FeatureServer/0/query";
const MAX_RECORDS_PER_REQUEST = 2000;
const BATCH_INSERT_SIZE = 100;

interface DentonCadFeature {
  attributes: {
    pid: number | null;
    objectid: number;
    name: string | null;
    namesecondary: string | null;
    dba: string | null;
    proptype: string | null;
    usecd: string | null;
    statecodes: string | null;
    cad_zoning: string | null;
    situs_full_address: string | null;
    situs_street_address: string | null;
    situsstreetnumb: string | null;
    situsstreetname: string | null;
    situsstreetsuff: string | null;
    situscity: string | null;
    situsstate: string | null;
    situszip: string | null;
    addrdeliveryline: string | null;
    addrcity: string | null;
    addrstate: string | null;
    addrzip: string | null;
    improvementvalue: number | null;
    ownermarketvalue: number | null;
    ownerappraisedvalue: number | null;
    landnhsvalue: number | null;
    imprvactualyearbuilt: number | null;
    imprveffyearbuilt: number | null;
    imprvtotalarea: number | null;
    imprvmainarea: number | null;
    imprvclasses: string | null;
    landtotalsqft: number | null;
    land_sqft: number | null;
    effectivesizeacres: number | null;
    legaldescription: string | null;
    deeddt: string | null;
    deedtype: string | null;
    instrumentnum: string | null;
    exemptions: string | null;
    citytaxingunitname: string | null;
    geoid: string | null;
  };
  geometry?: {
    rings?: number[][][];
  };
}

function getCentroid(geometry?: { rings?: number[][][] }): [number, number] {
  if (!geometry?.rings?.[0]?.length) return [33.2148, -97.1331];
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

function inferZoning(propType: string, useCode: string, cadZoning: string, imprvClasses: string): string {
  const combined = `${propType} ${useCode} ${cadZoning} ${imprvClasses}`.toUpperCase();
  if (combined.includes("MULTI") || combined.includes("MFR") || combined.includes("APARTMENT") || combined.includes("DUPLEX")) return "Multi-Family";
  if (combined.includes("INDUSTRIAL") || combined.includes("WAREHOUSE") || combined.includes("MANUFACTURING")) return "Industrial";
  if (combined.includes("OFFICE")) return "Commercial";
  if (combined.includes("RETAIL")) return "Commercial";
  if (combined.includes("MIXED")) return "Mixed Use";
  if (combined.includes("COMMERCIAL") || combined.includes("COMM")) return "Commercial";
  return "Commercial";
}

const DENTON_COUNTY_CITIES: Record<string, { lat: number; lng: number }> = {
  "DENTON": { lat: 33.2148, lng: -97.1331 },
  "LEWISVILLE": { lat: 33.0462, lng: -96.9942 },
  "FLOWER MOUND": { lat: 33.0146, lng: -97.0970 },
  "LITTLE ELM": { lat: 33.1626, lng: -96.9375 },
  "THE COLONY": { lat: 33.0890, lng: -96.8863 },
  "CORINTH": { lat: 33.1540, lng: -97.0650 },
  "HIGHLAND VILLAGE": { lat: 33.0918, lng: -97.0464 },
  "LAKE DALLAS": { lat: 33.1190, lng: -97.0253 },
  "SANGER": { lat: 33.3632, lng: -97.1739 },
  "ARGYLE": { lat: 33.1218, lng: -97.1828 },
  "AUBREY": { lat: 33.3037, lng: -96.9872 },
  "PILOT POINT": { lat: 33.3965, lng: -96.9608 },
  "KRUM": { lat: 33.2618, lng: -97.2378 },
  "PONDER": { lat: 33.1832, lng: -97.2892 },
  "JUSTIN": { lat: 33.0848, lng: -97.2962 },
  "ROANOKE": { lat: 33.0040, lng: -97.2256 },
  "NORTHLAKE": { lat: 33.0715, lng: -97.2572 },
  "TROPHY CLUB": { lat: 32.9974, lng: -97.1831 },
};

function inferCityCoords(city: string): { lat: number; lng: number } {
  const upper = (city || "").toUpperCase().trim();
  return DENTON_COUNTY_CITIES[upper] || { lat: 33.2148, lng: -97.1331 };
}

function isCommercialProperty(propType: string, useCode: string): boolean {
  const pt = (propType || "").toUpperCase();
  const uc = (useCode || "").toUpperCase();
  if (pt === "R" || pt === "REAL") {
    if (uc.startsWith("C") || uc.startsWith("F") || uc.startsWith("G") || uc.startsWith("H") || uc.startsWith("J") || uc.startsWith("L") || uc.startsWith("M") || uc.startsWith("N") || uc.startsWith("O")) {
      return true;
    }
  }
  if (pt.includes("COMM") || pt.includes("IND") || pt.includes("MULTI")) return true;
  return false;
}

async function fetchDentonCadPage(offset: number, minImpValue: number): Promise<{ features: DentonCadFeature[]; hasMore: boolean }> {
  const where = `improvementvalue>${minImpValue} AND proptype='R'`;
  const outFields = [
    "pid", "objectid", "name", "namesecondary", "dba", "proptype", "usecd", "statecodes",
    "cad_zoning", "situs_full_address", "situs_street_address", "situscity", "situsstate", "situszip",
    "addrdeliveryline", "addrcity", "addrstate", "addrzip",
    "improvementvalue", "ownermarketvalue", "ownerappraisedvalue", "landnhsvalue",
    "imprvactualyearbuilt", "imprveffyearbuilt", "imprvtotalarea", "imprvmainarea", "imprvclasses",
    "landtotalsqft", "land_sqft", "effectivesizeacres",
    "legaldescription", "deeddt", "instrumentnum", "exemptions", "citytaxingunitname", "geoid",
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

  const url = `${DENTON_CAD_API_BASE}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Denton CAD API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Denton CAD API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return {
    features: data.features || [],
    hasMore: data.exceededTransferLimit === true,
  };
}

export interface DentonCadImportResult {
  totalFetched: number;
  imported: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

export async function importDentonCadProperties(
  marketId: string,
  options: {
    minImpValue?: number;
    maxRecords?: number;
    minSqft?: number;
    skipGovernment?: boolean;
  } = {}
): Promise<DentonCadImportResult> {
  const minImpValue = options.minImpValue ?? 200000;
  const maxRecords = options.maxRecords ?? 4000;
  const minSqft = options.minSqft ?? 0;
  const skipGovernment = options.skipGovernment ?? true;

  const run = await storage.createImportRun({
    type: "denton_cad_api",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "Denton CAD ArcGIS REST API", minImpValue, maxRecords } as any,
  });

  const result: DentonCadImportResult = {
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
      console.log(`[Denton CAD Agent] Fetching page at offset ${offset}...`);
      const page = await fetchDentonCadPage(offset, minImpValue);
      const features = page.features;
      hasMore = page.hasMore;
      result.totalFetched += features.length;

      for (const feature of features) {
        try {
          const a = feature.attributes;
          const address = a.situs_full_address || a.situs_street_address;
          const ownerName = a.name;

          if (!address || !ownerName) {
            result.skipped++;
            continue;
          }

          const ownerType = inferOwnerType(ownerName);
          if (skipGovernment && ownerType === "Government") {
            result.skipped++;
            continue;
          }

          const sqft = a.imprvtotalarea || a.imprvmainarea || 0;
          if (minSqft > 0 && sqft > 0 && sqft < minSqft) {
            result.skipped++;
            continue;
          }

          const sourceId = a.pid ? String(a.pid) : (a.geoid || String(a.objectid));
          const existing = await storage.getLeadBySourceId("denton_cad_api", sourceId);
          if (existing) {
            result.skipped++;
            continue;
          }

          const city = a.situscity || a.citytaxingunitname || "Denton";
          const zipCode = a.situszip || "76201";
          const impValue = a.improvementvalue || 0;
          const landValue = a.landnhsvalue || 0;
          const totalValue = a.ownermarketvalue || a.ownerappraisedvalue || (impValue + landValue);
          const yearBuilt = a.imprvactualyearbuilt || a.imprveffyearbuilt || 1995;
          const zoning = inferZoning(a.proptype || "", a.usecd || "", a.cad_zoning || "", a.imprvclasses || "");
          const llcName = ownerType === "LLC" ? ownerName : undefined;

          let lat: number, lng: number;
          const [geoLat, geoLng] = getCentroid(feature.geometry);
          if (geoLat !== 33.2148 || geoLng !== -97.1331) {
            lat = geoLat;
            lng = geoLng;
          } else {
            const coords = inferCityCoords(city);
            lat = coords.lat + (Math.random() - 0.5) * 0.01;
            lng = coords.lng + (Math.random() - 0.5) * 0.01;
          }

          const ownerAddress = a.addrdeliveryline
            ? `${a.addrdeliveryline}, ${a.addrcity || ""} ${a.addrstate || "TX"} ${a.addrzip || ""}`
            : undefined;

          const leadData: InsertLead = {
            marketId,
            address: String(address),
            city: String(city),
            county: "Denton",
            state: "TX",
            zipCode: String(zipCode),
            latitude: lat,
            longitude: lng,
            sqft: sqft || Math.round(impValue / 120),
            yearBuilt,
            constructionType: a.imprvclasses || "Masonry",
            zoning,
            stories: 1,
            units: 1,
            ownerName: String(ownerName),
            ownerType,
            ownerAddress,
            llcName,
            businessName: a.dba || undefined,
            improvementValue: impValue || undefined,
            landValue: landValue || undefined,
            totalValue: totalValue || undefined,
            lastDeedDate: a.deeddt || undefined,
            sourceType: "denton_cad_api",
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

    console.log(`[Denton CAD Agent] Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (err: any) {
    console.error("[Denton CAD Agent] Import failed:", err);
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
