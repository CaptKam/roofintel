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

const DFW_BBOX = {
  west: -97.6,
  south: 32.4,
  east: -96.2,
  north: 33.2,
};

function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export async function fetchSwdiHailSignatures(daysBack: number = 7): Promise<SwdiHailSignature[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const startStr = formatDateYYYYMMDD(startDate);
  const endStr = formatDateYYYYMMDD(endDate);
  const bbox = `${DFW_BBOX.west},${DFW_BBOX.south},${DFW_BBOX.east},${DFW_BBOX.north}`;

  const url = `https://www.ncdc.noaa.gov/swdiws/json/nx3hail?startdate=${startStr}&enddate=${endStr}&bbox=${bbox}&limit=5000`;

  console.log(`[Hail Tracker] Fetching SWDI radar hail signatures: ${startStr} to ${endStr}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Hail Tracker] SWDI API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results: SwdiHailSignature[] = [];

    if (data?.result && Array.isArray(data.result)) {
      for (const r of data.result) {
        const lat = parseFloat(r.LAT);
        const lon = parseFloat(r.LON);
        const prob = parseInt(r.PROB) || 0;
        const sevprob = parseInt(r.SEVPROB) || 0;

        if (!isFinite(lat) || !isFinite(lon)) continue;

        results.push({
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

    console.log(`[Hail Tracker] Found ${results.length} radar hail signatures`);
    return results;
  } catch (error) {
    console.error("[Hail Tracker] SWDI fetch error:", error);
    return [];
  }
}

export async function fetchNwsAlerts(): Promise<NwsAlert[]> {
  const url = "https://api.weather.gov/alerts/active?area=TX&event=Severe%20Thunderstorm%20Warning,Tornado%20Warning";

  console.log("[Hail Tracker] Fetching active NWS alerts for Texas...");

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
        const isDfwArea = isDfwRegion(props.areaDesc || "");

        if (!isDfwArea || !isHailRelated) continue;

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

function isDfwRegion(areaDesc: string): boolean {
  const dfwCounties = ["dallas", "tarrant", "collin", "denton", "ellis", "johnson", "kaufman", "rockwall", "parker", "wise", "hunt"];
  const lower = areaDesc.toLowerCase();
  return dfwCounties.some((c) => lower.includes(c));
}

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
