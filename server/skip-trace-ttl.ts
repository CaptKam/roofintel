import { db } from "./storage";
import { skipTraceLog, leads } from "@shared/schema";
import { eq, and, gte, desc, sql, lte } from "drizzle-orm";

export async function logTrace(
  leadId: string,
  provider: string,
  cost: number,
  fieldsReturned: string[],
  matchQuality: string,
  cooldownDays: number = 180
): Promise<void> {
  const tracedAt = new Date();
  const expiresAt = new Date(tracedAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);

  await db.insert(skipTraceLog).values({
    leadId,
    provider,
    cost,
    fieldsReturned,
    matchQuality,
    tracedAt,
    expiresAt,
    cooldownDays,
  });
}

export async function canRetrace(
  leadId: string,
  provider?: string
): Promise<{ allowed: boolean; lastTraced: Date | null; expiresAt: Date | null; provider: string | null }> {
  const now = new Date();

  const conditions = [
    eq(skipTraceLog.leadId, leadId),
    gte(skipTraceLog.expiresAt, now),
  ];
  if (provider) {
    conditions.push(eq(skipTraceLog.provider, provider));
  }

  const entries = await db
    .select()
    .from(skipTraceLog)
    .where(and(...conditions))
    .orderBy(desc(skipTraceLog.tracedAt))
    .limit(1);

  if (entries.length === 0) {
    return { allowed: true, lastTraced: null, expiresAt: null, provider: null };
  }

  const entry = entries[0];
  return {
    allowed: false,
    lastTraced: entry.tracedAt,
    expiresAt: entry.expiresAt,
    provider: entry.provider,
  };
}

export async function getTraceHistory(leadId: string) {
  return db
    .select()
    .from(skipTraceLog)
    .where(eq(skipTraceLog.leadId, leadId))
    .orderBy(desc(skipTraceLog.tracedAt));
}

interface ProviderPricing {
  name: string;
  costPerLookup: number;
  batchDiscount?: number;
  batchThreshold?: number;
  expectedMatchRate: number;
}

const DEFAULT_PROVIDERS: ProviderPricing[] = [
  { name: "google_places", costPerLookup: 0.017, expectedMatchRate: 0.35 },
  { name: "hunter", costPerLookup: 0.03, expectedMatchRate: 0.25, batchDiscount: 0.15, batchThreshold: 100 },
  { name: "pdl", costPerLookup: 0.10, expectedMatchRate: 0.55, batchDiscount: 0.20, batchThreshold: 500 },
  { name: "batchdata", costPerLookup: 0.12, expectedMatchRate: 0.60, batchDiscount: 0.25, batchThreshold: 250 },
  { name: "lexisnexis", costPerLookup: 0.50, expectedMatchRate: 0.75, batchDiscount: 0.10, batchThreshold: 1000 },
  { name: "twilio_lookup", costPerLookup: 0.005, expectedMatchRate: 0.90 },
];

export function computeBatchEconomics(
  leadCount: number,
  providers?: ProviderPricing[]
): {
  strategies: Array<{
    provider: string;
    unitCost: number;
    batchCost: number;
    expectedMatches: number;
    costPerMatch: number;
    batchDiscountApplied: boolean;
  }>;
  recommendedMix: Array<{ provider: string; allocation: number; reason: string }>;
  totalEstimatedCost: number;
  totalExpectedMatches: number;
} {
  const providerList = providers || DEFAULT_PROVIDERS;

  const strategies = providerList.map((p) => {
    const batchDiscountApplied = !!(p.batchDiscount && p.batchThreshold && leadCount >= p.batchThreshold);
    const unitCost = batchDiscountApplied
      ? p.costPerLookup * (1 - (p.batchDiscount || 0))
      : p.costPerLookup;
    const batchCost = unitCost * leadCount;
    const expectedMatches = Math.round(leadCount * p.expectedMatchRate);
    const costPerMatch = expectedMatches > 0 ? batchCost / expectedMatches : Infinity;

    return {
      provider: p.name,
      unitCost: Math.round(unitCost * 1000) / 1000,
      batchCost: Math.round(batchCost * 100) / 100,
      expectedMatches,
      costPerMatch: Math.round(costPerMatch * 100) / 100,
      batchDiscountApplied,
    };
  });

  strategies.sort((a, b) => a.costPerMatch - b.costPerMatch);

  const recommendedMix: Array<{ provider: string; allocation: number; reason: string }> = [];
  let remaining = leadCount;

  const cheapProvider = strategies.find((s) => s.costPerMatch < 0.10);
  if (cheapProvider && remaining > 0) {
    const alloc = Math.min(remaining, Math.round(leadCount * 0.4));
    recommendedMix.push({
      provider: cheapProvider.provider,
      allocation: alloc,
      reason: "Lowest cost per match for initial pass",
    });
    remaining -= alloc;
  }

  const midProvider = strategies.find(
    (s) => s.costPerMatch >= 0.10 && s.costPerMatch < 0.50 && !recommendedMix.some((r) => r.provider === s.provider)
  );
  if (midProvider && remaining > 0) {
    const alloc = Math.min(remaining, Math.round(leadCount * 0.35));
    recommendedMix.push({
      provider: midProvider.provider,
      allocation: alloc,
      reason: "Good match rate at moderate cost",
    });
    remaining -= alloc;
  }

  const premiumProvider = strategies.find(
    (s) => s.expectedMatches / leadCount > 0.5 && !recommendedMix.some((r) => r.provider === s.provider)
  );
  if (premiumProvider && remaining > 0) {
    recommendedMix.push({
      provider: premiumProvider.provider,
      allocation: remaining,
      reason: "High match rate for remaining leads",
    });
  }

  const totalEstimatedCost = recommendedMix.reduce((sum, r) => {
    const strat = strategies.find((s) => s.provider === r.provider);
    return sum + (strat ? strat.unitCost * r.allocation : 0);
  }, 0);

  const totalExpectedMatches = recommendedMix.reduce((sum, r) => {
    const provider = providerList.find((p) => p.name === r.provider);
    return sum + Math.round(r.allocation * (provider?.expectedMatchRate || 0));
  }, 0);

  return {
    strategies,
    recommendedMix,
    totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
    totalExpectedMatches,
  };
}

export async function cleanExpiredTraces(): Promise<{ expiredCount: number; eligibleLeadIds: string[] }> {
  const now = new Date();

  const expired = await db
    .select({ leadId: skipTraceLog.leadId })
    .from(skipTraceLog)
    .where(lte(skipTraceLog.expiresAt, now));

  const uniqueLeadIds = Array.from(new Set(expired.map((e) => e.leadId)));

  const stillActive: string[] = [];
  for (const leadId of uniqueLeadIds) {
    const active = await db
      .select()
      .from(skipTraceLog)
      .where(and(eq(skipTraceLog.leadId, leadId), gte(skipTraceLog.expiresAt, now)))
      .limit(1);
    if (active.length === 0) {
      stillActive.push(leadId);
    }
  }

  return {
    expiredCount: expired.length,
    eligibleLeadIds: stillActive,
  };
}

export async function getTraceCostSummary(
  marketId?: string,
  days: number = 30
): Promise<
  Array<{
    provider: string;
    totalSpend: number;
    traceCount: number;
    matchCount: number;
    matchRate: number;
    avgCostPerMatch: number;
  }>
> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let query;
  if (marketId) {
    query = db
      .select({
        provider: skipTraceLog.provider,
        totalSpend: sql<number>`coalesce(sum(${skipTraceLog.cost}), 0)`,
        traceCount: sql<number>`count(*)::int`,
        matchCount: sql<number>`count(*) filter (where ${skipTraceLog.matchQuality} != 'none')::int`,
      })
      .from(skipTraceLog)
      .innerJoin(leads, eq(skipTraceLog.leadId, leads.id))
      .where(and(gte(skipTraceLog.tracedAt, since), eq(leads.marketId, marketId)))
      .groupBy(skipTraceLog.provider);
  } else {
    query = db
      .select({
        provider: skipTraceLog.provider,
        totalSpend: sql<number>`coalesce(sum(${skipTraceLog.cost}), 0)`,
        traceCount: sql<number>`count(*)::int`,
        matchCount: sql<number>`count(*) filter (where ${skipTraceLog.matchQuality} != 'none')::int`,
      })
      .from(skipTraceLog)
      .where(gte(skipTraceLog.tracedAt, since))
      .groupBy(skipTraceLog.provider);
  }

  const results = await query;

  return results.map((r) => ({
    provider: r.provider,
    totalSpend: Math.round(Number(r.totalSpend) * 100) / 100,
    traceCount: Number(r.traceCount),
    matchCount: Number(r.matchCount),
    matchRate: Number(r.traceCount) > 0 ? Math.round((Number(r.matchCount) / Number(r.traceCount)) * 100) / 100 : 0,
    avgCostPerMatch:
      Number(r.matchCount) > 0
        ? Math.round((Number(r.totalSpend) / Number(r.matchCount)) * 100) / 100
        : 0,
  }));
}
