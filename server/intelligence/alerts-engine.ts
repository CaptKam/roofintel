import { db } from "../storage";
import { sql } from "drizzle-orm";

export interface OpsAlert {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  count: number;
  leadIds: string[];
  actionUrl: string;
  icon: string;
}

export async function generateOpsAlerts(): Promise<OpsAlert[]> {
  const alerts: OpsAlert[] = [];

  const [
    claimWindowResult,
    highValueStormResult,
    contactGapResult,
    portfolioResult,
    permitActivityResult,
    evidenceSourceResult,
    dataFreshnessResult,
  ] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS total,
        json_agg(json_build_object('id', id, 'city', city, 'zip', zip_code, 'value', total_value) ORDER BY total_value DESC NULLS LAST) FILTER (WHERE TRUE) AS details
      FROM leads
      WHERE claim_window_open = true
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS total,
        json_agg(json_build_object(
          'id', id, 'address', address, 'city', city,
          'value', total_value, 'hail_events', hail_events,
          'has_phone', CASE WHEN owner_phone IS NOT NULL OR contact_phone IS NOT NULL THEN true ELSE false END
        ) ORDER BY total_value DESC NULLS LAST) FILTER (WHERE TRUE) AS details
      FROM leads
      WHERE hail_events >= 15 AND total_value >= 5000000
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE owner_phone IS NOT NULL OR contact_phone IS NOT NULL OR managing_member_phone IS NOT NULL)::int AS with_phone,
        COUNT(*) FILTER (WHERE owner_email IS NOT NULL OR contact_email IS NOT NULL OR managing_member_email IS NOT NULL)::int AS with_email,
        json_agg(json_build_object('id', id, 'address', address, 'score', lead_score) ORDER BY lead_score DESC) FILTER (WHERE TRUE) AS details
      FROM leads
      WHERE lead_score >= 60
    `),

    db.execute(sql`
      SELECT normalized_name, COUNT(DISTINCT lead_id)::int AS prop_count,
        json_agg(DISTINCT lead_id) AS lead_ids
      FROM rooftop_owners
      GROUP BY normalized_name
      HAVING COUNT(DISTINCT lead_id) >= 3
      ORDER BY COUNT(DISTINCT lead_id) DESC
      LIMIT 20
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE UPPER(work_description) LIKE '%ROOF%')::int AS roof_related,
        json_agg(json_build_object('id', id, 'address', address, 'contractor', contractor, 'work', work_description, 'date', issued_date)
          ORDER BY issued_date DESC NULLS LAST) FILTER (WHERE UPPER(work_description) LIKE '%ROOF%') AS roof_permits
      FROM building_permits
    `),

    db.execute(sql`
      SELECT source_name, COUNT(*)::int AS cnt
      FROM contact_evidence
      WHERE is_active = true
      GROUP BY source_name
      ORDER BY cnt DESC
    `),

    db.execute(sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE enrichment_status = 'pending' OR enrichment_status IS NULL)::int AS pending,
        COUNT(*) FILTER (WHERE enrichment_status = 'complete')::int AS complete,
        COUNT(*) FILTER (WHERE last_enriched_at IS NULL OR last_enriched_at < NOW() - INTERVAL '30 days')::int AS stale,
        COUNT(*) FILTER (WHERE owner_phone IS NULL AND contact_phone IS NULL AND managing_member_phone IS NULL)::int AS no_phone,
        COUNT(*) FILTER (WHERE owner_email IS NULL AND contact_email IS NULL AND managing_member_email IS NULL)::int AS no_email,
        json_agg(json_build_object('id', id, 'address', address, 'score', lead_score) ORDER BY lead_score DESC) FILTER (WHERE enrichment_status = 'pending' OR enrichment_status IS NULL) AS pending_details
      FROM leads
    `),
  ]);

  const claimWindow = (claimWindowResult as any).rows[0];
  if (claimWindow && claimWindow.total > 0) {
    const details = claimWindow.details || [];
    const cityMap = new Map<string, number>();
    for (const d of details.slice(0, 100)) {
      cityMap.set(d.city, (cityMap.get(d.city) || 0) + 1);
    }
    const topCities = Array.from(cityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([city, count]) => `${city} (${count})`)
      .join(", ");

    alerts.push({
      id: "claim-window-open",
      type: "claim_window",
      severity: "critical",
      title: "Open Claim Windows",
      description: `${claimWindow.total} leads have open insurance claim windows. Top cities: ${topCities}. Act before windows expire.`,
      count: claimWindow.total,
      leadIds: details.slice(0, 10).map((d: any) => d.id),
      actionUrl: "/leads?claimWindowOpen=true",
      icon: "AlertTriangle",
    });
  }

  const highValueStorm = (highValueStormResult as any).rows[0];
  if (highValueStorm && highValueStorm.total > 0) {
    const details = highValueStorm.details || [];
    const withContact = details.filter((d: any) => d.has_phone).length;

    alerts.push({
      id: "high-value-storm-targets",
      type: "high_value_storm",
      severity: "critical",
      title: "High-Value Storm Targets",
      description: `${highValueStorm.total} properties worth $5M+ with 15+ hail events. ${withContact} have contact info ready.`,
      count: highValueStorm.total,
      leadIds: details.slice(0, 10).map((d: any) => d.id),
      actionUrl: "/leads?minHailEvents=15&minPropertyValue=5000000",
      icon: "Zap",
    });
  }

  const contactGap = (contactGapResult as any).rows[0];
  if (contactGap && contactGap.total > 0) {
    const noPhone = contactGap.total - contactGap.with_phone;
    const noEmail = contactGap.total - contactGap.with_email;
    const details = contactGap.details || [];

    if (noPhone > contactGap.total * 0.5) {
      alerts.push({
        id: "contactability-gap",
        type: "contactability_gap",
        severity: "warning",
        title: "Contactability Gap",
        description: `${contactGap.total} high-score leads (60+) but only ${contactGap.with_phone} have phone numbers and ${contactGap.with_email} have email. ${noPhone} leads need phone enrichment.`,
        count: noPhone,
        leadIds: details.slice(0, 10).map((d: any) => d.id),
        actionUrl: "/leads?minScore=60&hasPhone=false",
        icon: "PhoneOff",
      });
    }
  }

  const portfolioRows = (portfolioResult as any).rows;
  if (portfolioRows && portfolioRows.length > 0) {
    const totalPortfolios = portfolioRows.length;
    const totalProperties = portfolioRows.reduce((sum: number, r: any) => sum + r.prop_count, 0);
    const topOwner = portfolioRows[0];
    const allLeadIds = portfolioRows.flatMap((r: any) => r.lead_ids || []);

    alerts.push({
      id: "portfolio-opportunities",
      type: "portfolio",
      severity: "info",
      title: "Portfolio Opportunities",
      description: `${totalPortfolios} owners control ${totalProperties} properties (3+ each). Top: "${topOwner.normalized_name}" with ${topOwner.prop_count} properties. One relationship = multiple deals.`,
      count: totalPortfolios,
      leadIds: allLeadIds.slice(0, 10),
      actionUrl: "/owners",
      icon: "Building2",
    });
  }

  const permitActivity = (permitActivityResult as any).rows[0];
  if (permitActivity && permitActivity.total > 0) {
    const roofPermits = permitActivity.roof_permits || [];

    alerts.push({
      id: "permit-activity",
      type: "permit_activity",
      severity: "info",
      title: "Permit Activity Signals",
      description: `${permitActivity.total} building permits tracked. ${permitActivity.roof_related} are roof-related, indicating active competitor work or replacement cycles.`,
      count: permitActivity.total,
      leadIds: roofPermits.slice(0, 10).map((p: any) => p.id),
      actionUrl: "/data-management",
      icon: "FileText",
    });
  }

  const evidenceRows = (evidenceSourceResult as any).rows;
  if (evidenceRows && evidenceRows.length > 0) {
    const totalEvidence = evidenceRows.reduce((sum: number, r: any) => sum + r.cnt, 0);
    const topSources = evidenceRows
      .slice(0, 5)
      .map((r: any) => `${r.source_name} (${r.cnt})`)
      .join(", ");

    alerts.push({
      id: "enrichment-sources",
      type: "enrichment_sources",
      severity: "info",
      title: "Enrichment Source Summary",
      description: `${totalEvidence} contact evidence records from ${evidenceRows.length} sources. Top: ${topSources}.`,
      count: totalEvidence,
      leadIds: [],
      actionUrl: "/data-intelligence",
      icon: "Database",
    });
  }

  const freshness = (dataFreshnessResult as any).rows[0];
  if (freshness) {
    const staleCount = freshness.stale || 0;
    const pendingCount = freshness.pending || 0;
    const pendingDetails = freshness.pending_details || [];

    if (staleCount > freshness.total * 0.1 || pendingCount > 100) {
      alerts.push({
        id: "data-freshness",
        type: "data_freshness",
        severity: "warning",
        title: "Data Freshness Alert",
        description: `${pendingCount} leads pending enrichment, ${staleCount} have stale data (>30 days). ${freshness.no_phone} missing phone, ${freshness.no_email} missing email.`,
        count: staleCount + pendingCount,
        leadIds: pendingDetails.slice(0, 10).map((d: any) => d.id),
        actionUrl: "/data-management",
        icon: "Clock",
      });
    }
  }

  alerts.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return alerts;
}
