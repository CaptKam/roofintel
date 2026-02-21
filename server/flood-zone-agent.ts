import { leads, type Lead } from "@shared/schema";
import { db } from "./storage";
import { eq, and, sql, isNull, isNotNull } from "drizzle-orm";

const FEMA_NFHL_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

const REQUEST_TIMEOUT_MS = 15000;
const RATE_LIMIT_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function lookupFloodZone(
  lat: number,
  lng: number
): Promise<{ floodZone: string; floodZoneSubtype: string; isHighRisk: boolean } | null> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
    returnGeometry: "false",
    f: "json",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${FEMA_NFHL_URL}?${params.toString()}`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      console.error("[flood-zone] FEMA returned non-JSON response:", contentType);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.error("[flood-zone] FEMA API error:", data.error.message || data.error);
      return null;
    }

    if (!data.features || data.features.length === 0) {
      return null;
    }

    const attrs = data.features[0].attributes;
    const floodZone = attrs.FLD_ZONE || "UNKNOWN";
    const floodZoneSubtype = attrs.ZONE_SUBTY || "";
    const isHighRisk = attrs.SFHA_TF === "T";

    return { floodZone, floodZoneSubtype, isHighRisk };
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[flood-zone] FEMA request timed out for", lat, lng);
    } else {
      console.error("[flood-zone] FEMA request failed:", err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichLeadsWithFloodZones(
  marketId: string,
  options?: { batchSize?: number }
): Promise<{ processed: number; enriched: number; errors: number }> {
  const batchSize = options?.batchSize ?? 100;

  const unenrichedLeads = await db
    .select({
      id: leads.id,
      latitude: leads.latitude,
      longitude: leads.longitude,
    })
    .from(leads)
    .where(
      and(
        eq(leads.marketId, marketId),
        isNull(leads.floodZone)
      )
    )
    .limit(batchSize);

  let processed = 0;
  let enriched = 0;
  let errors = 0;

  for (const lead of unenrichedLeads) {
    processed++;

    try {
      const result = await lookupFloodZone(lead.latitude, lead.longitude);

      if (result) {
        await db
          .update(leads)
          .set({
            floodZone: result.floodZone,
            floodZoneSubtype: result.floodZoneSubtype,
            isFloodHighRisk: result.isHighRisk,
          })
          .where(eq(leads.id, lead.id));
        enriched++;
      } else {
        await db
          .update(leads)
          .set({
            floodZone: "NONE",
            floodZoneSubtype: "",
            isFloodHighRisk: false,
          })
          .where(eq(leads.id, lead.id));
        enriched++;
      }
    } catch (err: any) {
      console.error(`[flood-zone] Error enriching lead ${lead.id}:`, err.message);
      errors++;
    }

    if (processed < unenrichedLeads.length) {
      await delay(RATE_LIMIT_MS);
    }
  }

  console.log(
    `[flood-zone] Enrichment complete: ${processed} processed, ${enriched} enriched, ${errors} errors`
  );

  return { processed, enriched, errors };
}

export async function getFloodZoneStats(
  marketId?: string
): Promise<{
  total: number;
  enriched: number;
  highRisk: number;
  zoneDistribution: Record<string, number>;
}> {
  const conditions = marketId
    ? [eq(leads.marketId, marketId)]
    : [];

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  const total = totalResult[0]?.count ?? 0;

  const enrichedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      conditions.length > 0
        ? and(...conditions, isNotNull(leads.floodZone))
        : isNotNull(leads.floodZone)
    );
  const enriched = enrichedResult[0]?.count ?? 0;

  const highRiskResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      conditions.length > 0
        ? and(...conditions, eq(leads.isFloodHighRisk, true))
        : eq(leads.isFloodHighRisk, true)
    );
  const highRisk = highRiskResult[0]?.count ?? 0;

  const zoneRows = await db
    .select({
      zone: leads.floodZone,
      count: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(
      conditions.length > 0
        ? and(...conditions, isNotNull(leads.floodZone))
        : isNotNull(leads.floodZone)
    )
    .groupBy(leads.floodZone);

  const zoneDistribution: Record<string, number> = {};
  for (const row of zoneRows) {
    if (row.zone) {
      zoneDistribution[row.zone] = row.count;
    }
  }

  return { total, enriched, highRisk, zoneDistribution };
}
