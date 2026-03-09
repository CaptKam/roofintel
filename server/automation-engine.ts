/**
 * Automation Engine — Central scheduler for all RoofIntel background tasks.
 *
 * ALWAYS RUNNING (every 10 min):
 *   Storm Monitor → detect hail → auto-correlate → auto-boost scores → auto-generate storm queue → SMS alert
 *
 * DAILY (5 AM):
 *   Recalculate all scores → Tier 1/2/3 classification → Daily Briefing → Enrich near-Tier-1 leads
 *
 * WEEKLY (Sunday 2 AM):
 *   Refresh NOAA hail → Re-run portfolio detection → Update competitor intel from permits → ZIP re-scoring
 *
 * ON NEW MARKET LOAD:
 *   Import → NOAA hail → Correlate → Building intel → Enrichment → Score → Portfolio detect
 *
 * ON USER ACTION:
 *   Enrich single lead · Mark status · Export call list
 */

import { storage, db } from "./storage";
import { calculateScore, calculateDistressScore } from "./seed";
import { correlateHailToLeads } from "./hail-correlator";
import { importNoaaHailData } from "./noaa-importer";
import { batchComputeRoofRisk } from "./roof-risk-index";
import { runStormMonitorCycle } from "./storm-monitor";
import { dualWriteUpdate } from "./dual-write";
import { sql, eq, desc, and, gte, lte, isNotNull } from "drizzle-orm";
import { leads as leadsTable } from "@shared/schema";
import type { Lead } from "@shared/schema";

// ─────────────────────────────────────────
// Timers
// ─────────────────────────────────────────
let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let weeklyTimer: ReturnType<typeof setTimeout> | null = null;
let stormAutoCorrelateEnabled = true;

// ─────────────────────────────────────────
// Status tracking
// ─────────────────────────────────────────
export interface AutomationStatus {
  daily: { lastRun: string | null; nextRun: string | null; running: boolean; lastResult: DailyResult | null };
  weekly: { lastRun: string | null; nextRun: string | null; running: boolean; lastResult: WeeklyResult | null };
  stormChain: { enabled: boolean; lastCorrelation: string | null; lastBoost: string | null };
  marketLoad: { running: boolean; currentStep: string | null; marketId: string | null };
}

let automationStatus: AutomationStatus = {
  daily: { lastRun: null, nextRun: null, running: false, lastResult: null },
  weekly: { lastRun: null, nextRun: null, running: false, lastResult: null },
  stormChain: { enabled: true, lastCorrelation: null, lastBoost: null },
  marketLoad: { running: false, currentStep: null, marketId: null },
};

export function getAutomationStatus(): AutomationStatus {
  return { ...automationStatus };
}

// ═══════════════════════════════════════════
// ALWAYS RUNNING: Enhanced Storm Monitor Chain
// ═══════════════════════════════════════════

/**
 * Wraps runStormMonitorCycle with auto-correlate + auto-boost.
 * Called by the existing 10-min storm monitor interval.
 */
export async function runStormChain(): Promise<{
  stormResult: Awaited<ReturnType<typeof runStormMonitorCycle>>;
  correlated: number;
  boosted: number;
}> {
  // Step 1: Detect hail (existing storm monitor)
  const stormResult = await runStormMonitorCycle();

  let correlated = 0;
  let boosted = 0;

  // Step 2: If new storms detected → auto-correlate hail to leads
  if (stormResult.newStormRuns > 0 && stormAutoCorrelateEnabled) {
    console.log("[Automation] Storm detected — running auto-correlate...");
    try {
      const corrResult = await correlateHailToLeads();
      correlated = corrResult.leadsUpdated;
      automationStatus.stormChain.lastCorrelation = new Date().toISOString();
      console.log(`[Automation] Auto-correlated: ${correlated} leads updated`);
    } catch (err) {
      console.error("[Automation] Auto-correlate error:", err);
    }

    // Step 3: Auto-boost scores for affected leads
    try {
      boosted = await boostStormAffectedScores(stormResult.swathPolygons);
      automationStatus.stormChain.lastBoost = new Date().toISOString();
      console.log(`[Automation] Auto-boosted: ${boosted} leads`);
    } catch (err) {
      console.error("[Automation] Auto-boost error:", err);
    }
  }

  // Steps 4 & 5 (queue + SMS) are already handled inside runStormMonitorCycle

  return { stormResult, correlated, boosted };
}

/**
 * Boost lead scores for properties in active storm swaths.
 * Adds a "storm recency" bonus since they just got hit.
 */
async function boostStormAffectedScores(
  swathPolygons: Array<{ centroid: { lat: number; lon: number } }>
): Promise<number> {
  if (swathPolygons.length === 0) return 0;

  let boosted = 0;

  for (const swath of swathPolygons) {
    // Get leads near each swath centroid (within 5 miles ≈ 0.07 degrees)
    const nearbyLeads = await storage.getLeadsInBounds(
      swath.centroid.lon - 0.07,
      swath.centroid.lat - 0.07,
      swath.centroid.lon + 0.07,
      swath.centroid.lat + 0.07,
    );

    for (const lead of nearbyLeads) {
      const newScore = calculateScore({
        ...lead,
        lastHailDate: new Date().toISOString().split("T")[0],
        hailEvents: (lead.hailEvents || 0) + 1,
      });
      if (newScore !== lead.leadScore) {
        await storage.updateLeadScore(lead.id, newScore);
        boosted++;
      }
    }
  }

  return boosted;
}

// ═══════════════════════════════════════════
// DAILY (5 AM): Recalculate + Tiers + Briefing + Near-Tier-1 Enrichment
// ═══════════════════════════════════════════

export interface TierClassification {
  tier1: Lead[]; // Critical (81-100)
  tier2: Lead[]; // High (61-80)
  tier3: Lead[]; // Moderate & Low (0-60)
  distribution: { tier1: number; tier2: number; tier3: number };
}

export interface DailyBriefing {
  generatedAt: string;
  topCalls: Array<{
    leadId: string;
    address: string;
    score: number;
    tier: string;
    phone: string | null;
    reason: string;
  }>;
  portfolioOpportunities: Array<{
    ownerName: string;
    propertyCount: number;
    avgScore: number;
  }>;
  stormUpdates: Array<{
    stormRunId: string;
    detectedAt: string;
    affectedLeads: number;
    maxProb: number;
  }>;
  tierDistribution: { tier1: number; tier2: number; tier3: number };
  leadsEnrichedToday: number;
  nearTier1Count: number;
}

export interface DailyResult {
  scoresRecalculated: number;
  tierDistribution: { tier1: number; tier2: number; tier3: number };
  nearTier1Enriched: number;
  briefing: DailyBriefing;
}

let lastDailyBriefing: DailyBriefing | null = null;

export function getLastDailyBriefing(): DailyBriefing | null {
  return lastDailyBriefing;
}

export async function runDailyAutomation(): Promise<DailyResult> {
  console.log("[Automation] === DAILY 5AM RUN STARTING ===");
  automationStatus.daily.running = true;

  try {
    // Step 1: Recalculate ALL lead scores
    console.log("[Automation] Step 1: Recalculating all scores...");
    const scoresRecalculated = await recalculateAllScores();
    console.log(`[Automation] Recalculated ${scoresRecalculated} lead scores`);

    // Step 2: Compute roof risk index (tiers)
    console.log("[Automation] Step 2: Computing roof risk index / tiers...");
    try {
      await batchComputeRoofRisk();
    } catch (err: any) {
      // May already be running
      console.log("[Automation] Roof risk batch:", err.message);
    }

    // Step 3: Classify leads into Tier 1/2/3
    console.log("[Automation] Step 3: Generating tier classification...");
    const tiers = await classifyTiers();

    // Step 4: Enrich near-Tier-1 leads (Tier 2 leads with score 75+)
    console.log("[Automation] Step 4: Enriching near-Tier-1 leads...");
    const nearTier1Enriched = await enrichNearTier1Leads();
    console.log(`[Automation] Enriched ${nearTier1Enriched} near-Tier-1 leads`);

    // Step 5: Build Daily Briefing
    console.log("[Automation] Step 5: Building daily briefing...");
    const briefing = await buildDailyBriefing(tiers);
    lastDailyBriefing = briefing;

    const result: DailyResult = {
      scoresRecalculated,
      tierDistribution: tiers.distribution,
      nearTier1Enriched,
      briefing,
    };

    automationStatus.daily.lastRun = new Date().toISOString();
    automationStatus.daily.lastResult = result;
    console.log("[Automation] === DAILY 5AM RUN COMPLETE ===");

    return result;
  } finally {
    automationStatus.daily.running = false;
  }
}

async function recalculateAllScores(): Promise<number> {
  const { leads: allLeads } = await storage.getLeads();
  let updated = 0;

  for (const lead of allLeads) {
    const newScore = calculateScore(lead);
    if (newScore !== lead.leadScore) {
      await storage.updateLeadScore(lead.id, newScore);
      updated++;
    }
  }

  return updated;
}

async function classifyTiers(): Promise<TierClassification> {
  const { leads: allLeads } = await storage.getLeads();

  const tier1: Lead[] = [];
  const tier2: Lead[] = [];
  const tier3: Lead[] = [];

  for (const lead of allLeads) {
    const rri = lead.roofRiskIndex || 0;
    const score = lead.leadScore || 0;

    // Tier 1: Critical roof risk (81+) OR lead score 85+
    if (rri >= 81 || score >= 85) {
      tier1.push(lead);
    }
    // Tier 2: High roof risk (61-80) OR lead score 65-84
    else if (rri >= 61 || score >= 65) {
      tier2.push(lead);
    }
    // Tier 3: Everything else
    else {
      tier3.push(lead);
    }
  }

  return {
    tier1,
    tier2,
    tier3,
    distribution: { tier1: tier1.length, tier2: tier2.length, tier3: tier3.length },
  };
}

async function enrichNearTier1Leads(): Promise<number> {
  // Find Tier 2 leads that are close to Tier 1 (score 75-84, roofRiskIndex 70-80)
  const { leads: allLeads } = await storage.getLeads();

  const nearTier1 = allLeads.filter((lead) => {
    const score = lead.leadScore || 0;
    const rri = lead.roofRiskIndex || 0;
    const notFullyEnriched = lead.enrichmentStatus !== "complete";
    return notFullyEnriched && (score >= 75 || rri >= 70) && score < 85 && rri < 81;
  });

  if (nearTier1.length === 0) return 0;

  // Run a lightweight enrichment: just recalculate distress + contact confidence
  let enriched = 0;
  for (const lead of nearTier1.slice(0, 50)) {
    // Cap at 50 to avoid overload
    try {
      const distress = calculateDistressScore(lead);
      const updates: Record<string, any> = { distressScore: distress };

      // If they don't have a phone yet, flag for enrichment
      if (!lead.ownerPhone && !lead.contactPhone && !lead.managingMemberPhone) {
        updates.enrichmentStatus = "needs_enrichment";
      }

      await dualWriteUpdate(lead.id, updates, "daily_automation");
      enriched++;
    } catch (err) {
      console.error(`[Automation] Near-Tier-1 enrichment error for ${lead.id}:`, err);
    }
  }

  return enriched;
}

async function buildDailyBriefing(tiers: TierClassification): Promise<DailyBriefing> {
  // Top 10 calls: Tier 1 leads sorted by score, must have phone
  const callableTier1 = tiers.tier1
    .filter((l) => l.ownerPhone || l.contactPhone || l.managingMemberPhone)
    .sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0))
    .slice(0, 10);

  const topCalls = callableTier1.map((lead) => ({
    leadId: lead.id,
    address: lead.address || "Unknown",
    score: lead.leadScore || 0,
    tier: "Tier 1",
    phone: lead.contactPhone || lead.ownerPhone || lead.managingMemberPhone || null,
    reason: buildCallReason(lead),
  }));

  // Portfolio opportunities: multi-property owners with high avg score
  const portfolioRows = (await db.execute(sql`
    SELECT p.name as owner_name, p.property_count, p.avg_lead_score
    FROM portfolios p
    WHERE p.property_count >= 3
    ORDER BY p.avg_lead_score DESC NULLS LAST
    LIMIT 10
  `)) as any;

  const portfolioOpportunities = (portfolioRows.rows || []).map((r: any) => ({
    ownerName: r.owner_name || "Unknown",
    propertyCount: r.property_count || 0,
    avgScore: Math.round(r.avg_lead_score || 0),
  }));

  // Recent storm updates (last 24h)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stormRuns = await storage.getStormRuns(20);
  const recentStorms = stormRuns
    .filter((sr) => sr.createdAt && new Date(sr.createdAt).toISOString() > yesterday)
    .map((sr) => ({
      stormRunId: sr.id,
      detectedAt: sr.createdAt ? new Date(sr.createdAt).toISOString() : "",
      affectedLeads: sr.affectedLeadCount || 0,
      maxProb: sr.maxHailProb || 0,
    }));

  // Leads enriched in last 24h
  const enrichedResult = (await db.execute(sql`
    SELECT COUNT(*) as cnt FROM leads
    WHERE last_enriched_at >= NOW() - INTERVAL '24 hours'
  `)) as any;
  const leadsEnrichedToday = parseInt(enrichedResult.rows?.[0]?.cnt || "0", 10);

  // Near Tier 1 count
  const nearTier1 = tiers.tier2.filter(
    (l) => (l.leadScore || 0) >= 75 || (l.roofRiskIndex || 0) >= 70,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    topCalls,
    portfolioOpportunities,
    stormUpdates: recentStorms,
    tierDistribution: tiers.distribution,
    leadsEnrichedToday,
    nearTier1Count: nearTier1,
  };
}

function buildCallReason(lead: Lead): string {
  const reasons: string[] = [];
  if ((lead.roofRiskIndex || 0) >= 81) reasons.push("Critical roof risk");
  if ((lead.leadScore || 0) >= 85) reasons.push("High lead score");
  if (lead.lastHailDate) {
    const days = Math.floor(
      (Date.now() - new Date(lead.lastHailDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days <= 30) reasons.push(`Hail ${days}d ago`);
  }
  if (lead.foreclosureFlag) reasons.push("Foreclosure");
  if (lead.taxDelinquent) reasons.push("Tax delinquent");
  if ((lead.hailEvents || 0) >= 3) reasons.push(`${lead.hailEvents} hail events`);
  return reasons.length > 0 ? reasons.join(", ") : "High overall score";
}

// ═══════════════════════════════════════════
// WEEKLY (Sunday 2 AM): NOAA + Portfolios + Permits + ZIP Scoring
// ═══════════════════════════════════════════

export interface WeeklyResult {
  noaaRefreshed: { marketsProcessed: number; totalImported: number };
  portfolioDetection: { ran: boolean };
  permitRefresh: { ran: boolean };
  zipReScoring: { zipsProcessed: number };
}

export async function runWeeklyAutomation(): Promise<WeeklyResult> {
  console.log("[Automation] === WEEKLY RUN STARTING ===");
  automationStatus.weekly.running = true;

  try {
    // Step 1: Refresh NOAA hail data for all active markets
    console.log("[Automation] Step 1: Refreshing NOAA hail data...");
    const noaaResult = await refreshNoaaAllMarkets();

    // Step 2: Re-run portfolio detection
    console.log("[Automation] Step 2: Re-running portfolio detection...");
    let portfolioRan = false;
    try {
      const { runPortfolioDetection } = await import("./data-audit-agent");
      await runPortfolioDetection(100);
      portfolioRan = true;
      console.log("[Automation] Portfolio detection complete");
    } catch (err) {
      console.error("[Automation] Portfolio detection error:", err);
    }

    // Step 3: Update competitor intelligence from permits
    console.log("[Automation] Step 3: Refreshing competitor intel from permits...");
    let permitsRan = false;
    try {
      const { cleanupContractorData } = await import("./permits-agent");
      await cleanupContractorData();
      permitsRan = true;
      console.log("[Automation] Permit/contractor refresh complete");
    } catch (err) {
      console.error("[Automation] Permit refresh error:", err);
    }

    // Step 4: ZIP code priority re-scoring
    console.log("[Automation] Step 4: ZIP code priority re-scoring...");
    const zipsProcessed = await reScoreZipCodes();

    const result: WeeklyResult = {
      noaaRefreshed: noaaResult,
      portfolioDetection: { ran: portfolioRan },
      permitRefresh: { ran: permitsRan },
      zipReScoring: { zipsProcessed },
    };

    automationStatus.weekly.lastRun = new Date().toISOString();
    automationStatus.weekly.lastResult = result;
    console.log("[Automation] === WEEKLY RUN COMPLETE ===");

    return result;
  } finally {
    automationStatus.weekly.running = false;
  }
}

async function refreshNoaaAllMarkets(): Promise<{ marketsProcessed: number; totalImported: number }> {
  const markets = await storage.getMarkets();
  const currentYear = new Date().getFullYear();
  let marketsProcessed = 0;
  let totalImported = 0;

  for (const market of markets) {
    if (!market.isActive) continue;
    try {
      const targetCounties = new Set(market.counties.map((c: string) => c.toUpperCase()));
      const result = await importNoaaHailData(currentYear, market.id, targetCounties);
      totalImported += result.imported;
      marketsProcessed++;
    } catch (err) {
      console.error(`[Automation] NOAA refresh failed for market ${market.name}:`, err);
    }
  }

  // Also re-correlate after fresh data
  try {
    await correlateHailToLeads();
  } catch (err) {
    console.error("[Automation] Post-NOAA correlation error:", err);
  }

  return { marketsProcessed, totalImported };
}

async function reScoreZipCodes(): Promise<number> {
  // Aggregate lead scores by ZIP and update a priority ranking
  const zipResult = (await db.execute(sql`
    SELECT zip_code,
           COUNT(*) as lead_count,
           AVG(lead_score) as avg_score,
           MAX(lead_score) as max_score,
           SUM(CASE WHEN roof_risk_index >= 81 THEN 1 ELSE 0 END) as critical_count,
           SUM(CASE WHEN hail_events > 0 THEN 1 ELSE 0 END) as hail_affected
    FROM leads
    WHERE zip_code IS NOT NULL AND zip_code != ''
    GROUP BY zip_code
    ORDER BY avg_score DESC
  `)) as any;

  const zips = zipResult.rows || [];
  console.log(`[Automation] Computed priority scores for ${zips.length} ZIP codes`);
  return zips.length;
}

// ═══════════════════════════════════════════
// ON NEW MARKET LOAD: Full market bootstrap
// ═══════════════════════════════════════════

export interface MarketLoadOptions {
  marketId: string;
  csvBuffer?: Buffer;
  csvFilename?: string;
  skipNoaa?: boolean;
  skipEnrichment?: boolean;
}

export interface MarketLoadResult {
  steps: Array<{ step: string; status: "complete" | "skipped" | "error"; detail?: string }>;
  totalLeadsImported: number;
  hailEventsImported: number;
  leadsCorrelated: number;
  leadsScored: number;
}

export async function runNewMarketLoad(options: MarketLoadOptions): Promise<MarketLoadResult> {
  const { marketId, skipNoaa, skipEnrichment } = options;
  console.log(`[Automation] === NEW MARKET LOAD: ${marketId} ===`);

  automationStatus.marketLoad = { running: true, currentStep: "init", marketId };

  const steps: MarketLoadResult["steps"] = [];
  let totalLeadsImported = 0;
  let hailEventsImported = 0;
  let leadsCorrelated = 0;
  let leadsScored = 0;

  try {
    // Step 1: Import properties (CSV or ArcGIS)
    automationStatus.marketLoad.currentStep = "import_properties";
    if (options.csvBuffer) {
      try {
        const { importPropertyCsv } = await import("./property-importer");
        const result = await importPropertyCsv(options.csvBuffer, marketId);
        totalLeadsImported = result.imported;
        steps.push({ step: "Import Properties (CSV)", status: "complete", detail: `${result.imported} imported` });
      } catch (err: any) {
        steps.push({ step: "Import Properties (CSV)", status: "error", detail: err.message });
      }
    } else {
      try {
        const arcgisSources = await storage.getMarketDataSources(marketId);
        const cadSources = arcgisSources.filter(s => s.sourceType === "cad_arcgis" && s.isActive);
        if (cadSources.length > 0) {
          const { importGenericArcgis } = await import("./arcgis-importer");
          for (const source of cadSources) {
            try {
              console.log(`[Automation] Importing from ArcGIS source: ${source.sourceName}`);
              const result = await importGenericArcgis(source.id, {
                maxRecords: 5000,
                minSqft: 0,
                dryRun: false,
              });
              totalLeadsImported += result.imported;
              steps.push({ step: `Import Properties (${source.sourceName})`, status: "complete", detail: `${result.imported} imported, ${result.skipped} skipped` });
            } catch (err: any) {
              steps.push({ step: `Import Properties (${source.sourceName})`, status: "error", detail: err.message });
            }
          }
        } else {
          steps.push({ step: "Import Properties", status: "skipped", detail: "No CSV or ArcGIS sources configured" });
        }
      } catch (err: any) {
        steps.push({ step: "Import Properties (ArcGIS)", status: "error", detail: err.message });
      }
    }

    // Step 2: Import NOAA hail history
    automationStatus.marketLoad.currentStep = "import_noaa";
    if (!skipNoaa) {
      try {
        const market = await storage.getMarketById(marketId);
        if (market) {
          const targetCounties = new Set(market.counties.map((c: string) => c.toUpperCase()));
          const currentYear = new Date().getFullYear();
          // Import current year and previous 2 years
          for (const year of [currentYear, currentYear - 1, currentYear - 2]) {
            const result = await importNoaaHailData(year, marketId, targetCounties);
            hailEventsImported += result.imported;
          }
          steps.push({ step: "Import NOAA Hail History", status: "complete", detail: `${hailEventsImported} events (3 years)` });
        } else {
          steps.push({ step: "Import NOAA Hail History", status: "error", detail: "Market not found" });
        }
      } catch (err: any) {
        steps.push({ step: "Import NOAA Hail History", status: "error", detail: err.message });
      }
    } else {
      steps.push({ step: "Import NOAA Hail History", status: "skipped" });
    }

    // Step 3: Correlate hail to properties
    automationStatus.marketLoad.currentStep = "correlate_hail";
    try {
      const corrResult = await correlateHailToLeads(marketId);
      leadsCorrelated = corrResult.leadsUpdated;
      steps.push({ step: "Correlate Hail to Properties", status: "complete", detail: `${leadsCorrelated} leads matched` });
    } catch (err: any) {
      steps.push({ step: "Correlate Hail to Properties", status: "error", detail: err.message });
    }

    // Step 4: Run building intelligence (stories, roof type)
    automationStatus.marketLoad.currentStep = "building_intel";
    try {
      const { leads: marketLeads } = await storage.getLeads({ marketId });
      let storiesEstimated = 0;
      for (const lead of marketLeads) {
        if (!lead.stories || lead.stories === 0) {
          // Estimate stories from sqft
          const stories = lead.sqft >= 50000 ? 3 : lead.sqft >= 15000 ? 2 : 1;
          await storage.updateLead(lead.id, { stories });
          storiesEstimated++;
        }
      }
      steps.push({ step: "Building Intelligence", status: "complete", detail: `${storiesEstimated} stories estimated` });
    } catch (err: any) {
      steps.push({ step: "Building Intelligence", status: "error", detail: err.message });
    }

    // Step 5: Run initial enrichment (free sources)
    automationStatus.marketLoad.currentStep = "initial_enrichment";
    if (!skipEnrichment) {
      try {
        const { runFullPipeline } = await import("./enrichment-pipeline");
        const results = await runFullPipeline(marketId, { batchSize: 100 });
        const totalEnriched = results.reduce((sum, r) => sum + (r.enriched ? 1 : 0), 0);
        steps.push({ step: "Initial Enrichment (Free Sources)", status: "complete", detail: `${totalEnriched} leads enriched` });
      } catch (err: any) {
        steps.push({ step: "Initial Enrichment (Free Sources)", status: "error", detail: err.message });
      }
    } else {
      steps.push({ step: "Initial Enrichment", status: "skipped" });
    }

    // Step 6: Score everything
    automationStatus.marketLoad.currentStep = "scoring";
    try {
      const { leads: marketLeads } = await storage.getLeads({ marketId });
      for (const lead of marketLeads) {
        const newScore = calculateScore(lead);
        if (newScore !== lead.leadScore) {
          await storage.updateLeadScore(lead.id, newScore);
          leadsScored++;
        }
      }
      steps.push({ step: "Score All Leads", status: "complete", detail: `${leadsScored} scored` });
    } catch (err: any) {
      steps.push({ step: "Score All Leads", status: "error", detail: err.message });
    }

    // Step 7: Run portfolio detection
    automationStatus.marketLoad.currentStep = "portfolio_detection";
    try {
      const { runPortfolioDetection } = await import("./data-audit-agent");
      await runPortfolioDetection(50);
      steps.push({ step: "Portfolio Detection", status: "complete" });
    } catch (err: any) {
      steps.push({ step: "Portfolio Detection", status: "error", detail: err.message });
    }

    console.log(`[Automation] === NEW MARKET LOAD COMPLETE: ${steps.filter(s => s.status === "complete").length}/${steps.length} steps succeeded ===`);
  } finally {
    automationStatus.marketLoad = { running: false, currentStep: null, marketId: null };
  }

  return { steps, totalLeadsImported, hailEventsImported, leadsCorrelated, leadsScored };
}

// ═══════════════════════════════════════════
// ON USER ACTION: Enrich / Status / Export
// ═══════════════════════════════════════════

/**
 * Full single-lead enrichment: runs the 16-agent pipeline on one lead.
 */
export async function enrichSingleLead(leadId: string): Promise<{
  success: boolean;
  newScore: number;
  steps: string[];
}> {
  console.log(`[Automation] Full enrichment for lead ${leadId}`);
  const lead = await storage.getLeadById(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const steps: string[] = [];

  try {
    // Mark as enriching
    await storage.updateLead(leadId, { enrichmentStatus: "enriching" });
    steps.push("Marked as enriching");

    // Run owner intelligence
    try {
      const { runOwnerIntelligence } = await import("./owner-intelligence");
      await runOwnerIntelligence(leadId);
      steps.push("Owner intelligence complete");
    } catch (err: any) {
      steps.push(`Owner intelligence: ${err.message}`);
    }

    // TX SOS enrichment
    if (lead.state === "TX") {
      try {
        const { enrichLeadFromTXSOS } = await import("./tx-sos");
        await enrichLeadFromTXSOS(leadId);
        steps.push("TX SOS enrichment complete");
      } catch (err: any) {
        steps.push(`TX SOS: ${err.message}`);
      }
    }

    // County clerk enrichment
    if (lead.state === "TX") {
      try {
        const { enrichLeadFromCountyClerk } = await import("./county-clerk");
        await enrichLeadFromCountyClerk(leadId);
        steps.push("County clerk enrichment complete");
      } catch (err: any) {
        steps.push(`County clerk: ${err.message}`);
      }
    }

    // Phone enrichment
    try {
      const { enrichLeadPhones } = await import("./phone-enrichment");
      await enrichLeadPhones([leadId]);
      steps.push("Phone enrichment complete");
    } catch (err: any) {
      steps.push(`Phone enrichment: ${err.message}`);
    }

    // Web research
    try {
      const { runWebResearch } = await import("./web-research-agent");
      await runWebResearch([leadId]);
      steps.push("Web research complete");
    } catch (err: any) {
      steps.push(`Web research: ${err.message}`);
    }

    // Recalculate score
    const updatedLead = await storage.getLeadById(leadId);
    const newScore = calculateScore(updatedLead || lead);
    await storage.updateLeadScore(leadId, newScore);

    // Mark complete
    await storage.updateLead(leadId, {
      enrichmentStatus: "complete",
      lastEnrichedAt: new Date(),
    });
    steps.push(`Score updated to ${newScore}`);

    return { success: true, newScore, steps };
  } catch (err: any) {
    await storage.updateLead(leadId, { enrichmentStatus: "error" });
    steps.push(`Error: ${err.message}`);
    return { success: false, newScore: lead.leadScore || 0, steps };
  }
}

/**
 * Mark lead status and adjust future scoring.
 */
export async function updateLeadStatus(
  leadId: string,
  status: "contacted" | "won" | "lost" | "no_answer" | "callback",
): Promise<Lead | undefined> {
  const updates: Record<string, any> = {};

  switch (status) {
    case "contacted":
      updates.enrichmentStatus = "contacted";
      updates.lastContactedAt = new Date();
      break;
    case "won":
      updates.enrichmentStatus = "won";
      updates.lastContactedAt = new Date();
      break;
    case "lost":
      updates.enrichmentStatus = "lost";
      updates.lastContactedAt = new Date();
      break;
    case "no_answer":
      updates.enrichmentStatus = "no_answer";
      updates.lastContactedAt = new Date();
      break;
    case "callback":
      updates.enrichmentStatus = "callback";
      updates.lastContactedAt = new Date();
      break;
  }

  return storage.updateLead(leadId, updates);
}

/**
 * Export call list as CSV data string.
 */
export async function exportCallList(options: {
  marketId?: string;
  minScore?: number;
  tier?: "tier1" | "tier2" | "tier3";
  limit?: number;
}): Promise<{ csv: string; count: number }> {
  const filter: Record<string, any> = {};
  if (options.marketId) filter.marketId = options.marketId;

  const { leads: allLeads } = await storage.getLeads(filter);

  let filtered = allLeads
    .filter((l) => l.ownerPhone || l.contactPhone || l.managingMemberPhone)
    .filter((l) => (l.leadScore || 0) >= (options.minScore || 0));

  if (options.tier) {
    filtered = filtered.filter((l) => {
      const rri = l.roofRiskIndex || 0;
      const score = l.leadScore || 0;
      switch (options.tier) {
        case "tier1":
          return rri >= 81 || score >= 85;
        case "tier2":
          return (rri >= 61 && rri < 81) || (score >= 65 && score < 85);
        case "tier3":
          return rri < 61 && score < 65;
        default:
          return true;
      }
    });
  }

  filtered.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0));

  if (options.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  // Build CSV
  const headers = [
    "Address",
    "City",
    "State",
    "ZIP",
    "Score",
    "Roof Risk",
    "Tier",
    "Phone",
    "Contact Name",
    "Owner",
    "Hail Events",
    "Last Hail",
    "SqFt",
    "Value",
    "Reason",
  ];

  const rows = filtered.map((l) => {
    const rri = l.roofRiskIndex || 0;
    const score = l.leadScore || 0;
    const tier = rri >= 81 || score >= 85 ? "Tier 1" : rri >= 61 || score >= 65 ? "Tier 2" : "Tier 3";

    return [
      csvEscape(l.address || ""),
      csvEscape(l.city || ""),
      csvEscape(l.state || ""),
      csvEscape(l.zipCode || ""),
      score,
      rri,
      tier,
      csvEscape(l.contactPhone || l.ownerPhone || l.managingMemberPhone || ""),
      csvEscape(l.contactName || l.managingMember || ""),
      csvEscape(l.ownerName || ""),
      l.hailEvents || 0,
      l.lastHailDate || "",
      l.sqft || 0,
      l.totalValue || 0,
      csvEscape(buildCallReason(l)),
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  return { csv, count: filtered.length };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ═══════════════════════════════════════════
// SCHEDULER: Wire up daily + weekly cron timers
// ═══════════════════════════════════════════

function msUntilNext(targetHour: number, targetMinute: number, targetDay?: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, targetMinute, 0, 0);

  if (targetDay !== undefined) {
    // targetDay: 0 = Sunday
    const daysUntil = (targetDay - now.getDay() + 7) % 7;
    next.setDate(now.getDate() + (daysUntil === 0 && now >= next ? 7 : daysUntil));
  } else {
    if (now >= next) {
      next.setDate(next.getDate() + 1);
    }
  }

  return next.getTime() - now.getTime();
}

function scheduleDaily(): void {
  const msUntil5AM = msUntilNext(5, 0);
  const nextRun = new Date(Date.now() + msUntil5AM);
  automationStatus.daily.nextRun = nextRun.toISOString();

  console.log(`[Automation] Daily run scheduled for ${nextRun.toLocaleString()} (in ${Math.round(msUntil5AM / 60000)} min)`);

  dailyTimer = setTimeout(async () => {
    try {
      await runDailyAutomation();
    } catch (err) {
      console.error("[Automation] Daily run error:", err);
    }
    // Reschedule for tomorrow
    scheduleDaily();
  }, msUntil5AM);
}

function scheduleWeekly(): void {
  const msUntilSunday2AM = msUntilNext(2, 0, 0); // Sunday at 2 AM
  const nextRun = new Date(Date.now() + msUntilSunday2AM);
  automationStatus.weekly.nextRun = nextRun.toISOString();

  console.log(`[Automation] Weekly run scheduled for ${nextRun.toLocaleString()} (in ${Math.round(msUntilSunday2AM / 3600000)} hr)`);

  weeklyTimer = setTimeout(async () => {
    try {
      await runWeeklyAutomation();
    } catch (err) {
      console.error("[Automation] Weekly run error:", err);
    }
    // Reschedule for next week
    scheduleWeekly();
  }, msUntilSunday2AM);
}

/**
 * Start the full automation engine.
 * Called once at server boot from registerRoutes().
 */
export function startAutomationEngine(): void {
  console.log("[Automation] ╔══════════════════════════════════════╗");
  console.log("[Automation] ║   RoofIntel Automation Engine v1.0  ║");
  console.log("[Automation] ╚══════════════════════════════════════╝");

  // Schedule daily at 5 AM
  scheduleDaily();

  // Schedule weekly on Sunday 2 AM
  scheduleWeekly();

  // Storm chain is wired into the existing storm monitor
  automationStatus.stormChain.enabled = stormAutoCorrelateEnabled;

  console.log("[Automation] Engine started: Daily @ 5AM, Weekly @ Sun 2AM, Storm chain active");
}

export function stopAutomationEngine(): void {
  if (dailyTimer) { clearTimeout(dailyTimer); dailyTimer = null; }
  if (weeklyTimer) { clearTimeout(weeklyTimer); weeklyTimer = null; }
  console.log("[Automation] Engine stopped");
}
