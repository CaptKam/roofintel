import { db } from "./storage";
import { leads, zipTiles } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

let computeProgress = { processed: 0, total: 0, running: false };

export async function computeZipTile(zipCode: string, marketId: string) {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*)::int as lead_count,
      AVG(COALESCE(${leads.hailEvents}, 0))::real as avg_hail,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(${leads.totalValue}, 0))::real as median_value,
      AVG(CASE WHEN ${leads.ownerPhone} IS NULL THEN 1.0 ELSE 0.0 END)::real as pct_missing_phone,
      AVG(CASE WHEN ${leads.ownerEmail} IS NULL THEN 1.0 ELSE 0.0 END)::real as pct_missing_email,
      AVG(CASE WHEN ${leads.yearBuilt} < 2000 OR ${leads.yearBuilt} IS NULL THEN 1.0 ELSE 0.0 END)::real as pct_old_roof,
      AVG(COALESCE(${leads.leadScore}, 0))::real as avg_score,
      AVG(CASE WHEN ${leads.ownerPhone} IS NOT NULL AND ${leads.ownerEmail} IS NOT NULL THEN 1.0 ELSE 0.0 END)::real as contactable_pct,
      AVG(${leads.latitude})::real as center_lat,
      AVG(${leads.longitude})::real as center_lng,
      MIN(${leads.latitude})::real as min_lat,
      MAX(${leads.latitude})::real as max_lat,
      MIN(${leads.longitude})::real as min_lng,
      MAX(${leads.longitude})::real as max_lng
    FROM ${leads}
    WHERE ${leads.zipCode} = ${zipCode} AND ${leads.marketId} = ${marketId}
  `);

  const s = result.rows[0] as any;
  if (!s || !s.lead_count || Number(s.lead_count) === 0) return null;

  const stormRisk = Math.min(100, (Number(s.avg_hail) || 0) * 6);
  const roofAgeRisk = (Number(s.pct_old_roof) || 0) * 100;
  const dataGap = ((Number(s.pct_missing_phone) || 0) + (Number(s.pct_missing_email) || 0)) * 50;
  const valueScore = Math.min(100, (Number(s.median_value) || 0) / 150000);
  const densityScore = Math.min(100, Number(s.lead_count) / 80);

  const zipScore = Math.round(
    0.30 * stormRisk +
    0.20 * roofAgeRisk +
    0.20 * dataGap +
    0.15 * valueScore +
    0.15 * densityScore
  );

  const tile = {
    marketId,
    zipCode,
    zipScore,
    stormRiskScore: Math.round(stormRisk * 10) / 10,
    roofAgeScore: Math.round(roofAgeRisk * 10) / 10,
    dataGapScore: Math.round(dataGap * 10) / 10,
    propertyValueScore: Math.round(valueScore * 10) / 10,
    leadDensityScore: Math.round(densityScore * 10) / 10,
    contactabilityScore: Math.round((Number(s.contactable_pct) || 0) * 1000) / 10,
    leadCount: Number(s.lead_count),
    avgLeadScore: Math.round((Number(s.avg_score) || 0) * 10) / 10,
    avgHailEvents: Math.round((Number(s.avg_hail) || 0) * 10) / 10,
    medianPropertyValue: Math.round(Number(s.median_value) || 0),
    pctMissingPhone: Math.round((Number(s.pct_missing_phone) || 0) * 1000) / 10,
    pctMissingEmail: Math.round((Number(s.pct_missing_email) || 0) * 1000) / 10,
    pctOldRoof: Math.round((Number(s.pct_old_roof) || 0) * 1000) / 10,
    recommendedSpend: zipScore > 70 ? 1800 : zipScore > 50 ? 900 : 300,
    projectedEv: zipScore * 120,
    centerLat: Number(s.center_lat) || 0,
    centerLng: Number(s.center_lng) || 0,
    boundingBox: {
      minLat: Number(s.min_lat),
      maxLat: Number(s.max_lat),
      minLng: Number(s.min_lng),
      maxLng: Number(s.max_lng),
    },
    lastComputedAt: new Date(),
  };

  await db
    .insert(zipTiles)
    .values(tile)
    .onConflictDoUpdate({
      target: [zipTiles.zipCode],
      set: {
        ...tile,
        lastComputedAt: new Date(),
      },
    });

  return tile;
}

export async function scoreAllZips(marketId: string = "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da") {
  computeProgress = { processed: 0, total: 0, running: true };

  const zips = await db.execute(
    sql`SELECT DISTINCT ${leads.zipCode} as zip_code FROM ${leads} WHERE ${leads.marketId} = ${marketId} AND ${leads.zipCode} IS NOT NULL`
  );

  const zipCodes = (zips.rows as any[]).map((z) => z.zip_code).filter(Boolean);
  computeProgress.total = zipCodes.length;

  const tiles = [];
  for (const zip of zipCodes) {
    const tile = await computeZipTile(zip, marketId);
    if (tile) tiles.push(tile);
    computeProgress.processed++;
  }

  computeProgress.running = false;
  return tiles.sort((a, b) => b.zipScore - a.zipScore);
}

export function getComputeProgress() {
  return computeProgress;
}

export async function getZipTiles(marketId: string) {
  return db.select().from(zipTiles).where(eq(zipTiles.marketId, marketId));
}

export async function getZipTile(zipCode: string) {
  const tiles = await db.select().from(zipTiles).where(eq(zipTiles.zipCode, zipCode)).limit(1);
  return tiles[0] || null;
}
