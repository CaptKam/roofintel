import { db } from "./storage";
import { leads, leadOutcomes, enrichmentDecisions, skipTraceLog, kpiSnapshots } from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";

interface OutcomeDetails {
  appointmentDate?: Date;
  proposalValue?: number;
  closedValue?: number;
  closedDate?: Date;
  contractorId?: string;
  outcomeSource?: string;
  notes?: string;
}

export async function recordOutcome(
  leadId: string,
  status: string,
  details: OutcomeDetails = {}
): Promise<{ id: string }> {
  const [outcome] = await db
    .insert(leadOutcomes)
    .values({
      leadId,
      status,
      appointmentDate: details.appointmentDate || null,
      proposalValue: details.proposalValue || null,
      closedValue: details.closedValue || null,
      closedDate: details.closedDate || null,
      contractorId: details.contractorId || null,
      outcomeSource: details.outcomeSource || "manual",
      notes: details.notes || null,
    })
    .returning({ id: leadOutcomes.id });

  const leadStatusMap: Record<string, string> = {
    appointment_set: "contacted",
    proposal_sent: "proposal",
    closed_won: "closed",
    closed_lost: "closed",
    no_response: "new",
  };
  const newLeadStatus = leadStatusMap[status] || "new";
  await db
    .update(leads)
    .set({ status: newLeadStatus })
    .where(eq(leads.id, leadId));

  if (status === "closed_won") {
    const revenueValue = details.closedValue || details.proposalValue || 0;
    if (revenueValue > 0) {
      await db
        .update(enrichmentDecisions)
        .set({
          actualRevenue: revenueValue,
          outcomeTrackedAt: new Date(),
        })
        .where(eq(enrichmentDecisions.leadId, leadId));
    }
  }

  return { id: outcome.id };
}

export async function computeKpiSnapshot(marketId: string): Promise<any> {
  const totalLeadsResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.marketId, marketId));
  const totalLeads = totalLeadsResult[0]?.count || 0;

  const contactableResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.marketId, marketId),
        sql`(${leads.ownerPhone} IS NOT NULL OR ${leads.contactPhone} IS NOT NULL OR ${leads.ownerEmail} IS NOT NULL OR ${leads.contactEmail} IS NOT NULL)`
      )
    );
  const contactableLeads = contactableResult[0]?.count || 0;

  const enrichedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enrichmentDecisions)
    .where(eq(enrichmentDecisions.marketId, marketId));
  const enrichedCount = enrichedResult[0]?.count || 0;

  const matchRate = totalLeads > 0 ? enrichedCount / totalLeads : 0;
  const contactableRate = totalLeads > 0 ? contactableLeads / totalLeads : 0;

  const outcomeStats = await db
    .select({
      status: leadOutcomes.status,
      count: sql<number>`count(*)::int`,
      totalValue: sql<number>`coalesce(sum(${leadOutcomes.closedValue}), 0)`,
    })
    .from(leadOutcomes)
    .innerJoin(leads, eq(leadOutcomes.leadId, leads.id))
    .where(eq(leads.marketId, marketId))
    .groupBy(leadOutcomes.status);

  let appointmentsSet = 0;
  let proposalsSent = 0;
  let closedWon = 0;
  let closedLost = 0;
  let totalRevenue = 0;

  for (const row of outcomeStats) {
    switch (row.status) {
      case "appointment_set":
        appointmentsSet = row.count;
        break;
      case "proposal_sent":
        proposalsSent = row.count;
        break;
      case "closed_won":
        closedWon = row.count;
        totalRevenue = Number(row.totalValue);
        break;
      case "closed_lost":
        closedLost = row.count;
        break;
    }
  }

  const enrichmentSpendResult = await db
    .select({ total: sql<number>`coalesce(sum(${enrichmentDecisions.enrichmentCost}), 0)` })
    .from(enrichmentDecisions)
    .where(eq(enrichmentDecisions.marketId, marketId));
  const totalEnrichmentSpend = Number(enrichmentSpendResult[0]?.total || 0);

  const traceSpendResult = await db
    .select({ total: sql<number>`coalesce(sum(${skipTraceLog.cost}), 0)` })
    .from(skipTraceLog)
    .innerJoin(leads, eq(skipTraceLog.leadId, leads.id))
    .where(eq(leads.marketId, marketId));
  const totalTraceSpend = Number(traceSpendResult[0]?.total || 0);

  const totalSpend = totalEnrichmentSpend + totalTraceSpend;
  const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const costPerSale = closedWon > 0 ? totalSpend / closedWon : 0;
  const conversionRate = totalLeads > 0 ? closedWon / totalLeads : 0;
  const roi = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  const avgScoreResult = await db
    .select({ avg: sql<number>`coalesce(avg(${leads.leadScore}), 0)` })
    .from(leads)
    .where(eq(leads.marketId, marketId));
  const avgLeadScore = Number(avgScoreResult[0]?.avg || 0);

  const [snapshot] = await db
    .insert(kpiSnapshots)
    .values({
      marketId,
      snapshotDate: new Date(),
      totalLeads,
      contactableLeads,
      matchRate: Math.round(matchRate * 10000) / 10000,
      contactableRate: Math.round(contactableRate * 10000) / 10000,
      appointmentsSet,
      proposalsSent,
      closedWon,
      closedLost,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalEnrichmentSpend: Math.round(totalSpend * 100) / 100,
      costPerLead: Math.round(costPerLead * 100) / 100,
      costPerSale: Math.round(costPerSale * 100) / 100,
      conversionRate: Math.round(conversionRate * 10000) / 10000,
      roi: Math.round(roi * 100) / 100,
      avgLeadScore: Math.round(avgLeadScore * 100) / 100,
    })
    .returning();

  return snapshot;
}

export async function getKpiTimeSeries(marketId: string, days: number = 30): Promise<any[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return db
    .select()
    .from(kpiSnapshots)
    .where(
      and(
        eq(kpiSnapshots.marketId, marketId),
        gte(kpiSnapshots.snapshotDate, cutoff)
      )
    )
    .orderBy(desc(kpiSnapshots.snapshotDate));
}

export async function getConversionFunnel(marketId: string): Promise<any> {
  const stages = ["new", "contacted", "qualified", "proposal", "closed"];

  const statusCounts = await db
    .select({
      status: leads.status,
      count: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(eq(leads.marketId, marketId))
    .groupBy(leads.status);

  const countMap: Record<string, number> = {};
  for (const row of statusCounts) {
    countMap[row.status] = row.count;
  }

  const closedWonResult = await db
    .select({ count: sql<number>`count(distinct ${leadOutcomes.leadId})::int` })
    .from(leadOutcomes)
    .innerJoin(leads, eq(leadOutcomes.leadId, leads.id))
    .where(
      and(
        eq(leads.marketId, marketId),
        eq(leadOutcomes.status, "closed_won")
      )
    );
  const closedWon = closedWonResult[0]?.count || 0;

  const closedLostResult = await db
    .select({ count: sql<number>`count(distinct ${leadOutcomes.leadId})::int` })
    .from(leadOutcomes)
    .innerJoin(leads, eq(leadOutcomes.leadId, leads.id))
    .where(
      and(
        eq(leads.marketId, marketId),
        eq(leadOutcomes.status, "closed_lost")
      )
    );
  const closedLost = closedLostResult[0]?.count || 0;

  const funnel = stages.map((stage, idx) => {
    const stageCount = countMap[stage] || 0;
    return { stage, count: stageCount };
  });

  const totalLeads = funnel.reduce((sum, s) => sum + s.count, 0);

  const funnelWithRates = funnel.map((item, idx) => {
    const prevCount = idx === 0 ? totalLeads : funnel[idx - 1].count;
    const conversionFromPrev = prevCount > 0 ? item.count / prevCount : 0;
    return {
      ...item,
      conversionFromPrev: Math.round(conversionFromPrev * 10000) / 10000,
      pctOfTotal: totalLeads > 0 ? Math.round((item.count / totalLeads) * 10000) / 10000 : 0,
    };
  });

  return {
    stages: funnelWithRates,
    totalLeads,
    closedWon,
    closedLost,
    winRate: closedWon + closedLost > 0 ? Math.round((closedWon / (closedWon + closedLost)) * 10000) / 10000 : 0,
  };
}

export async function retrainWeights(marketId: string): Promise<any> {
  const wonLeads = await db
    .select({
      hailEvents: leads.hailEvents,
      leadScore: leads.leadScore,
      totalValue: leads.totalValue,
      ownershipStructure: leads.ownershipStructure,
      roofLastReplaced: leads.roofLastReplaced,
      ownerPhone: leads.ownerPhone,
      ownerEmail: leads.ownerEmail,
      contactPhone: leads.contactPhone,
      contactEmail: leads.contactEmail,
      contactName: leads.contactName,
      managingMemberPhone: leads.managingMemberPhone,
    })
    .from(leadOutcomes)
    .innerJoin(leads, eq(leadOutcomes.leadId, leads.id))
    .where(
      and(
        eq(leads.marketId, marketId),
        eq(leadOutcomes.status, "closed_won")
      )
    );

  const lostLeads = await db
    .select({
      hailEvents: leads.hailEvents,
      leadScore: leads.leadScore,
      totalValue: leads.totalValue,
      ownershipStructure: leads.ownershipStructure,
      roofLastReplaced: leads.roofLastReplaced,
      ownerPhone: leads.ownerPhone,
      ownerEmail: leads.ownerEmail,
      contactPhone: leads.contactPhone,
      contactEmail: leads.contactEmail,
      contactName: leads.contactName,
      managingMemberPhone: leads.managingMemberPhone,
    })
    .from(leadOutcomes)
    .innerJoin(leads, eq(leadOutcomes.leadId, leads.id))
    .where(
      and(
        eq(leads.marketId, marketId),
        eq(leadOutcomes.status, "closed_lost")
      )
    );

  function avgField(rows: any[], fn: (r: any) => number): number {
    if (rows.length === 0) return 0;
    return rows.reduce((sum, r) => sum + fn(r), 0) / rows.length;
  }

  function contactabilityScore(r: any): number {
    return (r.ownerPhone ? 1 : 0) + (r.ownerEmail ? 1 : 0) + (r.contactName ? 1 : 0) + (r.managingMemberPhone ? 1 : 0);
  }

  const currentYear = new Date().getFullYear();

  const attributes = {
    hailEvents: {
      wonAvg: avgField(wonLeads, (r) => r.hailEvents || 0),
      lostAvg: avgField(lostLeads, (r) => r.hailEvents || 0),
    },
    roofAge: {
      wonAvg: avgField(wonLeads, (r) => r.roofLastReplaced ? currentYear - r.roofLastReplaced : 15),
      lostAvg: avgField(lostLeads, (r) => r.roofLastReplaced ? currentYear - r.roofLastReplaced : 15),
    },
    contactability: {
      wonAvg: avgField(wonLeads, contactabilityScore),
      lostAvg: avgField(lostLeads, contactabilityScore),
    },
    totalValue: {
      wonAvg: avgField(wonLeads, (r) => r.totalValue || 0),
      lostAvg: avgField(lostLeads, (r) => r.totalValue || 0),
    },
    ownershipStructure: {
      wonBreakdown: breakdownField(wonLeads, (r) => r.ownershipStructure || "unknown"),
      lostBreakdown: breakdownField(lostLeads, (r) => r.ownershipStructure || "unknown"),
    },
  };

  const recommendations: Record<string, any> = {};

  for (const [attr, vals] of Object.entries(attributes)) {
    if ("wonAvg" in vals && "lostAvg" in vals) {
      const diff = vals.wonAvg - vals.lostAvg;
      const baseline = Math.max(vals.wonAvg, vals.lostAvg, 1);
      const impact = diff / baseline;

      let suggestion = "no_change";
      let multiplier = 1.0;

      if (impact > 0.15) {
        suggestion = "increase_weight";
        multiplier = 1.0 + Math.min(impact, 0.5);
      } else if (impact < -0.15) {
        suggestion = "decrease_weight";
        multiplier = 1.0 + Math.max(impact, -0.5);
      }

      recommendations[attr] = {
        wonAvg: Math.round(vals.wonAvg * 100) / 100,
        lostAvg: Math.round(vals.lostAvg * 100) / 100,
        impact: Math.round(impact * 1000) / 1000,
        suggestion,
        recommendedMultiplier: Math.round(multiplier * 100) / 100,
      };
    }
  }

  if ("ownershipStructure" in attributes) {
    recommendations.ownershipStructure = {
      wonBreakdown: (attributes.ownershipStructure as any).wonBreakdown,
      lostBreakdown: (attributes.ownershipStructure as any).lostBreakdown,
      suggestion: "review_manually",
    };
  }

  return {
    marketId,
    sampleSize: { won: wonLeads.length, lost: lostLeads.length },
    recommendations,
    generatedAt: new Date().toISOString(),
    note: wonLeads.length + lostLeads.length < 20
      ? "WARNING: Small sample size. Recommendations may not be statistically significant."
      : "Sufficient sample size for directional guidance.",
  };
}

function breakdownField(rows: any[], fn: (r: any) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const val = fn(r);
    counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

export async function getOutcomesForLead(leadId: string): Promise<any[]> {
  return db
    .select()
    .from(leadOutcomes)
    .where(eq(leadOutcomes.leadId, leadId))
    .orderBy(desc(leadOutcomes.createdAt));
}

export async function updateOutcome(
  outcomeId: string,
  updates: Partial<OutcomeDetails & { status?: string }>
): Promise<any> {
  const setValues: any = { updatedAt: new Date() };
  if (updates.status) setValues.status = updates.status;
  if (updates.appointmentDate) setValues.appointmentDate = updates.appointmentDate;
  if (updates.proposalValue !== undefined) setValues.proposalValue = updates.proposalValue;
  if (updates.closedValue !== undefined) setValues.closedValue = updates.closedValue;
  if (updates.closedDate) setValues.closedDate = updates.closedDate;
  if (updates.contractorId) setValues.contractorId = updates.contractorId;
  if (updates.notes) setValues.notes = updates.notes;

  const [updated] = await db
    .update(leadOutcomes)
    .set(setValues)
    .where(eq(leadOutcomes.id, outcomeId))
    .returning();

  return updated;
}

export async function getCurrentKpi(marketId: string): Promise<any> {
  const [latest] = await db
    .select()
    .from(kpiSnapshots)
    .where(eq(kpiSnapshots.marketId, marketId))
    .orderBy(desc(kpiSnapshots.snapshotDate))
    .limit(1);

  return latest || null;
}
