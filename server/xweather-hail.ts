import { storage } from "./storage";
import type { Lead, InsertResponseQueue } from "@shared/schema";

interface XweatherThreatPeriod {
  timestamp: number;
  dateTimeISO: string;
  polygon: {
    type: string;
    coordinates: number[][][];
  } | null;
  centroid: { lat: number; lon: number } | null;
}

interface XweatherThreatDetails {
  hail: {
    maxSizeIN: number;
    maxSizeMM: number;
    probSevere: number;
    severe: boolean;
  };
  stormMotion: {
    directionDEG: number;
    speedMPH: number;
    speedKPH: number;
  } | null;
}

interface XweatherThreatResponse {
  id: string;
  loc: { lat: number; long: number };
  place?: { name?: string; state?: string; country?: string };
  periods: XweatherThreatPeriod[];
  details: XweatherThreatDetails;
  forecastPath?: {
    type: string;
    coordinates: number[][];
  };
}

export interface HailThreat {
  id: string;
  centroidLat: number;
  centroidLon: number;
  maxSizeIN: number;
  maxSizeMM: number;
  probSevere: number;
  severe: boolean;
  stormMotionDeg: number | null;
  stormMotionMPH: number | null;
  forecastPath: [number, number][];
  threatPolygons: Array<{
    timestamp: number;
    dateTimeISO: string;
    polygon: [number, number][];
  }>;
  affectedLeads: Array<{
    leadId: string;
    address: string;
    city: string;
    leadScore: number;
    distanceMiles: number;
    etaMinutes: number | null;
    ownerName: string;
    ownerPhone: string | null;
    contactPhone: string | null;
  }>;
  placeName: string | null;
  fetchedAt: string;
}

interface XweatherApiResponse {
  success: boolean;
  error?: { code: string; description: string };
  response?: XweatherThreatResponse[];
}

let threatMonitorInterval: ReturnType<typeof setInterval> | null = null;
let lastThreats: HailThreat[] = [];
let lastFetchedAt: string | null = null;
let alertedThreatIds = new Set<string>();

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function calculateEta(leadLat: number, leadLon: number, forecastPath: [number, number][], stormSpeedMPH: number | null): number | null {
  if (!stormSpeedMPH || stormSpeedMPH <= 0 || forecastPath.length < 2) return null;

  let closestDist = Infinity;
  let closestIdx = 0;

  for (let i = 0; i < forecastPath.length; i++) {
    const d = distanceMiles(leadLat, leadLon, forecastPath[i][0], forecastPath[i][1]);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  let pathDistToClosest = 0;
  for (let i = 1; i <= closestIdx; i++) {
    pathDistToClosest += distanceMiles(
      forecastPath[i - 1][0], forecastPath[i - 1][1],
      forecastPath[i][0], forecastPath[i][1]
    );
  }

  const etaMinutes = (pathDistToClosest / stormSpeedMPH) * 60;
  return Math.round(etaMinutes);
}

function calculateThreatPriority(lead: Lead, distance: number, probSevere: number, hailSizeIN: number, etaMinutes: number | null): number {
  let priority = 0;
  priority += lead.leadScore;
  priority += Math.max(0, (10 - distance) * 8);
  priority += probSevere * 0.8;
  priority += hailSizeIN * 20;
  if (etaMinutes !== null && etaMinutes <= 30) priority += 30;
  else if (etaMinutes !== null && etaMinutes <= 60) priority += 15;
  if (lead.totalValue && lead.totalValue > 1000000) priority += 20;
  else if (lead.totalValue && lead.totalValue > 500000) priority += 10;
  if (lead.sqft >= 10000) priority += 15;
  else if (lead.sqft >= 5000) priority += 10;
  if (lead.ownerPhone || lead.contactPhone) priority += 25;
  return Math.round(priority);
}

export async function fetchXweatherThreats(lat: number, lon: number, radiusMiles: number = 50): Promise<HailThreat[]> {
  const clientId = process.env.XWEATHER_CLIENT_ID;
  const clientSecret = process.env.XWEATHER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[Xweather] API credentials not configured");
    return [];
  }

  try {
    const url = `https://data.api.xweather.com/threats?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&p=${radiusMiles}mi&filter=hail&limit=25&loc=${lat},${lon}`;

    console.log(`[Xweather] Fetching hail threats for ${lat},${lon} (${radiusMiles}mi radius)...`);

    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Xweather] API error ${response.status}: ${text.substring(0, 200)}`);
      return [];
    }

    const data: XweatherApiResponse = await response.json();

    if (!data.success || !data.response || data.response.length === 0) {
      console.log("[Xweather] No active hail threats");
      return [];
    }

    const threats: HailThreat[] = data.response.map((t) => {
      const threatPolygons: HailThreat["threatPolygons"] = [];

      for (const period of t.periods || []) {
        if (period.polygon?.coordinates?.[0]) {
          const coords = period.polygon.coordinates[0].map(
            (c: number[]) => [c[1], c[0]] as [number, number]
          );
          threatPolygons.push({
            timestamp: period.timestamp,
            dateTimeISO: period.dateTimeISO,
            polygon: coords,
          });
        }
      }

      const forecastPath: [number, number][] = [];
      if (t.forecastPath?.coordinates) {
        for (const c of t.forecastPath.coordinates) {
          forecastPath.push([c[1], c[0]] as [number, number]);
        }
      }

      return {
        id: t.id,
        centroidLat: t.loc.lat,
        centroidLon: t.loc.long,
        maxSizeIN: t.details?.hail?.maxSizeIN || 0,
        maxSizeMM: t.details?.hail?.maxSizeMM || 0,
        probSevere: t.details?.hail?.probSevere || 0,
        severe: t.details?.hail?.severe || false,
        stormMotionDeg: t.details?.stormMotion?.directionDEG ?? null,
        stormMotionMPH: t.details?.stormMotion?.speedMPH ?? null,
        forecastPath,
        threatPolygons,
        affectedLeads: [],
        placeName: t.place?.name || null,
        fetchedAt: new Date().toISOString(),
      };
    });

    console.log(`[Xweather] Found ${threats.length} active hail threats`);
    return threats;

  } catch (err: any) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.error("[Xweather] Request timed out");
    } else {
      console.error("[Xweather] Fetch error:", err.message);
    }
    return [];
  }
}

export async function intersectThreatsWithLeads(threats: HailThreat[], marketId?: string): Promise<HailThreat[]> {
  if (threats.length === 0) return threats;

  const markets = await storage.getMarkets();
  const activeMarket = marketId
    ? markets.find(m => m.id === marketId)
    : (markets.find(m => m.isActive) || markets[0]);

  if (!activeMarket) return threats;

  for (const threat of threats) {
    const bounds = {
      west: threat.centroidLon - 0.5,
      south: threat.centroidLat - 0.5,
      east: threat.centroidLon + 0.5,
      north: threat.centroidLat + 0.5,
    };

    if (threat.threatPolygons.length > 0) {
      const allLats = threat.threatPolygons.flatMap(p => p.polygon.map(c => c[0]));
      const allLons = threat.threatPolygons.flatMap(p => p.polygon.map(c => c[1]));
      bounds.south = Math.min(...allLats) - 0.1;
      bounds.north = Math.max(...allLats) + 0.1;
      bounds.west = Math.min(...allLons) - 0.1;
      bounds.east = Math.max(...allLons) + 0.1;
    }

    const nearbyLeads = await storage.getLeadsInBounds(bounds.west, bounds.south, bounds.east, bounds.north, activeMarket.id);

    const affected: HailThreat["affectedLeads"] = [];

    for (const lead of nearbyLeads) {
      if (!lead.latitude || !lead.longitude) continue;

      let inZone = false;
      for (const tp of threat.threatPolygons) {
        if (isPointInPolygon(lead.latitude, lead.longitude, tp.polygon)) {
          inZone = true;
          break;
        }
      }

      const dist = distanceMiles(lead.latitude, lead.longitude, threat.centroidLat, threat.centroidLon);

      if (inZone || dist <= 10) {
        const eta = calculateEta(lead.latitude, lead.longitude, threat.forecastPath, threat.stormMotionMPH);

        affected.push({
          leadId: lead.id,
          address: lead.address,
          city: lead.city,
          leadScore: lead.leadScore,
          distanceMiles: Math.round(dist * 10) / 10,
          etaMinutes: eta,
          ownerName: lead.ownerName,
          ownerPhone: lead.ownerPhone,
          contactPhone: lead.contactPhone,
        });
      }
    }

    affected.sort((a, b) => b.leadScore - a.leadScore);
    threat.affectedLeads = affected;
  }

  return threats;
}

async function sendPreStormAlerts(threats: HailThreat[]): Promise<number> {
  let alertsSent = 0;

  const markets = await storage.getMarkets();
  const activeMarket = markets.find(m => m.isActive) || markets[0];
  if (!activeMarket) return 0;

  const configs = await storage.getStormAlertConfigs(activeMarket.id);
  const activeConfigs = configs.filter(c => c.isActive);
  if (activeConfigs.length === 0) return 0;

  for (const threat of threats) {
    if (threat.affectedLeads.length === 0) continue;
    if (alertedThreatIds.has(threat.id)) continue;

    for (const config of activeConfigs) {
      if (config.predictiveAlerts === false) continue;
      const minProb = config.minProbSevere || 40;
      const minSize = config.minHailSize || 1.0;
      if (threat.probSevere < minProb && threat.maxSizeIN < minSize) continue;

      const recipients = config.recipients as Array<{ type: string; value: string }>;
      const message = `[RoofIntel PREDICTION] Hail threat approaching ${threat.affectedLeads.length} properties! ` +
        `Size: ${threat.maxSizeIN}"${threat.severe ? " (SEVERE)" : ""}, ` +
        `Prob: ${threat.probSevere}%` +
        (threat.stormMotionMPH ? `, Moving ${threat.stormMotionMPH}mph` : "") +
        `. ETA: ${threat.affectedLeads[0]?.etaMinutes ? `~${threat.affectedLeads[0].etaMinutes}min` : "imminent"}. ` +
        `Pre-warm your top leads NOW.`;

      for (const recipient of recipients) {
        try {
          if (recipient.type === "sms" && config.notifySms) {
            await sendSmsAlert(recipient.value, message);
            alertsSent++;
          }

          const stormRuns = await storage.getStormRuns(1);
          const latestRunId = stormRuns[0]?.id;

          if (latestRunId) {
            await storage.createAlertHistory({
              stormRunId: latestRunId,
              alertConfigId: config.id,
              channel: recipient.type,
              recipient: recipient.value,
              message,
              status: "sent",
            });
          }
        } catch (err) {
          console.error(`[Xweather] Alert send error for ${recipient.value}:`, err);
        }
      }
    }

    alertedThreatIds.add(threat.id);
  }

  if (alertedThreatIds.size > 200) {
    const arr = Array.from(alertedThreatIds);
    alertedThreatIds = new Set(arr.slice(-100));
  }

  return alertsSent;
}

async function sendSmsAlert(phone: string, message: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[Xweather] SMS queued (Twilio not configured): ${phone} -> ${message.substring(0, 60)}...`);
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({ To: phone, From: fromNumber, Body: message });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Twilio SMS failed: ${response.status} - ${err}`);
  }

  console.log(`[Xweather] Pre-storm SMS sent to ${phone}`);
}

export async function runXweatherCycle(): Promise<{
  threats: HailThreat[];
  totalAffectedLeads: number;
  alertsSent: number;
}> {
  console.log("[Xweather] Running hail prediction cycle...");

  const markets = await storage.getMarkets();
  const activeMarket = markets.find(m => m.isActive) || markets[0];

  if (!activeMarket) {
    console.log("[Xweather] No active market");
    return { threats: [], totalAffectedLeads: 0, alertsSent: 0 };
  }

  let threats = await fetchXweatherThreats(activeMarket.centerLat, activeMarket.centerLng, activeMarket.radiusMiles);

  if (threats.length > 0) {
    threats = await intersectThreatsWithLeads(threats, activeMarket.id);

    for (const threat of threats) {
      if (threat.affectedLeads.length > 0) {
        try {
          const stormRun = await storage.createStormRun({
            marketId: activeMarket.id,
            status: "predicted",
            radarSignatureCount: threat.threatPolygons.length,
            maxHailProb: Math.round(threat.probSevere),
            maxSevereProb: threat.severe ? Math.round(threat.probSevere) : 0,
            swathPolygon: {
              type: "Polygon",
              coordinates: threat.threatPolygons[0]?.polygon || [],
              centroid: { lat: threat.centroidLat, lon: threat.centroidLon },
              maxProb: Math.round(threat.probSevere),
              maxSevereProb: threat.severe ? Math.round(threat.probSevere) : 0,
              signatureCount: threat.threatPolygons.length,
              source: "xweather",
              maxSizeIN: threat.maxSizeIN,
              forecastPath: threat.forecastPath,
              stormMotionMPH: threat.stormMotionMPH,
              stormMotionDeg: threat.stormMotionDeg,
            },
            affectedLeadCount: threat.affectedLeads.length,
            nwsAlertIds: [],
            metadata: {
              source: "xweather",
              threatId: threat.id,
              maxSizeIN: threat.maxSizeIN,
              severe: threat.severe,
              stormMotionMPH: threat.stormMotionMPH,
              stormMotionDeg: threat.stormMotionDeg,
              fetchedAt: threat.fetchedAt,
            },
          });

          const queueItems: InsertResponseQueue[] = threat.affectedLeads.slice(0, 200).map((al) => ({
            stormRunId: stormRun.id,
            leadId: al.leadId,
            priority: calculateThreatPriority(
              { leadScore: al.leadScore, totalValue: null, sqft: 0, ownerPhone: al.ownerPhone, contactPhone: al.contactPhone } as any,
              al.distanceMiles,
              threat.probSevere,
              threat.maxSizeIN,
              al.etaMinutes
            ),
            distanceMiles: al.distanceMiles,
            hailProbability: Math.round(threat.probSevere),
            status: "pending" as const,
          }));

          if (queueItems.length > 0) {
            await storage.createResponseQueueItems(queueItems);
          }
        } catch (err) {
          console.error("[Xweather] Failed to create storm run:", err);
        }
      }
    }
  }

  const totalAffectedLeads = threats.reduce((s, t) => s + t.affectedLeads.length, 0);
  let alertsSent = 0;

  if (totalAffectedLeads > 0) {
    alertsSent = await sendPreStormAlerts(threats);
  }

  lastThreats = threats;
  lastFetchedAt = new Date().toISOString();

  console.log(`[Xweather] Cycle complete: ${threats.length} threats, ${totalAffectedLeads} affected leads, ${alertsSent} alerts`);

  return { threats, totalAffectedLeads, alertsSent };
}

export function startXweatherMonitor(intervalMinutes: number = 2): void {
  if (threatMonitorInterval) {
    console.log("[Xweather] Monitor already running");
    return;
  }

  const clientId = process.env.XWEATHER_CLIENT_ID;
  const clientSecret = process.env.XWEATHER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[Xweather] Monitor not started - API credentials not configured");
    return;
  }

  console.log(`[Xweather] Starting predictive hail monitor (${intervalMinutes}-min interval)`);

  runXweatherCycle().catch(err => {
    console.error("[Xweather] Initial cycle error:", err);
  });

  threatMonitorInterval = setInterval(() => {
    runXweatherCycle().catch(err => {
      console.error("[Xweather] Cycle error:", err);
    });
  }, intervalMinutes * 60 * 1000);
}

export function stopXweatherMonitor(): void {
  if (threatMonitorInterval) {
    clearInterval(threatMonitorInterval);
    threatMonitorInterval = null;
    console.log("[Xweather] Monitor stopped");
  }
}

export function getXweatherStatus(): {
  running: boolean;
  configured: boolean;
  lastFetchedAt: string | null;
  activeThreats: number;
  totalAffectedLeads: number;
} {
  const clientId = process.env.XWEATHER_CLIENT_ID;
  const clientSecret = process.env.XWEATHER_CLIENT_SECRET;

  return {
    running: threatMonitorInterval !== null,
    configured: !!(clientId && clientSecret),
    lastFetchedAt,
    activeThreats: lastThreats.length,
    totalAffectedLeads: lastThreats.reduce((s, t) => s + t.affectedLeads.length, 0),
  };
}

export function getActiveThreats(): HailThreat[] {
  return lastThreats;
}
