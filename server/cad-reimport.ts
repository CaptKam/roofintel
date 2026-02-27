import { db } from "./storage";
import { leads } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const DCAD_API_BASE = "https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query";
const TAD_API_BASE = "https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0/query";
const COLLIN_CAD_PARCEL_API = "https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1/query";
const DENTON_CAD_API_BASE = "https://geo.dentoncad.com/arcgis/rest/services/Hosted/Parcels_with_CAMA_Data/FeatureServer/0/query";

const RATE_LIMIT_MS = 250;
const BATCH_SIZE = 50;

interface ReimportProgress {
  status: "idle" | "running" | "completed" | "failed";
  county: string;
  processed: number;
  total: number;
  updated: number;
  yearBuiltFixed: number;
  errors: number;
  startedAt: Date | null;
  completedAt: Date | null;
  countyStats: Record<string, { total: number; processed: number; updated: number; yearBuiltFixed: number }>;
  errorMessages: string[];
}

let reimportProgress: ReimportProgress = {
  status: "idle",
  county: "",
  processed: 0,
  total: 0,
  updated: 0,
  yearBuiltFixed: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  countyStats: {},
  errorMessages: [],
};

export function getReimportStatus(): ReimportProgress {
  return { ...reimportProgress };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchCadRecord(sourceType: string, sourceId: string): Promise<Record<string, any> | null> {
  let url: string;
  let whereClause: string;
  let outFields: string;

  switch (sourceType) {
    case "dcad_api":
      whereClause = `PARCELID='${sourceId}'`;
      outFields = [
        "PARCELID", "RESYRBLT", "PRVASSDVAL", "CNVYNAME", "DBA1",
        "SCHLDSCRP", "CVTTXDSCRP", "STATEDAREA", "PRPRTYDSCRP",
        "OWNERNME2", "LASTUPDATE", "REVALYR", "Shape.STArea()",
      ].join(",");
      url = `${DCAD_API_BASE}?where=${encodeURIComponent(whereClause)}&outFields=${encodeURIComponent(outFields)}&f=json`;
      break;

    case "tad_api":
      whereClause = `ACCOUNT='${sourceId}'`;
      outFields = [
        "ACCOUNT", "YEAR_BUILT", "DEED_DATE", "DEED_BOOK", "DEED_PAGE",
        "INSTRUMENT_NO", "LAND_ACRES", "LAND_SQFT", "SubdivisionName",
        "SCHOOL", "EXEMPTION_", "DESCR",
      ].join(",");
      url = `${TAD_API_BASE}?where=${encodeURIComponent(whereClause)}&outFields=${encodeURIComponent(outFields)}&f=json`;
      break;

    case "collin_cad_api":
      whereClause = `prop_id='${sourceId}' OR PROP_ID='${sourceId}'`;
      outFields = "*";
      url = `${COLLIN_CAD_PARCEL_API}?where=${encodeURIComponent(whereClause)}&outFields=${outFields}&f=json`;
      break;

    case "denton_cad_api":
      whereClause = `pid=${sourceId}`;
      outFields = [
        "pid", "imprvactualyearbuilt", "imprveffyearbuilt", "deeddt",
        "instrumentnum", "legalacreage", "landtotalsqft", "land_sqft",
        "abstractsubdivisiondescription", "schooltaxingunitname",
        "citytaxingunitname", "namesecondary", "ownerpct",
        "exemptions", "dba", "propertyuse", "effectivesizeacres",
      ].join(",");
      url = `${DENTON_CAD_API_BASE}?where=${encodeURIComponent(whereClause)}&outFields=${encodeURIComponent(outFields)}&f=json`;
      break;

    default:
      return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.error || !data.features?.length) return null;
    return data.features[0].attributes;
  } catch {
    return null;
  }
}

function mapDcadFields(attrs: Record<string, any>): Record<string, any> {
  const updates: Record<string, any> = {};
  
  const resYrBlt = attrs.RESYRBLT;
  if (resYrBlt && resYrBlt > 1800 && resYrBlt <= new Date().getFullYear()) {
    updates.yearBuilt = resYrBlt;
  }
  
  if (attrs.REVALYR && attrs.REVALYR > 1800) updates.effectiveYearBuilt = attrs.REVALYR;
  if (attrs.PRVASSDVAL && attrs.PRVASSDVAL > 0) updates.previousMarketValue = attrs.PRVASSDVAL;
  if (attrs.CNVYNAME) updates.subdivisionName = attrs.CNVYNAME;
  if (attrs.DBA1) updates.dbaName = attrs.DBA1;
  if (attrs.SCHLDSCRP) updates.schoolDistrict = attrs.SCHLDSCRP;
  if (attrs.CVTTXDSCRP) updates.taxDistrict = attrs.CVTTXDSCRP;
  if (attrs.OWNERNME2) updates.secondOwner = attrs.OWNERNME2;
  if (attrs.STATEDAREA && attrs.STATEDAREA > 0) updates.landAcreage = attrs.STATEDAREA;
  if (attrs.PRPRTYDSCRP) updates.propertyUseDescription = attrs.PRPRTYDSCRP;
  const shapeArea = attrs["Shape.STArea()"] || attrs["Shape__STArea__"];
  if (shapeArea && shapeArea > 0) updates.parcelAreaSqft = shapeArea;
  if (attrs.LASTUPDATE) {
    try { updates.cadLastUpdated = new Date(attrs.LASTUPDATE); } catch {}
  }
  
  return updates;
}

function mapTadFields(attrs: Record<string, any>): Record<string, any> {
  const updates: Record<string, any> = {};
  
  if (attrs.YEAR_BUILT && attrs.YEAR_BUILT > 1800 && attrs.YEAR_BUILT <= new Date().getFullYear()) {
    updates.yearBuilt = attrs.YEAR_BUILT;
  }
  if (attrs.DEED_DATE) {
    try { updates.lastDeedDate = new Date(attrs.DEED_DATE).toISOString().slice(0, 10); } catch {}
  }
  if (attrs.INSTRUMENT_NO) {
    updates.deedInstrument = attrs.INSTRUMENT_NO;
  } else if (attrs.DEED_BOOK && attrs.DEED_PAGE) {
    updates.deedInstrument = `${attrs.DEED_BOOK}/${attrs.DEED_PAGE}`;
  }
  if (attrs.LAND_ACRES && attrs.LAND_ACRES > 0) updates.landAcreage = attrs.LAND_ACRES;
  if (attrs.LAND_SQFT && attrs.LAND_SQFT > 0) updates.landSqft = attrs.LAND_SQFT;
  if (attrs.SubdivisionName) updates.subdivisionName = attrs.SubdivisionName;
  if (attrs.SCHOOL) updates.schoolDistrict = attrs.SCHOOL;
  if (attrs.EXEMPTION_) updates.taxExemptions = attrs.EXEMPTION_;
  if (attrs.DESCR) updates.propertyUseDescription = attrs.DESCR;
  
  return updates;
}

function mapCollinFields(attrs: Record<string, any>): Record<string, any> {
  const updates: Record<string, any> = {};
  const get = (key: string) => attrs[key] ?? attrs[key.toUpperCase()] ?? attrs[key.toLowerCase()];
  
  const yrBlt = get("yr_built");
  if (yrBlt && yrBlt > 1800 && yrBlt <= new Date().getFullYear()) updates.yearBuilt = yrBlt;
  
  const effYrBlt = get("eff_yr_blt");
  if (effYrBlt && effYrBlt > 1800) updates.effectiveYearBuilt = effYrBlt;
  
  const deedDt = get("deed_dt");
  if (deedDt) {
    try { updates.lastDeedDate = new Date(deedDt).toISOString().slice(0, 10); } catch {}
  }
  
  const deedNum = get("deed_num");
  if (deedNum) updates.deedInstrument = String(deedNum);
  else {
    const book = get("deed_book_id");
    const page = get("deed_book_pag");
    if (book && page) updates.deedInstrument = `${book}/${page}`;
  }
  
  const legalAcreage = get("legal_acreage");
  if (legalAcreage && legalAcreage > 0) updates.landAcreage = legalAcreage;
  
  const landSq = get("land_total_sq");
  if (landSq && landSq > 0) updates.landSqft = Math.round(landSq);
  
  const subdv = get("abs_subdv_des");
  if (subdv) updates.subdivisionName = subdv;
  
  const school = get("school");
  if (school) updates.schoolDistrict = school;
  
  const exemptions = get("exemptions");
  if (exemptions) updates.taxExemptions = exemptions;
  
  const pctOwn = get("pct_ownership");
  if (pctOwn && pctOwn > 0) updates.ownerPercentage = pctOwn;
  
  const dbaName = get("dba_name") || get("dba");
  if (dbaName) updates.dbaName = dbaName;
  
  const propUse = get("property_use_");
  if (propUse) updates.propertyUseDescription = propUse;
  
  const ownerName2 = get("owner_name2") || get("addr_line1");
  if (ownerName2) updates.secondOwner = ownerName2;
  
  const city = get("city");
  const tif = get("tif");
  if (city || tif) updates.taxDistrict = city || tif;
  
  return updates;
}

function mapDentonFields(attrs: Record<string, any>): Record<string, any> {
  const updates: Record<string, any> = {};
  
  if (attrs.imprvactualyearbuilt && attrs.imprvactualyearbuilt > 1800 && attrs.imprvactualyearbuilt <= new Date().getFullYear()) {
    updates.yearBuilt = attrs.imprvactualyearbuilt;
  }
  if (attrs.imprveffyearbuilt && attrs.imprveffyearbuilt > 1800) updates.effectiveYearBuilt = attrs.imprveffyearbuilt;
  if (attrs.deeddt) updates.lastDeedDate = attrs.deeddt;
  if (attrs.instrumentnum) updates.deedInstrument = attrs.instrumentnum;
  
  const acreage = attrs.legalacreage || attrs.effectivesizeacres;
  if (acreage && acreage > 0) updates.landAcreage = acreage;
  
  const landSqft = attrs.landtotalsqft || attrs.land_sqft;
  if (landSqft && landSqft > 0) updates.landSqft = Math.round(landSqft);
  
  if (attrs.abstractsubdivisiondescription) updates.subdivisionName = attrs.abstractsubdivisiondescription;
  if (attrs.schooltaxingunitname) updates.schoolDistrict = attrs.schooltaxingunitname;
  if (attrs.citytaxingunitname) updates.taxDistrict = attrs.citytaxingunitname;
  if (attrs.namesecondary) updates.secondOwner = attrs.namesecondary;
  if (attrs.ownerpct && attrs.ownerpct > 0) updates.ownerPercentage = attrs.ownerpct;
  if (attrs.exemptions) updates.taxExemptions = attrs.exemptions;
  if (attrs.dba) updates.dbaName = attrs.dba;
  if (attrs.propertyuse) updates.propertyUseDescription = attrs.propertyuse;
  
  return updates;
}

function mapFields(sourceType: string, attrs: Record<string, any>): Record<string, any> {
  switch (sourceType) {
    case "dcad_api": return mapDcadFields(attrs);
    case "tad_api": return mapTadFields(attrs);
    case "collin_cad_api": return mapCollinFields(attrs);
    case "denton_cad_api": return mapDentonFields(attrs);
    default: return {};
  }
}

function filterOnlyNewFields(updates: Record<string, any>, existingLead: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) continue;
    const existing = existingLead[key];
    if (existing === null || existing === undefined || existing === "" ||
        (key === "yearBuilt" && (existing === 1995 || existing === 1900 || existing === 0))) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export async function runCadReimport(options: {
  counties?: string[];
  maxRecords?: number;
  dryRun?: boolean;
} = {}): Promise<void> {
  if (reimportProgress.status === "running") {
    throw new Error("Reimport already in progress");
  }
  
  const counties = options.counties ?? ["Dallas", "Tarrant", "Collin", "Denton"];
  const maxRecords = options.maxRecords ?? 5000;
  const dryRun = options.dryRun ?? false;
  
  const sourceTypeMap: Record<string, string> = {
    "Dallas": "dcad_api",
    "Tarrant": "tad_api",
    "Collin": "collin_cad_api",
    "Denton": "denton_cad_api",
  };
  
  reimportProgress = {
    status: "running",
    county: "",
    processed: 0,
    total: 0,
    updated: 0,
    yearBuiltFixed: 0,
    errors: 0,
    startedAt: new Date(),
    completedAt: null,
    countyStats: {},
    errorMessages: [],
  };
  
  try {
    for (const county of counties) {
      const sourceType = sourceTypeMap[county];
      if (!sourceType) continue;
      
      reimportProgress.county = county;
      reimportProgress.countyStats[county] = { total: 0, processed: 0, updated: 0, yearBuiltFixed: 0 };
      
      const countyLeads = await db.select({
        id: leads.id,
        sourceId: leads.sourceId,
        yearBuilt: leads.yearBuilt,
        lastDeedDate: leads.lastDeedDate,
        subdivisionName: leads.subdivisionName,
        schoolDistrict: leads.schoolDistrict,
        dbaName: leads.dbaName,
        landAcreage: leads.landAcreage,
        effectiveYearBuilt: leads.effectiveYearBuilt,
        secondOwner: leads.secondOwner,
        taxExemptions: leads.taxExemptions,
        previousMarketValue: leads.previousMarketValue,
        taxDistrict: leads.taxDistrict,
        propertyUseDescription: leads.propertyUseDescription,
        deedInstrument: leads.deedInstrument,
        ownerPercentage: leads.ownerPercentage,
        parcelAreaSqft: leads.parcelAreaSqft,
        cadLastUpdated: leads.cadLastUpdated,
        landSqft: leads.landSqft,
      })
      .from(leads)
      .where(
        and(
          eq(leads.sourceType, sourceType),
          sql`${leads.sourceId} IS NOT NULL`
        )
      )
      .limit(maxRecords);
      
      reimportProgress.countyStats[county].total = countyLeads.length;
      reimportProgress.total += countyLeads.length;
      
      console.log(`[CAD Reimport] Processing ${countyLeads.length} ${county} County leads...`);
      
      for (let i = 0; i < countyLeads.length; i++) {
        const lead = countyLeads[i];
        reimportProgress.processed++;
        reimportProgress.countyStats[county].processed = i + 1;
        
        if (!lead.sourceId) continue;
        
        try {
          const attrs = await fetchCadRecord(sourceType, lead.sourceId);
          if (!attrs) {
            await sleep(RATE_LIMIT_MS);
            continue;
          }
          
          const allUpdates = mapFields(sourceType, attrs);
          const newUpdates = filterOnlyNewFields(allUpdates, lead as any);
          
          if (Object.keys(newUpdates).length > 0 && !dryRun) {
            const hadBadYear = lead.yearBuilt === 1995 || lead.yearBuilt === 1900;
            const gotRealYear = newUpdates.yearBuilt && newUpdates.yearBuilt !== 1995 && newUpdates.yearBuilt !== 1900;
            
            await db.update(leads)
              .set({ ...newUpdates, lastEnrichedAt: new Date() })
              .where(eq(leads.id, lead.id));
            
            reimportProgress.updated++;
            reimportProgress.countyStats[county].updated++;
            
            if (hadBadYear && gotRealYear) {
              reimportProgress.yearBuiltFixed++;
              reimportProgress.countyStats[county].yearBuiltFixed++;
            }
          } else if (Object.keys(newUpdates).length > 0) {
            reimportProgress.updated++;
            reimportProgress.countyStats[county].updated++;
          }
          
          await sleep(RATE_LIMIT_MS);
        } catch (err: any) {
          reimportProgress.errors++;
          if (reimportProgress.errorMessages.length < 20) {
            reimportProgress.errorMessages.push(`${county} ${lead.sourceId}: ${err.message}`);
          }
        }
      }
      
      console.log(`[CAD Reimport] ${county} County complete: ${reimportProgress.countyStats[county].updated} updated, ${reimportProgress.countyStats[county].yearBuiltFixed} year_built fixed`);
    }
    
    reimportProgress.status = "completed";
    reimportProgress.completedAt = new Date();
    console.log(`[CAD Reimport] Complete: ${reimportProgress.updated} total updated, ${reimportProgress.yearBuiltFixed} year_built fixed, ${reimportProgress.errors} errors`);
  } catch (err: any) {
    reimportProgress.status = "failed";
    reimportProgress.completedAt = new Date();
    reimportProgress.errorMessages.push(err.message);
    console.error("[CAD Reimport] Failed:", err);
  }
}
