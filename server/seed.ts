import { storage } from "./storage";
import type { InsertLead } from "@shared/schema";

export function calculateScore(lead: Partial<InsertLead>): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  if (lead.roofLastReplaced) {
    const roofAge = currentYear - lead.roofLastReplaced;
    score += Math.min(roofAge * 2, 30);
  } else {
    score += 15;
  }

  score += Math.min((lead.hailEvents || 0) * 8, 25);

  if ((lead.sqft || 0) >= 10000) score += 20;
  else if ((lead.sqft || 0) >= 5000) score += 15;
  else if ((lead.sqft || 0) >= 2500) score += 10;

  if (lead.ownerType === "LLC") score += 15;
  else if (lead.ownerType === "Corporation") score += 10;
  else score += 5;

  if (lead.totalValue && lead.totalValue >= 1000000) score += 10;
  else if (lead.totalValue && lead.totalValue >= 500000) score += 7;
  else score += 3;

  return Math.min(score, 100);
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
