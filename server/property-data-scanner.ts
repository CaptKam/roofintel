import { db } from "./storage";
import { leads } from "@shared/schema";
import { eq, isNull, or, sql } from "drizzle-orm";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const RATE_LIMIT_MS = 600;
const BATCH_SIZE = 50;

interface ScanProgress {
  status: "idle" | "running" | "completed" | "failed";
  stage: string;
  processed: number;
  total: number;
  found: number;
  errors: number;
  startedAt: Date | null;
  completedAt: Date | null;
  results: ScanResult[];
  errorMessages: string[];
}

interface ScanResult {
  leadId: string;
  address: string;
  field: string;
  oldValue: string | null;
  newValue: string;
  source: string;
  confidence: number;
}

let scanProgress: ScanProgress = {
  status: "idle",
  stage: "",
  processed: 0,
  total: 0,
  found: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  results: [],
  errorMessages: [],
};

export function getScanStatus(): ScanProgress {
  return { ...scanProgress };
}

export function getScanResults(): ScanResult[] {
  return [...scanProgress.results];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchSerper(query: string): Promise<any[]> {
  if (!SERPER_API_KEY) return [];
  
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    
    if (!response.ok) return [];
    const data = await response.json();
    return data.organic || [];
  } catch {
    return [];
  }
}

function extractYearFromText(text: string): number | null {
  const yearPatterns = [
    /(?:year\s*built|built\s*in|constructed\s*in|built)\s*:?\s*(\d{4})/i,
    /(?:yr\s*blt|year\s*blt)\s*:?\s*(\d{4})/i,
    /(\d{4})\s*(?:construction|built|constructed)/i,
  ];
  
  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match) {
      const year = parseInt(match[1]);
      if (year >= 1900 && year <= new Date().getFullYear()) {
        return year;
      }
    }
  }
  return null;
}

function extractSqftFromText(text: string): number | null {
  const patterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:sq\.?\s*ft|square\s*feet|sf)/i,
    /(?:size|area|sqft)\s*:?\s*(\d{1,3}(?:,\d{3})*)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const sqft = parseInt(match[1].replace(/,/g, ""));
      if (sqft >= 500 && sqft <= 5000000) return sqft;
    }
  }
  return null;
}

async function searchCountyAssessor(address: string, county: string): Promise<{ yearBuilt?: number; sqft?: number; source: string }> {
  const siteDomain = county === "Dallas" ? "dcad.org" : 
                     county === "Tarrant" ? "tad.org" :
                     county === "Collin" ? "collincad.org" :
                     county === "Denton" ? "dentoncad.com" : "";
  
  const cleanAddr = address.replace(/[#,]/g, "").trim();
  const query = `"${cleanAddr}" ${siteDomain ? `site:${siteDomain}` : ""} "year built"`;
  
  const results = await searchSerper(query);
  
  for (const result of results) {
    const combined = `${result.title || ""} ${result.snippet || ""}`;
    const yearBuilt = extractYearFromText(combined);
    const sqft = extractSqftFromText(combined);
    if (yearBuilt || sqft) {
      return { yearBuilt: yearBuilt || undefined, sqft: sqft || undefined, source: "county_assessor_search" };
    }
  }
  
  return { source: "county_assessor_search" };
}

async function searchCimls(address: string): Promise<{ yearBuilt?: number; sqft?: number; propertyType?: string; source: string }> {
  const cleanAddr = address.replace(/[#,]/g, "").trim();
  const query = `site:cimls.com "${cleanAddr}"`;
  
  const results = await searchSerper(query);
  
  for (const result of results) {
    const combined = `${result.title || ""} ${result.snippet || ""}`;
    const yearBuilt = extractYearFromText(combined);
    const sqft = extractSqftFromText(combined);
    
    let propertyType: string | undefined;
    const typeMatch = combined.match(/(?:office|retail|industrial|warehouse|medical|flex|restaurant|hotel|multi-?family|apartment)/i);
    if (typeMatch) propertyType = typeMatch[0];
    
    if (yearBuilt || sqft || propertyType) {
      return { yearBuilt: yearBuilt || undefined, sqft: sqft || undefined, propertyType, source: "cimls" };
    }
  }
  
  return { source: "cimls" };
}

async function queryOsmBuilding(lat: number, lng: number): Promise<{ yearBuilt?: number; levels?: number; roofMaterial?: string; buildingUse?: string; source: string }> {
  try {
    const radius = 30;
    const query = `[out:json][timeout:10];(way["building"](around:${radius},${lat},${lng}););out tags;`;
    
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    
    if (!response.ok) return { source: "osm" };
    const data = await response.json();
    
    if (data.elements?.length > 0) {
      const tags = data.elements[0].tags || {};
      const startDate = tags["start_date"] || tags["building:start_date"];
      let yearBuilt: number | undefined;
      if (startDate) {
        const yearMatch = startDate.match(/(\d{4})/);
        if (yearMatch) {
          const y = parseInt(yearMatch[1]);
          if (y >= 1900 && y <= new Date().getFullYear()) yearBuilt = y;
        }
      }
      
      const levels = tags["building:levels"] ? parseInt(tags["building:levels"]) : undefined;
      const roofMaterial = tags["roof:material"] || undefined;
      const buildingUse = tags["building"] !== "yes" ? tags["building"] : (tags["building:use"] || undefined);
      
      return { yearBuilt, levels: levels || undefined, roofMaterial, buildingUse, source: "osm" };
    }
  } catch {}
  
  return { source: "osm" };
}

async function searchGenericWeb(address: string, city: string): Promise<{ yearBuilt?: number; sqft?: number; source: string }> {
  const cleanAddr = address.replace(/[#,]/g, "").trim();
  const query = `"${cleanAddr}" ${city} TX commercial property "year built" OR "built in"`;
  
  const results = await searchSerper(query);
  
  for (const result of results) {
    const combined = `${result.title || ""} ${result.snippet || ""}`;
    const yearBuilt = extractYearFromText(combined);
    const sqft = extractSqftFromText(combined);
    if (yearBuilt || sqft) {
      return { yearBuilt: yearBuilt || undefined, sqft: sqft || undefined, source: "web_search" };
    }
  }
  
  return { source: "web_search" };
}

export async function runPropertyScan(options: {
  maxLeads?: number;
  stages?: string[];
  countyFilter?: string;
} = {}): Promise<void> {
  if (scanProgress.status === "running") {
    throw new Error("Scan already in progress");
  }
  
  const maxLeads = options.maxLeads ?? 500;
  const stages = options.stages ?? ["county_assessor", "cimls", "osm", "web_search"];
  const countyFilter = options.countyFilter;
  
  scanProgress = {
    status: "running",
    stage: "initializing",
    processed: 0,
    total: 0,
    found: 0,
    errors: 0,
    startedAt: new Date(),
    completedAt: null,
    results: [],
    errorMessages: [],
  };
  
  try {
    let query = db
      .select({
        id: leads.id,
        address: leads.address,
        city: leads.city,
        county: leads.county,
        latitude: leads.latitude,
        longitude: leads.longitude,
        yearBuilt: leads.yearBuilt,
        sqft: leads.sqft,
        effectiveYearBuilt: leads.effectiveYearBuilt,
      })
      .from(leads)
      .where(
        or(
          eq(leads.yearBuilt, 1995),
          eq(leads.yearBuilt, 1900),
          isNull(sql`${leads.yearBuilt}`)
        )
      )
      .limit(maxLeads);
    
    const targetLeads = await query;
    
    if (countyFilter) {
      const filtered = targetLeads.filter(l => l.county?.toLowerCase() === countyFilter.toLowerCase());
      targetLeads.length = 0;
      targetLeads.push(...filtered);
    }
    
    scanProgress.total = targetLeads.length;
    console.log(`[Property Scanner] Starting scan of ${targetLeads.length} leads missing year_built data`);
    
    for (let i = 0; i < targetLeads.length; i++) {
      const lead = targetLeads[i];
      scanProgress.processed = i + 1;
      
      try {
        let foundYear: number | null = null;
        let foundSqft: number | null = null;
        let foundSource = "";
        
        if (stages.includes("county_assessor") && SERPER_API_KEY) {
          scanProgress.stage = `county_assessor (${i + 1}/${targetLeads.length})`;
          const result = await searchCountyAssessor(lead.address, lead.county || "Dallas");
          if (result.yearBuilt) {
            foundYear = result.yearBuilt;
            foundSource = result.source;
          }
          if (result.sqft && (!lead.sqft || lead.sqft < 100)) {
            foundSqft = result.sqft;
          }
          await sleep(RATE_LIMIT_MS);
        }
        
        if (!foundYear && stages.includes("cimls") && SERPER_API_KEY) {
          scanProgress.stage = `cimls (${i + 1}/${targetLeads.length})`;
          const result = await searchCimls(lead.address);
          if (result.yearBuilt) {
            foundYear = result.yearBuilt;
            foundSource = result.source;
          }
          if (result.sqft && !foundSqft && (!lead.sqft || lead.sqft < 100)) {
            foundSqft = result.sqft;
          }
          await sleep(RATE_LIMIT_MS);
        }
        
        if (!foundYear && stages.includes("osm") && lead.latitude && lead.longitude) {
          scanProgress.stage = `osm (${i + 1}/${targetLeads.length})`;
          const result = await queryOsmBuilding(lead.latitude, lead.longitude);
          if (result.yearBuilt) {
            foundYear = result.yearBuilt;
            foundSource = result.source;
          }
          await sleep(RATE_LIMIT_MS);
        }
        
        if (!foundYear && stages.includes("web_search") && SERPER_API_KEY) {
          scanProgress.stage = `web_search (${i + 1}/${targetLeads.length})`;
          const result = await searchGenericWeb(lead.address, lead.city || "Dallas");
          if (result.yearBuilt) {
            foundYear = result.yearBuilt;
            foundSource = result.source;
          }
          if (result.sqft && !foundSqft && (!lead.sqft || lead.sqft < 100)) {
            foundSqft = result.sqft;
          }
          await sleep(RATE_LIMIT_MS);
        }
        
        if (foundYear) {
          await db.update(leads)
            .set({
              yearBuilt: foundYear,
              roofAgeSource: foundSource,
              lastEnrichedAt: new Date(),
            })
            .where(eq(leads.id, lead.id));
          
          scanProgress.found++;
          scanProgress.results.push({
            leadId: lead.id,
            address: lead.address,
            field: "yearBuilt",
            oldValue: String(lead.yearBuilt),
            newValue: String(foundYear),
            source: foundSource,
            confidence: foundSource === "county_assessor_search" ? 90 : foundSource === "cimls" ? 80 : foundSource === "osm" ? 85 : 70,
          });
        }
        
        if (foundSqft) {
          await db.update(leads)
            .set({ sqft: foundSqft })
            .where(eq(leads.id, lead.id));
          
          scanProgress.results.push({
            leadId: lead.id,
            address: lead.address,
            field: "sqft",
            oldValue: String(lead.sqft),
            newValue: String(foundSqft),
            source: foundSource,
            confidence: 75,
          });
        }
      } catch (err: any) {
        scanProgress.errors++;
        if (scanProgress.errorMessages.length < 20) {
          scanProgress.errorMessages.push(`${lead.address}: ${err.message}`);
        }
      }
    }
    
    scanProgress.status = "completed";
    scanProgress.stage = "done";
    scanProgress.completedAt = new Date();
    console.log(`[Property Scanner] Scan complete: ${scanProgress.found} found out of ${scanProgress.total} searched, ${scanProgress.errors} errors`);
  } catch (err: any) {
    scanProgress.status = "failed";
    scanProgress.stage = "failed";
    scanProgress.completedAt = new Date();
    scanProgress.errorMessages.push(err.message);
    console.error("[Property Scanner] Scan failed:", err);
  }
}

export async function getDataGapSummary(): Promise<{
  totalLeads: number;
  missingYearBuilt: number;
  defaultYearBuilt: number;
  missingDeedDate: number;
  missingSubdivision: number;
  missingSchoolDistrict: number;
  missingSecondOwner: number;
  missingDbaName: number;
  missingLandAcreage: number;
  missingEffectiveYearBuilt: number;
  byCounty: Record<string, { total: number; missingYearBuilt: number; defaultYearBuilt: number }>;
}> {
  const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(leads);
  const totalLeads = totalResult.count;
  
  const [missingYbResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.yearBuilt));
  
  const [defaultYbResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(or(eq(leads.yearBuilt, 1995), eq(leads.yearBuilt, 1900)));
  
  const [missingDeedResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.lastDeedDate));
  
  const [missingSubdivResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.subdivisionName));
  
  const [missingSchoolResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.schoolDistrict));
  
  const [missingSecondResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.secondOwner));
  
  const [missingDbaResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.dbaName));
  
  const [missingLandResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.landAcreage));
  
  const [missingEffYbResult] = await db.select({ count: sql<number>`count(*)` }).from(leads)
    .where(isNull(leads.effectiveYearBuilt));
  
  const countyStats = await db.select({
    county: leads.county,
    total: sql<number>`count(*)`,
    missingYb: sql<number>`count(*) filter (where ${leads.yearBuilt} is null)`,
    defaultYb: sql<number>`count(*) filter (where ${leads.yearBuilt} = 1995 OR ${leads.yearBuilt} = 1900)`,
  }).from(leads).groupBy(leads.county);
  
  const byCounty: Record<string, { total: number; missingYearBuilt: number; defaultYearBuilt: number }> = {};
  for (const row of countyStats) {
    if (row.county) {
      byCounty[row.county] = {
        total: row.total,
        missingYearBuilt: row.missingYb,
        defaultYearBuilt: row.defaultYb,
      };
    }
  }
  
  return {
    totalLeads,
    missingYearBuilt: missingYbResult.count,
    defaultYearBuilt: defaultYbResult.count,
    missingDeedDate: missingDeedResult.count,
    missingSubdivision: missingSubdivResult.count,
    missingSchoolDistrict: missingSchoolResult.count,
    missingSecondOwner: missingSecondResult.count,
    missingDbaName: missingDbaResult.count,
    missingLandAcreage: missingLandResult.count,
    missingEffectiveYearBuilt: missingEffYbResult.count,
    byCounty,
  };
}
