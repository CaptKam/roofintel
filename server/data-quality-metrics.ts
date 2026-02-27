import { db } from "./storage";
import { sql } from "drizzle-orm";

export interface MarketReadiness {
  marketId: string;
  marketName: string;
  totalLeads: number;
  metrics: {
    hasValidCoordinates: { count: number; pct: number };
    hasOwnerPhone: { count: number; pct: number };
    hasDecisionMaker: { count: number; pct: number };
    hasRoofRiskScore: { count: number; pct: number };
    hasEmail: { count: number; pct: number };
    hasPermitData: { count: number; pct: number };
    enrichmentComplete: { count: number; pct: number };
    hasContactName: { count: number; pct: number };
  };
  conflictRate: number;
  duplicateRate: number;
  avgLeadScore: number;
  avgRoofRisk: number | null;
  dataSourceCoverage: Array<{ sourceName: string; recordCount: number; lastSync: string | null }>;
  normalizedTables: {
    property_roof: number;
    property_owner: number;
    property_risk_signals: number;
    property_contacts: number;
    property_intelligence: number;
  };
  overallReadiness: number;
}

export async function computeMarketReadiness(marketId: string): Promise<MarketReadiness> {
  const marketResult = (await db.execute(sql`SELECT name FROM markets WHERE id = ${marketId}`)) as any;
  const marketName = marketResult.rows[0]?.name || "Unknown";

  const metricsResult = (await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 THEN 1 END) as has_coords,
      COUNT(CASE WHEN owner_phone IS NOT NULL OR contact_phone IS NOT NULL THEN 1 END) as has_phone,
      COUNT(CASE WHEN dm_confidence_score >= 50 THEN 1 END) as has_dm,
      COUNT(CASE WHEN roof_risk_index IS NOT NULL THEN 1 END) as has_roof_risk,
      COUNT(CASE WHEN owner_email IS NOT NULL OR contact_email IS NOT NULL THEN 1 END) as has_email,
      COUNT(CASE WHEN permit_count > 0 THEN 1 END) as has_permits,
      COUNT(CASE WHEN enrichment_status = 'complete' THEN 1 END) as enriched,
      COUNT(CASE WHEN contact_name IS NOT NULL THEN 1 END) as has_contact_name,
      ROUND(AVG(lead_score)::numeric, 1) as avg_score,
      ROUND(AVG(roof_risk_index)::numeric, 1) as avg_risk
    FROM leads
    WHERE market_id = ${marketId}
  `)) as any;

  const m = metricsResult.rows[0];
  const total = Number(m.total) || 1;

  const conflictResult = (await db.execute(sql`
    SELECT COUNT(*) as cnt FROM conflict_sets cs
    JOIN leads l ON l.id = cs.lead_id
    WHERE l.market_id = ${marketId} AND cs.resolution = 'UNRESOLVED'
  `)) as any;
  const conflictCount = Number(conflictResult.rows[0]?.cnt || 0);

  const dupeResult = (await db.execute(sql`
    SELECT COUNT(*) as cnt FROM duplicate_clusters dc
    WHERE dc.market_id = ${marketId} AND dc.status = 'pending'
  `)) as any;
  const dupeCount = Number(dupeResult.rows[0]?.cnt || 0);

  const sourceResult = (await db.execute(sql`
    SELECT source_name, last_sync_record_count as record_count, last_sync_at
    FROM market_data_sources
    WHERE market_id = ${marketId} AND is_active = true
    ORDER BY source_name
  `)) as any;

  const normalizedResult = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM property_roof pr JOIN leads l ON l.id = pr.property_id WHERE l.market_id = ${marketId}) as roof,
      (SELECT COUNT(*) FROM property_owner po JOIN leads l ON l.id = po.property_id WHERE l.market_id = ${marketId}) as owner,
      (SELECT COUNT(*) FROM property_risk_signals prs JOIN leads l ON l.id = prs.property_id WHERE l.market_id = ${marketId}) as risk,
      (SELECT COUNT(*) FROM property_contacts pc JOIN leads l ON l.id = pc.property_id WHERE l.market_id = ${marketId}) as contacts,
      (SELECT COUNT(*) FROM property_intelligence pi2 JOIN leads l ON l.id = pi2.property_id WHERE l.market_id = ${marketId}) as intel
  `)) as any;
  const n = normalizedResult.rows[0];

  const pct = (v: number) => Math.round((v / total) * 100);

  const hasCoords = Number(m.has_coords);
  const hasPhone = Number(m.has_phone);
  const hasDm = Number(m.has_dm);
  const hasRisk = Number(m.has_roof_risk);
  const hasEmail = Number(m.has_email);
  const hasPermits = Number(m.has_permits);
  const enriched = Number(m.enriched);
  const hasContactName = Number(m.has_contact_name);

  const readinessWeights = [
    { val: pct(hasCoords), weight: 0.15 },
    { val: pct(hasPhone), weight: 0.20 },
    { val: pct(hasDm), weight: 0.15 },
    { val: pct(hasRisk), weight: 0.10 },
    { val: pct(enriched), weight: 0.20 },
    { val: pct(hasContactName), weight: 0.10 },
    { val: Math.max(0, 100 - pct(conflictCount)), weight: 0.05 },
    { val: Math.max(0, 100 - pct(dupeCount)), weight: 0.05 },
  ];
  const overallReadiness = Math.round(readinessWeights.reduce((sum, w) => sum + w.val * w.weight, 0));

  return {
    marketId,
    marketName,
    totalLeads: total,
    metrics: {
      hasValidCoordinates: { count: hasCoords, pct: pct(hasCoords) },
      hasOwnerPhone: { count: hasPhone, pct: pct(hasPhone) },
      hasDecisionMaker: { count: hasDm, pct: pct(hasDm) },
      hasRoofRiskScore: { count: hasRisk, pct: pct(hasRisk) },
      hasEmail: { count: hasEmail, pct: pct(hasEmail) },
      hasPermitData: { count: hasPermits, pct: pct(hasPermits) },
      enrichmentComplete: { count: enriched, pct: pct(enriched) },
      hasContactName: { count: hasContactName, pct: pct(hasContactName) },
    },
    conflictRate: Math.round((conflictCount / total) * 10000) / 100,
    duplicateRate: Math.round((dupeCount / total) * 10000) / 100,
    avgLeadScore: Number(m.avg_score) || 0,
    avgRoofRisk: m.avg_risk ? Number(m.avg_risk) : null,
    dataSourceCoverage: (sourceResult.rows || []).map((r: any) => ({
      sourceName: r.source_name,
      recordCount: r.record_count || 0,
      lastSync: r.last_sync_at,
    })),
    normalizedTables: {
      property_roof: Number(n.roof) || 0,
      property_owner: Number(n.owner) || 0,
      property_risk_signals: Number(n.risk) || 0,
      property_contacts: Number(n.contacts) || 0,
      property_intelligence: Number(n.intel) || 0,
    },
    overallReadiness,
  };
}

export async function snapshotQualityMetrics(marketId: string): Promise<void> {
  const readiness = await computeMarketReadiness(marketId);
  const now = new Date();

  const metrics = [
    { name: "total_leads", value: readiness.totalLeads },
    { name: "pct_has_coordinates", value: readiness.metrics.hasValidCoordinates.pct },
    { name: "pct_has_phone", value: readiness.metrics.hasOwnerPhone.pct },
    { name: "pct_has_decision_maker", value: readiness.metrics.hasDecisionMaker.pct },
    { name: "pct_has_roof_risk", value: readiness.metrics.hasRoofRiskScore.pct },
    { name: "pct_has_email", value: readiness.metrics.hasEmail.pct },
    { name: "pct_enriched", value: readiness.metrics.enrichmentComplete.pct },
    { name: "conflict_rate", value: readiness.conflictRate },
    { name: "duplicate_rate", value: readiness.duplicateRate },
    { name: "avg_lead_score", value: readiness.avgLeadScore },
    { name: "overall_readiness", value: readiness.overallReadiness },
  ];

  for (const m of metrics) {
    await db.execute(sql`
      INSERT INTO data_quality_metrics (market_id, metric_name, metric_value, measured_at)
      VALUES (${marketId}, ${m.name}, ${m.value}, ${now})
    `);
  }

  console.log(`[quality] Stored ${metrics.length} quality metrics for market ${marketId}`);
}
