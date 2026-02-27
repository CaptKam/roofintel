import { db } from "./storage";
import { sql } from "drizzle-orm";

const STAC_API = "https://planetarycomputer.microsoft.com/api/stac/v1";
const TILE_API = "https://planetarycomputer.microsoft.com/api/data/v1";
const FETCH_DELAY_MS = 250;

export interface NAIPItem {
  id: string;
  year: number;
  date: string;
  gsd: number;
  tileJsonUrl: string;
  imageUrl: string;
}

export interface RoofCrop {
  year: number;
  date: string;
  gsd: number;
  itemId: string;
  imageBuffer: Buffer;
  tileUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function searchNAIPItems(lat: number, lon: number): Promise<NAIPItem[]> {
  const delta = 0.001;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta];

  const response = await fetch(`${STAC_API}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: ["naip"],
      bbox,
      limit: 20,
      sortby: [{ field: "datetime", direction: "asc" }],
    }),
  });

  if (!response.ok) {
    throw new Error(`STAC search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const items: NAIPItem[] = [];
  const seenYears = new Set<number>();

  for (const feature of data.features || []) {
    const dt = feature.properties?.datetime || "";
    const year = new Date(dt).getFullYear();
    if (seenYears.has(year)) continue;
    seenYears.add(year);

    const tileJsonUrl = feature.assets?.tilejson?.href || "";
    const imageUrl = feature.assets?.image?.href || "";
    const gsd = feature.properties?.gsd || 1.0;

    if (tileJsonUrl) {
      items.push({
        id: feature.id,
        year,
        date: dt.substring(0, 10),
        gsd,
        tileJsonUrl,
        imageUrl,
      });
    }
  }

  items.sort((a, b) => a.year - b.year);
  return items;
}

function latLonToTileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

export async function fetchRoofCropFromTiles(
  tileJsonUrl: string,
  lat: number,
  lon: number,
  zoom: number = 18
): Promise<Buffer | null> {
  try {
    const tjResponse = await fetch(tileJsonUrl);
    if (!tjResponse.ok) return null;
    const tileJson = await tjResponse.json();
    const tileTemplate: string = tileJson.tiles?.[0];
    if (!tileTemplate) return null;

    const { x, y } = latLonToTileXY(lat, lon, zoom);
    const tileUrl = tileTemplate.replace("{z}", String(zoom)).replace("{x}", String(x)).replace("{y}", String(y));

    const tileResponse = await fetch(tileUrl);
    if (!tileResponse.ok) return null;

    const buffer = Buffer.from(await tileResponse.arrayBuffer());
    return buffer;
  } catch (err: any) {
    console.error(`[NAIP] Tile fetch error:`, err.message);
    return null;
  }
}

export async function fetchAllYearsForProperty(
  lat: number,
  lon: number
): Promise<RoofCrop[]> {
  const items = await searchNAIPItems(lat, lon);
  const crops: RoofCrop[] = [];

  for (const item of items) {
    await sleep(FETCH_DELAY_MS);
    const buffer = await fetchRoofCropFromTiles(item.tileJsonUrl, lat, lon, 18);
    if (buffer && buffer.length > 100) {
      crops.push({
        year: item.year,
        date: item.date,
        gsd: item.gsd,
        itemId: item.id,
        imageBuffer: buffer,
        tileUrl: item.tileJsonUrl,
      });
    }
  }

  return crops;
}

export async function getCachedSnapshots(leadId: string): Promise<any[]> {
  const result = (await db.execute(sql`
    SELECT * FROM naip_roof_snapshots WHERE lead_id = ${leadId} ORDER BY capture_year ASC
  `)) as any;
  return result.rows || [];
}

export async function storeSnapshot(data: {
  leadId: string;
  captureYear: number;
  captureDate: string;
  naipItemId: string;
  imageUrl: string;
  meanBrightness: number;
  meanR: number;
  meanG: number;
  meanB: number;
  stdBrightness: number;
  colorClass: string;
  colorStats: any;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO naip_roof_snapshots (lead_id, capture_year, capture_date, naip_item_id, image_url,
      mean_brightness, mean_r, mean_g, mean_b, std_brightness, color_class, color_stats)
    VALUES (${data.leadId}, ${data.captureYear}, ${data.captureDate}, ${data.naipItemId},
      ${data.imageUrl}, ${data.meanBrightness}, ${data.meanR}, ${data.meanG}, ${data.meanB},
      ${data.stdBrightness}, ${data.colorClass}, ${JSON.stringify(data.colorStats)}::jsonb)
    ON CONFLICT (lead_id, capture_year) DO UPDATE SET
      mean_brightness = EXCLUDED.mean_brightness,
      mean_r = EXCLUDED.mean_r,
      mean_g = EXCLUDED.mean_g,
      mean_b = EXCLUDED.mean_b,
      std_brightness = EXCLUDED.std_brightness,
      color_class = EXCLUDED.color_class,
      color_stats = EXCLUDED.color_stats,
      fetched_at = NOW()
  `);
}

export async function storeChange(data: {
  leadId: string;
  estimatedYear: number;
  confidence: number;
  changeType: string;
  brightnessDelta: number;
  fromColor: string;
  toColor: string;
  fromYear: number;
  toYear: number;
  details: any;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO naip_roof_changes (lead_id, estimated_year, confidence, change_type,
      brightness_delta, from_color, to_color, from_year, to_year, details)
    VALUES (${data.leadId}, ${data.estimatedYear}, ${data.confidence}, ${data.changeType},
      ${data.brightnessDelta}, ${data.fromColor}, ${data.toColor}, ${data.fromYear},
      ${data.toYear}, ${JSON.stringify(data.details)}::jsonb)
  `);
}

export interface NAIPBatchProgress {
  running: boolean;
  phase: string;
  processed: number;
  total: number;
  detected: number;
  applied: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
}

export let naipBatchProgress: NAIPBatchProgress = {
  running: false,
  phase: "idle",
  processed: 0,
  total: 0,
  detected: 0,
  applied: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
};
