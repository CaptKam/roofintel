import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
import { importNoaaHailData, importNoaaMultiYear } from "./noaa-importer";
import { startJobScheduler } from "./job-scheduler";
import { updateLeadSchema, type LeadFilter } from "@shared/schema";

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
      };
      const leads = await storage.getLeads(filter);
      res.json(leads);
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
      const leads = await storage.getLeads(filter);

      const headers = [
        "Address", "City", "County", "State", "Zip", "Sqft", "Year Built",
        "Zoning", "Roof Year", "Roof Material", "Hail Events", "Last Hail Date",
        "Last Hail Size", "Owner Name", "Owner Type", "LLC Name", "Phone",
        "Email", "Score", "Status", "Total Value",
      ];

      const rows = leads.map((l) => [
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

  return httpServer;
}
