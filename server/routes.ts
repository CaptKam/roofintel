import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { z } from "zod";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
import { importNoaaHailData, importNoaaMultiYear } from "./noaa-importer";
import { importPropertyCsv, generateSampleCsv } from "./property-importer";
import { importDcadProperties, inferCityFromCoords } from "./dcad-agent";
import { correlateHailToLeads } from "./hail-correlator";
import { enrichLeadContacts, getEnrichmentStatus } from "./contact-enrichment";
import { enrichLeadPhones, getPhoneEnrichmentStatus } from "./phone-enrichment";
import { runWebResearch, getWebResearchStatus } from "./web-research-agent";
import { getPipelineStats, runFullPipeline, calculateContactConfidence } from "./enrichment-pipeline";
import { getHailTrackerData } from "./hail-tracker";
import { startJobScheduler } from "./job-scheduler";
import { runStormMonitorCycle, startStormMonitor, stopStormMonitor, getStormMonitorStatus } from "./storm-monitor";
import { runXweatherCycle, startXweatherMonitor, stopXweatherMonitor, getXweatherStatus, getActiveThreats } from "./xweather-hail";
import { runOwnerIntelligenceBatch, runOwnerIntelligence, getIntelligenceStatus } from "./owner-intelligence";
import { recordBatchEvidence, getEvidenceForLead, getConflictsForLead, resolveConflict, type EvidenceInput } from "./evidence-recorder";
import { validateAllEvidenceForLead, normalizePhoneE164, isValidPhoneStructure, validateEmailSyntax } from "./contact-validation";
import { getRateLimitStatus, isDomainBlocked } from "./config/sourcePolicy";
import { lookupPhone, verifyAllPhonesForLead, isTwilioConfigured } from "./twilio-lookup";
import { markWrongNumber, markConfirmedGood, suppressContact, unsuppressContact } from "./contact-feedback";
import { buildContactPath } from "./contact-ranking";
import { seedPmCompanies, findPmCompany, addPmCompany, getAllPmCompanies } from "./pm-company-manager";
import { getSkipTraceStatus } from "./skip-trace-agent";
import { importDallas311, importDallasCodeViolations, matchViolationsToLeads, getDallasRecordsStatus, addRecordedDocument } from "./dallas-records-agent";
import { importDallasPermits, importFortWorthPermits, matchPermitsToLeads, getPermitStats, importDallasRoofingPermits, getRoofingPermitStats } from "./permits-agent";
import { enrichLeadsWithFloodZones, getFloodZoneStats } from "./flood-zone-agent";
import { calculateScore, calculateDistressScore, getScoreBreakdown } from "./seed";
import { updateLeadSchema, insertStormAlertConfigSchema, type LeadFilter, buildingPermits, leads as leadsTable, enrichmentJobs } from "@shared/schema";
import { db } from "./storage";
import { sql, eq } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedDatabase();
  startJobScheduler();

  app.get("/api/markets", async (_req, res) => {
    try {
      const markets = await storage.getMarkets();
      res.json(markets);
    } catch (error) {
      console.error("Markets fetch error:", error);
      res.status(500).json({ message: "Failed to load markets" });
    }
  });

  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const stats = await storage.getDashboardStats(marketId);
      res.json(stats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ message: "Failed to load dashboard stats" });
    }
  });

  app.get("/api/leads", async (req, res) => {
    try {
      const filter: LeadFilter = {
        marketId: req.query.marketId as string | undefined,
        search: req.query.search as string | undefined,
        county: req.query.county as string | undefined,
        minScore: req.query.minScore ? Number(req.query.minScore) : undefined,
        zoning: req.query.zoning as string | undefined,
        status: req.query.status as string | undefined,
        ownerType: req.query.ownerType as string | undefined,
        minSqft: req.query.minSqft ? Number(req.query.minSqft) : undefined,
        hasPhone: req.query.hasPhone === "true" ? true : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      };
      const result = await storage.getLeads(filter);
      res.json(result);
    } catch (error) {
      console.error("Leads fetch error:", error);
      res.status(500).json({ message: "Failed to load leads" });
    }
  });

  app.get("/api/leads/export", async (req, res) => {
    try {
      const filter: LeadFilter = {
        marketId: req.query.marketId as string | undefined,
        county: req.query.county as string | undefined,
        minScore: req.query.minScore ? Number(req.query.minScore) : undefined,
        zoning: req.query.zoning as string | undefined,
        status: req.query.status as string | undefined,
      };
      const { leads: exportLeads } = await storage.getLeads(filter);

      const headers = [
        "Address", "City", "County", "State", "Zip", "Sqft", "Year Built",
        "Zoning", "Roof Year", "Roof Material", "Hail Events", "Last Hail Date",
        "Last Hail Size", "Owner Name", "Owner Type", "LLC Name", "Phone",
        "Email", "Score", "Status", "Total Value",
      ];

      const rows = exportLeads.map((l) => [
        l.address, l.city, l.county, l.state, l.zipCode,
        l.sqft, l.yearBuilt, l.zoning, l.roofLastReplaced || "",
        l.roofMaterial || "", l.hailEvents, l.lastHailDate || "",
        l.lastHailSize || "", l.ownerName, l.ownerType, l.llcName || "",
        l.ownerPhone || "", l.ownerEmail || "", l.leadScore, l.status,
        l.totalValue || "",
      ]);

      const csv = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((val) => {
            const str = String(val);
            return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
          }).join(",")
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="roofIntel-leads.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ message: "Failed to export leads" });
    }
  });

  app.get("/api/leads/:id", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      res.json(lead);
    } catch (error) {
      console.error("Lead fetch error:", error);
      res.status(500).json({ message: "Failed to load lead" });
    }
  });

  app.patch("/api/leads/:id", async (req, res) => {
    try {
      const parsed = updateLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
      }
      const updated = await storage.updateLead(req.params.id, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "Lead not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Lead update error:", error);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  app.get("/api/hail-events", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const events = await storage.getHailEvents(marketId);
      res.json(events);
    } catch (error) {
      console.error("Hail events error:", error);
      res.status(500).json({ message: "Failed to load hail events" });
    }
  });

  app.post("/api/import/noaa", async (req, res) => {
    try {
      const { startYear, endYear, marketId } = req.body;
      if (!marketId) {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      const targetCounties = new Set(market.counties.map((c: string) => c.toUpperCase()));
      const currentYear = new Date().getFullYear();
      const start = startYear || currentYear - 5;
      const end = Math.min(endYear || currentYear, currentYear);

      res.json({ message: "NOAA import started", years: `${start}-${end}` });

      importNoaaMultiYear(start, end, marketId, targetCounties).then((results) => {
        const totalImported = results.reduce((sum, r) => sum + r.imported, 0);
        console.log(`NOAA import complete: ${totalImported} events imported across ${results.length} years`);
      }).catch((err) => {
        console.error("NOAA import failed:", err);
      });
    } catch (error) {
      console.error("NOAA import error:", error);
      res.status(500).json({ message: "Failed to start NOAA import" });
    }
  });

  app.get("/api/import/runs", async (_req, res) => {
    try {
      const runs = await storage.getImportRuns();
      res.json(runs);
    } catch (error) {
      console.error("Import runs error:", error);
      res.status(500).json({ message: "Failed to load import runs" });
    }
  });

  app.get("/api/data-sources", async (_req, res) => {
    try {
      const sources = await storage.getDataSources();
      res.json(sources);
    } catch (error) {
      console.error("Data sources error:", error);
      res.status(500).json({ message: "Failed to load data sources" });
    }
  });

  app.get("/api/jobs", async (_req, res) => {
    try {
      const allJobs = await storage.getJobs();
      res.json(allJobs);
    } catch (error) {
      console.error("Jobs error:", error);
      res.status(500).json({ message: "Failed to load jobs" });
    }
  });

  app.get("/api/hail-tracker", async (req, res) => {
    try {
      const parsed = Number(req.query.daysBack);
      const daysBack = Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.round(parsed), 30) : 7;
      const data = await getHailTrackerData(daysBack);
      res.json(data);
    } catch (error) {
      console.error("Hail tracker error:", error);
      res.status(500).json({ message: "Failed to fetch hail tracker data" });
    }
  });

  app.post("/api/import/property-csv", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const marketId = req.body.marketId;
      if (!marketId) {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      const csvContent = file.buffer.toString("utf-8");
      const minSqft = req.body.minSqft ? parseInt(req.body.minSqft, 10) : 2000;
      const countyFilter = req.body.countyFilter || undefined;
      const zoningFilter = req.body.zoningFilter ? req.body.zoningFilter.split(",") : undefined;

      const result = await importPropertyCsv(csvContent, marketId, {
        minSqft,
        countyFilter,
        zoningFilter,
      });

      res.json({
        message: `Import complete: ${result.imported} properties imported`,
        ...result,
      });
    } catch (error: any) {
      console.error("Property CSV import error:", error);
      res.status(500).json({ message: "Failed to import property CSV", error: error.message });
    }
  });

  app.post("/api/import/dcad", async (req, res) => {
    try {
      const { marketId, minImpValue, maxRecords, minSqft } = req.body;
      if (!marketId) {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      res.json({ message: "DCAD property import started", minImpValue: minImpValue || 200000, maxRecords: maxRecords || 4000, minSqft: minSqft || 0 });

      importDcadProperties(marketId, {
        minImpValue: minImpValue || 200000,
        maxRecords: maxRecords || 4000,
        minSqft: minSqft || 0,
      }).then((result) => {
        console.log(`DCAD import complete: ${result.imported} properties imported, ${result.skipped} skipped`);
      }).catch((err) => {
        console.error("DCAD import failed:", err);
      });
    } catch (error) {
      console.error("DCAD import error:", error);
      res.status(500).json({ message: "Failed to start DCAD import" });
    }
  });

  app.get("/api/import/sample-csv", (_req, res) => {
    const csv = generateSampleCsv();
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="sample-property-data.csv"');
    res.send(csv);
  });

  app.post("/api/data/fix-locations", async (_req, res) => {
    res.json({ message: "Location fix started in background" });

    (async () => {
      try {
        const batchSize = 500;
        let offset = 0;
        let fixed = 0;
        let totalChecked = 0;

        while (true) {
          const { leads } = await storage.getLeads({ limit: batchSize, offset });
          if (leads.length === 0) break;

          for (const lead of leads) {
            if (!lead.latitude || !lead.longitude || lead.sourceType !== "dcad_api") continue;
            const location = inferCityFromCoords(lead.latitude, lead.longitude);
            const currentCity = (lead.city || "").trim();
            if (currentCity !== location.city || lead.zipCode !== location.zip) {
              await storage.updateLead(lead.id, { city: location.city, zipCode: location.zip });
              fixed++;
            }
          }
          totalChecked += leads.length;
          offset += batchSize;
          if (leads.length < batchSize) break;
        }

        console.log(`[Data Fix] Complete: Fixed ${fixed} leads out of ${totalChecked} checked`);
      } catch (error: any) {
        console.error("[Data Fix] Location fix error:", error);
      }
    })();
  });

  app.post("/api/correlate/hail", async (req, res) => {
    try {
      const { marketId, radiusMiles } = req.body;
      res.json({ message: "Hail correlation started", radiusMiles: radiusMiles || 5 });

      correlateHailToLeads(marketId, radiusMiles || 5).then((result) => {
        console.log(`Hail correlation complete: ${result.leadsUpdated} leads updated`);
      }).catch((err) => {
        console.error("Hail correlation failed:", err);
      });
    } catch (error) {
      console.error("Hail correlation error:", error);
      res.status(500).json({ message: "Failed to start hail correlation" });
    }
  });

  app.get("/api/enrichment/status", async (_req, res) => {
    try {
      const status = getEnrichmentStatus();
      res.json(status);
    } catch (error) {
      console.error("Enrichment status error:", error);
      res.status(500).json({ message: "Failed to get enrichment status" });
    }
  });

  app.post("/api/enrichment/contacts", async (req, res) => {
    try {
      const { marketId, batchSize } = req.body;

      const status = getEnrichmentStatus();
      if (!status.apiKeySet) {
        return res.status(400).json({
          message: "TX Comptroller API key not configured. Register free at https://data-secure.comptroller.texas.gov and add your key as TX_COMPTROLLER_API_KEY.",
          needsApiKey: true,
        });
      }

      res.json({ message: "Contact enrichment started", batchSize: batchSize || 50 });

      enrichLeadContacts(marketId, { batchSize: batchSize || 50 }).then((result) => {
        console.log(`Contact enrichment complete: ${result.enriched} enriched, ${result.skipped} skipped, ${result.errors} errors`);
      }).catch((err) => {
        console.error("Contact enrichment failed:", err);
      });
    } catch (error) {
      console.error("Contact enrichment error:", error);
      res.status(500).json({ message: "Failed to start contact enrichment" });
    }
  });

  app.get("/api/enrichment/phone-status", async (_req, res) => {
    try {
      const status = getPhoneEnrichmentStatus();
      res.json(status);
    } catch (error) {
      console.error("Phone enrichment status error:", error);
      res.status(500).json({ message: "Failed to get phone enrichment status" });
    }
  });

  app.post("/api/enrichment/phones", async (req, res) => {
    try {
      const { marketId, batchSize } = req.body;

      if (!marketId || typeof marketId !== "string") {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      const parsedBatchSize = Math.min(Math.max(Number(batchSize) || 50, 1), 500);

      const status = getPhoneEnrichmentStatus();
      if (status.totalAvailable === 0) {
        return res.status(400).json({
          message: "No phone enrichment providers configured. Add GOOGLE_PLACES_API_KEY or SERPER_API_KEY to enable phone lookups.",
          providers: status.providers,
        });
      }

      res.json({
        message: "Phone enrichment started",
        batchSize: parsedBatchSize,
        providers: status.providers.filter(p => p.available).map(p => p.name),
      });

      enrichLeadPhones(marketId, { batchSize: parsedBatchSize }).then((result) => {
        console.log(`Phone enrichment complete: ${result.enriched} found, ${result.skipped} skipped, ${result.errors} errors`);
      }).catch((err) => {
        console.error("Phone enrichment failed:", err);
      });
    } catch (error) {
      console.error("Phone enrichment error:", error);
      res.status(500).json({ message: "Failed to start phone enrichment" });
    }
  });

  app.get("/api/enrichment/web-research-status", async (_req, res) => {
    try {
      const status = getWebResearchStatus();
      res.json(status);
    } catch (error) {
      console.error("Web research status error:", error);
      res.status(500).json({ message: "Failed to get web research status" });
    }
  });

  app.post("/api/enrichment/web-research", async (req, res) => {
    try {
      const { marketId, batchSize } = req.body;

      if (!marketId || typeof marketId !== "string") {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      const status = getWebResearchStatus();
      if (!status.googlePlacesAvailable) {
        return res.status(400).json({
          message: "Google Places API key is required for web research. It is used to find business websites at property addresses.",
        });
      }

      const parsedBatchSize = Math.min(Math.max(Number(batchSize) || 25, 1), 100);

      res.json({
        message: "Web research agent started",
        batchSize: parsedBatchSize,
        capabilities: status.capabilities,
      });

      runWebResearch(marketId, { batchSize: parsedBatchSize }).then((result) => {
        console.log(`Web research complete: ${result.found} contacts found, ${result.skipped} skipped, ${result.errors} errors`);
      }).catch((err) => {
        console.error("Web research failed:", err);
      });
    } catch (error) {
      console.error("Web research error:", error);
      res.status(500).json({ message: "Failed to start web research" });
    }
  });

  app.get("/api/enrichment/pipeline-stats", async (req, res) => {
    try {
      const { marketId } = req.query;
      const stats = await getPipelineStats(marketId as string | undefined);
      res.json(stats);
    } catch (error) {
      console.error("Pipeline stats error:", error);
      res.status(500).json({ message: "Failed to get pipeline stats" });
    }
  });

  app.post("/api/enrichment/run-pipeline", async (req, res) => {
    try {
      const { marketId, batchSize } = req.body;
      const parsedBatchSize = Math.min(Math.max(Number(batchSize) || 25, 1), 100);

      res.json({
        message: "Full enrichment pipeline started (TX Filing -> Phone -> Web Research)",
        batchSize: parsedBatchSize,
      });

      runFullPipeline(marketId, { batchSize: parsedBatchSize }).then((results) => {
        console.log("[Pipeline] Results:", results);
      }).catch((err) => {
        console.error("[Pipeline] Failed:", err);
      });
    } catch (error) {
      console.error("Pipeline error:", error);
      res.status(500).json({ message: "Failed to start enrichment pipeline" });
    }
  });

  app.get("/api/leads/:id/confidence", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      const confidence = calculateContactConfidence(lead);
      res.json(confidence);
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate confidence" });
    }
  });

  app.post("/api/jobs/:id/run", async (req, res) => {
    try {
      const job = await storage.getJobs();
      const targetJob = job.find((j) => j.id === req.params.id);
      if (!targetJob) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json({ message: `Job "${targetJob.name}" triggered` });
    } catch (error) {
      console.error("Job trigger error:", error);
      res.status(500).json({ message: "Failed to trigger job" });
    }
  });

  // Storm Monitor
  app.get("/api/storm/status", async (_req, res) => {
    try {
      const status = getStormMonitorStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get storm monitor status" });
    }
  });

  app.post("/api/storm/monitor/start", async (_req, res) => {
    try {
      startStormMonitor(10);
      res.json({ message: "Storm monitor started (10-minute interval)" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start storm monitor" });
    }
  });

  app.post("/api/storm/monitor/stop", async (_req, res) => {
    try {
      stopStormMonitor();
      res.json({ message: "Storm monitor stopped" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop storm monitor" });
    }
  });

  app.post("/api/storm/scan", async (_req, res) => {
    try {
      const result = await runStormMonitorCycle();
      res.json(result);
    } catch (error) {
      console.error("Storm scan error:", error);
      res.status(500).json({ message: "Failed to run storm scan" });
    }
  });

  // Storm Runs
  app.get("/api/storm/runs", async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const runs = await storage.getStormRuns(limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get storm runs" });
    }
  });

  app.get("/api/storm/runs/active", async (_req, res) => {
    try {
      const runs = await storage.getActiveStormRuns();
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get active storm runs" });
    }
  });

  app.get("/api/storm/runs/:id", async (req, res) => {
    try {
      const run = await storage.getStormRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Storm run not found" });
      res.json(run);
    } catch (error) {
      res.status(500).json({ message: "Failed to get storm run" });
    }
  });

  // Response Queue
  app.get("/api/storm/response-queue", async (req, res) => {
    try {
      const stormRunId = req.query.stormRunId as string | undefined;
      if (stormRunId) {
        const queue = await storage.getResponseQueue(stormRunId);
        res.json(queue);
      } else {
        const queue = await storage.getActiveResponseQueue();
        res.json(queue);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get response queue" });
    }
  });

  app.patch("/api/storm/response-queue/:id", async (req, res) => {
    try {
      const { status, assignedTo } = req.body;
      const updates: any = {};
      if (status) updates.status = status;
      if (assignedTo) updates.assignedTo = assignedTo;
      if (status === "called") updates.calledAt = new Date();
      const updated = await storage.updateResponseQueueItem(req.params.id, updates);
      if (!updated) return res.status(404).json({ message: "Queue item not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update queue item" });
    }
  });

  // Alert Configs
  app.get("/api/storm/alert-configs", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const configs = await storage.getStormAlertConfigs(marketId);
      res.json(configs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get alert configs" });
    }
  });

  app.post("/api/storm/alert-configs", async (req, res) => {
    try {
      const parsed = insertStormAlertConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid config data", errors: parsed.error.flatten() });
      }
      const config = await storage.createStormAlertConfig(parsed.data);
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to create alert config" });
    }
  });

  app.patch("/api/storm/alert-configs/:id", async (req, res) => {
    try {
      const updated = await storage.updateStormAlertConfig(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Config not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update alert config" });
    }
  });

  app.delete("/api/storm/alert-configs/:id", async (req, res) => {
    try {
      await storage.deleteStormAlertConfig(req.params.id);
      res.json({ message: "Config deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete alert config" });
    }
  });

  // Alert History
  app.get("/api/storm/alert-history", async (req, res) => {
    try {
      const stormRunId = req.query.stormRunId as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const history = await storage.getAlertHistory(stormRunId, limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Failed to get alert history" });
    }
  });

  // Xweather Hail Prediction
  app.get("/api/xweather/status", async (_req, res) => {
    try {
      const status = getXweatherStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get Xweather status" });
    }
  });

  app.get("/api/xweather/threats", async (_req, res) => {
    try {
      const threats = getActiveThreats();
      res.json(threats);
    } catch (error) {
      res.status(500).json({ message: "Failed to get active threats" });
    }
  });

  app.post("/api/xweather/scan", async (_req, res) => {
    try {
      const result = await runXweatherCycle();
      res.json(result);
    } catch (error) {
      console.error("Xweather scan error:", error);
      res.status(500).json({ message: "Failed to run Xweather scan" });
    }
  });

  app.post("/api/xweather/monitor/start", async (_req, res) => {
    try {
      startXweatherMonitor(2);
      res.json({ message: "Xweather predictive monitor started (2-minute interval)" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start Xweather monitor" });
    }
  });

  app.post("/api/xweather/monitor/stop", async (_req, res) => {
    try {
      stopXweatherMonitor();
      res.json({ message: "Xweather monitor stopped" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop Xweather monitor" });
    }
  });

  // Owner Intelligence (12-Agent Pipeline)
  app.get("/api/intelligence/status", async (_req, res) => {
    try {
      const status = getIntelligenceStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get intelligence status" });
    }
  });

  app.post("/api/intelligence/run", async (req, res) => {
    try {
      const { marketId, batchSize, processAll } = req.body;
      const parsedBatchSize = processAll ? 99999 : Math.min(Math.max(Number(batchSize) || 10, 1), 50);

      res.json({
        message: processAll ? "Owner intelligence pipeline started for ALL leads (16 agents)" : "Owner intelligence pipeline started (16 agents)",
        batchSize: parsedBatchSize,
        processAll: !!processAll,
      });

      runOwnerIntelligenceBatch(marketId, { batchSize: parsedBatchSize, processAll: !!processAll }).then((result) => {
        console.log(`[Intelligence] Complete: ${result.enriched} enriched, ${result.skipped} skipped, ${result.errors} errors`);
      }).catch((err) => {
        console.error("[Intelligence] Failed:", err);
      });
    } catch (error) {
      console.error("Intelligence pipeline error:", error);
      res.status(500).json({ message: "Failed to start intelligence pipeline" });
    }
  });

  app.post("/api/intelligence/run-single/:id", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const result = await runOwnerIntelligence(lead);

      const chainLength = (result.llcChain || []).length;
      const hasOffshoreEntity = (result.llcChain || []).some((link: any) => {
        const state = (link.entityType || "").toUpperCase();
        const addr = (link.registeredAgentAddress || "").toUpperCase();
        return state.includes("SG") || state.includes("KY") || state.includes("BVI") ||
               state.includes("SINGAPORE") || state.includes("CAYMAN") || state.includes("BERMUDA") ||
               addr.includes("SINGAPORE") || addr.includes("CAYMAN") || addr.includes("BERMUDA");
      });
      const hasCorpService = (result.llcChain || []).some((link: any) => {
        const ra = (link.registeredAgent || "").toUpperCase();
        return ra.includes("CSC") || ra.includes("CORPORATION SERVICE") || ra.includes("CT CORPORATION") ||
               ra.includes("REGISTERED AGENTS") || ra.includes("NATIONAL REGISTERED") || ra.includes("COGENCY");
      });
      const noRealPeople = !result.managingMember;
      let ownershipFlag: string | null = null;
      if (chainLength >= 3 || (chainLength >= 2 && hasOffshoreEntity)) {
        ownershipFlag = "Deep Holding Structure";
      } else if (chainLength >= 2 && noRealPeople) {
        ownershipFlag = "Multi-Layer Holding";
      } else if (chainLength >= 2) {
        ownershipFlag = "Multi-Layer Holding";
      } else if (hasCorpService && noRealPeople) {
        ownershipFlag = "Corp Service Shield";
      }

      await storage.updateLead(lead.id, {
        managingMember: result.managingMember,
        managingMemberTitle: result.managingMemberTitle,
        managingMemberPhone: result.managingMemberPhone,
        managingMemberEmail: result.managingMemberEmail,
        llcChain: result.llcChain,
        ownerIntelligence: result.dossier,
        buildingContacts: result.dossier.buildingContacts,
        intelligenceScore: result.score,
        intelligenceSources: result.sources,
        intelligenceAt: new Date(),
        ownershipFlag,
      } as any);

      res.json(result);
    } catch (error: any) {
      console.error("Single intelligence error:", error);
      res.status(500).json({ message: "Failed to run intelligence", error: error.message });
    }
  });

  app.get("/api/leads/:id/intelligence", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const dossier = lead.ownerIntelligence as any;
      const realPeople = dossier?.realPeople || [];
      const topPerson = realPeople[0];

      res.json({
        managingMember: lead.managingMember || topPerson?.name || null,
        managingMemberTitle: lead.managingMemberTitle || topPerson?.title || null,
        managingMemberPhone: lead.managingMemberPhone || topPerson?.phone || null,
        managingMemberEmail: lead.managingMemberEmail || topPerson?.email || null,
        llcChain: lead.llcChain || dossier?.llcChain || [],
        buildingContacts: lead.buildingContacts || dossier?.buildingContacts || [],
        dossier: dossier,
        score: lead.intelligenceScore,
        sources: lead.intelligenceSources || dossier?.agentResults?.filter((a: any) => a.status === 'found').map((a: any) => a.agent) || [],
        generatedAt: lead.intelligenceAt || dossier?.generatedAt || null,
        realPeople: realPeople,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get intelligence data" });
    }
  });

  app.get("/api/leads/:id/evidence", async (req, res) => {
    try {
      const evidence = await getEvidenceForLead(req.params.id);
      res.json(evidence);
    } catch (error) {
      res.status(500).json({ message: "Failed to get evidence data" });
    }
  });

  app.get("/api/leads/:id/conflicts", async (req, res) => {
    try {
      const conflicts = await getConflictsForLead(req.params.id);
      res.json(conflicts);
    } catch (error) {
      res.status(500).json({ message: "Failed to get conflict data" });
    }
  });

  app.post("/api/conflicts/:id/resolve", async (req, res) => {
    try {
      const { pickedEvidenceId, resolvedBy } = req.body;
      if (!pickedEvidenceId) return res.status(400).json({ message: "pickedEvidenceId required" });
      await resolveConflict(req.params.id, pickedEvidenceId, resolvedBy || "admin");
      res.json({ message: "Conflict resolved" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to resolve conflict" });
    }
  });

  app.post("/api/leads/:id/validate-contacts", async (req, res) => {
    try {
      const result = await validateAllEvidenceForLead(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to validate contacts" });
    }
  });

  app.get("/api/compliance/rate-limits", async (_req, res) => {
    try {
      res.json(getRateLimitStatus());
    } catch (error) {
      res.status(500).json({ message: "Failed to get rate limit status" });
    }
  });

  app.post("/api/validate/phone", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "phone required" });
    const normalized = normalizePhoneE164(phone);
    const validation = isValidPhoneStructure(phone);
    res.json({ normalized, display: normalized ? `(${normalized.slice(2,5)}) ${normalized.slice(5,8)}-${normalized.slice(8)}` : null, ...validation });
  });

  app.post("/api/validate/email", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "email required" });
    const validation = validateEmailSyntax(email);
    res.json(validation);
  });

  app.get("/api/leads/:id/enrichment-jobs", async (req, res) => {
    try {
      const jobs = await db
        .select()
        .from(enrichmentJobs)
        .where(eq(enrichmentJobs.leadId, req.params.id))
        .orderBy(sql`created_at DESC`)
        .limit(20);
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get enrichment jobs" });
    }
  });

  app.get("/api/admin/enrichment-jobs", async (_req, res) => {
    try {
      const jobs = await db
        .select()
        .from(enrichmentJobs)
        .orderBy(sql`created_at DESC`)
        .limit(100);
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get enrichment jobs" });
    }
  });

  app.get("/api/leads/:id/contact-path", async (req, res) => {
    try {
      const path = await buildContactPath(req.params.id);
      res.json(path);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to build contact path" });
    }
  });

  app.post("/api/evidence/:id/mark-wrong", async (req, res) => {
    try {
      const { feedback } = req.body;
      const result = await markWrongNumber(req.params.id, feedback || "Wrong number reported by contractor");
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to mark wrong" });
    }
  });

  app.post("/api/evidence/:id/confirm-good", async (req, res) => {
    try {
      await markConfirmedGood(req.params.id);
      res.json({ message: "Confirmed" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to confirm" });
    }
  });

  app.post("/api/evidence/:id/suppress", async (req, res) => {
    try {
      const { reason } = req.body;
      await suppressContact(req.params.id, reason || "Manual suppression");
      res.json({ message: "Suppressed" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to suppress" });
    }
  });

  app.post("/api/evidence/:id/unsuppress", async (req, res) => {
    try {
      await unsuppressContact(req.params.id);
      res.json({ message: "Unsuppressed" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to unsuppress" });
    }
  });

  app.post("/api/leads/:id/verify-phones", async (req, res) => {
    try {
      if (!isTwilioConfigured()) {
        return res.status(400).json({ message: "Twilio not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN." });
      }
      const result = await verifyAllPhonesForLead(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to verify phones" });
    }
  });

  app.post("/api/validate/phone-lookup", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ message: "phone required" });
      const result = await lookupPhone(phone);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to lookup phone" });
    }
  });

  app.get("/api/pm-companies", async (_req, res) => {
    try {
      const companies = await getAllPmCompanies();
      res.json(companies);
    } catch (error) {
      res.status(500).json({ message: "Failed to get PM companies" });
    }
  });

  app.post("/api/pm-companies", async (req, res) => {
    try {
      const { companyName, phone, email, website, address, city, contactPerson, contactTitle, contactPhone, contactEmail } = req.body;
      if (!companyName) return res.status(400).json({ message: "companyName required" });
      const id = await addPmCompany({ companyName, phone, email, website, address, city, contactPerson, contactTitle, contactPhone, contactEmail, source: "manual" });
      res.json({ id, message: "PM company added" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to add PM company" });
    }
  });

  app.post("/api/pm-companies/seed", async (_req, res) => {
    try {
      const count = await seedPmCompanies();
      res.json({ seeded: count });
    } catch (error) {
      res.status(500).json({ message: "Failed to seed PM companies" });
    }
  });

  app.get("/api/leads/:id/permits", async (req, res) => {
    try {
      const leadId = req.params.id;
      const lead = await storage.getLead(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const directMatches = await db
        .select()
        .from(buildingPermits)
        .where(eq(buildingPermits.leadId, leadId))
        .orderBy(sql`${buildingPermits.issuedDate} DESC`);

      if (directMatches.length > 0) {
        return res.json(directMatches);
      }

      const normalAddr = lead.address.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const allPermits = await db.select().from(buildingPermits).orderBy(sql`${buildingPermits.issuedDate} DESC`);
      const addrMatches = allPermits.filter((p) => {
        const pAddr = p.address.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return pAddr === normalAddr;
      });
      res.json(addrMatches);
    } catch (error) {
      res.status(500).json({ message: "Failed to get permits for lead" });
    }
  });

  app.get("/api/leads/:id/claims", async (req, res) => {
    try {
      const claims = await storage.getClaimsForLead(req.params.id);
      res.json(claims);
    } catch (error) {
      res.status(500).json({ message: "Failed to get provenance claims" });
    }
  });

  app.get("/api/intelligence/skip-trace-status", async (_req, res) => {
    try {
      const status = getSkipTraceStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get skip trace status" });
    }
  });

  // ============================================================
  // Code Violations & 311 Endpoints
  // ============================================================

  app.get("/api/violations/status", async (_req, res) => {
    try {
      const status = await getDallasRecordsStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get violations status", error: error.message });
    }
  });

  app.post("/api/violations/import-311", async (req, res) => {
    try {
      const { marketId, daysBack } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await importDallas311(marketId, { daysBack: daysBack || 90 });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import 311 data", error: error.message });
    }
  });

  app.post("/api/violations/import-code", async (req, res) => {
    try {
      const { marketId, daysBack } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await importDallasCodeViolations(marketId, { daysBack: daysBack || 365 });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import code violations", error: error.message });
    }
  });

  app.post("/api/violations/match", async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await matchViolationsToLeads(marketId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to match violations to leads", error: error.message });
    }
  });

  // ============================================================
  // Building Permits Endpoints
  // ============================================================

  app.get("/api/permits/status", async (_req, res) => {
    try {
      const stats = await getPermitStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get permit stats", error: error.message });
    }
  });

  app.post("/api/permits/import-dallas", async (req, res) => {
    try {
      const { marketId, daysBack, commercialOnly } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await importDallasPermits(marketId, { daysBack, commercialOnly });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import Dallas permits", error: error.message });
    }
  });

  app.post("/api/permits/import-fortworth", async (req, res) => {
    try {
      const { marketId, daysBack } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await importFortWorthPermits(marketId, { daysBack });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import Fort Worth permits", error: error.message });
    }
  });

  app.get("/api/permits/roofing-stats", async (_req, res) => {
    try {
      const stats = await getRoofingPermitStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get roofing permit stats", error: error.message });
    }
  });

  app.post("/api/permits/import-roofing", async (req, res) => {
    try {
      const { marketId, yearsBack, commercialOnly } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await importDallasRoofingPermits(marketId, {
        yearsBack: yearsBack ?? 10,
        commercialOnly: commercialOnly ?? false,
      });
      const matchResult = await matchPermitsToLeads(marketId);
      res.json({
        ...result,
        matched: matchResult.matched,
        unmatched: matchResult.unmatched,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import roofing permits", error: error.message });
    }
  });

  app.post("/api/permits/match", async (req, res) => {
    try {
      const { marketId } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await matchPermitsToLeads(marketId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to match permits to leads", error: error.message });
    }
  });

  // ============================================================
  // Flood Zone Endpoints
  // ============================================================

  app.get("/api/flood/status", async (req, res) => {
    try {
      const stats = await getFloodZoneStats(req.query.marketId as string);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get flood zone stats", error: error.message });
    }
  });

  app.post("/api/flood/enrich", async (req, res) => {
    try {
      const { marketId, batchSize } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await enrichLeadsWithFloodZones(marketId, { batchSize });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to enrich flood zones", error: error.message });
    }
  });

  // ============================================================
  // Lead Score v2 Endpoints
  // ============================================================

  app.get("/api/leads/:id/score-breakdown", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      const breakdown = getScoreBreakdown(lead as any);
      const totalScore = calculateScore(lead as any);
      const distressScore = calculateDistressScore(lead as any);
      res.json({ score: totalScore, distressScore, breakdown });
    } catch (error) {
      res.status(500).json({ message: "Failed to get score breakdown" });
    }
  });

  app.post("/api/leads/recalculate-scores", async (req, res) => {
    try {
      const { marketId } = req.body;
      const filter: any = {};
      if (marketId) filter.marketId = marketId;
      filter.limit = 50000;
      const { leads: allLeads } = await storage.getLeads(filter);
      let updated = 0;
      for (const lead of allLeads) {
        const roofArea = Math.round(lead.sqft / Math.max(lead.stories || 1, 1));
        let claimWindowOpen: boolean | null = null;
        if (lead.lastHailDate) {
          const daysSince = Math.floor((Date.now() - new Date(lead.lastHailDate).getTime()) / (1000 * 60 * 60 * 24));
          claimWindowOpen = daysSince <= 730;
        }
        const enrichedLead = { ...lead, estimatedRoofArea: roofArea, claimWindowOpen } as any;
        const newScore = calculateScore(enrichedLead);
        const distress = calculateDistressScore(enrichedLead);
        const updates: any = {};
        if (roofArea !== lead.estimatedRoofArea) updates.estimatedRoofArea = roofArea;
        if (claimWindowOpen !== lead.claimWindowOpen) updates.claimWindowOpen = claimWindowOpen;
        if (newScore !== lead.leadScore) updates.leadScore = newScore;
        if (distress !== (lead.distressScore || 0)) updates.distressScore = distress;
        if (Object.keys(updates).length > 0) {
          await storage.updateLead(lead.id, updates);
          updated++;
        }
      }
      res.json({ total: allLeads.length, updated });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to recalculate scores", error: error.message });
    }
  });

  app.post("/api/leads/scan-roofing-permits", async (req, res) => {
    try {
      const roofingPermits = await db.execute(sql`
        SELECT bp.lead_id, bp.address, bp.contractor, bp.contractor_phone, bp.work_description, bp.issued_date, bp.permit_type
        FROM building_permits bp
        WHERE (bp.work_description ILIKE '%roof%' OR bp.permit_type ILIKE '%roof%')
        ORDER BY bp.issued_date DESC
      `);
      const permitsByLead = new Map<string, any>();
      const addressToLeadId = new Map<string, string>();
      const { leads: allLeads } = await storage.getLeads({ limit: 50000 });
      for (const lead of allLeads) {
        const normalAddr = lead.address.toUpperCase().replace(/[^A-Z0-9]/g, '');
        addressToLeadId.set(normalAddr, lead.id);
      }
      for (const p of roofingPermits.rows) {
        let leadId = p.lead_id as string | null;
        if (!leadId && p.address) {
          const normalAddr = (p.address as string).toUpperCase().replace(/[^A-Z0-9]/g, '');
          leadId = addressToLeadId.get(normalAddr) || null;
        }
        if (leadId && !permitsByLead.has(leadId)) {
          permitsByLead.set(leadId, p);
        }
      }
      let updated = 0;
      for (const [leadId, permit] of Array.from(permitsByLead.entries())) {
        const desc = (permit.work_description || "").toLowerCase();
        let roofType: string | null = null;
        if (desc.includes("tpo")) roofType = "TPO";
        else if (desc.includes("epdm")) roofType = "EPDM";
        else if (desc.includes("modified bitumen") || desc.includes("mod bit")) roofType = "Modified Bitumen";
        else if (desc.includes("built-up") || desc.includes("bur ")) roofType = "Built-Up (BUR)";
        else if (desc.includes("metal")) roofType = "Metal";
        else if (desc.includes("shingle")) roofType = "Shingle";
        else if (desc.includes("flat")) roofType = "Flat";
        let permitClassification = "Replacement";
        if (desc.includes("repair") || desc.includes("patch") || desc.includes("fix") || desc.includes("leak")) {
          permitClassification = "Repair";
        } else if (desc.includes("inspect") || desc.includes("survey")) {
          permitClassification = "Inspection";
        } else if (desc.includes("overlay")) {
          permitClassification = "Overlay";
        } else if (desc.includes("tear") || desc.includes("remove") || desc.includes("demo")) {
          permitClassification = "Tear-Off/Replace";
        } else if (desc.includes("re-roof") || desc.includes("reroof") || desc.includes("new roof") || desc.includes("replacement")) {
          permitClassification = "Replacement";
        }
        const updates: any = {
          lastRoofingPermitDate: permit.issued_date || null,
          lastRoofingContractor: permit.contractor || null,
          lastRoofingPermitType: permitClassification,
        };
        if (roofType) updates.roofType = roofType;
        await storage.updateLead(leadId, updates);
        updated++;
      }
      res.json({ totalRoofingPermits: roofingPermits.rows.length, leadsUpdated: updated });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to scan roofing permits", error: error.message });
    }
  });

  app.post("/api/leads/flag-ownership", async (req, res) => {
    try {
      const { leads: allLeads } = await storage.getLeads({ limit: 50000 });
      let flagged = 0;
      let deepHolding = 0;
      let multiLayer = 0;
      let corpShield = 0;

      for (const lead of allLeads) {
        const chain: any[] = Array.isArray(lead.llcChain) ? lead.llcChain : [];
        const intel: any = lead.ownerIntelligence || {};
        const chainLength = chain.length;

        const hasOffshoreEntity = chain.some((link: any) => {
          const state = (link.entityType || "").toUpperCase();
          const addr = (link.registeredAgentAddress || "").toUpperCase();
          const officerAddr = (link.officers || []).some((o: any) => {
            const a = (o.address || "").toUpperCase();
            return a.includes("SINGAPORE") || a.includes("CAYMAN") || a.includes("BERMUDA") || a.includes("BRITISH VIRGIN");
          });
          return state.includes("SG") || state.includes("KY") || state.includes("BVI") ||
                 state.includes("SINGAPORE") || state.includes("CAYMAN") || state.includes("BERMUDA") ||
                 addr.includes("SINGAPORE") || addr.includes("CAYMAN") || addr.includes("BERMUDA") || officerAddr;
        });
        const hasCorpService = chain.some((link: any) => {
          const ra = (link.registeredAgent || "").toUpperCase();
          return ra.includes("CSC") || ra.includes("CORPORATION SERVICE") || ra.includes("CT CORPORATION") ||
                 ra.includes("REGISTERED AGENTS") || ra.includes("NATIONAL REGISTERED") || ra.includes("COGENCY");
        });
        const noRealPeople = !lead.managingMember;

        let ownershipFlag: string | null = null;
        if (chainLength >= 3 || (chainLength >= 2 && hasOffshoreEntity)) {
          ownershipFlag = "Deep Holding Structure";
          deepHolding++;
        } else if (chainLength >= 2) {
          ownershipFlag = "Multi-Layer Holding";
          multiLayer++;
        } else if (hasCorpService && noRealPeople && chainLength >= 1) {
          ownershipFlag = "Corp Service Shield";
          corpShield++;
        }

        if (ownershipFlag !== (lead as any).ownershipFlag) {
          await storage.updateLead(lead.id, { ownershipFlag } as any);
          flagged++;
        }
      }

      res.json({
        totalScanned: allLeads.length,
        flagged,
        breakdown: { deepHolding, multiLayer, corpShield },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to flag ownership", error: error.message });
    }
  });

  // ============================================================
  // Story Estimation Endpoint
  // ============================================================

  app.post("/api/leads/estimate-stories", async (req, res) => {
    try {
      const marketId = req.body.marketId as string | undefined;
      const filter: any = { limit: 50000 };
      if (marketId) filter.marketId = marketId;
      const { leads: allLeads } = await storage.getLeads(filter);

      let updated = 0;
      let skipped = 0;

      for (const lead of allLeads) {
        const sqft = lead.sqft || 0;
        const zoning = (lead.zoning || "").toLowerCase();
        const impValue = lead.improvementValue || 0;
        const totalValue = lead.totalValue || 0;

        let estimatedStories = 1;

        if (zoning.includes("multi-family") || zoning.includes("multi family") || zoning.includes("apartment")) {
          if (sqft >= 500000) estimatedStories = 4;
          else if (sqft >= 200000) estimatedStories = 3;
          else if (sqft >= 80000) estimatedStories = 2;
          else estimatedStories = 2;
        } else if (zoning.includes("commercial") || zoning.includes("office") || zoning.includes("mixed")) {
          if (sqft >= 1000000) estimatedStories = 10;
          else if (sqft >= 500000) estimatedStories = 6;
          else if (sqft >= 200000) estimatedStories = 4;
          else if (sqft >= 100000) estimatedStories = 3;
          else if (sqft >= 50000) estimatedStories = 2;
          else estimatedStories = 1;
        } else if (zoning.includes("industrial") || zoning.includes("warehouse")) {
          estimatedStories = 1;
        }

        if (estimatedStories !== (lead.stories || 1)) {
          const roofArea = Math.round(sqft / estimatedStories);
          await storage.updateLead(lead.id, {
            stories: estimatedStories,
            estimatedRoofArea: roofArea,
          } as any);
          updated++;
        } else {
          skipped++;
        }
      }

      res.json({
        message: "Story estimation complete",
        totalLeads: allLeads.length,
        updated,
        unchanged: skipped,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to estimate stories", error: error.message });
    }
  });

  // ============================================================
  // Roof Type & Construction Type Estimation Endpoint
  // ============================================================

  app.post("/api/leads/estimate-roof-type", async (req, res) => {
    try {
      const marketId = req.body.marketId as string | undefined;
      const overwrite = req.body.overwrite === true;
      const filter: any = { limit: 50000 };
      if (marketId) filter.marketId = marketId;
      const { leads: allLeads } = await storage.getLeads(filter);

      let updatedRoof = 0;
      let updatedConstruction = 0;
      let skipped = 0;

      for (const lead of allLeads) {
        const yearBuilt = lead.yearBuilt || 1995;
        const hasRealYearBuilt = yearBuilt !== 1995;
        const zoning = (lead.zoning || "").toLowerCase();
        const sqft = lead.sqft || 0;
        const stories = lead.stories || 1;
        const roofArea = lead.estimatedRoofArea || Math.round(sqft / stories);
        const impValue = lead.improvementValue || 0;
        const impPerSqft = sqft > 0 ? impValue / sqft : 0;
        const updates: any = {};

        if (!lead.roofType || overwrite) {
          let roofType: string | null = null;

          if (zoning.includes("industrial") || zoning.includes("warehouse")) {
            if (roofArea >= 80000) roofType = "Metal";
            else if (roofArea >= 30000) roofType = "TPO";
            else if (impPerSqft > 120) roofType = "TPO";
            else roofType = "Metal";
          } else if (zoning.includes("multi-family") || zoning.includes("apartment")) {
            if (stories <= 2) roofType = "Shingle";
            else if (stories >= 4) roofType = "TPO";
            else if (hasRealYearBuilt && yearBuilt >= 2010) roofType = "TPO";
            else roofType = "Modified Bitumen";
          } else {
            if (hasRealYearBuilt) {
              if (yearBuilt >= 2010) roofType = "TPO";
              else if (yearBuilt >= 2000) roofType = "EPDM";
              else if (yearBuilt >= 1985) roofType = "Modified Bitumen";
              else roofType = "Built-Up (BUR)";
            } else {
              if (stories >= 6) roofType = "TPO";
              else if (impPerSqft > 180) roofType = "TPO";
              else if (impPerSqft > 130) roofType = "EPDM";
              else if (roofArea >= 50000) roofType = "TPO";
              else if (roofArea >= 20000) roofType = "EPDM";
              else if (roofArea >= 10000) roofType = "Modified Bitumen";
              else roofType = "Built-Up (BUR)";
            }
          }

          if (roofType) {
            updates.roofType = roofType;
            updatedRoof++;
          }
        }

        const currentConstruction = (lead.constructionType || "").toLowerCase();
        if (currentConstruction === "masonry" || currentConstruction === "unass" || !lead.constructionType || overwrite) {
          let constructionType = "Masonry";

          if (zoning.includes("industrial") || zoning.includes("warehouse")) {
            if (sqft >= 100000) constructionType = "Pre-Engineered Metal";
            else if (sqft >= 30000) constructionType = "Tilt-Wall Concrete";
            else constructionType = "Metal Building";
          } else if (zoning.includes("multi-family")) {
            if (stories >= 4) constructionType = "Steel Frame";
            else if (yearBuilt >= 2000) constructionType = "Wood Frame";
            else constructionType = "Masonry / Wood Frame";
          } else {
            if (stories >= 6) constructionType = "Steel Frame";
            else if (stories >= 3) constructionType = "Steel / Masonry";
            else if (sqft >= 50000) constructionType = "Tilt-Wall Concrete";
            else constructionType = "Masonry";
          }

          if (constructionType !== (lead.constructionType || "")) {
            updates.constructionType = constructionType;
            updatedConstruction++;
          }
        }

        if (Object.keys(updates).length > 0) {
          await storage.updateLead(lead.id, updates);
        } else {
          skipped++;
        }
      }

      res.json({
        message: "Roof type & construction estimation complete",
        totalLeads: allLeads.length,
        roofTypesUpdated: updatedRoof,
        constructionTypesUpdated: updatedConstruction,
        unchanged: skipped,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to estimate roof types", error: error.message });
    }
  });

  // ============================================================
  // Compliance / Consent Endpoints
  // ============================================================

  app.get("/api/compliance/status", async (req, res) => {
    try {
      const marketId = req.query.marketId as string;
      const filter: any = { limit: 50000 };
      if (marketId) filter.marketId = marketId;
      const { leads: allLeads, total } = await storage.getLeads(filter);
      const consentStats = {
        total,
        unknown: allLeads.filter(l => !l.consentStatus || l.consentStatus === "unknown").length,
        granted: allLeads.filter(l => l.consentStatus === "granted").length,
        denied: allLeads.filter(l => l.consentStatus === "denied").length,
        revoked: allLeads.filter(l => l.consentStatus === "revoked").length,
        dncRegistered: allLeads.filter(l => l.dncRegistered).length,
        hasPhone: allLeads.filter(l => l.ownerPhone || l.contactPhone || l.managingMemberPhone).length,
        hasEmail: allLeads.filter(l => l.ownerEmail || l.contactEmail || l.managingMemberEmail).length,
      };
      res.json(consentStats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get compliance status", error: error.message });
    }
  });

  app.patch("/api/leads/:id/consent", async (req, res) => {
    try {
      const { consentStatus, consentChannel } = req.body;
      if (!consentStatus) return res.status(400).json({ message: "consentStatus required" });
      await storage.updateLead(req.params.id, {
        consentStatus,
        consentChannel: consentChannel || "manual",
        consentDate: new Date().toISOString(),
      } as any);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update consent", error: error.message });
    }
  });

  // ============================================================
  // Recorded Documents Endpoints
  // ============================================================

  app.post("/api/documents/add", async (req, res) => {
    try {
      const result = await addRecordedDocument(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to add document", error: error.message });
    }
  });

  // ============================================================
  // Relationship Network / Portfolio Endpoints
  // ============================================================

  app.post("/api/network/analyze", async (req, res) => {
    try {
      const schema = z.object({ marketId: z.string().optional() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.issues });
      }
      const { analyzeNetwork } = await import("./network-agent");
      const result = await analyzeNetwork(parsed.data.marketId);
      res.json(result);
    } catch (error: any) {
      console.error("Network analysis error:", error);
      res.status(500).json({ message: "Failed to analyze network", error: error.message });
    }
  });

  app.get("/api/network/stats", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const { getNetworkStats } = await import("./network-agent");
      const stats = await getNetworkStats(marketId);
      res.json(stats);
    } catch (error: any) {
      console.error("Network stats error:", error);
      res.status(500).json({ message: "Failed to load network stats", error: error.message });
    }
  });

  app.get("/api/portfolios", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const sortBy = req.query.sortBy as string | undefined;
      const { getPortfolios } = await import("./network-agent");
      const portfolios = await getPortfolios(marketId, sortBy);
      res.json(portfolios);
    } catch (error: any) {
      console.error("Portfolios fetch error:", error);
      res.status(500).json({ message: "Failed to load portfolios", error: error.message });
    }
  });

  app.get("/api/portfolios/:id", async (req, res) => {
    try {
      const { getPortfolioDetail } = await import("./network-agent");
      const result = await getPortfolioDetail(req.params.id);
      if (!result) return res.status(404).json({ message: "Portfolio not found" });
      res.json(result);
    } catch (error: any) {
      console.error("Portfolio detail error:", error);
      res.status(500).json({ message: "Failed to load portfolio detail", error: error.message });
    }
  });

  // Entity Resolution & Deduplication endpoints
  app.post("/api/entity-resolution/scan", async (req, res) => {
    try {
      const { runEntityResolutionScan } = await import("./entity-resolution");
      const marketId = req.body.marketId as string | undefined;
      const result = await runEntityResolutionScan(marketId);
      res.json(result);
    } catch (error: any) {
      console.error("Entity resolution scan error:", error);
      res.status(500).json({ message: "Entity resolution scan failed", error: error.message });
    }
  });

  app.get("/api/entity-resolution/stats", async (req, res) => {
    try {
      const { getEntityResolutionStats } = await import("./entity-resolution");
      const marketId = req.query.marketId as string | undefined;
      const stats = await getEntityResolutionStats(marketId);
      res.json(stats);
    } catch (error: any) {
      console.error("Entity resolution stats error:", error);
      res.status(500).json({ message: "Failed to get stats", error: error.message });
    }
  });

  app.get("/api/entity-resolution/clusters", async (req, res) => {
    try {
      const { getClustersList } = await import("./entity-resolution");
      const marketId = req.query.marketId as string | undefined;
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const clusters = await getClustersList(marketId, status, limit, offset);
      res.json(clusters);
    } catch (error: any) {
      console.error("Entity resolution clusters error:", error);
      res.status(500).json({ message: "Failed to get clusters", error: error.message });
    }
  });

  app.post("/api/entity-resolution/merge/:id", async (req, res) => {
    try {
      const { mergeCluster } = await import("./entity-resolution");
      const result = await mergeCluster(req.params.id);
      res.json(result);
    } catch (error: any) {
      console.error("Entity resolution merge error:", error);
      res.status(500).json({ message: "Merge failed", error: error.message });
    }
  });

  app.post("/api/entity-resolution/skip/:id", async (req, res) => {
    try {
      const { skipCluster } = await import("./entity-resolution");
      await skipCluster(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Entity resolution skip error:", error);
      res.status(500).json({ message: "Skip failed", error: error.message });
    }
  });

  // ============================================================
  // Management Attribution Endpoints
  // ============================================================

  app.post("/api/attribution/scan", async (req, res) => {
    try {
      const { runManagementAttribution } = await import("./management-attribution");
      const marketId = req.body.marketId as string | undefined;
      const result = await runManagementAttribution(marketId);
      res.json(result);
    } catch (error: any) {
      console.error("Management attribution error:", error);
      res.status(500).json({ message: "Attribution scan failed", error: error.message });
    }
  });

  app.get("/api/attribution/stats", async (req, res) => {
    try {
      const { getManagementAttributionStats } = await import("./management-attribution");
      const marketId = req.query.marketId as string | undefined;
      const stats = await getManagementAttributionStats(marketId);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get attribution stats", error: error.message });
    }
  });

  // ============================================================
  // Role Inference & Decision-Maker Endpoints
  // ============================================================

  app.post("/api/roles/infer", async (req, res) => {
    try {
      const { runRoleInference } = await import("./role-inference");
      const marketId = req.body.marketId as string | undefined;
      const result = await runRoleInference(marketId);
      res.json(result);
    } catch (error: any) {
      console.error("Role inference error:", error);
      res.status(500).json({ message: "Role inference failed", error: error.message });
    }
  });

  app.get("/api/roles/stats", async (req, res) => {
    try {
      const { getRoleInferenceStats } = await import("./role-inference");
      const marketId = req.query.marketId as string | undefined;
      const stats = await getRoleInferenceStats(marketId);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get role stats", error: error.message });
    }
  });

  app.get("/api/leads/:id/decision-makers", async (req, res) => {
    try {
      const { getLeadDecisionMakers } = await import("./role-inference");
      const result = await getLeadDecisionMakers(req.params.id);
      if (!result) return res.status(404).json({ message: "Lead not found" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get decision makers", error: error.message });
    }
  });

  // ============================================================
  // Compliance Gating & Suppression Endpoints
  // ============================================================

  app.get("/api/compliance/overview", async (req, res) => {
    try {
      const { getComplianceOverview } = await import("./compliance-gate");
      const marketId = req.query.marketId as string | undefined;
      const result = await getComplianceOverview(marketId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get compliance overview", error: error.message });
    }
  });

  app.get("/api/compliance/check/:id", async (req, res) => {
    try {
      const { checkLeadCompliance } = await import("./compliance-gate");
      const result = await checkLeadCompliance(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Compliance check failed", error: error.message });
    }
  });

  app.post("/api/suppression/add", async (req, res) => {
    try {
      const { addToSuppressionList } = await import("./compliance-gate");
      const result = await addToSuppressionList(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to add suppression", error: error.message });
    }
  });

  app.delete("/api/suppression/:id", async (req, res) => {
    try {
      const { removeFromSuppressionList } = await import("./compliance-gate");
      await removeFromSuppressionList(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to remove suppression", error: error.message });
    }
  });

  app.get("/api/suppression/stats", async (req, res) => {
    try {
      const { getSuppressionStats } = await import("./compliance-gate");
      const stats = await getSuppressionStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get suppression stats", error: error.message });
    }
  });

  // ============================================================
  // Decision-Maker Confidence & Review Endpoints
  // ============================================================

  app.post("/api/dm-confidence/score", async (req, res) => {
    try {
      const { runConfidenceScoring } = await import("./dm-confidence");
      const marketId = req.body.marketId as string | undefined;
      const result = await runConfidenceScoring(marketId);
      res.json(result);
    } catch (error: any) {
      console.error("Confidence scoring error:", error);
      res.status(500).json({ message: "Confidence scoring failed", error: error.message });
    }
  });

  app.get("/api/dm-confidence/stats", async (req, res) => {
    try {
      const { getConfidenceStats } = await import("./dm-confidence");
      const marketId = req.query.marketId as string | undefined;
      const stats = await getConfidenceStats(marketId);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get confidence stats", error: error.message });
    }
  });

  app.get("/api/leads/:id/dm-confidence", async (req, res) => {
    try {
      const { computeDecisionMakerConfidence } = await import("./dm-confidence");
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      const result = computeDecisionMakerConfidence(lead);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to compute confidence", error: error.message });
    }
  });

  app.get("/api/dm-confidence/review-queue", async (req, res) => {
    try {
      const { getReviewQueue } = await import("./dm-confidence");
      const marketId = req.query.marketId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const queue = await getReviewQueue(marketId, limit, offset);
      res.json(queue);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get review queue", error: error.message });
    }
  });

  app.post("/api/dm-confidence/review/:id", async (req, res) => {
    try {
      const { reviewDecisionMaker } = await import("./dm-confidence");
      const { action, notes, newRole } = req.body;
      if (!action) return res.status(400).json({ message: "action is required" });
      const result = await reviewDecisionMaker(req.params.id, action, notes, newRole);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Review failed", error: error.message });
    }
  });

  app.post("/api/leads/:id/enrich", async (req, res) => {
    try {
      const { enrichLead } = await import("./lead-enrichment-orchestrator");
      const progress = await enrichLead(req.params.id);
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: "Enrichment failed", error: error.message });
    }
  });

  app.get("/api/leads/:id/enrichment-status", async (req, res) => {
    try {
      const { getEnrichmentProgress } = await import("./lead-enrichment-orchestrator");
      const progress = getEnrichmentProgress(req.params.id);
      if (progress) {
        res.json(progress);
      } else {
        const lead = await db.select().from(leadsTable).where(eq(leadsTable.id, req.params.id)).limit(1);
        if (lead[0] && (lead[0] as any).enrichmentStatus === "running") {
          res.json({ leadId: req.params.id, status: "running", steps: [] });
        } else {
          res.json({ leadId: req.params.id, status: "idle", steps: [] });
        }
      }
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get status", error: error.message });
    }
  });

  app.get("/api/reverse-address/stats", async (_req, res) => {
    try {
      const { getReverseAddressStats } = await import("./reverse-address-enrichment");
      const stats = await getReverseAddressStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get stats", error: error.message });
    }
  });

  app.post("/api/reverse-address/scan", async (req, res) => {
    try {
      const schema = z.object({ marketId: z.string().optional(), batchSize: z.number().int().min(1).max(500).optional() });
      const parsed = schema.safeParse(req.body);
      const { marketId, batchSize } = parsed.success ? parsed.data : { marketId: undefined, batchSize: 200 };
      const { runReverseAddressEnrichment } = await import("./reverse-address-enrichment");
      const result = await runReverseAddressEnrichment(marketId, batchSize || 200);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Scan failed", error: error.message });
    }
  });

  app.get("/api/leads/:id/rooftop-owner", async (req, res) => {
    try {
      const { getRooftopOwner } = await import("./rooftop-owner-resolver");
      const result = await getRooftopOwner(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/portfolio/top", async (req, res) => {
    try {
      const { getTopPortfolioOwners } = await import("./rooftop-owner-resolver");
      const limit = parseInt(req.query.limit as string) || 25;
      const result = await getTopPortfolioOwners(limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/portfolio/owner/:normalizedName", async (req, res) => {
    try {
      const { getPortfolioProperties } = await import("./rooftop-owner-resolver");
      const normalizedName = decodeURIComponent(req.params.normalizedName);
      const result = await getPortfolioProperties(normalizedName);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/rooftop-owners/rebuild", async (req, res) => {
    try {
      const { resolveRooftopOwners, buildPortfolioGroups } = await import("./rooftop-owner-resolver");
      console.log("[API] Starting rooftop owner resolution...");
      const resolveResult = await resolveRooftopOwners();
      console.log(`[API] Resolved ${resolveResult.people} people from ${resolveResult.processed} leads`);
      const portfolioResult = await buildPortfolioGroups();
      console.log(`[API] Built ${portfolioResult.groups} portfolio groups (${portfolioResult.multiProperty} multi-property)`);
      res.json({
        ...resolveResult,
        portfolioGroups: portfolioResult.groups,
        multiPropertyOwners: portfolioResult.multiProperty,
      });
    } catch (error: any) {
      console.error("[API] Rooftop owner rebuild failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Start storm monitor on boot
  startStormMonitor(10);
  startXweatherMonitor(2);

  return httpServer;
}
