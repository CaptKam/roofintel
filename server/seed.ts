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
    await seedFortCollinsMarket();
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

  await storage.createDataSource({
    name: "COS Parcels - Accela",
    type: "cad_arcgis",
    url: "https://gis.coloradosprings.gov/arcgis/rest/services/Accela/AccelaAddressesParcels/MapServer/1",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "City of Colorado Springs parcel data with owner names, addresses, zoning, acreage",
      fields: ["PARCEL", "ZONING", "MAINADDRES", "OwnerName", "OwnerCSZ", "ADDRESS1", "ADDRESS2", "CITY", "STATE", "zip", "ACREAGE", "LEGAL"],
      geometryType: "esriGeometryPolygon",
    },
  });

  await storage.createDataSource({
    name: "COS Address Points",
    type: "cad_arcgis",
    url: "https://gis.coloradosprings.gov/arcgis/rest/services/Accela/AccelaAddressesParcels/MapServer/0",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "City of Colorado Springs address points linked to parcels",
      geometryType: "esriGeometryPoint",
    },
  });

  await storage.createDataSource({
    name: "COS Land Records - Parcels",
    type: "cad_arcgis",
    url: "https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/LandRecords/MapServer/4",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "General use parcel layer with ownership, zoning, and acreage data",
      fields: ["PARCEL", "ZONING", "MAINADDRES", "OwnerName", "OwnerCSZ", "ADDRESS1", "ADDRESS2", "ACREAGE", "LEGAL"],
      geometryType: "esriGeometryPolygon",
    },
  });

  await storage.createDataSource({
    name: "COS Building Footprints",
    type: "building_footprints",
    url: "https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/BuildingsImpSurfaces/MapServer/0",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Building footprint polygons with area for roof size estimation",
      fields: ["OBJECTID", "BUILDINGTYPE", "FEATURECODE", "Shape_Area"],
      geometryType: "esriGeometryPolygon",
    },
  });

  await storage.createDataSource({
    name: "COS Planning & Dev Tracker",
    type: "permits",
    url: "https://gis.coloradosprings.gov/arcgis/rest/services/Planning/PlanDevTracker_PRO/MapServer/0",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Planning and development applications (zone changes, variances, site plans) with status",
      fields: ["record_id", "record_type", "record_name", "record_description", "record_status", "record_address"],
      geometryType: "esriGeometryPoint",
    },
  });

  await storage.createDataSource({
    name: "COS Zoning",
    type: "zoning",
    url: "https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/PlanningZoning/MapServer",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Zoning districts and overlay layers for Colorado Springs",
    },
  });

  await storage.createDataSource({
    name: "CO Business Entities (SOS)",
    type: "business_entity",
    url: "https://data.colorado.gov/resource/4ykn-tg5h.json",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Colorado Secretary of State business entity registrations via Socrata API. Filter by principalcity=COLORADO SPRINGS. Fields: entityid, entityname, principaladdress1, principalcity, principalstate, principalzipcode, entitystatus, entitytype, agentfirstname, agentlastname, agentprincipaladdress1, entityformdate",
      filterParam: "$where=principalcity='COLORADO SPRINGS'",
      apiType: "socrata",
    },
  });

  await storage.createDataSource({
    name: "NOAA SWDI Radar Hail - COS",
    type: "noaa_swdi",
    url: "https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=swdi-nx3hail",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Real-time NOAA SWDI NEXRAD Level-3 hail signatures for COS bounding box",
      bbox: "-105.25,38.5,-104.4,39.15",
    },
  });

  await storage.createDataSource({
    name: "FEMA Flood Zones - COS",
    type: "fema_flood",
    url: "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "FEMA National Flood Hazard Layer for flood zone risk assessment around COS properties",
      bbox: { north: 39.15, south: 38.50, east: -104.40, west: -105.25 },
    },
  });

  await storage.createDataSource({
    name: "OpenStreetMap Buildings - COS",
    type: "osm_buildings",
    url: "https://overpass-api.de/api/interpreter",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "OpenStreetMap Overpass API for building footprint polygons in COS area for roof area computation",
      bbox: "38.5,-105.25,39.15,-104.4",
    },
  });

  await storage.createDataSource({
    name: "NAIP Aerial Imagery - COS",
    type: "naip_imagery",
    url: "https://planetarycomputer.microsoft.com/api/stac/v1",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Microsoft Planetary Computer STAC API for USDA NAIP aerial imagery to detect roof replacement events in COS area",
      bbox: [-105.25, 38.5, -104.4, 39.15],
      collection: "naip",
    },
  });

  await storage.createDataSource({
    name: "Esri Satellite Imagery - COS",
    type: "satellite_imagery",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    marketId: cosMarket.id,
    isActive: true,
    config: {
      description: "Esri World Imagery for satellite views of COS commercial rooftops",
    },
  });

  console.log("Seeded Colorado Springs market with data source configurations");

  await seedColoradoSpringsSources();

  await seedFortCollinsMarket();
}

async function seedColoradoSpringsSources() {
  const markets = await storage.getMarkets();
  const cosMarket = markets.find(m => m.name?.toLowerCase().includes("colorado springs"));
  if (!cosMarket) {
    console.log("Colorado Springs market not found, skipping COS sources");
    return;
  }

  const existingSources = await storage.getMarketDataSources(cosMarket.id);
  if (existingSources.some(s => s.sourceName === "Colorado Springs Land Records")) {
    console.log("Colorado Springs Land Records source already exists, skipping");
    return;
  }

  await storage.createMarketDataSource({
    marketId: cosMarket.id,
    sourceName: "Colorado Springs Land Records",
    sourceType: "cad_arcgis",
    endpoint: "https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/LandRecords/MapServer/4/query",
    fieldMapping: {
      sourceId: "SCHEDULE_NUMBER",
      address: ["SITUS_ADDRESS", "FULL_ADDRESS", "ADDRESS"],
      ownerName: ["OwnerName", "OWNER_NAME", "OWNER"],
      city: ["SITUS_CITY", "CITY"],
      zipCode: ["SITUS_ZIP", "ZIP_CODE"],
      classDescription: ["LAND_USE_DESC", "USE_CODE_DESC"],
      totalValue: ["TOTAL_VALUE", "ASSESSED_VALUE"],
      improvementValue: ["IMP_VALUE"],
      landValue: ["LAND_VALUE"],
      sqft: ["BLDG_SQFT", "BUILDING_SQFT"],
      yearBuilt: ["YEAR_BUILT", "YR_BUILT"],
      stories: ["NUM_STORIES"],
      state: "_STATIC_CO",
    },
    filterConfig: {
      county: "El Paso",
      defaultCity: "Colorado Springs",
      defaultState: "CO",
      minImpValue: 50000,
    },
    isActive: true,
  });

  console.log("Seeded Colorado Springs Land Records market data source");
}

async function seedFortCollinsMarket() {
  const markets = await storage.getMarkets();
  if (markets.some(m => m.name?.toLowerCase().includes("fort collins"))) {
    console.log("Fort Collins market already exists, skipping");
    return;
  }

  console.log("Seeding Fort Collins market...");

  const fcoMarket = await storage.createMarket({
    name: "Fort Collins",
    state: "CO",
    counties: ["Larimer"],
    centerLat: 40.5853,
    centerLng: -105.0844,
    radiusMiles: 30,
    isActive: true,
    boundingBox: {
      north: 41.02,
      south: 40.15,
      east: -104.52,
      west: -105.65,
    },
    metroArea: "Fort Collins",
  });

  await storage.createDataSource({
    name: "NOAA Storm Events - Fort Collins",
    type: "noaa_hail",
    url: "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/",
    marketId: fcoMarket.id,
    isActive: true,
  });

  await storage.createDataSource({
    name: "Fort Collins Parcels",
    type: "cad_arcgis",
    url: "https://gisweb.fcgov.com/arcgis/rest/services/FCMaps/MapServer/3",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "City of Fort Collins parcel data with owner names, parcel numbers, jurisdiction",
      fields: ["PARCELNO", "ACCOUNTNO", "OWNERNAMES", "NAME1", "NAME2", "MAILADDRESS1", "MAILADDRESS2", "MAILCITY", "MAILSTATE", "MAILZIPCODE", "JURISDICTION", "SHAPE_Area"],
      geometryType: "esriGeometryPolygon",
    },
  });

  await storage.createDataSource({
    name: "Fort Collins Parcel Addresses",
    type: "cad_arcgis",
    url: "https://gisweb.fcgov.com/arcgis/rest/services/FCMaps/MapServer/0",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "Fort Collins parcel address points with street components and zip codes",
      fields: ["PARCELNO", "NUMBER_", "FDPRE", "FNAME", "FTYPE", "FDSUF", "BUILDING", "UNIT", "ZIP", "CITY"],
      geometryType: "esriGeometryPolygon",
    },
  });

  await storage.createDataSource({
    name: "Fort Collins Development Projects",
    type: "permits",
    url: "https://gisweb.fcgov.com/arcgis/rest/services/FCMaps/MapServer/30",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "Current development project applications with permit IDs, project names, types, and status",
      fields: ["PROJECTNUM", "PROJECTNAME", "PROJECTTYPE", "B1_APPL_STATUS"],
      geometryType: "esriGeometryPoint",
    },
  });

  await storage.createDataSource({
    name: "Fort Collins Zoning",
    type: "zoning",
    url: "https://gisweb.fcgov.com/arcgis/rest/services/FCMaps/MapServer/33",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "City of Fort Collins zoning districts",
    },
  });

  await storage.createDataSource({
    name: "CO Business Entities (SOS) - Fort Collins",
    type: "business_entity",
    url: "https://data.colorado.gov/resource/4ykn-tg5h.json",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "Colorado Secretary of State business entity registrations. Filter by principalcity=FORT COLLINS",
      filterParam: "$where=principalcity='FORT COLLINS'",
      apiType: "socrata",
    },
  });

  await storage.createDataSource({
    name: "NOAA SWDI Radar Hail - Fort Collins",
    type: "noaa_swdi",
    url: "https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=swdi-nx3hail",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "Real-time NOAA SWDI NEXRAD Level-3 hail signatures for Fort Collins bounding box",
      bbox: "-105.65,40.15,-104.52,41.02",
    },
  });

  await storage.createDataSource({
    name: "FEMA Flood Zones - Fort Collins",
    type: "fema_flood",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "FEMA National Flood Hazard Layer for flood zone risk assessment around Fort Collins properties",
      bbox: { north: 41.02, south: 40.15, east: -104.52, west: -105.65 },
    },
  });

  await storage.createDataSource({
    name: "OpenStreetMap Buildings - Fort Collins",
    type: "osm_buildings",
    url: "https://overpass-api.de/api/interpreter",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "OpenStreetMap Overpass API for building footprint polygons in Fort Collins area",
      bbox: "40.15,-105.65,41.02,-104.52",
    },
  });

  await storage.createDataSource({
    name: "NAIP Aerial Imagery - Fort Collins",
    type: "naip_imagery",
    url: "https://planetarycomputer.microsoft.com/api/stac/v1",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "Microsoft Planetary Computer STAC API for USDA NAIP aerial imagery in Fort Collins area",
      bbox: [-105.65, 40.15, -104.52, 41.02],
      collection: "naip",
    },
  });

  await storage.createDataSource({
    name: "Esri Satellite Imagery - Fort Collins",
    type: "satellite_imagery",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    marketId: fcoMarket.id,
    isActive: true,
    config: {
      description: "Esri World Imagery for satellite views of Fort Collins commercial rooftops",
    },
  });

  await storage.createMarketDataSource({
    marketId: fcoMarket.id,
    sourceName: "Fort Collins Parcels",
    sourceType: "cad_arcgis",
    endpoint: "https://gisweb.fcgov.com/arcgis/rest/services/FCMaps/MapServer/3/query",
    fieldMapping: {
      sourceId: "PARCELNO",
      address: ["MAILADDRESS2", "MAILADDRESS1"],
      ownerName: ["OWNERNAMES", "NAME1", "NAME2"],
      city: "MAILCITY",
      zipCode: "MAILZIPCODE",
      state: "MAILSTATE",
    },
    filterConfig: {
      county: "Larimer",
      defaultCity: "Fort Collins",
      defaultState: "CO",
      whereClause: "OBJECTID > 0",
      paginationMode: "objectid",
    },
    isActive: true,
  });

  console.log("Seeded Fort Collins market with data source configurations");
}
