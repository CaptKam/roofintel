import { db } from "./storage";
import { leads, chaseSessions, chaseActions, chaseAlertHistory, pushDevices } from "@shared/schema";
import { eq, sql, and, gte, desc } from "drizzle-orm";

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isQuietHours(quietStart: string | null, quietEnd: string | null): boolean {
  if (!quietStart || !quietEnd) return false;
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const current = hour * 60 + min;
  const [sh, sm] = quietStart.split(":").map(Number);
  const [eh, em] = quietEnd.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start <= end) return current >= start && current < end;
  return current >= start || current < end;
}

export async function checkProximity(
  userId: string,
  latitude: number,
  longitude: number,
  radiusMiles: number = 5,
  minScore: number = 50
): Promise<any[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentAlerts = await db.select()
    .from(chaseAlertHistory)
    .where(and(
      eq(chaseAlertHistory.userId, userId),
      gte(chaseAlertHistory.createdAt, oneHourAgo)
    ));

  if (recentAlerts.length >= 5) return [];

  const recentDismissals = recentAlerts.filter(a => a.dismissed).slice(-3);
  if (recentDismissals.length >= 3) {
    const lastDismissal = recentDismissals[recentDismissals.length - 1];
    if (lastDismissal.createdAt && (Date.now() - lastDismissal.createdAt.getTime()) < 30 * 60 * 1000) {
      return [];
    }
  }

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentLeadIds = new Set(
    recentAlerts
      .filter(a => a.createdAt && a.createdAt >= tenMinAgo)
      .map(a => a.leadId)
  );

  const actionedLeadIds = new Set(
    (await db.select({ leadId: chaseActions.leadId })
      .from(chaseActions)
      .where(eq(chaseActions.userId, userId)))
      .map(a => a.leadId)
  );

  const latRange = radiusMiles / 69;
  const lonRange = radiusMiles / (69 * Math.cos(latitude * Math.PI / 180));

  const nearbyLeads = await db.select({
    id: leads.id,
    address: leads.address,
    city: leads.city,
    latitude: leads.latitude,
    longitude: leads.longitude,
    leadScore: leads.leadScore,
    ownerName: leads.ownerName,
    ownerPhone: leads.ownerPhone,
    contactPhone: leads.contactPhone,
    contactName: leads.contactName,
    estimatedRoofArea: leads.estimatedRoofArea,
    yearBuilt: leads.yearBuilt,
    totalValue: leads.totalValue,
    hailEvents: leads.hailEvents,
    lastHailDate: leads.lastHailDate,
    lastHailSize: leads.lastHailSize,
    roofType: leads.roofType,
  })
    .from(leads)
    .where(and(
      gte(leads.leadScore, minScore),
      sql`${leads.latitude} BETWEEN ${latitude - latRange} AND ${latitude + latRange}`,
      sql`${leads.longitude} BETWEEN ${longitude - lonRange} AND ${longitude + lonRange}`
    ))
    .limit(100);

  const results = nearbyLeads
    .filter(l => !recentLeadIds.has(l.id) && !actionedLeadIds.has(l.id))
    .map(l => ({
      ...l,
      distanceMiles: Math.round(haversineDistance(latitude, longitude, l.latitude, l.longitude) * 100) / 100,
    }))
    .filter(l => l.distanceMiles <= radiusMiles)
    .sort((a, b) => {
      const scoreWeight = (b.leadScore - a.leadScore) * 2;
      const distWeight = (a.distanceMiles - b.distanceMiles) * 10;
      return scoreWeight + distWeight;
    })
    .slice(0, 10);

  for (const lead of results) {
    await db.insert(chaseAlertHistory).values({
      userId,
      leadId: lead.id,
      triggerType: "proximity",
      distanceMiles: lead.distanceMiles,
      leadScore: lead.leadScore,
    });
  }

  return results;
}

export async function updateLocation(
  userId: string,
  latitude: number,
  longitude: number,
  speedMph?: number,
  heading?: number
): Promise<void> {
  const existing = await db.select()
    .from(chaseSessions)
    .where(eq(chaseSessions.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(chaseSessions)
      .set({
        latitude,
        longitude,
        speedMph: speedMph ?? null,
        heading: heading ?? null,
        lastUpdatedAt: new Date(),
      })
      .where(eq(chaseSessions.userId, userId));
  } else {
    await db.insert(chaseSessions).values({
      userId,
      latitude,
      longitude,
      speedMph,
      heading,
    });
  }
}

export async function registerDevice(
  userId: string,
  pushToken: string,
  platform: string
): Promise<void> {
  const existing = await db.select()
    .from(pushDevices)
    .where(and(
      eq(pushDevices.userId, userId),
      eq(pushDevices.pushToken, pushToken)
    ))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(pushDevices).values({ userId, pushToken, platform });
  }
}

export async function getQueue(
  userId: string,
  latitude?: number,
  longitude?: number
): Promise<any> {
  let session;
  if (!latitude || !longitude) {
    const sessions = await db.select()
      .from(chaseSessions)
      .where(eq(chaseSessions.userId, userId))
      .limit(1);
    session = sessions[0];
  }

  const lat = latitude || session?.latitude || 32.78;
  const lon = longitude || session?.longitude || -96.80;
  const minScore = session?.minScore || 50;
  const radius = session?.alertRadius || 5;

  const actionedIds = new Set(
    (await db.select({ leadId: chaseActions.leadId })
      .from(chaseActions)
      .where(eq(chaseActions.userId, userId)))
      .map(a => a.leadId)
  );

  const latRange = radius / 69;
  const lonRange = radius / (69 * Math.cos(lat * Math.PI / 180));

  const nearbyLeads = await db.select({
    id: leads.id,
    address: leads.address,
    city: leads.city,
    latitude: leads.latitude,
    longitude: leads.longitude,
    leadScore: leads.leadScore,
    ownerName: leads.ownerName,
    ownerPhone: leads.ownerPhone,
    contactPhone: leads.contactPhone,
    contactName: leads.contactName,
    estimatedRoofArea: leads.estimatedRoofArea,
    yearBuilt: leads.yearBuilt,
    totalValue: leads.totalValue,
    hailEvents: leads.hailEvents,
    lastHailDate: leads.lastHailDate,
    lastHailSize: leads.lastHailSize,
    roofType: leads.roofType,
    county: leads.county,
  })
    .from(leads)
    .where(and(
      gte(leads.leadScore, minScore),
      sql`${leads.latitude} BETWEEN ${lat - latRange} AND ${lat + latRange}`,
      sql`${leads.longitude} BETWEEN ${lon - lonRange} AND ${lon + lonRange}`
    ))
    .limit(200);

  const queue = nearbyLeads
    .filter(l => !actionedIds.has(l.id))
    .map(l => {
      const dist = haversineDistance(lat, lon, l.latitude, l.longitude);
      return {
        ...l,
        distanceMiles: Math.round(dist * 100) / 100,
        estimatedDriveMin: Math.round(dist / 30 * 60),
      };
    })
    .filter(l => l.distanceMiles <= radius)
    .sort((a, b) => {
      const scoreWeight = (b.leadScore - a.leadScore) * 2;
      const distWeight = (a.distanceMiles - b.distanceMiles) * 10;
      return scoreWeight + distWeight;
    })
    .slice(0, 25);

  const totalDriveMin = queue.reduce((sum, l) => sum + l.estimatedDriveMin, 0);
  const totalValue = queue.reduce((sum, l) => sum + (l.totalValue || 0), 0);

  return {
    leads: queue,
    summary: {
      count: queue.length,
      totalDriveMin,
      totalDriveHours: Math.round(totalDriveMin / 60 * 10) / 10,
      totalPropertyValue: totalValue,
    },
  };
}

export async function recordAction(
  userId: string,
  leadId: string,
  action: string,
  latitude?: number,
  longitude?: number,
  notes?: string
): Promise<void> {
  await db.insert(chaseActions).values({
    userId,
    leadId,
    action,
    latitude,
    longitude,
    notes,
  });
}

export async function getLeadSummary(leadId: string): Promise<any> {
  const rows = await db.select({
    id: leads.id,
    address: leads.address,
    city: leads.city,
    county: leads.county,
    state: leads.state,
    zipCode: leads.zipCode,
    latitude: leads.latitude,
    longitude: leads.longitude,
    sqft: leads.sqft,
    yearBuilt: leads.yearBuilt,
    leadScore: leads.leadScore,
    ownerName: leads.ownerName,
    ownerType: leads.ownerType,
    ownerPhone: leads.ownerPhone,
    contactName: leads.contactName,
    contactPhone: leads.contactPhone,
    contactEmail: leads.contactEmail,
    estimatedRoofArea: leads.estimatedRoofArea,
    roofType: leads.roofType,
    roofLastReplaced: leads.roofLastReplaced,
    totalValue: leads.totalValue,
    hailEvents: leads.hailEvents,
    lastHailDate: leads.lastHailDate,
    lastHailSize: leads.lastHailSize,
    claimWindowOpen: leads.claimWindowOpen,
    status: leads.status,
    ownershipStructure: leads.ownershipStructure,
    decisionMakers: leads.decisionMakers,
  })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (rows.length === 0) return null;

  const lead = rows[0];
  const roofAge = lead.roofLastReplaced
    ? new Date().getFullYear() - lead.roofLastReplaced
    : lead.yearBuilt
      ? new Date().getFullYear() - lead.yearBuilt
      : null;

  return {
    ...lead,
    roofAge,
    phone: lead.contactPhone || lead.ownerPhone || null,
    primaryContact: lead.contactName || lead.ownerName,
  };
}
