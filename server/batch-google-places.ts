import { db } from "./storage";
import { leads } from "@shared/schema";
import { sql, isNull, and, desc } from "drizzle-orm";
import { trackedGooglePlacesFetch } from "./google-places-tracker";
import { recordEvidence } from "./evidence-recorder";
import { isValidPhoneStructure, normalizePhoneE164 } from "./contact-validation";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DELAY_MS = 200;

interface BatchStatus {
  running: boolean;
  total: number;
  processed: number;
  found: number;
  skipped: number;
  errors: number;
  apiCalls: number;
  estimatedCost: number;
  startedAt: string | null;
  completedAt: string | null;
  currentAddress: string | null;
  recentFinds: Array<{ address: string; phone: string }>;
}

let batchStatus: BatchStatus = {
  running: false,
  total: 0,
  processed: 0,
  found: 0,
  skipped: 0,
  errors: 0,
  apiCalls: 0,
  estimatedCost: 0,
  startedAt: null,
  completedAt: null,
  currentAddress: null,
  recentFinds: [],
};

export function getBatchGooglePlacesStatus(): BatchStatus {
  return { ...batchStatus };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchAndGetPhone(
  query: string
): Promise<{ phone: string | null; name: string | null; apiCalls: number }> {
  if (!API_KEY) return { phone: null, name: null, apiCalls: 0 };

  let apiCalls = 0;

  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
  const searchResp = await trackedGooglePlacesFetch(searchUrl, "batch-google-places");
  apiCalls++;

  if (!searchResp || !searchResp.ok) return { phone: null, name: null, apiCalls };

  let searchData: any;
  try {
    searchData = await searchResp.json();
  } catch {
    return { phone: null, name: null, apiCalls };
  }
  if (searchData.status === "REQUEST_DENIED" || searchData.status === "OVER_QUERY_LIMIT") {
    console.log(`[Batch Google Places] API error: ${searchData.status} - ${searchData.error_message || ""}`);
    return { phone: null, name: null, apiCalls };
  }
  if (!searchData.results || searchData.results.length === 0) {
    return { phone: null, name: null, apiCalls };
  }

  for (const place of searchData.results.slice(0, 3)) {
    const placeId = place.place_id;
    if (!placeId) continue;

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,name,business_status&key=${API_KEY}`;
    const detailsResp = await trackedGooglePlacesFetch(detailsUrl, "batch-google-places");
    apiCalls++;

    if (!detailsResp || !detailsResp.ok) continue;

    let detailsData: any;
    try {
      detailsData = await detailsResp.json();
    } catch {
      continue;
    }
    const result = detailsData.result;
    if (!result || !result.formatted_phone_number) continue;

    if (result.business_status && result.business_status !== "OPERATIONAL") continue;

    const phone = result.formatted_phone_number;
    const validation = isValidPhoneStructure(phone);
    if (!validation.valid) continue;

    return { phone, name: result.name, apiCalls };
  }

  return { phone: null, name: null, apiCalls };
}

async function findPlacePhone(
  address: string,
  city: string,
  ownerName: string | null
): Promise<{ phone: string | null; name: string | null; apiCalls: number }> {
  if (!API_KEY) return { phone: null, name: null, apiCalls: 0 };

  let totalApiCalls = 0;

  const addressQuery = `${address}, ${city}, TX`;
  const result1 = await searchAndGetPhone(addressQuery);
  totalApiCalls += result1.apiCalls;
  if (result1.phone) return { ...result1, apiCalls: totalApiCalls };

  if (ownerName && ownerName.length > 3) {
    const cleanOwner = ownerName.replace(/\s+(LLC|LP|INC|CORP|LTD|L\.?L\.?C\.?|L\.?P\.?)\.?\s*$/i, "").trim();
    if (cleanOwner.length > 3) {
      const ownerQuery = `${cleanOwner} ${city} TX`;
      const result2 = await searchAndGetPhone(ownerQuery);
      totalApiCalls += result2.apiCalls;
      if (result2.phone) return { ...result2, apiCalls: totalApiCalls };
    }
  }

  return { phone: null, name: null, apiCalls: totalApiCalls };
}

export async function runBatchGooglePlaces(limit: number = 1000): Promise<BatchStatus> {
  if (batchStatus.running) {
    console.log("[Batch Google Places] Already running, skipping");
    return batchStatus;
  }

  if (!API_KEY) {
    console.log("[Batch Google Places] No GOOGLE_PLACES_API_KEY configured");
    batchStatus.running = false;
    return batchStatus;
  }

  batchStatus = {
    running: true,
    total: 0,
    processed: 0,
    found: 0,
    skipped: 0,
    errors: 0,
    apiCalls: 0,
    estimatedCost: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentAddress: null,
    recentFinds: [],
  };

  try {
    const candidates = await db
      .select({
        id: leads.id,
        address: leads.address,
        city: leads.city,
        leadScore: leads.leadScore,
        ownerName: leads.ownerName,
      })
      .from(leads)
      .where(
        and(
          isNull(leads.ownerPhone),
          isNull(leads.contactPhone),
          isNull(leads.managingMemberPhone)
        )
      )
      .orderBy(desc(leads.leadScore))
      .limit(limit);

    batchStatus.total = candidates.length;
    console.log(`[Batch Google Places] Starting batch for ${candidates.length} leads (requested ${limit})`);

    for (const lead of candidates) {
      if (!batchStatus.running) {
        console.log("[Batch Google Places] Batch cancelled");
        break;
      }

      batchStatus.currentAddress = lead.address || "Unknown";
      batchStatus.processed++;

      try {
        const address = lead.address || "";
        const city = lead.city || "Dallas";

        if (!address || address.length < 5) {
          batchStatus.skipped++;
          continue;
        }

        const result = await findPlacePhone(address, city, lead.ownerName);
        batchStatus.apiCalls += result.apiCalls;
        batchStatus.estimatedCost = Math.round(batchStatus.apiCalls * 0.017 * 100) / 100;

        if (result.phone) {
          const normalized = normalizePhoneE164(result.phone);
          if (!normalized) {
            batchStatus.skipped++;
            continue;
          }

          await db
            .update(leads)
            .set({ contactPhone: normalized })
            .where(sql`id = ${lead.id}`);

          await recordEvidence({
            leadId: lead.id,
            contactType: "PHONE",
            contactValue: normalized,
            sourceName: "Google Places",
            sourceType: "BUSINESS_LISTING",
            extractorMethod: "BATCH_GOOGLE_PLACES",
            confidence: 75,
            rawSnippet: `Business phone for ${result.name || address} at ${address}, ${city}`,
          });

          batchStatus.found++;
          batchStatus.recentFinds = [
            { address: address, phone: result.phone },
            ...batchStatus.recentFinds.slice(0, 9),
          ];

          if (batchStatus.found % 10 === 0) {
            console.log(
              `[Batch Google Places] Progress: ${batchStatus.processed}/${batchStatus.total} processed, ${batchStatus.found} phones found, ${batchStatus.apiCalls} API calls ($${batchStatus.estimatedCost})`
            );
          }
        } else {
          batchStatus.skipped++;
        }

        await sleep(DELAY_MS);
      } catch (err: any) {
        batchStatus.errors++;
        console.error(`[Batch Google Places] Error for ${lead.address}: ${err.message}`);
        await sleep(500);
      }
    }
  } catch (err: any) {
    console.error(`[Batch Google Places] Fatal error: ${err.message}`);
    batchStatus.errors++;
  } finally {
    batchStatus.running = false;
    batchStatus.completedAt = new Date().toISOString();
    batchStatus.currentAddress = null;
    console.log(
      `[Batch Google Places] Complete: ${batchStatus.found} phones found out of ${batchStatus.total} leads. ${batchStatus.apiCalls} API calls ($${batchStatus.estimatedCost})`
    );
  }

  return batchStatus;
}

export function cancelBatchGooglePlaces(): void {
  if (batchStatus.running) {
    batchStatus.running = false;
    console.log("[Batch Google Places] Cancellation requested");
  }
}
