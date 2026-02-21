import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
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
import { getSkipTraceStatus } from "./skip-trace-agent";
import { importDallas311, importDallasCodeViolations, matchViolationsToLeads, getDallasRecordsStatus, addRecordedDocument } from "./dallas-records-agent";
import { importDallasPermits, importFortWorthPermits, matchPermitsToLeads, getPermitStats } from "./permits-agent";
import { enrichLeadsWithFloodZones, getFloodZoneStats } from "./flood-zone-agent";
import { calculateScore, calculateDistressScore, getScoreBreakdown } from "./seed";
import { updateLeadSchema, insertStormAlertConfigSchema, type LeadFilter } from "@shared/schema";
import { db } from "./storage";
import { sql } from "drizzle-orm";

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
      const { marketId, batchSize } = req.body;
      const parsedBatchSize = Math.min(Math.max(Number(batchSize) || 10, 1), 50);

      res.json({
        message: "Owner intelligence pipeline started (16 agents)",
        batchSize: parsedBatchSize,
      });

      runOwnerIntelligenceBatch(marketId, { batchSize: parsedBatchSize }).then((result) => {
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

      res.json({
        managingMember: lead.managingMember,
        managingMemberTitle: lead.managingMemberTitle,
        managingMemberPhone: lead.managingMemberPhone,
        managingMemberEmail: lead.managingMemberEmail,
        llcChain: lead.llcChain,
        buildingContacts: lead.buildingContacts,
        dossier: lead.ownerIntelligence,
        score: lead.intelligenceScore,
        sources: lead.intelligenceSources,
        generatedAt: lead.intelligenceAt,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get intelligence data" });
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

  // Start storm monitor on boot
  startStormMonitor(10);
  startXweatherMonitor(2);

  return httpServer;
}
