import { storage } from "./storage";
import { calculateScore } from "./seed";

const HAIL_RADIUS_MILES = 5;
const MILES_TO_DEGREES_LAT = 1 / 69;
const MILES_TO_DEGREES_LNG = 1 / 54.6;

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface CorrelationResult {
  leadsUpdated: number;
  leadsProcessed: number;
  totalHailEvents: number;
}

export async function correlateHailToLeads(
  marketId?: string,
  radiusMiles: number = HAIL_RADIUS_MILES
): Promise<CorrelationResult> {
  console.log(`[Hail Correlator] Starting proximity matching (radius: ${radiusMiles} miles)...`);

  const allHailEvents = await storage.getHailEvents(marketId);
  const allLeads = await storage.getLeads(marketId ? { marketId } : {});

  console.log(`[Hail Correlator] Processing ${allLeads.length} leads against ${allHailEvents.length} hail events`);

  let leadsUpdated = 0;

  for (const lead of allLeads) {
    const lat = typeof lead.latitude === "string" ? parseFloat(lead.latitude) : (lead.latitude ?? 0);
    const lng = typeof lead.longitude === "string" ? parseFloat(lead.longitude) : (lead.longitude ?? 0);

    if (!lat || !lng) continue;

    const nearbyEvents = allHailEvents.filter((event) => {
      const eLat = typeof event.latitude === "string" ? parseFloat(event.latitude) : (event.latitude ?? 0);
      const eLng = typeof event.longitude === "string" ? parseFloat(event.longitude) : (event.longitude ?? 0);

      const latDiff = Math.abs(lat - eLat);
      const lngDiff = Math.abs(lng - eLng);
      if (latDiff > radiusMiles * MILES_TO_DEGREES_LAT || lngDiff > radiusMiles * MILES_TO_DEGREES_LNG) {
        return false;
      }

      const distance = haversineDistance(lat, lng, eLat, eLng);
      return distance <= radiusMiles;
    });

    if (nearbyEvents.length === 0 && (lead.hailEvents || 0) === 0) continue;

    const sortedEvents = nearbyEvents.sort((a, b) => {
      const dateA = a.eventDate ? new Date(a.eventDate).getTime() : 0;
      const dateB = b.eventDate ? new Date(b.eventDate).getTime() : 0;
      return dateB - dateA;
    });

    const lastEvent = sortedEvents[0];
    const maxHailSize = nearbyEvents.reduce((max, e) => {
      const size = typeof e.hailSize === "string" ? parseFloat(e.hailSize) : (e.hailSize ?? 0);
      return Math.max(max, size);
    }, 0);

    const newHailEvents = nearbyEvents.length;
    const newLastHailDate = lastEvent?.eventDate || null;
    const newLastHailSize = maxHailSize || null;

    const currentHailEvents = lead.hailEvents || 0;
    if (
      currentHailEvents === newHailEvents &&
      lead.lastHailDate === newLastHailDate
    ) {
      continue;
    }

    const updatedLead = {
      ...lead,
      hailEvents: newHailEvents,
      lastHailDate: newLastHailDate,
      lastHailSize: newLastHailSize,
    };

    const newScore = calculateScore(updatedLead);

    await storage.updateLead(lead.id, {
      hailEvents: newHailEvents,
      lastHailDate: newLastHailDate,
      lastHailSize: newLastHailSize,
      leadScore: newScore,
    });

    leadsUpdated++;
  }

  console.log(`[Hail Correlator] Complete: ${leadsUpdated} leads updated out of ${allLeads.length}`);

  return {
    leadsUpdated,
    leadsProcessed: allLeads.length,
    totalHailEvents: allHailEvents.length,
  };
}
