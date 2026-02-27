import { db } from "./storage";
import { leads, enrichmentDecisions, enrichmentBudgets, contactEvidence } from "@shared/schema";
import { eq, and, gte, inArray, desc, sql } from "drizzle-orm";
import type { Lead, EnrichmentBudget } from "@shared/schema";
import { canRetrace } from "./skip-trace-ttl";

async function getPhoneLineType(leadId: string): Promise<string | null> {
  const rows = await db
    .select({ phoneLineType: contactEvidence.phoneLineType })
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, leadId),
        eq(contactEvidence.contactType, "PHONE"),
        eq(contactEvidence.isActive, true)
      )
    )
    .limit(1);
  return rows[0]?.phoneLineType || null;
}

let batchProgress = { processed: 0, total: 0, running: false };

const DEFAULTS: Partial<EnrichmentBudget> = {
  hailSeasonMultiplier: 1.8,
  minRoiThreshold: 8.0,
  avgDealSize: 28500,
  baseCloseRate: 0.09,
  dailyBudgetUsd: 500,
  monthlyBudgetUsd: 12000,
  spentTodayUsd: 0,
  spentThisMonthUsd: 0,
};

export async function getMarketConfig(marketId: string): Promise<EnrichmentBudget> {
  const config = await db.select().from(enrichmentBudgets).where(eq(enrichmentBudgets.marketId, marketId)).limit(1);
  if (config.length > 0) return config[0];
  return DEFAULTS as EnrichmentBudget;
}

interface RoiDecision {
  decisionType: string;
  roiScore: number;
  expectedValue: number;
  cost: number;
  recommendedApis: string[];
  reason: string;
  confidence: number;
}

export async function processOneLead(lead: Lead, marketConfig: EnrichmentBudget): Promise<RoiDecision> {
  const now = new Date();
  const isHailSeason = now.getMonth() >= 2 && now.getMonth() <= 5;
  const daysSinceHail = lead.lastHailDate
    ? Math.floor((now.getTime() - new Date(lead.lastHailDate).getTime()) / 86400000)
    : 999;

  const ttlCheck = await canRetrace(lead.id);
  if (!ttlCheck.allowed) {
    return { decisionType: "skip", roiScore: 0, expectedValue: 0, cost: 0, recommendedApis: [], reason: `TTL cooldown active until ${ttlCheck.expiresAt?.toISOString()?.split('T')[0] || 'unknown'} (provider: ${ttlCheck.provider || 'unknown'})`, confidence: 95 };
  }

  if (lead.dncRegistered) {
    return { decisionType: "skip", roiScore: 0, expectedValue: 0, cost: 0, recommendedApis: [], reason: "DNC registered", confidence: 95 };
  }
  const structure = (lead.ownershipStructure || "").toLowerCase();
  if (["government", "reit", "nonprofit"].includes(structure)) {
    return { decisionType: "skip", roiScore: 0, expectedValue: 0, cost: 0, recommendedApis: [], reason: `Non-target owner: ${structure}`, confidence: 95 };
  }

  const phoneLineType = await getPhoneLineType(lead.id);
  const phoneLineTypeBonus = (() => {
    if (!lead.ownerPhone && !lead.contactPhone && !lead.managingMemberPhone) return 0;
    const lt = (phoneLineType || "").toLowerCase();
    if (lt === "mobile") return 2;
    if (lt === "landline") return 1;
    if (lt === "voip") return 1;
    if (lt === "" || lt === "unknown" || !phoneLineType) return 1;
    return 0;
  })();

  const baseContactability =
    (lead.ownerPhone ? 1 : 0) +
    (lead.ownerEmail ? 1 : 0) +
    (lead.contactName ? 1 : 0) +
    (lead.managingMemberPhone ? 1 : 0);

  const contactability = baseContactability + (phoneLineTypeBonus > 1 ? 1 : 0);

  if (contactability >= 3 && (lead.intelligenceScore || 0) > 92) {
    return { decisionType: "free_only", roiScore: 0, expectedValue: 0, cost: 0, recommendedApis: [], reason: "High intelligence + full contacts", confidence: 90 };
  }

  const hailFactor = Math.min(
    3.2,
    (lead.hailEvents || 0) * 0.35 +
    (lead.claimWindowOpen ? 2.2 : 0) +
    (daysSinceHail < 14 ? 2.8 : 0)
  );

  const missingHighValue = [
    !lead.ownerPhone,
    !lead.contactEmail,
    !lead.managingMemberPhone,
    (lead.hailEvents || 0) < 3 && !lead.roofLastReplaced,
  ].filter(Boolean).length;
  const uplift = Math.min(0.45, missingHighValue * 0.12);

  const invalidPhonePenalty = phoneLineTypeBonus === 0 && (lead.ownerPhone || lead.contactPhone || lead.managingMemberPhone) ? 0.5 : 1.0;
  const contactMultiplier = (contactability >= 3 ? 1.0 : contactability === 2 ? 0.75 : 0.4) * invalidPhonePenalty;
  const marketFactor = 1 + ((lead.hailEvents || 0) / 20) + (lead.isFloodHighRisk ? 0.3 : 0);
  const seasonal = isHailSeason ? (marketConfig.hailSeasonMultiplier || 1.8) : 1.0;

  const ev =
    (lead.leadScore || 40) *
    contactMultiplier *
    marketFactor *
    seasonal *
    (1 + uplift) *
    hailFactor *
    (marketConfig.avgDealSize || 28500) *
    (marketConfig.baseCloseRate || 0.09);

  let tier = "skip";
  let cost = 0;
  let recommendedApis: string[] = [];
  let reason = "";

  if (ev < 800) {
    tier = "skip";
    reason = "EV too low";
  } else if (ev < 2500) {
    tier = "tier1";
    cost = 0.18;
    recommendedApis = ["google_places_phone"];
    reason = "Cheap phone append";
  } else if (ev < 6500) {
    tier = "tier2";
    cost = 0.45;
    recommendedApis = ["batchdata_phone", "hunter_email"];
    reason = "Strong hail signals";
  } else if (ev < 12000) {
    tier = "tier3";
    cost = 0.95;
    recommendedApis = ["pdl_full", "batchdata_skip"];
    reason = "High-value target";
  } else {
    tier = "premium";
    cost = 2.50;
    recommendedApis = ["lexisnexis_full"];
    reason = "Portfolio + fresh hail";
  }

  const roiScore = cost > 0 ? ev / cost : 0;
  const minThreshold = marketConfig.minRoiThreshold || 8.0;
  const finalDecision = roiScore >= minThreshold && cost <= 1.25 ? tier : tier === "skip" ? "skip" : "skip";
  const actualTier = roiScore >= minThreshold ? tier : "skip";
  const actualCost = actualTier === "skip" ? 0 : cost;
  const actualApis = actualTier === "skip" ? [] : recommendedApis;
  const actualReason = roiScore < minThreshold && tier !== "skip" ? `ROI ${roiScore.toFixed(1)}x below ${minThreshold}x threshold` : reason;

  const confidence = Math.round(Math.min(
    95,
    55 + (lead.leadScore || 0) / 2 + contactability * 8 + hailFactor * 6
  ));

  const dailyRemaining = (marketConfig.dailyBudgetUsd || 500) - (marketConfig.spentTodayUsd || 0);
  const monthlyRemaining = (marketConfig.monthlyBudgetUsd || 12000) - (marketConfig.spentThisMonthUsd || 0);
  if (actualTier !== "skip" && (actualCost > dailyRemaining || actualCost > monthlyRemaining)) {
    const reason = actualCost > dailyRemaining ? "Daily budget exhausted" : "Monthly budget exhausted";
    return { decisionType: "skip", roiScore: 0, expectedValue: ev, cost: 0, recommendedApis: [], reason, confidence };
  }

  await db.insert(enrichmentDecisions).values({
    leadId: lead.id,
    marketId: lead.marketId || "dfw",
    decisionType: actualTier,
    roiScore,
    expectedValue: ev,
    enrichmentCost: actualCost,
    recommendedApis: actualApis,
    confidence,
    reasonSummary: actualReason,
  });

  if (actualCost > 0) {
    await db
      .update(enrichmentBudgets)
      .set({ spentTodayUsd: sql`${enrichmentBudgets.spentTodayUsd} + ${actualCost}` })
      .where(eq(enrichmentBudgets.marketId, lead.marketId || "dfw"));
  }

  return { decisionType: actualTier, roiScore, expectedValue: ev, cost: actualCost, recommendedApis: actualApis, reason: actualReason, confidence };
}

export async function runBatch(marketId?: string, filterLeadIds?: string[], zipCode?: string) {
  batchProgress = { processed: 0, total: 0, running: true };

  const mId = marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
  const marketConfig = await getMarketConfig(mId);

  const conditions = [gte(leads.leadScore, 40)];
  if (marketId) conditions.push(eq(leads.marketId, marketId));
  if (filterLeadIds && filterLeadIds.length > 0) conditions.push(inArray(leads.id, filterLeadIds));
  if (zipCode) conditions.push(eq(leads.zipCode, zipCode));

  const batchLeads = await db
    .select()
    .from(leads)
    .where(and(...conditions))
    .orderBy(desc(leads.leadScore));

  batchProgress.total = batchLeads.length;

  const tierCounts: Record<string, number> = {};
  let totalCost = 0;
  let totalEv = 0;

  for (let i = 0; i < batchLeads.length; i += 100) {
    const chunk = batchLeads.slice(i, i + 100);
    const results = await Promise.all(
      chunk.map(async (lead) => {
        const d = await processOneLead(lead, marketConfig);
        batchProgress.processed++;
        return d;
      })
    );

    for (const d of results) {
      tierCounts[d.decisionType] = (tierCounts[d.decisionType] || 0) + 1;
      totalCost += d.cost;
      totalEv += d.expectedValue;
    }

    if (i + 100 < batchLeads.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  batchProgress.running = false;

  return {
    processed: batchProgress.processed,
    tierCounts,
    totalCost: Math.round(totalCost * 100) / 100,
    totalEv: Math.round(totalEv),
    avgRoi: totalCost > 0 ? Math.round(totalEv / totalCost) : 0,
  };
}

export function getBatchProgress() {
  return batchProgress;
}

export async function getEnrichmentStats(marketId?: string) {
  const mId = marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
  const stats = await db
    .select({
      tier: enrichmentDecisions.decisionType,
      count: sql<number>`count(*)::int`,
      totalEv: sql<number>`coalesce(sum(${enrichmentDecisions.expectedValue}), 0)`,
      totalCost: sql<number>`coalesce(sum(${enrichmentDecisions.enrichmentCost}), 0)`,
      avgRoi: sql<number>`coalesce(avg(${enrichmentDecisions.roiScore}), 0)`,
    })
    .from(enrichmentDecisions)
    .where(marketId ? eq(enrichmentDecisions.marketId, marketId) : undefined)
    .groupBy(enrichmentDecisions.decisionType);

  const budget = await getMarketConfig(mId);
  return {
    stats,
    budget: {
      dailyBudgetUsd: budget.dailyBudgetUsd,
      monthlyBudgetUsd: budget.monthlyBudgetUsd,
      spentTodayUsd: budget.spentTodayUsd,
      spentThisMonthUsd: budget.spentThisMonthUsd,
      dailyRemaining: (budget.dailyBudgetUsd || 500) - (budget.spentTodayUsd || 0),
    },
  };
}

export async function getSingleLeadDecision(leadId: string) {
  const decisions = await db
    .select()
    .from(enrichmentDecisions)
    .where(eq(enrichmentDecisions.leadId, leadId))
    .orderBy(desc(enrichmentDecisions.createdAt))
    .limit(1);
  return decisions[0] || null;
}
