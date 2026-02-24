import { db } from "./storage";
import { apiUsageTracker } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const SERVICE_NAME = "google_places";
const MONTHLY_BUDGET_ESTIMATE = 11765;

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getOrCreateUsageRow() {
  const month = getCurrentMonth();
  const existing = await db
    .select()
    .from(apiUsageTracker)
    .where(and(eq(apiUsageTracker.service, SERVICE_NAME), eq(apiUsageTracker.month, month)));

  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(apiUsageTracker)
    .values({ service: SERVICE_NAME, month, usedCount: 0, monthlyLimit: MONTHLY_BUDGET_ESTIMATE })
    .returning();
  return row;
}

async function incrementUsage(count: number = 1) {
  const month = getCurrentMonth();
  await db
    .update(apiUsageTracker)
    .set({ usedCount: sql`${apiUsageTracker.usedCount} + ${count}`, lastUsedAt: new Date() })
    .where(and(eq(apiUsageTracker.service, SERVICE_NAME), eq(apiUsageTracker.month, month)));
}

export async function getGooglePlacesUsage() {
  const row = await getOrCreateUsageRow();
  const estimatedCost = row.usedCount * 0.017;
  return {
    service: "Google Places",
    used: row.usedCount,
    limit: row.monthlyLimit,
    remaining: Math.max(0, row.monthlyLimit - row.usedCount),
    month: row.month,
    lastUsedAt: row.lastUsedAt,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    freeCreditRemaining: Math.max(0, Math.round((200 - estimatedCost) * 100) / 100),
  };
}

export async function trackGooglePlacesCall(
  endpoint: string,
  caller: string,
  fetchFn: () => Promise<Response>
): Promise<Response> {
  await getOrCreateUsageRow();
  const response = await fetchFn();
  await incrementUsage();
  console.log(`[Google Places Tracker] ${caller} → ${endpoint} (tracked)`);
  return response;
}

export async function trackedGooglePlacesFetch(
  url: string,
  caller: string,
  fetchImpl: (url: string) => Promise<Response | null> = (u) => fetch(u)
): Promise<Response | null> {
  await getOrCreateUsageRow();

  let endpoint = "unknown";
  if (url.includes("/findplacefromtext/")) endpoint = "findplacefromtext";
  else if (url.includes("/textsearch/")) endpoint = "textsearch";
  else if (url.includes("/nearbysearch/")) endpoint = "nearbysearch";
  else if (url.includes("/details/")) endpoint = "details";

  const response = await fetchImpl(url);
  if (response) {
    await incrementUsage();
    console.log(`[Google Places Tracker] ${caller} → ${endpoint} (tracked)`);
  }
  return response;
}
