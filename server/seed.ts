import { storage } from "./storage";
import type { InsertLead } from "@shared/schema";

export function calculateScore(lead: Partial<InsertLead>): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  // === ROOF AGE (up to 20 pts) ===
  if (lead.roofLastReplaced) {
    const roofAge = currentYear - lead.roofLastReplaced;
    score += Math.min(roofAge * 2, 20);
  } else {
    score += 10;
  }

  // === HAIL EXPOSURE (up to 15 pts) ===
  score += Math.min((lead.hailEvents || 0) * 5, 15);

  // === STORM RECENCY (up to 15 pts) ===
  if (lead.lastHailDate) {
    const lastHail = new Date(lead.lastHailDate);
    const daysSince = Math.floor((Date.now() - lastHail.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince <= 30) score += 15;
    else if (daysSince <= 90) score += 12;
    else if (daysSince <= 180) score += 10;
    else if (daysSince <= 365) score += 7;
    else if (daysSince <= 730) score += 4;
    else score += 1;
  }

  // === ROOF AREA / JOB SIZE (up to 15 pts) ===
  const roofArea = lead.estimatedRoofArea || Math.round((lead.sqft || 0) / Math.max(lead.stories || 1, 1));
  if (roofArea >= 20000) score += 15;
  else if (roofArea >= 10000) score += 12;
  else if (roofArea >= 5000) score += 8;
  else if (roofArea >= 2500) score += 5;

  // === OWNER TYPE (up to 8 pts) ===
  if (lead.ownerType === "LLC") score += 8;
  else if (lead.ownerType === "Corporation") score += 6;
  else score += 2;

  // === PROPERTY VALUE (up to 7 pts) ===
  if (lead.totalValue && lead.totalValue >= 1000000) score += 7;
  else if (lead.totalValue && lead.totalValue >= 500000) score += 4;
  else score += 1;

  // === CONTACTABILITY (up to 10 pts) ===
  let contactPts = 0;
  if (lead.ownerPhone || lead.contactPhone || lead.managingMemberPhone) contactPts += 4;
  if (lead.ownerEmail || lead.contactEmail || lead.managingMemberEmail) contactPts += 3;
  if (lead.managingMember || lead.contactName) contactPts += 3;
  score += Math.min(contactPts, 10);

  // === DISTRESS SIGNALS (up to 5 pts) ===
  const distress = calculateDistressScore(lead);
  score += Math.min(distress, 5);

  // === FLOOD RISK (up to 3 pts) ===
  if (lead.isFloodHighRisk) score += 3;
  else if (lead.floodZone && lead.floodZone !== "X" && lead.floodZone !== "NONE") score += 1;

  // === PROPERTY CONDITION / VIOLATIONS (up to 2 pts) ===
  if ((lead.openViolations || 0) >= 3) score += 2;
  else if ((lead.openViolations || 0) >= 1) score += 1;

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

  let roofPts = 10;
  let roofDetail = "Unknown roof age (default)";
  if (lead.roofLastReplaced) {
    const roofAge = currentYear - lead.roofLastReplaced;
    roofPts = Math.min(roofAge * 2, 20);
    roofDetail = `${roofAge} years old (replaced ${lead.roofLastReplaced})`;
  }
  breakdown["Roof Age"] = { points: roofPts, max: 20, detail: roofDetail };

  const hailPts = Math.min((lead.hailEvents || 0) * 5, 15);
  breakdown["Hail Exposure"] = { points: hailPts, max: 15, detail: `${lead.hailEvents || 0} events` };

  let recencyPts = 0;
  let recencyDetail = "No hail history";
  if (lead.lastHailDate) {
    const lastHail = new Date(lead.lastHailDate);
    const daysSince = Math.floor((Date.now() - lastHail.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince <= 30) recencyPts = 15;
    else if (daysSince <= 90) recencyPts = 12;
    else if (daysSince <= 180) recencyPts = 10;
    else if (daysSince <= 365) recencyPts = 7;
    else if (daysSince <= 730) recencyPts = 4;
    else recencyPts = 1;
    recencyDetail = `${daysSince} days ago (${lead.lastHailDate})`;
  }
  breakdown["Storm Recency"] = { points: recencyPts, max: 15, detail: recencyDetail };

  const roofArea = lead.estimatedRoofArea || Math.round((lead.sqft || 0) / Math.max(lead.stories || 1, 1));
  let areaPts = 0;
  if (roofArea >= 20000) areaPts = 15;
  else if (roofArea >= 10000) areaPts = 12;
  else if (roofArea >= 5000) areaPts = 8;
  else if (roofArea >= 2500) areaPts = 5;
  breakdown["Roof Area"] = { points: areaPts, max: 15, detail: `~${roofArea.toLocaleString()} sqft roof` };

  let ownerPts = 2;
  if (lead.ownerType === "LLC") ownerPts = 8;
  else if (lead.ownerType === "Corporation") ownerPts = 6;
  breakdown["Owner Type"] = { points: ownerPts, max: 8, detail: lead.ownerType || "Unknown" };

  let valuePts = 1;
  if (lead.totalValue && lead.totalValue >= 1000000) valuePts = 7;
  else if (lead.totalValue && lead.totalValue >= 500000) valuePts = 4;
  breakdown["Property Value"] = { points: valuePts, max: 7, detail: `$${(lead.totalValue || 0).toLocaleString()}` };

  let contactPts = 0;
  const contactDetails: string[] = [];
  if (lead.ownerPhone || lead.contactPhone || lead.managingMemberPhone) { contactPts += 4; contactDetails.push("Phone"); }
  if (lead.ownerEmail || lead.contactEmail || lead.managingMemberEmail) { contactPts += 3; contactDetails.push("Email"); }
  if (lead.managingMember || lead.contactName) { contactPts += 3; contactDetails.push("Named contact"); }
  contactPts = Math.min(contactPts, 10);
  breakdown["Contactability"] = { points: contactPts, max: 10, detail: contactDetails.length > 0 ? contactDetails.join(", ") : "No contact info" };

  const distressPts = Math.min(calculateDistressScore(lead), 5);
  const distressDetails: string[] = [];
  if (lead.foreclosureFlag) distressDetails.push("Foreclosure");
  if (lead.taxDelinquent) distressDetails.push("Tax delinquent");
  if ((lead.lienCount || 0) > 0) distressDetails.push(`${lead.lienCount} liens`);
  if ((lead.openViolations || 0) > 0) distressDetails.push(`${lead.openViolations} open violations`);
  breakdown["Distress Signals"] = { points: distressPts, max: 5, detail: distressDetails.length > 0 ? distressDetails.join(", ") : "None detected" };

  let floodPts = 0;
  if (lead.isFloodHighRisk) floodPts = 3;
  else if (lead.floodZone && lead.floodZone !== "X" && lead.floodZone !== "NONE") floodPts = 1;
  breakdown["Flood Risk"] = { points: floodPts, max: 3, detail: lead.floodZone || "Not assessed" };

  let violPts = 0;
  if ((lead.openViolations || 0) >= 3) violPts = 2;
  else if ((lead.openViolations || 0) >= 1) violPts = 1;
  breakdown["Property Condition"] = { points: violPts, max: 2, detail: `${lead.violationCount || 0} total, ${lead.openViolations || 0} open` };

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

  console.log("Seeding Colorado Springs market...");

  const cosMarket = await storage.createMarket({
    name: "Colorado Springs",
    state: "CO",
    counties: ["El Paso"],
    centerLat: 38.8339,
    centerLng: -104.8214,
    radiusMiles: 40,
    isActive: true,
    boundingBox: {
      north: 39.15,
      south: 38.50,
      east: -104.40,
      west: -105.25,
    },
    metroArea: "Colorado Springs",
  });

  await storage.createDataSource({
    name: "NOAA Storm Events - Colorado",
    type: "noaa_hail",
    url: "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/",
    marketId: cosMarket.id,
    isActive: true,
  });

  await storage.createDataSource({
    name: "El Paso County Assessor",
    type: "cad_arcgis",
    url: "https://gis.elpasoco.com/arcgis/rest/services",
    marketId: cosMarket.id,
    isActive: true,
  });

  console.log("Seeded Colorado Springs market with data source configurations");
}
