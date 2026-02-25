import { db } from "./storage";
import { buildingFootprints } from "@shared/schema";
import { eq } from "drizzle-orm";

interface FootprintResult {
  polygon: number[][];
  roofAreaSqft: number;
  source: string;
  cached: boolean;
}

function computePolygonAreaSqft(coords: number[][]): number {
  if (coords.length < 3) return 0;
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;

  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const lat1 = toRadians(coords[i][1]);
    const lat2 = toRadians(coords[j][1]);
    const dLon = toRadians(coords[j][0] - coords[i][0]);
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = Math.abs((area * R * R) / 2);
  return Math.round(area * 10.7639);
}

async function fetchFromOverpass(lat: number, lon: number): Promise<FootprintResult | null> {
  const delta = 0.0005;
  const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
  const query = `[out:json][timeout:15];way["building"](${bbox});out body;>;out skel qt;`;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: { "User-Agent": "RoofIntel/1.0 (roofing-lead-intelligence)" },
  });

  if (!response.ok) {
    console.error(`[Footprint] Overpass API error: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const nodes = new Map<number, [number, number]>();
  const ways: Array<{ id: number; nodes: number[]; tags: Record<string, string> }> = [];

  for (const el of data.elements) {
    if (el.type === "node") {
      nodes.set(el.id, [el.lon, el.lat]);
    } else if (el.type === "way" && el.tags?.building) {
      ways.push({ id: el.id, nodes: el.nodes, tags: el.tags });
    }
  }

  if (ways.length === 0) return null;

  let bestWay = ways[0];
  let bestDist = Infinity;

  for (const way of ways) {
    const wayNodes = way.nodes.map(nId => nodes.get(nId)).filter(Boolean) as [number, number][];
    if (wayNodes.length < 3) continue;
    const centLon = wayNodes.reduce((s, n) => s + n[0], 0) / wayNodes.length;
    const centLat = wayNodes.reduce((s, n) => s + n[1], 0) / wayNodes.length;
    const dist = Math.sqrt(Math.pow(centLon - lon, 2) + Math.pow(centLat - lat, 2));
    if (dist < bestDist) {
      bestDist = dist;
      bestWay = way;
    }
  }

  const polygon = bestWay.nodes
    .map(nId => nodes.get(nId))
    .filter(Boolean) as [number, number][];

  if (polygon.length < 3) return null;

  const roofAreaSqft = computePolygonAreaSqft(polygon);

  return {
    polygon,
    roofAreaSqft,
    source: "openstreetmap",
    cached: false,
  };
}

export async function getBuildingFootprint(
  leadId: string,
  lat: number,
  lon: number
): Promise<FootprintResult | null> {
  const cached = await db
    .select()
    .from(buildingFootprints)
    .where(eq(buildingFootprints.leadId, leadId))
    .limit(1);

  if (cached.length > 0) {
    return {
      polygon: cached[0].polygon as number[][],
      roofAreaSqft: cached[0].roofAreaSqft || 0,
      source: cached[0].source,
      cached: true,
    };
  }

  console.log(`[Footprint] Fetching building footprint for lead ${leadId} at ${lat},${lon}`);
  const result = await fetchFromOverpass(lat, lon);

  if (result) {
    await db.insert(buildingFootprints).values({
      leadId,
      latitude: lat,
      longitude: lon,
      polygon: result.polygon,
      roofAreaSqft: result.roofAreaSqft,
      source: result.source,
    });
    console.log(`[Footprint] Cached footprint: ${result.roofAreaSqft} sqft roof area`);
  }

  return result;
}

export async function getBuildingFootprintsBatch(
  leads: Array<{ id: string; latitude: number; longitude: number }>
): Promise<Map<string, FootprintResult>> {
  const results = new Map<string, FootprintResult>();

  const cached = await db.select().from(buildingFootprints);
  const cachedMap = new Map(cached.map(c => [c.leadId, c]));

  const uncached = leads.filter(l => !cachedMap.has(l.id));

  for (const c of cached) {
    if (leads.some(l => l.id === c.leadId)) {
      results.set(c.leadId, {
        polygon: c.polygon as number[][],
        roofAreaSqft: c.roofAreaSqft || 0,
        source: c.source,
        cached: true,
      });
    }
  }

  if (uncached.length > 0) {
    const batchSize = 5;
    for (let i = 0; i < Math.min(uncached.length, 20); i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      const fetches = batch.map(async (lead) => {
        try {
          const result = await getBuildingFootprint(lead.id, lead.latitude, lead.longitude);
          if (result) results.set(lead.id, result);
        } catch (err) {
          console.error(`[Footprint] Error fetching for ${lead.id}:`, err);
        }
      });
      await Promise.all(fetches);
      if (i + batchSize < uncached.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  return results;
}
