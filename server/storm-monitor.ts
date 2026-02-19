import { storage } from "./storage";
import { fetchSwdiHailSignatures, fetchNwsAlerts } from "./hail-tracker";
import type { InsertStormRun, InsertResponseQueue, Lead } from "@shared/schema";

interface RadarPoint {
  lat: number;
  lon: number;
  prob: number;
  sevprob: number;
  ztime: string;
}

interface HailSwathPolygon {
  type: "Polygon";
  coordinates: [number, number][];
  centroid: { lat: number; lon: number };
  maxProb: number;
  maxSevereProb: number;
  signatureCount: number;
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastRunSignatureHash = "";

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clusterRadarSignatures(points: RadarPoint[], radiusMiles: number = 5): RadarPoint[][] {
  if (points.length === 0) return [];
  
  const visited = new Set<number>();
  const clusters: RadarPoint[][] = [];

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);
    
    const cluster: RadarPoint[] = [points[i]];
    const queue = [i];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (let j = 0; j < points.length; j++) {
        if (visited.has(j)) continue;
        const dist = distanceMiles(points[current].lat, points[current].lon, points[j].lat, points[j].lon);
        if (dist <= radiusMiles) {
          visited.add(j);
          cluster.push(points[j]);
          queue.push(j);
        }
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

function convexHull(points: { lat: number; lon: number }[]): [number, number][] {
  if (points.length < 3) {
    return points.map(p => [p.lat, p.lon] as [number, number]);
  }

  const pts = points.map(p => ({ x: p.lon, y: p.lat }));
  pts.sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: typeof pts = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: typeof pts = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.map(p => [p.y, p.x] as [number, number]);
}

function expandPolygon(polygon: [number, number][], bufferMiles: number): [number, number][] {
  if (polygon.length < 3) return polygon;
  
  const centroidLat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  const centroidLon = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  const latPerMile = 1 / 69.0;
  const lonPerMile = 1 / (69.0 * Math.cos(centroidLat * Math.PI / 180));

  return polygon.map(([lat, lon]) => {
    const dLat = lat - centroidLat;
    const dLon = lon - centroidLon;
    const dist = Math.sqrt((dLat / latPerMile) ** 2 + (dLon / lonPerMile) ** 2);
    if (dist < 0.001) return [lat, lon] as [number, number];
    const scale = (dist + bufferMiles) / dist;
    return [
      centroidLat + dLat * scale,
      centroidLon + dLon * scale,
    ] as [number, number];
  });
}

function buildSwathPolygon(cluster: RadarPoint[]): HailSwathPolygon {
  const hull = convexHull(cluster.map(p => ({ lat: p.lat, lon: p.lon })));
  const expanded = expandPolygon(hull, 1);
  
  const centroidLat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
  const centroidLon = cluster.reduce((s, p) => s + p.lon, 0) / cluster.length;

  return {
    type: "Polygon",
    coordinates: expanded,
    centroid: { lat: centroidLat, lon: centroidLon },
    maxProb: Math.max(...cluster.map(p => p.prob)),
    maxSevereProb: Math.max(...cluster.map(p => p.sevprob)),
    signatureCount: cluster.length,
  };
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

function findAffectedLeads(leadsArr: Lead[], swath: HailSwathPolygon, radiusMiles: number = 3): { lead: Lead; distance: number }[] {
  const affected: { lead: Lead; distance: number }[] = [];
  
  for (const lead of leadsArr) {
    if (!lead.latitude || !lead.longitude) continue;
    
    if (isPointInPolygon(lead.latitude, lead.longitude, swath.coordinates)) {
      affected.push({ lead, distance: 0 });
      continue;
    }

    const dist = distanceMiles(lead.latitude, lead.longitude, swath.centroid.lat, swath.centroid.lon);
    if (dist <= radiusMiles) {
      affected.push({ lead, distance: dist });
    }
  }

  return affected;
}

function calculateResponsePriority(lead: Lead, distance: number, hailProb: number): number {
  let priority = 0;
  priority += lead.leadScore;
  priority += Math.max(0, (5 - distance) * 10);
  priority += hailProb * 0.5;
  if (lead.totalValue && lead.totalValue > 1000000) priority += 20;
  else if (lead.totalValue && lead.totalValue > 500000) priority += 10;
  if (lead.sqft >= 10000) priority += 15;
  else if (lead.sqft >= 5000) priority += 10;
  if (lead.ownerPhone || lead.contactPhone) priority += 25;
  return Math.round(priority);
}

function hashSignatures(sigs: RadarPoint[]): string {
  if (sigs.length === 0) return "empty";
  const sorted = sigs.map(s => `${s.lat.toFixed(3)},${s.lon.toFixed(3)},${s.ztime}`).sort();
  return sorted.join("|").substring(0, 200);
}

export async function runStormMonitorCycle(): Promise<{
  newStormRuns: number;
  totalAffectedLeads: number;
  alertsSent: number;
  swathPolygons: HailSwathPolygon[];
}> {
  console.log("[Storm Monitor] Running detection cycle...");
  
  const [radarSigs, nwsAlerts] = await Promise.all([
    fetchSwdiHailSignatures(1),
    fetchNwsAlerts(),
  ]);

  const sigHash = hashSignatures(radarSigs);
  if (sigHash === lastRunSignatureHash && sigHash !== "empty") {
    console.log("[Storm Monitor] No new radar signatures since last check");
    return { newStormRuns: 0, totalAffectedLeads: 0, alertsSent: 0, swathPolygons: [] };
  }
  lastRunSignatureHash = sigHash;

  if (radarSigs.length === 0 && nwsAlerts.length === 0) {
    console.log("[Storm Monitor] No active hail signatures or alerts");
    return { newStormRuns: 0, totalAffectedLeads: 0, alertsSent: 0, swathPolygons: [] };
  }

  const clusters = clusterRadarSignatures(radarSigs, 8);
  console.log(`[Storm Monitor] Found ${clusters.length} hail clusters from ${radarSigs.length} radar signatures`);

  if (clusters.length === 0 && nwsAlerts.length === 0) {
    return { newStormRuns: 0, totalAffectedLeads: 0, alertsSent: 0, swathPolygons: [] };
  }

  const markets = await storage.getMarkets();
  const activeMarket = markets.find(m => m.isActive) || markets[0];
  if (!activeMarket) {
    console.log("[Storm Monitor] No active market found");
    return { newStormRuns: 0, totalAffectedLeads: 0, alertsSent: 0, swathPolygons: [] };
  }

  const swathPolygons: HailSwathPolygon[] = clusters.map(c => buildSwathPolygon(c));
  let totalAffectedLeads = 0;
  let newStormRuns = 0;
  let alertsSent = 0;

  for (const swath of swathPolygons) {
    const bounds = {
      west: Math.min(...swath.coordinates.map(c => c[1])) - 0.1,
      south: Math.min(...swath.coordinates.map(c => c[0])) - 0.1,
      east: Math.max(...swath.coordinates.map(c => c[1])) + 0.1,
      north: Math.max(...swath.coordinates.map(c => c[0])) + 0.1,
    };

    const nearbyLeads = await storage.getLeadsInBounds(bounds.west, bounds.south, bounds.east, bounds.north, activeMarket.id);
    const affected = findAffectedLeads(nearbyLeads, swath, 5);

    const stormRun = await storage.createStormRun({
      marketId: activeMarket.id,
      status: affected.length > 0 ? "active" : "detected",
      radarSignatureCount: swath.signatureCount,
      maxHailProb: swath.maxProb,
      maxSevereProb: swath.maxSevereProb,
      swathPolygon: swath,
      affectedLeadCount: affected.length,
      nwsAlertIds: nwsAlerts.map(a => a.id),
      metadata: {
        centroid: swath.centroid,
        boundingBox: bounds,
        detectedAt: new Date().toISOString(),
      },
    });

    newStormRuns++;
    totalAffectedLeads += affected.length;

    if (affected.length > 0) {
      const queueItems: InsertResponseQueue[] = affected.map(({ lead, distance }) => ({
        stormRunId: stormRun.id,
        leadId: lead.id,
        priority: calculateResponsePriority(lead, distance, swath.maxProb),
        distanceMiles: Math.round(distance * 10) / 10,
        hailProbability: swath.maxProb,
        status: "pending" as const,
      }));

      await storage.createResponseQueueItems(queueItems);

      const configs = await storage.getStormAlertConfigs(activeMarket.id);
      const activeConfigs = configs.filter(c => c.isActive);

      for (const config of activeConfigs) {
        if (swath.maxProb < (config.minHailSize * 100)) continue;

        const recipients = config.recipients as Array<{ type: string; value: string }>;
        const message = `[RoofIntel Storm Alert] Hail detected near ${affected.length} properties. ` +
          `Probability: ${swath.maxProb}%, Severe: ${swath.maxSevereProb}%. ` +
          `Location: ${swath.centroid.lat.toFixed(3)}, ${swath.centroid.lon.toFixed(3)}. ` +
          `Check your Storm Response dashboard for the prioritized call list.`;

        for (const recipient of recipients) {
          try {
            if (recipient.type === "sms" && config.notifySms) {
              await sendSmsAlert(recipient.value, message);
              await storage.createAlertHistory({
                stormRunId: stormRun.id,
                alertConfigId: config.id,
                channel: "sms",
                recipient: recipient.value,
                message,
                status: "sent",
              });
              alertsSent++;
            } else if (recipient.type === "email" && config.notifyEmail) {
              await storage.createAlertHistory({
                stormRunId: stormRun.id,
                alertConfigId: config.id,
                channel: "email",
                recipient: recipient.value,
                message,
                status: "queued",
              });
              alertsSent++;
            }
          } catch (err) {
            console.error(`[Storm Monitor] Failed to send alert to ${recipient.value}:`, err);
            await storage.createAlertHistory({
              stormRunId: stormRun.id,
              alertConfigId: config.id,
              channel: recipient.type,
              recipient: recipient.value,
              message,
              status: "failed",
            });
          }
        }
      }
    }

    console.log(`[Storm Monitor] Storm run created: ${stormRun.id}, ${affected.length} affected leads, prob=${swath.maxProb}%`);
  }

  return { newStormRuns, totalAffectedLeads, alertsSent, swathPolygons };
}

async function sendSmsAlert(phone: string, message: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[Storm Monitor] SMS alert queued (Twilio not configured): ${phone}`);
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    To: phone,
    From: fromNumber,
    Body: message,
  });

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

  console.log(`[Storm Monitor] SMS sent to ${phone}`);
}

export function startStormMonitor(intervalMinutes: number = 10): void {
  if (monitorInterval) {
    console.log("[Storm Monitor] Already running");
    return;
  }

  console.log(`[Storm Monitor] Starting real-time monitor (checking every ${intervalMinutes} min)`);

  runStormMonitorCycle().catch(err => {
    console.error("[Storm Monitor] Initial cycle error:", err);
  });

  monitorInterval = setInterval(() => {
    runStormMonitorCycle().catch(err => {
      console.error("[Storm Monitor] Cycle error:", err);
    });
  }, intervalMinutes * 60 * 1000);
}

export function stopStormMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[Storm Monitor] Stopped");
  }
}

export function getStormMonitorStatus(): { running: boolean; lastHash: string } {
  return {
    running: monitorInterval !== null,
    lastHash: lastRunSignatureHash,
  };
}
