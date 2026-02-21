import { storage } from "./storage";
import type { InsertLead } from "@shared/schema";

export function calculateScore(lead: Partial<InsertLead>): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  // === ROOF AGE (up to 25 pts) ===
  if (lead.roofLastReplaced) {
    const roofAge = currentYear - lead.roofLastReplaced;
    score += Math.min(roofAge * 2, 25);
  } else {
    score += 12;
  }

  // === HAIL EXPOSURE (up to 20 pts) ===
  score += Math.min((lead.hailEvents || 0) * 6, 20);

  // === BUILDING SIZE (up to 15 pts) ===
  if ((lead.sqft || 0) >= 10000) score += 15;
  else if ((lead.sqft || 0) >= 5000) score += 12;
  else if ((lead.sqft || 0) >= 2500) score += 8;

  // === OWNER TYPE (up to 10 pts) ===
  if (lead.ownerType === "LLC") score += 10;
  else if (lead.ownerType === "Corporation") score += 8;
  else score += 3;

  // === PROPERTY VALUE (up to 8 pts) ===
  if (lead.totalValue && lead.totalValue >= 1000000) score += 8;
  else if (lead.totalValue && lead.totalValue >= 500000) score += 5;
  else score += 2;

  // === DISTRESS SIGNALS (up to 12 pts) ===
  const distress = calculateDistressScore(lead);
  score += Math.min(distress, 12);

  // === FLOOD RISK (up to 5 pts) ===
  if (lead.isFloodHighRisk) score += 5;
  else if (lead.floodZone && lead.floodZone !== "X" && lead.floodZone !== "NONE") score += 2;

  // === PROPERTY CONDITION / VIOLATIONS (up to 5 pts) ===
  if ((lead.openViolations || 0) >= 3) score += 5;
  else if ((lead.openViolations || 0) >= 1) score += 3;
  else if ((lead.violationCount || 0) >= 2) score += 1;

  return Math.min(score, 100);
}

export function calculateDistressScore(lead: Partial<InsertLead>): number {
  let distress = 0;

  if (lead.foreclosureFlag) distress += 5;
  if (lead.taxDelinquent) distress += 4;
  if ((lead.lienCount || 0) >= 3) distress += 3;
  else if ((lead.lienCount || 0) >= 1) distress += 1;
  if ((lead.openViolations || 0) >= 5) distress += 3;
  else if ((lead.openViolations || 0) >= 2) distress += 2;
  else if ((lead.openViolations || 0) >= 1) distress += 1;

  return Math.min(distress, 15);
}

export function getScoreBreakdown(lead: Partial<InsertLead>): Record<string, { points: number; max: number; detail: string }> {
  const currentYear = new Date().getFullYear();
  const breakdown: Record<string, { points: number; max: number; detail: string }> = {};

  let roofPts = 12;
  let roofDetail = "Unknown roof age (default)";
  if (lead.roofLastReplaced) {
    const roofAge = currentYear - lead.roofLastReplaced;
    roofPts = Math.min(roofAge * 2, 25);
    roofDetail = `${roofAge} years old (replaced ${lead.roofLastReplaced})`;
  }
  breakdown["Roof Age"] = { points: roofPts, max: 25, detail: roofDetail };

  const hailPts = Math.min((lead.hailEvents || 0) * 6, 20);
  breakdown["Hail Exposure"] = { points: hailPts, max: 20, detail: `${lead.hailEvents || 0} events` };

  let sizePts = 0;
  if ((lead.sqft || 0) >= 10000) sizePts = 15;
  else if ((lead.sqft || 0) >= 5000) sizePts = 12;
  else if ((lead.sqft || 0) >= 2500) sizePts = 8;
  breakdown["Building Size"] = { points: sizePts, max: 15, detail: `${(lead.sqft || 0).toLocaleString()} sqft` };

  let ownerPts = 3;
  if (lead.ownerType === "LLC") ownerPts = 10;
  else if (lead.ownerType === "Corporation") ownerPts = 8;
  breakdown["Owner Type"] = { points: ownerPts, max: 10, detail: lead.ownerType || "Unknown" };

  let valuePts = 2;
  if (lead.totalValue && lead.totalValue >= 1000000) valuePts = 8;
  else if (lead.totalValue && lead.totalValue >= 500000) valuePts = 5;
  breakdown["Property Value"] = { points: valuePts, max: 8, detail: `$${(lead.totalValue || 0).toLocaleString()}` };

  const distressPts = Math.min(calculateDistressScore(lead), 12);
  const distressDetails: string[] = [];
  if (lead.foreclosureFlag) distressDetails.push("Foreclosure");
  if (lead.taxDelinquent) distressDetails.push("Tax delinquent");
  if ((lead.lienCount || 0) > 0) distressDetails.push(`${lead.lienCount} liens`);
  if ((lead.openViolations || 0) > 0) distressDetails.push(`${lead.openViolations} open violations`);
  breakdown["Distress Signals"] = { points: distressPts, max: 12, detail: distressDetails.length > 0 ? distressDetails.join(", ") : "None detected" };

  let floodPts = 0;
  if (lead.isFloodHighRisk) floodPts = 5;
  else if (lead.floodZone && lead.floodZone !== "X" && lead.floodZone !== "NONE") floodPts = 2;
  breakdown["Flood Risk"] = { points: floodPts, max: 5, detail: lead.floodZone || "Not assessed" };

  let violPts = 0;
  if ((lead.openViolations || 0) >= 3) violPts = 5;
  else if ((lead.openViolations || 0) >= 1) violPts = 3;
  else if ((lead.violationCount || 0) >= 2) violPts = 1;
  breakdown["Property Condition"] = { points: violPts, max: 5, detail: `${lead.violationCount || 0} total, ${lead.openViolations || 0} open` };

  return breakdown;
}

export async function seedDatabase() {
  const existingMarkets = await storage.getMarkets();
  if (existingMarkets.length > 0) {
    console.log("Database already seeded, skipping...");
    return;
  }

  console.log("Seeding database with DFW market...");

  const dfwMarket = await storage.createMarket({
    name: "Dallas-Fort Worth",
    state: "TX",
    counties: ["Dallas", "Tarrant", "Collin", "Denton"],
    centerLat: 32.7767,
    centerLng: -96.7970,
    radiusMiles: 50,
    isActive: true,
  });

  await storage.createDataSource({
    name: "NOAA Storm Events - Texas",
    type: "noaa_hail",
    url: "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/",
    marketId: dfwMarket.id,
    isActive: true,
  });

  await storage.createDataSource({
    name: "DCAD Property Data",
    type: "dcad_api",
    url: "https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4",
    marketId: dfwMarket.id,
    isActive: true,
  });

  console.log("Seeded DFW market with data source configurations");
}
