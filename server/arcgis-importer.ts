import { storage } from "./storage";
import { calculateScore } from "./seed";
import type { InsertLead, MarketDataSource } from "@shared/schema";

const MAX_RECORDS_PER_REQUEST = 1000;
const BATCH_INSERT_SIZE = 100;

export interface ArcgisImportResult {
  totalFetched: number;
  imported: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
  dataSourceId: string;
  dataSourceName: string;
  dryRun: boolean;
  sample?: Record<string, any>[];
}

interface FieldMapping {
  [canonicalField: string]: string | string[];
}

interface FilterConfig {
  minImpValue?: number;
  commercialUseCodes?: string[];
  commercialClasses?: string[];
  commercialPropTypes?: (string | number)[];
  commercialParcelTypes?: number[];
  whereClause?: string;
  county?: string;
}

export function getFieldValue(attributes: Record<string, any>, mapping: string | string[]): any {
  if (Array.isArray(mapping)) {
    for (const key of mapping) {
      if (typeof key === 'string' && key.startsWith('_STATIC_')) {
        return key.slice(8);
      }
      if (attributes[key] !== undefined && attributes[key] !== null) {
        return attributes[key];
      }
    }
    return null;
  }
  if (typeof mapping === 'string' && mapping.startsWith('_STATIC_')) {
    return mapping.slice(8);
  }
  return attributes[mapping] ?? null;
}

export function getCentroid(geometry?: { rings?: number[][][] }, defaultLat = 32.7767, defaultLng = -96.7970): [number, number] {
  if (!geometry?.rings?.[0]?.length) return [defaultLat, defaultLng];
  const pts = geometry.rings[0];
  const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lng];
}

export function inferOwnerType(name: string): string {
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
  if (upper.includes("MULTI-FAMILY") || upper.includes("MFR") || upper.includes("APARTMENT") || upper.includes("DUPLEX") || upper.includes("TRIPLEX") || upper.includes("FOURPLEX")) return "Multi-Family";
  if (upper.includes("INDUSTRIAL") || upper.includes("WAREHOUSE") || upper.includes("MANUFACTURING")) return "Industrial";
  if (upper.includes("OFFICE")) return "Commercial";
  if (upper.includes("RETAIL") || upper.includes("SHOPPING") || upper.includes("STORE")) return "Commercial";
  if (upper.includes("MIXED")) return "Mixed Use";
  if (upper.includes("HOTEL") || upper.includes("MOTEL")) return "Commercial";
  if (upper.includes("MEDICAL") || upper.includes("HOSPITAL") || upper.includes("CLINIC")) return "Commercial";
  if (upper.includes("COMMERCIAL") || upper.includes("COMM")) return "Commercial";
  return "Commercial";
}

function estimateSqft(impValue: number | null): number {
  if (!impValue || impValue <= 0) return 5000;
  if (impValue > 10000000) return Math.round(impValue / 150);
  if (impValue > 1000000) return Math.round(impValue / 120);
  return Math.round(impValue / 100);
}

function buildWhereClause(filterConfig: FilterConfig): string {
  if (filterConfig.whereClause) return filterConfig.whereClause;

  const conditions: string[] = [];
  const minImp = filterConfig.minImpValue ?? 100000;

  if (filterConfig.commercialUseCodes?.length) {
    const codes = filterConfig.commercialUseCodes.map(c => `'${c}'`).join(",");
    conditions.push(`USECD IN (${codes})`);
  }

  conditions.push(`IMPVALUE>${minImp}`);

  return conditions.join(" AND ") || "1=1";
}

function buildOutFields(fieldMapping: FieldMapping): string {
  const fields = new Set<string>();
  for (const mapping of Object.values(fieldMapping)) {
    if (Array.isArray(mapping)) {
      mapping.forEach(f => { if (!f.startsWith('_STATIC_')) fields.add(f); });
    } else if (!mapping.startsWith('_STATIC_')) {
      fields.add(mapping);
    }
  }
  return Array.from(fields).join(",");
}

function inferCountyFromSourceName(sourceName: string): string {
  const upper = sourceName.toUpperCase();
  if (upper.includes("DALLAS")) return "Dallas";
  if (upper.includes("TARRANT")) return "Tarrant";
  if (upper.includes("COLLIN")) return "Collin";
  if (upper.includes("DENTON")) return "Denton";
  return "Dallas";
}

function inferDefaultCoords(sourceName: string): [number, number] {
  const county = inferCountyFromSourceName(sourceName);
  switch (county) {
    case "Dallas": return [32.7767, -96.7970];
    case "Tarrant": return [32.7555, -97.3308];
    case "Collin": return [33.1972, -96.6150];
    case "Denton": return [33.2148, -97.1331];
    default: return [32.7767, -96.7970];
  }
}

async function fetchArcgisPage(
  endpoint: string,
  whereClause: string,
  outFields: string,
  offset: number,
  maxRecords: number,
  paginationMode?: string
): Promise<{ features: any[]; hasMore: boolean }> {
  const paramObj: Record<string, string> = {
    where: whereClause,
    outFields: paginationMode === "objectid" ? outFields + ",OBJECTID" : outFields,
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  };

  if (paginationMode !== "objectid") {
    paramObj.resultRecordCount = String(Math.min(maxRecords, MAX_RECORDS_PER_REQUEST));
    paramObj.resultOffset = String(offset);
  }

  const params = new URLSearchParams(paramObj);
  const url = `${endpoint}?${params.toString()}`;

  let data: any;
  const MAX_RETRIES = 4;
  const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
      console.log(`[ArcGIS Importer] Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);
      await new Promise(r => setTimeout(r, delay));
    }
    let response: Response;
    try {
      response = await fetch(url);
    } catch (networkErr: any) {
      if (attempt === MAX_RETRIES) throw new Error(`ArcGIS network error: ${networkErr.message}`);
      continue;
    }
    if (!response.ok) {
      if (RETRYABLE_HTTP.has(response.status) && attempt < MAX_RETRIES) continue;
      throw new Error(`ArcGIS API error: ${response.status} ${response.statusText}`);
    }
    data = await response.json();
    if (!data.error) break;
    if (attempt === MAX_RETRIES) {
      throw new Error(`ArcGIS API error: ${data.error.message || JSON.stringify(data.error)}`);
    }
  }

  const features = data.features || [];
  let hasMore: boolean;
  if (paginationMode === "objectid") {
    hasMore = features.length >= 2500;
  } else {
    hasMore = data.exceededTransferLimit === true;
  }

  return { features, hasMore };
}

function transformFeatureToLead(
  feature: any,
  fieldMapping: FieldMapping,
  filterConfig: FilterConfig,
  dataSource: MarketDataSource,
  marketId: string
): InsertLead | null {
  const a = feature.attributes;
  if (!a) return null;

  const address = getFieldValue(a, fieldMapping.address || "SITEADDRESS");
  const ownerName = getFieldValue(a, fieldMapping.ownerName || "OWNERNME1");

  if (!address || !ownerName) return null;

  const ownerType = inferOwnerType(ownerName);
  if (ownerType === "Government") return null;

  const classDesc = getFieldValue(a, fieldMapping.classDescription || fieldMapping.description || fieldMapping.landUseDesc || fieldMapping.propType || "CLASSDSCRP") || "";
  if (typeof classDesc === "string" && classDesc.toUpperCase().includes("VACANT")) return null;

  const sourceId = String(getFieldValue(a, fieldMapping.sourceId || "PARCELID") || "");
  if (!sourceId) return null;

  const county = filterConfig.county || inferCountyFromSourceName(dataSource.sourceName);
  const [defaultLat, defaultLng] = inferDefaultCoords(dataSource.sourceName);
  const [lat, lng] = getCentroid(feature.geometry, defaultLat, defaultLng);

  const rawImpValue = getFieldValue(a, fieldMapping.improvementValue || "IMPVALUE");
  const impValue = typeof rawImpValue === "number" ? rawImpValue : 0;
  const rawLandValue = getFieldValue(a, fieldMapping.landValue || "LNDVALUE");
  const landValue = typeof rawLandValue === "number" ? rawLandValue : 0;
  const rawTotalValue = getFieldValue(a, fieldMapping.totalValue || "CNTASSDVAL");
  const totalValue = typeof rawTotalValue === "number" ? rawTotalValue : (impValue + landValue);

  const rawSqft = getFieldValue(a, fieldMapping.sqft || "BLDGAREA");
  const sqft = (typeof rawSqft === "number" && rawSqft > 0) ? rawSqft : estimateSqft(impValue);

  const rawYearBuilt = getFieldValue(a, fieldMapping.yearBuilt || "RESYRBLT");
  const yearBuilt = (typeof rawYearBuilt === "number" && rawYearBuilt > 1800) ? rawYearBuilt : 1995;

  const rawStories = getFieldValue(a, fieldMapping.stories || "FLOORCOUNT");
  const stories = (typeof rawStories === "number" && rawStories > 0) ? rawStories : 1;

  const zoning = inferZoning(classDesc);
  const llcName = ownerType === "LLC" ? ownerName : undefined;

  const city = getFieldValue(a, fieldMapping.city || "CITY") || filterConfig.defaultCity || county;
  const zipCode = getFieldValue(a, fieldMapping.zipCode || "PSTLZIP5") || "00000";
  const state = getFieldValue(a, fieldMapping.state || "STATE") || filterConfig.defaultState || "TX";
  const constructionType = getFieldValue(a, fieldMapping.constructionType || "STRCLASS") || "Masonry";

  const ownerAddress = getFieldValue(a, fieldMapping.ownerAddress || "PSTLADDRESS");
  const ownerCity = getFieldValue(a, fieldMapping.ownerCity || "");
  const ownerState = getFieldValue(a, fieldMapping.ownerState || "");
  const ownerZip = getFieldValue(a, fieldMapping.ownerZip || "");

  let fullOwnerAddress: string | undefined;
  if (ownerAddress) {
    const parts = [ownerAddress, ownerCity, ownerState, ownerZip].filter(Boolean);
    fullOwnerAddress = parts.join(", ");
  }

  const businessName = getFieldValue(a, fieldMapping.businessName || "DBA1") || undefined;

  const rawDeedDate = getFieldValue(a, fieldMapping.deedDate || "");
  let lastDeedDate: string | undefined;
  if (rawDeedDate) {
    if (typeof rawDeedDate === "number" && rawDeedDate > 946684800000) {
      lastDeedDate = new Date(rawDeedDate).toISOString().slice(0, 10);
    } else if (typeof rawDeedDate === "string" && rawDeedDate.length >= 8) {
      lastDeedDate = rawDeedDate;
    }
  }

  const sourceType = `generic_arcgis_${county.toLowerCase()}`;

  const leadData: InsertLead = {
    marketId,
    address: String(address),
    city: String(city),
    county,
    state: String(state),
    zipCode: String(zipCode),
    latitude: lat,
    longitude: lng,
    sqft,
    yearBuilt,
    constructionType: String(constructionType),
    zoning,
    stories,
    units: 1,
    ownerName: String(ownerName),
    ownerType,
    ownerAddress: fullOwnerAddress,
    llcName,
    businessName,
    improvementValue: impValue || undefined,
    landValue: landValue || undefined,
    totalValue: totalValue || undefined,
    lastDeedDate,
    sourceType,
    sourceId,
    leadScore: 0,
    status: "new",
  };

  leadData.leadScore = calculateScore(leadData);
  return leadData;
}

export async function importGenericArcgis(
  dataSourceId: string,
  options: {
    maxRecords?: number;
    minSqft?: number;
    dryRun?: boolean;
  } = {}
): Promise<ArcgisImportResult> {
  const dataSource = await storage.getMarketDataSourceById(dataSourceId);
  if (!dataSource) {
    throw new Error(`Data source not found: ${dataSourceId}`);
  }

  if (dataSource.sourceType !== "cad_arcgis") {
    throw new Error(`Data source ${dataSourceId} is not a cad_arcgis type (got: ${dataSource.sourceType})`);
  }

  if (!dataSource.isActive) {
    throw new Error(`Data source ${dataSourceId} is not active`);
  }

  const fieldMapping = (dataSource.fieldMapping || {}) as FieldMapping;
  const filterConfig = (dataSource.filterConfig || {}) as FilterConfig;
  const maxRecords = options.maxRecords ?? 4000;
  const minSqft = options.minSqft ?? 0;
  const dryRun = options.dryRun ?? false;
  const marketId = dataSource.marketId;

  const result: ArcgisImportResult = {
    totalFetched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
    dataSourceId,
    dataSourceName: dataSource.sourceName,
    dryRun,
    sample: dryRun ? [] : undefined,
  };

  const run = dryRun ? null : await storage.createImportRun({
    type: "generic_arcgis",
    status: "running",
    dataSourceId,
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: {
      source: dataSource.sourceName,
      endpoint: dataSource.endpoint,
      maxRecords,
      dryRun,
    } as any,
  });

  try {
    const whereClause = buildWhereClause(filterConfig);
    const outFields = buildOutFields(fieldMapping);
    let offset = 0;
    let hasMore = true;
    const leadsBatch: InsertLead[] = [];
    const county = filterConfig.county || inferCountyFromSourceName(dataSource.sourceName);
    const sourceType = `generic_arcgis_${county.toLowerCase()}`;

    console.log(`[ArcGIS Importer] Starting import from ${dataSource.sourceName}`);
    console.log(`[ArcGIS Importer] Endpoint: ${dataSource.endpoint}`);
    console.log(`[ArcGIS Importer] Where: ${whereClause}`);
    console.log(`[ArcGIS Importer] Dry run: ${dryRun}`);

    const paginationMode = filterConfig.paginationMode;
    let lastObjectId = 0;

    while (hasMore && result.totalFetched < maxRecords) {
      let currentWhere = whereClause;
      if (paginationMode === "objectid" && lastObjectId > 0) {
        if (whereClause.match(/^OBJECTID\s*>/i)) {
          currentWhere = `OBJECTID > ${lastObjectId}`;
        } else {
          currentWhere = `(${whereClause}) AND OBJECTID > ${lastObjectId}`;
        }
      }
      console.log(`[ArcGIS Importer] Fetching page at offset ${offset} (where: ${currentWhere})...`);
      const page = await fetchArcgisPage(
        dataSource.endpoint,
        currentWhere,
        outFields,
        offset,
        MAX_RECORDS_PER_REQUEST,
        paginationMode
      );
      const features = page.features;
      hasMore = page.hasMore;
      result.totalFetched += features.length;

      if (paginationMode === "objectid" && features.length > 0) {
        const maxOid = Math.max(...features.map((f: any) => f.attributes?.OBJECTID || 0));
        lastObjectId = maxOid;
      }

      for (const feature of features) {
        try {
          const leadData = transformFeatureToLead(feature, fieldMapping, filterConfig, dataSource, marketId);

          if (!leadData) {
            result.skipped++;
            continue;
          }

          if (minSqft > 0 && leadData.sqft > 0 && leadData.sqft < minSqft) {
            result.skipped++;
            continue;
          }

          if (dryRun) {
            if (result.sample && result.sample.length < 10) {
              result.sample.push({
                address: leadData.address,
                city: leadData.city,
                county: leadData.county,
                ownerName: leadData.ownerName,
                ownerType: leadData.ownerType,
                sqft: leadData.sqft,
                yearBuilt: leadData.yearBuilt,
                zoning: leadData.zoning,
                totalValue: leadData.totalValue,
                leadScore: leadData.leadScore,
              });
            }
            result.imported++;
            continue;
          }

          const existing = await storage.getLeadBySourceId(sourceType, leadData.sourceId!);
          if (existing) {
            result.skipped++;
            continue;
          }

          leadsBatch.push(leadData);

          if (leadsBatch.length >= BATCH_INSERT_SIZE) {
            await storage.createLeadsBatch(leadsBatch);
            result.imported += leadsBatch.length;
            leadsBatch.length = 0;

            if (run) {
              await storage.updateImportRun(run.id, {
                recordsProcessed: result.totalFetched,
                recordsImported: result.imported,
                recordsSkipped: result.skipped,
              });
            }
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

      const pageDelay = paginationMode === "objectid" ? 3000 : 500;
      await new Promise((r) => setTimeout(r, pageDelay));
    }

    if (!dryRun && leadsBatch.length > 0) {
      await storage.createLeadsBatch(leadsBatch);
      result.imported += leadsBatch.length;
    }

    if (run) {
      await storage.updateImportRun(run.id, {
        status: result.errors > 0 && result.imported === 0 ? "failed" : "completed",
        completedAt: new Date(),
        recordsProcessed: result.totalFetched,
        recordsImported: result.imported,
        recordsSkipped: result.skipped,
        errors: result.errorMessages.length > 0 ? result.errorMessages.join("; ") : null,
      });
    }

    if (!dryRun) {
      await storage.updateMarketDataSource(dataSourceId, {
        lastSyncAt: new Date(),
        lastSyncRecordCount: result.imported,
      });
    }

    console.log(`[ArcGIS Importer] ${dataSource.sourceName} ${dryRun ? "dry run" : "import"} complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (err: any) {
    console.error(`[ArcGIS Importer] ${dataSource.sourceName} import failed:`, err);
    result.errorMessages.push(err.message);
    if (run) {
      await storage.updateImportRun(run.id, {
        status: "failed",
        completedAt: new Date(),
        recordsProcessed: result.totalFetched,
        recordsImported: result.imported,
        recordsSkipped: result.skipped,
        errors: err.message,
      });
    }
  }

  return result;
}

export async function importAllMarketSources(
  marketId: string,
  options: {
    maxRecords?: number;
    minSqft?: number;
    dryRun?: boolean;
  } = {}
): Promise<ArcgisImportResult[]> {
  const sources = await storage.getMarketDataSources(marketId);
  const arcgisSources = sources.filter(s => s.sourceType === "cad_arcgis" && s.isActive);

  if (arcgisSources.length === 0) {
    console.log(`[ArcGIS Importer] No active cad_arcgis sources found for market ${marketId}`);
    return [];
  }

  console.log(`[ArcGIS Importer] Found ${arcgisSources.length} active cad_arcgis sources for market ${marketId}`);

  const results: ArcgisImportResult[] = [];
  for (const source of arcgisSources) {
    try {
      const result = await importGenericArcgis(source.id, options);
      results.push(result);
    } catch (err: any) {
      console.error(`[ArcGIS Importer] Failed to import from ${source.sourceName}:`, err.message);
      results.push({
        totalFetched: 0,
        imported: 0,
        skipped: 0,
        errors: 1,
        errorMessages: [err.message],
        dataSourceId: source.id,
        dataSourceName: source.sourceName,
        dryRun: options.dryRun ?? false,
      });
    }
  }

  return results;
}

export async function hasMarketDataSources(marketId: string): Promise<boolean> {
  const sources = await storage.getMarketDataSources(marketId);
  return sources.some(s => s.sourceType === "cad_arcgis" && s.isActive);
}
