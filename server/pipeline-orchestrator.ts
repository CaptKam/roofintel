import { db } from "./storage";
import { leads } from "@shared/schema";
import { sql } from "drizzle-orm";

export interface PipelineStep {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "skipped" | "error";
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelinePhase {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "skipped" | "error";
  steps: PipelineStep[];
}

export interface PipelineFilters {
  minSqft?: number;
  maxStories?: number;
  roofTypes?: string[];
  excludeShellCompanies?: boolean;
  minPropertyValue?: number;
  onlyUnprocessed?: boolean;
  forceReprocess?: boolean;
}

export interface PipelineStatus {
  running: boolean;
  cancelled: boolean;
  currentPhase?: string;
  currentStep?: string;
  phases: PipelinePhase[];
  startedAt?: string;
  completedAt?: string;
  skipPhases: string[];
  matchedLeads?: number;
  pipelineRunId?: string;
  filters?: PipelineFilters;
}

let pipelineStatus: PipelineStatus = {
  running: false,
  cancelled: false,
  phases: [],
  skipPhases: [],
};

export function getPipelineStatus(): PipelineStatus {
  return { ...pipelineStatus, phases: pipelineStatus.phases.map(p => ({ ...p, steps: [...p.steps] })) };
}

export function cancelPipeline(): void {
  if (pipelineStatus.running) {
    pipelineStatus.cancelled = true;
    console.log("[Pipeline] Cancel requested");
  }
}

function createPhases(): PipelinePhase[] {
  return [
    {
      id: "import",
      name: "Phase 1: Import Properties",
      status: "pending",
      steps: [
        { id: "dcad", name: "Import Dallas County (DCAD)", status: "pending" },
      ],
    },
    {
      id: "building-intel",
      name: "Phase 2: Building & Roof Intelligence",
      status: "pending",
      steps: [
        { id: "stories", name: "Estimate Stories", status: "pending" },
        { id: "roof-types", name: "Estimate Roof & Construction Types", status: "pending" },
        { id: "holding-companies", name: "Flag Holding Companies", status: "pending" },
        { id: "fix-locations", name: "Fix Missing Locations", status: "pending" },
      ],
    },
    {
      id: "storm",
      name: "Phase 3: Storm & Hail Data",
      status: "pending",
      steps: [
        { id: "noaa-current", name: "Import NOAA Hail (Current Year)", status: "pending" },
        { id: "hail-correlate", name: "Match Hail to Leads", status: "pending" },
      ],
    },
    {
      id: "intelligence-data",
      name: "Phase 4: Intelligence Data",
      status: "pending",
      steps: [
        { id: "import-311", name: "Import Dallas 311 (Last 90 Days)", status: "pending" },
        { id: "import-code", name: "Import Code Violations Archive", status: "pending" },
        { id: "match-violations", name: "Match Violations to Leads", status: "pending" },
        { id: "import-dallas-permits", name: "Import Dallas Permits", status: "pending" },
        { id: "import-fw-permits", name: "Import Fort Worth Permits", status: "pending" },
        { id: "match-permits", name: "Match Permits to Leads", status: "pending" },
        { id: "sync-contractors", name: "Sync Contractors to Leads", status: "pending" },
        { id: "flood", name: "Enrich Flood Risk (FEMA NFHL)", status: "pending" },
      ],
    },
    {
      id: "roofing-permits",
      name: "Phase 5: Roofing Permits",
      status: "pending",
      steps: [
        { id: "import-roofing", name: "Import Roofing Permits (10yr)", status: "pending" },
        { id: "scan-roofing", name: "Scan & Match to Leads", status: "pending" },
      ],
    },
    {
      id: "enrichment",
      name: "Phase 6: Contact Enrichment (Free Agents)",
      status: "pending",
      steps: [
        { id: "batch-free", name: "Batch Free Enrichment (Full Pipeline)", status: "pending" },
      ],
    },
    {
      id: "post-enrichment",
      name: "Phase 7: Post-Enrichment Analysis",
      status: "pending",
      steps: [
        { id: "classify-ownership", name: "Classify Ownership Structures", status: "pending" },
        { id: "scan-management", name: "Scan for Management Companies", status: "pending" },
        { id: "scan-addresses", name: "Reverse Address Enrichment", status: "pending" },
        { id: "infer-roles", name: "Infer Decision-Maker Roles", status: "pending" },
        { id: "score-confidence", name: "Score Decision-Maker Confidence", status: "pending" },
      ],
    },
    {
      id: "network",
      name: "Phase 8: Network & Deduplication",
      status: "pending",
      steps: [
        { id: "analyze-network", name: "Analyze Relationship Network", status: "pending" },
        { id: "scan-duplicates", name: "Scan for Duplicates", status: "pending" },
      ],
    },
    {
      id: "scoring",
      name: "Phase 9: Final Scoring",
      status: "pending",
      steps: [
        { id: "recalc-scores", name: "Recalculate All Lead Scores", status: "pending" },
      ],
    },
    {
      id: "roi-gate",
      name: "Phase 10: ROI Gate",
      status: "pending",
      steps: [
        { id: "roi-batch", name: "Run Enrichment ROI Decisions", status: "pending" },
        { id: "zip-recompute", name: "Recompute ZIP Tile Scores", status: "pending" },
      ],
    },
  ];
}

function updateStepStatus(stepId: string, status: PipelineStep["status"], detail?: string) {
  for (const phase of pipelineStatus.phases) {
    const step = phase.steps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
      if (status === "running") step.startedAt = new Date().toISOString();
      if (status === "complete" || status === "error" || status === "skipped") step.completedAt = new Date().toISOString();
      pipelineStatus.currentStep = status === "running" ? step.name : undefined;
      break;
    }
  }
}

function updatePhaseStatus(phaseId: string, status: PipelinePhase["status"]) {
  const phase = pipelineStatus.phases.find(p => p.id === phaseId);
  if (phase) {
    phase.status = status;
    pipelineStatus.currentPhase = status === "running" ? phase.name : undefined;
  }
}

async function runStep(stepId: string, fn: () => Promise<string>): Promise<void> {
  if (pipelineStatus.cancelled) {
    updateStepStatus(stepId, "skipped", "Pipeline cancelled");
    return;
  }
  updateStepStatus(stepId, "running");
  try {
    const detail = await fn();
    updateStepStatus(stepId, "complete", detail);
  } catch (err: any) {
    console.error(`[Pipeline] Step ${stepId} failed:`, err.message);
    updateStepStatus(stepId, "error", err.message?.slice(0, 200));
  }
}

async function getMarketId(): Promise<string | null> {
  const { storage } = await import("./storage");
  const markets = await storage.getMarkets();
  const dfw = markets.find(m => m.name?.toLowerCase().includes("dfw") || m.name?.toLowerCase().includes("dallas"));
  return dfw?.id || markets[0]?.id || null;
}

async function callInternalApi(path: string, body?: any): Promise<any> {
  const port = process.env.PORT || 5000;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `API call failed: ${res.status}`);
  }
  return res.json();
}

export async function queryFilteredLeadIds(filters: PipelineFilters): Promise<{ leadIds: string[]; totalLeads: number }> {
  const conditions: string[] = [];

  if (filters.minSqft && filters.minSqft > 0) {
    conditions.push(`sqft >= ${Number(filters.minSqft)}`);
  }
  if (filters.maxStories && filters.maxStories > 0) {
    conditions.push(`COALESCE(stories, 1) <= ${Number(filters.maxStories)}`);
  }
  if (filters.minPropertyValue && filters.minPropertyValue > 0) {
    conditions.push(`COALESCE(total_value, 0) >= ${Number(filters.minPropertyValue)}`);
  }
  if (filters.excludeShellCompanies) {
    conditions.push(`(ownership_flag IS NULL OR ownership_flag NOT IN ('Deep Holding Structure', 'Corp Service Shield'))`);
  }
  if (filters.roofTypes && filters.roofTypes.length > 0 && filters.roofTypes.length < 8) {
    const escaped = filters.roofTypes.map(r => `'${r.replace(/'/g, "''")}'`).join(",");
    conditions.push(`(roof_type IS NULL OR roof_type IN (${escaped}))`);
  }
  if (filters.onlyUnprocessed && !filters.forceReprocess) {
    conditions.push(`pipeline_last_processed_at IS NULL`);
  }

  const totalResult = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM leads`));
  const totalLeads = (totalResult.rows[0] as any)?.count || 0;

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.execute(sql.raw(`SELECT id FROM leads ${whereClause}`));
  const leadIds = result.rows.map((r: any) => r.id as string);

  return { leadIds, totalLeads };
}

export async function previewFilteredLeads(filters: PipelineFilters): Promise<{ matchedLeads: number; totalLeads: number }> {
  const { leadIds, totalLeads } = await queryFilteredLeadIds(filters);
  return { matchedLeads: leadIds.length, totalLeads };
}

export async function runFullPipeline(options: { skipPhases?: string[]; filters?: PipelineFilters }): Promise<void> {
  if (pipelineStatus.running) throw new Error("Pipeline already running");

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filters = options.filters || {};

  pipelineStatus = {
    running: true,
    cancelled: false,
    phases: createPhases(),
    startedAt: new Date().toISOString(),
    skipPhases: options.skipPhases || [],
    pipelineRunId: runId,
    filters,
  };

  const marketId = await getMarketId();
  if (!marketId) {
    pipelineStatus.running = false;
    pipelineStatus.completedAt = new Date().toISOString();
    throw new Error("No market found. Create a market first.");
  }

  const { leadIds: qualifiedLeadIds, totalLeads } = await queryFilteredLeadIds(filters);
  pipelineStatus.matchedLeads = qualifiedLeadIds.length;

  console.log(`[Pipeline] Starting full pipeline for market ${marketId}`);
  console.log(`[Pipeline] Filters: ${JSON.stringify(filters)}`);
  console.log(`[Pipeline] Matched ${qualifiedLeadIds.length} of ${totalLeads} leads`);
  console.log(`[Pipeline] Run ID: ${runId}`);
  console.log(`[Pipeline] Skipping phases: ${options.skipPhases?.join(", ") || "none"}`);

  (async () => {
    try {
      const shouldSkip = (phaseId: string) => pipelineStatus.skipPhases.includes(phaseId);

      if (shouldSkip("import")) {
        updatePhaseStatus("import", "skipped");
        pipelineStatus.phases.find(p => p.id === "import")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("import", "running");
        const leadCount = await db.select({ count: sql<number>`count(*)` }).from(leads);
        const total = Number(leadCount[0]?.count || 0);
        if (total > 100) {
          updateStepStatus("dcad", "skipped", `${total.toLocaleString()} leads already exist`);
        } else {
          const { hasMarketDataSources, importAllMarketSources } = await import("./arcgis-importer");
          const hasGenericConfig = await hasMarketDataSources(marketId);

          if (hasGenericConfig) {
            await runStep("dcad", async () => {
              const results = await importAllMarketSources(marketId, { maxRecords: 5000, minSqft: 0 });
              const totalImported = results.reduce((s, r) => s + r.imported, 0);
              const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
              const sourceNames = results.map(r => r.dataSourceName).join(", ");
              return `Generic importer: ${totalImported} imported, ${totalSkipped} skipped from ${results.length} sources (${sourceNames})`;
            });
          } else {
            await runStep("dcad", async () => {
              const result = await callInternalApi("/api/import/dcad", { marketId, minImpValue: 100000, maxRecords: 5000, minSqft: 0 });
              return `Imported ${result.imported || 0} properties (${result.skipped || 0} skipped)`;
            });
          }
        }
        updatePhaseStatus("import", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("building-intel")) {
        updatePhaseStatus("building-intel", "skipped");
        pipelineStatus.phases.find(p => p.id === "building-intel")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("building-intel", "running");
        await runStep("stories", async () => {
          const result = await callInternalApi("/api/leads/estimate-stories", { marketId, leadIds: qualifiedLeadIds });
          return `Estimated stories for ${result.updated} leads`;
        });
        await runStep("roof-types", async () => {
          const result = await callInternalApi("/api/leads/estimate-roof-type", { marketId, leadIds: qualifiedLeadIds });
          return `Estimated roof types for ${result.updated} leads`;
        });
        await runStep("holding-companies", async () => {
          const result = await callInternalApi("/api/leads/flag-ownership", { leadIds: qualifiedLeadIds });
          return `Flagged ${result.flagged} holding companies`;
        });
        await runStep("fix-locations", async () => {
          await callInternalApi("/api/data/fix-locations", { leadIds: qualifiedLeadIds });
          return "Location fix started in background";
        });
        updatePhaseStatus("building-intel", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("storm")) {
        updatePhaseStatus("storm", "skipped");
        pipelineStatus.phases.find(p => p.id === "storm")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("storm", "running");
        await runStep("noaa-current", async () => {
          const currentYear = new Date().getFullYear();
          const result = await callInternalApi("/api/import/noaa", { marketId, startYear: currentYear, endYear: currentYear });
          return `Imported ${result.imported || 0} hail events for ${currentYear}`;
        });
        await runStep("hail-correlate", async () => {
          const result = await callInternalApi("/api/correlate/hail", { marketId, radiusMiles: 5 });
          return `Correlated hail to ${result.matched || 0} leads`;
        });
        updatePhaseStatus("storm", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("intelligence-data")) {
        updatePhaseStatus("intelligence-data", "skipped");
        pipelineStatus.phases.find(p => p.id === "intelligence-data")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("intelligence-data", "running");
        await runStep("import-311", async () => {
          const result = await callInternalApi("/api/violations/import-311", { marketId });
          return `Imported ${result.imported || 0} service requests`;
        });
        await runStep("import-code", async () => {
          const result = await callInternalApi("/api/violations/import-code", { marketId });
          return `Imported ${result.imported || 0} code violations`;
        });
        await runStep("match-violations", async () => {
          const result = await callInternalApi("/api/violations/match", { marketId });
          return `Matched ${result.matched || 0} violations to leads`;
        });
        await runStep("import-dallas-permits", async () => {
          const result = await callInternalApi("/api/permits/import-dallas", { marketId, yearsBack: 10 });
          return `Imported ${result.imported || 0} Dallas permits`;
        });
        await runStep("import-fw-permits", async () => {
          const result = await callInternalApi("/api/permits/import-fortworth", { marketId, yearsBack: 10 });
          return `Imported ${result.imported || 0} Fort Worth permits`;
        });
        await runStep("match-permits", async () => {
          const result = await callInternalApi("/api/permits/match", { marketId });
          return `Matched ${result.matched || 0} permits to leads`;
        });
        await runStep("sync-contractors", async () => {
          const result = await callInternalApi("/api/permits/sync-contractors", {});
          return `Synced contractor data from ${result.synced || result.updated || 0} permits`;
        });
        await runStep("flood", async () => {
          const result = await callInternalApi("/api/flood/enrich", { marketId });
          return `Enriched ${result.enriched || 0} leads with flood data`;
        });
        updatePhaseStatus("intelligence-data", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("roofing-permits")) {
        updatePhaseStatus("roofing-permits", "skipped");
        pipelineStatus.phases.find(p => p.id === "roofing-permits")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("roofing-permits", "running");
        await runStep("import-roofing", async () => {
          const result = await callInternalApi("/api/permits/import-roofing", { marketId, yearsBack: 10 });
          return `Imported ${result.imported || 0} roofing permits`;
        });
        await runStep("scan-roofing", async () => {
          const result = await callInternalApi("/api/leads/scan-roofing-permits", {});
          return `Matched ${result.matched || result.updated || 0} roofing permits to leads`;
        });
        updatePhaseStatus("roofing-permits", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("enrichment")) {
        updatePhaseStatus("enrichment", "skipped");
        pipelineStatus.phases.find(p => p.id === "enrichment")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("enrichment", "running");
        await runStep("batch-free", async () => {
          const { runBatchFreeEnrichment, getBatchFreeStatus } = await import("./lead-enrichment-orchestrator");
          await runBatchFreeEnrichment(qualifiedLeadIds);
          let status = getBatchFreeStatus();
          while (status.running) {
            await new Promise(r => setTimeout(r, 5000));
            status = getBatchFreeStatus();
            if (pipelineStatus.cancelled) break;
          }
          return `Enriched ${status.enriched} leads (${status.errors} errors)`;
        });
        updatePhaseStatus("enrichment", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("post-enrichment")) {
        updatePhaseStatus("post-enrichment", "skipped");
        pipelineStatus.phases.find(p => p.id === "post-enrichment")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("post-enrichment", "running");
        await runStep("classify-ownership", async () => {
          const { classifyAndAssignDecisionMakers } = await import("./ownership-classifier");
          const result = await classifyAndAssignDecisionMakers(qualifiedLeadIds);
          return `Classified ${result.classified} leads, ${result.withDecisionMakers} with decision makers`;
        });
        await runStep("scan-management", async () => {
          const { runManagementAttribution } = await import("./management-attribution");
          const result = await runManagementAttribution(marketId, qualifiedLeadIds);
          return `Attributed ${result.attributed} leads`;
        });
        await runStep("scan-addresses", async () => {
          const { runReverseAddressEnrichment } = await import("./reverse-address-enrichment");
          const result = await runReverseAddressEnrichment(marketId, 200, qualifiedLeadIds);
          return `Enriched ${result.enriched} addresses`;
        });
        await runStep("infer-roles", async () => {
          const { runRoleInference } = await import("./role-inference");
          const result = await runRoleInference(marketId, qualifiedLeadIds);
          return `Assigned roles to ${result.rolesAssigned} leads`;
        });
        await runStep("score-confidence", async () => {
          const { runConfidenceScoring } = await import("./dm-confidence");
          const result = await runConfidenceScoring(marketId, qualifiedLeadIds);
          return `Scored ${result.totalProcessed} leads`;
        });
        updatePhaseStatus("post-enrichment", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("network")) {
        updatePhaseStatus("network", "skipped");
        pipelineStatus.phases.find(p => p.id === "network")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("network", "running");
        await runStep("analyze-network", async () => {
          const { analyzeNetwork } = await import("./network-agent");
          const result = await analyzeNetwork(marketId);
          return `Found ${result.portfolios} portfolios with ${result.connections} connections`;
        });
        await runStep("scan-duplicates", async () => {
          const { runEntityResolutionScan } = await import("./entity-resolution");
          const result = await runEntityResolutionScan(marketId);
          return `Found ${result.clusters} duplicate clusters`;
        });
        updatePhaseStatus("network", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("scoring")) {
        updatePhaseStatus("scoring", "skipped");
        pipelineStatus.phases.find(p => p.id === "scoring")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("scoring", "running");
        await runStep("recalc-scores", async () => {
          const result = await callInternalApi("/api/leads/recalculate-scores", { marketId, leadIds: qualifiedLeadIds });
          return `Recalculated scores for ${result.updated} leads`;
        });
        updatePhaseStatus("scoring", "complete");
      }

      if (pipelineStatus.cancelled) return finishPipeline();

      if (shouldSkip("roi-gate")) {
        updatePhaseStatus("roi-gate", "skipped");
        pipelineStatus.phases.find(p => p.id === "roi-gate")?.steps.forEach(s => { s.status = "skipped"; s.detail = "Phase skipped by user"; });
      } else {
        updatePhaseStatus("roi-gate", "running");
        await runStep("roi-batch", async () => {
          const { runBatch } = await import("./enrichment-roi-agent");
          const result = await runBatch(marketId || undefined, qualifiedLeadIds.length > 0 ? qualifiedLeadIds : undefined);
          return `ROI decisions: ${result.processed} leads, projected spend $${result.totalCost}, projected EV $${result.totalEv}`;
        });
        await runStep("zip-recompute", async () => {
          const { scoreAllZips } = await import("./zip-tile-scoring");
          const tiles = await scoreAllZips(marketId || undefined);
          return `Recomputed ${tiles.length} ZIP tiles`;
        });
        updatePhaseStatus("roi-gate", "complete");
      }

      if (qualifiedLeadIds.length > 0 && !pipelineStatus.cancelled) {
        const batchSize = 500;
        for (let i = 0; i < qualifiedLeadIds.length; i += batchSize) {
          const batch = qualifiedLeadIds.slice(i, i + batchSize);
          const idList = batch.map(id => `'${id}'`).join(",");
          await db.execute(sql.raw(`UPDATE leads SET pipeline_last_processed_at = NOW(), pipeline_run_id = '${runId}' WHERE id IN (${idList})`));
        }
        console.log(`[Pipeline] Stamped ${qualifiedLeadIds.length} leads with run ID ${runId}`);
      }

      finishPipeline();
    } catch (err: any) {
      console.error("[Pipeline] Fatal error:", err.message);
      pipelineStatus.running = false;
      pipelineStatus.completedAt = new Date().toISOString();
    }
  })();
}

function finishPipeline() {
  pipelineStatus.running = false;
  pipelineStatus.currentPhase = undefined;
  pipelineStatus.currentStep = undefined;
  pipelineStatus.completedAt = new Date().toISOString();

  const completed = pipelineStatus.phases.filter(p => p.status === "complete").length;
  const skipped = pipelineStatus.phases.filter(p => p.status === "skipped").length;
  const errors = pipelineStatus.phases.flatMap(p => p.steps).filter(s => s.status === "error").length;
  console.log(`[Pipeline] Complete: ${completed} phases done, ${skipped} skipped, ${errors} step errors`);
}
