interface SwdiHailSignature {
  lat: number;
  lon: number;
  ztime: string;
  prob: number;
  sevprob: number;
  wsrId: string;
  cellId: string;
}

interface NwsAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  areaDesc: string;
  severity: string;
  onset: string;
  expires: string;
  polygon: [number, number][] | null;
}

export interface HailTrackerData {
  radarSignatures: SwdiHailSignature[];
  alerts: NwsAlert[];
  fetchedAt: string;
}

function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function getAllMarketBboxes(): Promise<{ west: number; south: number; east: number; north: number }[]> {
  const defaultBbox = { west: -97.6, south: 32.4, east: -96.2, north: 33.2 };
  try {
    const markets = await (await import("./storage")).storage.getMarkets();
    const bboxes = markets
      .filter(m => m.isActive && m.boundingBox)
      .map(m => m.boundingBox as any);
    return bboxes.length > 0 ? bboxes : [defaultBbox];
  } catch {
    return [defaultBbox];
  }
}

export async function fetchSwdiHailSignatures(daysBack: number = 7): Promise<SwdiHailSignature[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const startStr = formatDateYYYYMMDD(startDate);
  const endStr = formatDateYYYYMMDD(endDate);

  const bboxes = await getAllMarketBboxes();
  const allSignatures: SwdiHailSignature[] = [];
  const seenKeys = new Set<string>();

  for (const bb of bboxes) {
    const bbox = `${bb.west},${bb.south},${bb.east},${bb.north}`;
    const url = `https://www.ncdc.noaa.gov/swdiws/json/nx3hail?startdate=${startStr}&enddate=${endStr}&bbox=${bbox}&limit=5000`;

    console.log(`[Hail Tracker] Fetching SWDI radar hail signatures: ${startStr} to ${endStr}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[Hail Tracker] SWDI API error: ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data?.result && Array.isArray(data.result)) {
        for (const r of data.result) {
          const lat = parseFloat(r.LAT);
          const lon = parseFloat(r.LON);
          const prob = parseInt(r.PROB) || 0;
          const sevprob = parseInt(r.SEVPROB) || 0;

          if (!isFinite(lat) || !isFinite(lon)) continue;
          const key = `${lat},${lon},${r.ZTIME}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          allSignatures.push({
            lat,
            lon,
            ztime: r.ZTIME || "",
            prob,
            sevprob,
            wsrId: r.WSR_ID || "",
            cellId: r.CELL_ID || "",
          });
        }
      }
    } catch (error) {
      console.error("[Hail Tracker] SWDI fetch error:", error);
    }
  }

  console.log(`[Hail Tracker] Found ${allSignatures.length} radar hail signatures`);
  return allSignatures;
}

export async function fetchNwsAlerts(): Promise<NwsAlert[]> {
  const allAlerts: NwsAlert[] = [];
  const marketStates = new Set<string>();
  try {
    const markets = await (await import("./storage")).storage.getMarkets();
    for (const m of markets) {
      if (m.isActive && m.state) marketStates.add(m.state);
    }
  } catch { marketStates.add("TX"); }
  if (marketStates.size === 0) marketStates.add("TX");

  for (const st of marketStates) {
    const url = `https://api.weather.gov/alerts/active?area=${st}&event=Severe%20Thunderstorm%20Warning,Tornado%20Warning`;
    console.log(`[Hail Tracker] Fetching active NWS alerts for ${st}...`);
    const alerts = await fetchNwsAlertsForState(url);
    allAlerts.push(...alerts);
  }
  return allAlerts;
}

async function fetchNwsAlertsForState(url: string): Promise<NwsAlert[]> {

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "RoofIntel/1.0 (roofing lead intelligence)",
        Accept: "application/geo+json",
      },
    });

    if (!response.ok) {
      console.error(`[Hail Tracker] NWS API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const alerts: NwsAlert[] = [];

    if (data?.features && Array.isArray(data.features)) {
      for (const feature of data.features) {
        const props = feature.properties;
        const desc = (props.description || "").toLowerCase();
        const headline = (props.headline || "").toLowerCase();
        const event = (props.event || "").toLowerCase();

        const isHailRelated = desc.includes("hail") || headline.includes("hail") || event.includes("severe thunderstorm");
        const isRelevantArea = isMarketRegion(props.areaDesc || "");

        if (!isRelevantArea || !isHailRelated) continue;

        let polygon: [number, number][] | null = null;
        if (feature.geometry?.type === "Polygon" && feature.geometry.coordinates?.[0]) {
          polygon = feature.geometry.coordinates[0].map((coord: number[]) => [coord[1], coord[0]]);
        }

        alerts.push({
          id: props.id || feature.id || "",
          event: props.event || "",
          headline: props.headline || "",
          description: props.description || "",
          areaDesc: props.areaDesc || "",
          severity: props.severity || "",
          onset: props.onset || "",
          expires: props.expires || "",
          polygon,
        });
      }
    }

    console.log(`[Hail Tracker] Found ${alerts.length} active hail-related alerts`);
    return alerts;
  } catch (error) {
    console.error("[Hail Tracker] NWS fetch error:", error);
    return [];
  }
}

let _cachedMarketCounties: string[] | null = null;
let _cacheTime = 0;

function isMarketRegion(areaDesc: string): boolean {
  const lower = areaDesc.toLowerCase();
  if (_cachedMarketCounties && Date.now() - _cacheTime < 600_000) {
    return _cachedMarketCounties.some((c) => lower.includes(c));
  }
  const dfwCounties = ["dallas", "tarrant", "collin", "denton", "ellis", "johnson", "kaufman", "rockwall", "parker", "wise", "hunt", "larimer", "el paso", "weld"];
  return dfwCounties.some((c) => lower.includes(c));
}

async function refreshMarketCountiesCache(): Promise<void> {
  try {
    const markets = await (await import("./storage")).storage.getMarkets();
    const counties: string[] = [];
    for (const m of markets) {
      if (m.isActive && m.counties) {
        for (const c of m.counties) counties.push(c.toLowerCase());
      }
    }
    _cachedMarketCounties = counties;
    _cacheTime = Date.now();
  } catch {}
}

refreshMarketCountiesCache();

export async function getHailTrackerData(daysBack: number = 7): Promise<HailTrackerData> {
  const [radarSignatures, alerts] = await Promise.all([
    fetchSwdiHailSignatures(daysBack),
    fetchNwsAlerts(),
  ]);

  return {
    radarSignatures,
    alerts,
    fetchedAt: new Date().toISOString(),
  };
}
