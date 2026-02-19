import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
import { importNoaaHailData, importNoaaMultiYear } from "./noaa-importer";
import { importPropertyCsv, generateSampleCsv } from "./property-importer";
import { importDcadProperties } from "./dcad-agent";
import { correlateHailToLeads } from "./hail-correlator";
import { enrichLeadContacts, getEnrichmentStatus } from "./contact-enrichment";
import { enrichLeadPhones, getPhoneEnrichmentStatus } from "./phone-enrichment";
import { runWebResearch, getWebResearchStatus } from "./web-research-agent";
import { getPipelineStats, runFullPipeline, calculateContactConfidence } from "./enrichment-pipeline";
import { getHailTrackerData } from "./hail-tracker";
import { startJobScheduler } from "./job-scheduler";
import { runStormMonitorCycle, startStormMonitor, stopStormMonitor, getStormMonitorStatus } from "./storm-monitor";
import { runXweatherCycle, startXweatherMonitor, stopXweatherMonitor, getXweatherStatus, getActiveThreats } from "./xweather-hail";
import { updateLeadSchema, insertStormAlertConfigSchema, type LeadFilter } from "@shared/schema";

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

  // Start storm monitor on boot
  startStormMonitor(10);
  startXweatherMonitor(2);

  return httpServer;
}
