import type { Express } from "express";
import { getGraphIntelligence } from "./graph-engine";
import { createServer, type Server } from "http";
import multer from "multer";
import { z } from "zod";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
import { importNoaaHailData, importNoaaMultiYear } from "./noaa-importer";
import { importPropertyCsv, generateSampleCsv } from "./property-importer";
import { importDcadProperties, inferCityFromCoords } from "./dcad-agent";
import { importTadProperties } from "./tad-agent";
import { importCollinCadProperties } from "./collin-cad-agent";
import { importDentonCadProperties } from "./denton-cad-agent";
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
import { recordBatchEvidence, getEvidenceForLead, getConflictsForLead, resolveConflict, backfillEvidenceVerification, type EvidenceInput } from "./evidence-recorder";
import { validateAllEvidenceForLead, normalizePhoneE164, isValidPhoneStructure, validateEmailSyntax, cleanupPollutedContactNames, isPersonName } from "./contact-validation";
import { getRateLimitStatus, isDomainBlocked } from "./config/sourcePolicy";
import { lookupPhone, verifyAllPhonesForLead, isTwilioConfigured } from "./twilio-lookup";
import { markWrongNumber, markConfirmedGood, suppressContact, unsuppressContact } from "./contact-feedback";
import { buildContactPath } from "./contact-ranking";
import { seedPmCompanies, findPmCompany, addPmCompany, getAllPmCompanies } from "./pm-company-manager";
import { getSkipTraceStatus } from "./skip-trace-agent";
import { importDallas311, importDallasCodeViolations, matchViolationsToLeads, getDallasRecordsStatus, addRecordedDocument } from "./dallas-records-agent";
import { importDallasPermits, importFortWorthPermits, matchPermitsToLeads, getPermitStats, importDallasRoofingPermits, getRoofingPermitStats, cleanupContractorData } from "./permits-agent";
import { enrichLeadsWithFloodZones, getFloodZoneStats } from "./flood-zone-agent";
import { calculateScore, calculateDistressScore, getScoreBreakdown } from "./seed";
import { updateLeadSchema, insertStormAlertConfigSchema, type LeadFilter, buildingPermits, leads as leadsTable, enrichmentJobs, apiUsageTracker, savedFilters, insertSavedFilterSchema } from "@shared/schema";
import { getHunterUsage, searchHunterDomain, findHunterEmail } from "./hunter-io";
import { runBatchGooglePlaces, getBatchGooglePlacesStatus, cancelBatchGooglePlaces } from "./batch-google-places";
import { getPDLUsage, enrichPersonPDL, enrichCompanyPDL } from "./pdl-enrichment";
import { enrichLeadFromEdgar, searchEdgarCompany } from "./sec-edgar";
import { enrichLeadFromTXSOS } from "./tx-sos";
import { enrichLeadFromCountyClerk } from "./county-clerk";
import { db } from "./storage";
import { sql, eq } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function computeDataConfidence(lead: any): "high" | "medium" | "low" {
  let indicators = 0;
  if (lead.ownerPhone || lead.contactPhone || lead.managingMemberPhone) indicators++;
  if (lead.contactName && lead.contactName.trim().length > 0) indicators++;
  if (lead.enrichmentStatus === "complete") indicators++;
  if (lead.ownershipStructure) indicators++;
  if (lead.decisionMakers && (Array.isArray(lead.decisionMakers) ? lead.decisionMakers.length > 0 : true)) indicators++;
  if (lead.dmReviewStatus === "auto_approved" || lead.dmReviewStatus === "auto_publish" || lead.dmReviewStatus === "approved") indicators++;
  if (indicators >= 3) return "high";
  if (indicators >= 1) return "medium";
  return "low";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedDatabase();
  startJobScheduler();

  app.get("/robots.txt", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.type("text/plain").send(
      `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get("/sitemap.xml", (req, res) => {
    const pages = ["/", "/leads", "/map", "/portfolios", "/network", "/admin", "/about", "/contact", "/privacy"];
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${baseUrl}${p}</loc><changefreq>daily</changefreq></url>`).join("\n")}
</urlset>`;
    res.type("application/xml").send(xml);
  });

  const sitemapVariants = ["/sitemap_index.xml", "/sitemap-index.xml", "/sitemaps.xml", "/sitemap1.xml", "/post-sitemap.xml", "/page-sitemap.xml", "/category-sitemap.xml", "/news-sitemap.xml"];
  for (const path of sitemapVariants) {
    app.get(path, (_req, res) => res.status(404).type("text/plain").send("Not found"));
  }

  app.get("/api/markets", async (_req, res) => {
    try {
      const markets = await storage.getMarkets();
      res.json(markets);
    } catch (error) {
      console.error("Markets fetch error:", error);
      res.status(500).json({ message: "Failed to load markets" });
    }
  });

  app.get("/api/markets/:marketId/data-sources", async (req, res) => {
    try {
      const sources = await storage.getMarketDataSources(req.params.marketId);
      res.json(sources);
    } catch (error) {
      console.error("Market data sources fetch error:", error);
      res.status(500).json({ message: "Failed to load market data sources" });
    }
  });

  app.get("/api/market-data-sources/:id", async (req, res) => {
    try {
      const source = await storage.getMarketDataSourceById(req.params.id);
      if (!source) return res.status(404).json({ message: "Data source not found" });
      res.json(source);
    } catch (error) {
      console.error("Market data source fetch error:", error);
      res.status(500).json({ message: "Failed to load data source" });
    }
  });

  app.post("/api/market-data-sources", async (req, res) => {
    try {
      const source = await storage.createMarketDataSource(req.body);
      res.status(201).json(source);
    } catch (error) {
      console.error("Market data source create error:", error);
      res.status(500).json({ message: "Failed to create data source" });
    }
  });

  app.patch("/api/market-data-sources/:id", async (req, res) => {
    try {
      const source = await storage.updateMarketDataSource(req.params.id, req.body);
      if (!source) return res.status(404).json({ message: "Data source not found" });
      res.json(source);
    } catch (error) {
      console.error("Market data source update error:", error);
      res.status(500).json({ message: "Failed to update data source" });
    }
  });

  app.get("/api/dashboard/command-center", async (_req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [
        heroResult,
        pipelineResult,
        coverageResult,
        priorityResult,
        stormPulseResult,
        stormAffectedResult,
        scoreDistResult,
        topValueResult,
        competitorResult,
      ] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total_leads,
            COALESCE(SUM(total_value), 0)::bigint AS total_pipeline_value,
            COUNT(*) FILTER (WHERE hail_events > 0 AND lead_score >= 60 AND (owner_phone IS NOT NULL OR contact_phone IS NOT NULL))::int AS actionable_leads,
            COALESCE(ROUND(AVG(lead_score)::numeric, 1), 0)::float AS avg_score,
            COUNT(*) FILTER (WHERE lead_score >= 80)::int AS hot_leads
          FROM leads
        `),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'new')::int AS new,
            COUNT(*) FILTER (WHERE status = 'contacted')::int AS contacted,
            COUNT(*) FILTER (WHERE status = 'qualified')::int AS qualified,
            COUNT(*) FILTER (WHERE status = 'proposal')::int AS proposal,
            COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
          FROM leads
        `),
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE owner_phone IS NOT NULL OR contact_phone IS NOT NULL)::int AS has_phone,
            COUNT(*) FILTER (WHERE owner_email IS NOT NULL OR contact_email IS NOT NULL)::int AS has_email,
            COUNT(*) FILTER (WHERE managing_member IS NOT NULL)::int AS has_decision_maker,
            COUNT(*) FILTER (WHERE ownership_structure IS NOT NULL)::int AS has_ownership_classified,
            COUNT(*) FILTER (WHERE enrichment_status = 'complete')::int AS enriched,
            COUNT(*) FILTER (WHERE permit_contractors IS NOT NULL)::int AS has_permit_data
          FROM leads
        `),
        db.execute(sql`
          SELECT
            id, address, city, lead_score, roof_last_replaced, hail_events,
            last_hail_date, claim_window_open, owner_name,
            COALESCE(contact_name, management_contact) AS contact_name,
            COALESCE(owner_phone, contact_phone, management_phone, managing_member_phone) AS contact_phone,
            total_value
          FROM leads
          WHERE lead_score >= 50
            AND (owner_phone IS NOT NULL OR contact_phone IS NOT NULL OR managing_member_phone IS NOT NULL)
          ORDER BY lead_score DESC, hail_events DESC
          LIMIT 10
        `),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE event_date >= ${d30})::int AS recent_30d,
            COUNT(*) FILTER (WHERE event_date >= ${d7})::int AS recent_7d,
            AVG(hail_size) FILTER (WHERE event_date >= ${d30})::float AS avg_hail_size_30d
          FROM hail_events
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS affected
          FROM leads
          WHERE last_hail_date >= ${d30}
        `),
        db.execute(sql`
          SELECT
            CASE
              WHEN lead_score BETWEEN 0 AND 20 THEN '0-20'
              WHEN lead_score BETWEEN 21 AND 40 THEN '21-40'
              WHEN lead_score BETWEEN 41 AND 60 THEN '41-60'
              WHEN lead_score BETWEEN 61 AND 80 THEN '61-80'
              WHEN lead_score BETWEEN 81 AND 100 THEN '81-100'
            END AS range,
            COUNT(*)::int AS count
          FROM leads
          GROUP BY 1
          ORDER BY 1
        `),
        db.execute(sql`
          SELECT id, address, total_value, lead_score, owner_name
          FROM leads
          WHERE total_value IS NOT NULL
          ORDER BY total_value DESC
          LIMIT 5
        `),
        db.execute(sql`
          SELECT permit_contractors
          FROM leads
          WHERE permit_contractors IS NOT NULL
        `),
      ]);

      const hero = (heroResult as any).rows[0];
      const pipe = (pipelineResult as any).rows[0];
      const cov = (coverageResult as any).rows[0];
      const priorityRows = (priorityResult as any).rows;
      const stormPulse = (stormPulseResult as any).rows[0];
      const stormAffected = (stormAffectedResult as any).rows[0];
      const scoreRows = (scoreDistResult as any).rows;
      const topValueRows = (topValueResult as any).rows;
      const contractorRows = (competitorResult as any).rows;

      const total = cov.total || 1;
      const pct = (v: number) => Math.round((v / total) * 100);

      const priorityActions = priorityRows.map((r: any) => {
        const roofAge = r.roof_last_replaced ? currentYear - r.roof_last_replaced : null;
        const reasons: string[] = [];
        if (roofAge !== null && roofAge > 15) reasons.push("Old roof");
        if (r.hail_events > 0) reasons.push("Recent hail");
        if (r.contact_phone) reasons.push("Has phone");
        if (r.claim_window_open) reasons.push("Claim window open");
        if (r.total_value && r.total_value > 500000) reasons.push("High value");
        return {
          id: r.id,
          address: r.address,
          city: r.city,
          leadScore: r.lead_score,
          roofAge,
          hailEvents: r.hail_events,
          lastHailDate: r.last_hail_date || null,
          claimWindowOpen: r.claim_window_open || false,
          ownerName: (r.owner_name && isPersonName(r.owner_name)) ? r.owner_name : null,
          contactName: (r.contact_name && isPersonName(r.contact_name)) ? r.contact_name : null,
          contactPhone: r.contact_phone || null,
          totalValue: r.total_value || null,
          reason: reasons.length > 0 ? reasons.join(" + ") : "High score",
        };
      });

      // Filter function to exclude garbage contractor names
      const isValidContractorName = (name: string): boolean => {
        if (!name || name.length < 3) return false;
        // Filter names that are only punctuation/whitespace
        if (/^[,\s().\-]+$/.test(name)) return false;
        // Filter common non-meaningful values
        const normalized = name.toUpperCase();
        if (["N/A", "NONE", "UNKNOWN", "TBD", "NA"].includes(normalized)) return false;
        return true;
      };

      const contractorMap = new Map<string, { count: number; recentDate: string | null }>();
      for (const row of contractorRows) {
        try {
          const contractors = typeof row.permit_contractors === "string"
            ? JSON.parse(row.permit_contractors)
            : row.permit_contractors;
          if (Array.isArray(contractors)) {
            for (const c of contractors) {
              const name = (c.name || c.contractor || "").trim();
              if (!isValidContractorName(name)) continue;
              const workDesc = (c.workDescription || c.work_description || c.permitType || "").toUpperCase();
              if (!workDesc.includes("ROOF")) continue;
              const existing = contractorMap.get(name);
              const permitDate = c.date || c.issued_date || null;
              if (existing) {
                existing.count++;
                if (permitDate && (!existing.recentDate || permitDate > existing.recentDate)) {
                  existing.recentDate = permitDate;
                }
              } else {
                contractorMap.set(name, { count: 1, recentDate: permitDate });
              }
            }
          }
        } catch {}
      }
      const competitors = Array.from(contractorMap.entries())
        .map(([name, data]) => ({ name, permitCount: data.count, recentPermit: data.recentDate }))
        .sort((a, b) => b.permitCount - a.permitCount)
        .slice(0, 8);

      res.json({
        totalLeads: hero.total_leads,
        totalPipelineValue: Number(hero.total_pipeline_value),
        actionableLeads: hero.actionable_leads,
        avgScore: hero.avg_score,
        hotLeads: hero.hot_leads,
        pipeline: {
          new: pipe.new,
          contacted: pipe.contacted,
          qualified: pipe.qualified,
          proposal: pipe.proposal,
          closed: pipe.closed,
        },
        coverage: {
          hasPhone: pct(cov.has_phone),
          hasEmail: pct(cov.has_email),
          hasDecisionMaker: pct(cov.has_decision_maker),
          hasOwnershipClassified: pct(cov.has_ownership_classified),
          enriched: pct(cov.enriched),
          hasPermitData: pct(cov.has_permit_data),
        },
        priorityActions,
        stormPulse: {
          recentEvents30d: stormPulse.recent_30d,
          recentEvents7d: stormPulse.recent_7d,
          avgHailSize30d: stormPulse.avg_hail_size_30d || null,
          affectedLeads30d: stormAffected.affected,
        },
        competitors,
        scoreDistribution: scoreRows.map((r: any) => ({ range: r.range, count: r.count })),
        topValueLeads: topValueRows.map((r: any) => ({
          id: r.id,
          address: r.address,
          totalValue: r.total_value,
          leadScore: r.lead_score,
          ownerName: (r.owner_name && isPersonName(r.owner_name)) ? r.owner_name : null,
        })),
      });
    } catch (error) {
      console.error("Command center error:", error);
      res.status(500).json({ message: "Failed to load command center data" });
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
        hasEmail: req.query.hasEmail === "true" ? true : undefined,
        hasDecisionMaker: req.query.hasDecisionMaker === "true" ? true : undefined,
        minRoofAge: req.query.minRoofAge ? Number(req.query.minRoofAge) : undefined,
        maxRoofAge: req.query.maxRoofAge ? Number(req.query.maxRoofAge) : undefined,
        minRoofArea: req.query.minRoofArea ? Number(req.query.minRoofArea) : undefined,
        maxRoofArea: req.query.maxRoofArea ? Number(req.query.maxRoofArea) : undefined,
        minHailEvents: req.query.minHailEvents ? Number(req.query.minHailEvents) : undefined,
        lastHailWithin: req.query.lastHailWithin ? Number(req.query.lastHailWithin) : undefined,
        minHailSize: req.query.minHailSize ? Number(req.query.minHailSize) : undefined,
        claimWindowOpen: req.query.claimWindowOpen === "true" ? true : undefined,
        minPropertyValue: req.query.minPropertyValue ? Number(req.query.minPropertyValue) : undefined,
        maxPropertyValue: req.query.maxPropertyValue ? Number(req.query.maxPropertyValue) : undefined,
        ownershipStructure: req.query.ownershipStructure as string | undefined,
        roofType: req.query.roofType as string | undefined,
        enrichmentStatus: req.query.enrichmentStatus as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      };
      const result = await storage.getLeads(filter);
      const leadsWithConfidence = result.leads.map((lead: any) => ({
        ...lead,
        dataConfidence: computeDataConfidence(lead),
      }));
      res.json({ leads: leadsWithConfidence, total: result.total });
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
      res.json({ ...lead, dataConfidence: computeDataConfidence(lead) });
    } catch (error) {
      console.error("Lead fetch error:", error);
      res.status(500).json({ message: "Failed to load lead" });
    }
  });

  app.get("/api/leads/:id/graph-intelligence", async (req, res) => {
    try {
      const intel = await getGraphIntelligence(req.params.id);
      res.json(intel || { 
        hasData: false, 
        lastBuilt: null, 
        sharedOfficers: [], 
        sharedAgents: [], 
        mailingClusters: [], 
        networkContacts: [], 
        connectedPropertyCount: 0 
      });
    } catch (error: any) {
      console.error("Graph intelligence error:", error);
      res.status(500).json({ error: error.message });
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

  app.post("/api/import/tad", async (req, res) => {
    try {
      const { marketId, minImprValue, maxRecords, minSqft } = req.body;
      if (!marketId) {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      res.json({ message: "TAD property import started", minImprValue: minImprValue || 200000, maxRecords: maxRecords || 4000, minSqft: minSqft || 0 });

      importTadProperties(marketId, {
        minImprValue: minImprValue || 200000,
        maxRecords: maxRecords || 4000,
        minSqft: minSqft || 0,
      }).then((result) => {
        console.log(`TAD import complete: ${result.imported} properties imported, ${result.skipped} skipped`);
      }).catch((err) => {
        console.error("TAD import failed:", err);
      });
    } catch (error) {
      console.error("TAD import error:", error);
      res.status(500).json({ message: "Failed to start TAD import" });
    }
  });

  app.post("/api/import/collin-cad", async (req, res) => {
    try {
      const { marketId, minImpValue, maxRecords, minSqft } = req.body;
      if (!marketId) {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      res.json({ message: "Collin CAD property import started", minImpValue: minImpValue || 200000, maxRecords: maxRecords || 4000, minSqft: minSqft || 0 });

      importCollinCadProperties(marketId, {
        minImpValue: minImpValue || 200000,
        maxRecords: maxRecords || 4000,
        minSqft: minSqft || 0,
      }).then((result) => {
        console.log(`Collin CAD import complete: ${result.imported} properties imported, ${result.skipped} skipped`);
      }).catch((err) => {
        console.error("Collin CAD import failed:", err);
      });
    } catch (error) {
      console.error("Collin CAD import error:", error);
      res.status(500).json({ message: "Failed to start Collin CAD import" });
    }
  });

  app.post("/api/import/denton-cad", async (req, res) => {
    try {
      const { marketId, minImpValue, maxRecords, minSqft } = req.body;
      if (!marketId) {
        return res.status(400).json({ message: "marketId is required" });
      }

      const market = await storage.getMarketById(marketId);
      if (!market) {
        return res.status(404).json({ message: "Market not found" });
      }

      res.json({ message: "Denton CAD property import started", minImpValue: minImpValue || 200000, maxRecords: maxRecords || 4000, minSqft: minSqft || 0 });

      importDentonCadProperties(marketId, {
        minImpValue: minImpValue || 200000,
        maxRecords: maxRecords || 4000,
        minSqft: minSqft || 0,
      }).then((result) => {
        console.log(`Denton CAD import complete: ${result.imported} properties imported, ${result.skipped} skipped`);
      }).catch((err) => {
        console.error("Denton CAD import failed:", err);
      });
    } catch (error) {
      console.error("Denton CAD import error:", error);
      res.status(500).json({ message: "Failed to start Denton CAD import" });
    }
  });

  app.post("/api/import/generic-arcgis", async (req, res) => {
    try {
      const { dataSourceId, maxRecords, minSqft, dryRun } = req.body;
      if (!dataSourceId) {
        return res.status(400).json({ message: "dataSourceId is required" });
      }

      const { importGenericArcgis } = await import("./arcgis-importer");

      if (dryRun) {
        const result = await importGenericArcgis(dataSourceId, {
          maxRecords: maxRecords || 4000,
          minSqft: minSqft || 0,
          dryRun: true,
        });
        return res.json(result);
      }

      res.json({
        message: "Generic ArcGIS import started",
        dataSourceId,
        maxRecords: maxRecords || 4000,
        minSqft: minSqft || 0,
      });

      importGenericArcgis(dataSourceId, {
        maxRecords: maxRecords || 4000,
        minSqft: minSqft || 0,
        dryRun: false,
      }).then((result) => {
        console.log(`Generic ArcGIS import complete (${result.dataSourceName}): ${result.imported} imported, ${result.skipped} skipped`);
      }).catch((err) => {
        console.error("Generic ArcGIS import failed:", err);
      });
    } catch (error: any) {
      console.error("Generic ArcGIS import error:", error);
      res.status(500).json({ message: error.message || "Failed to start generic ArcGIS import" });
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

  app.post("/api/admin/backfill-evidence-verification", async (_req, res) => {
    try {
      const result = await backfillEvidenceVerification();
      res.json({
        message: "Evidence verification backfill complete",
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to backfill evidence verification" });
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
      const lead = await storage.getLeadById(leadId);
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
  // Contractors Directory
  // ============================================================

  app.get("/api/contractors", async (req, res) => {
    try {
      const { search, roofingOnly, sortBy, page, limit: limitParam } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const perPage = Math.min(100, Math.max(10, parseInt(limitParam as string) || 50));
      const offset = (pageNum - 1) * perPage;

      const searchTerm = search && typeof search === "string" && search.trim() ? `%${search.trim().toUpperCase()}%` : null;
      const isRoofingOnly = roofingOnly === "true";

      let orderByClause = sql.raw("permit_count DESC");
      if (sortBy === "recent") orderByClause = sql.raw("most_recent_permit DESC");
      if (sortBy === "name") orderByClause = sql.raw("contractor_name ASC");

      const baseWhere = sql`bp.contractor IS NOT NULL AND bp.contractor != '' AND bp.contractor != ', ,   () -'`;
      const searchFilter = searchTerm ? sql` AND UPPER(bp.contractor) LIKE ${searchTerm}` : sql``;
      const roofFilter = isRoofingOnly ? sql` AND UPPER(bp.work_description) LIKE '%ROOF%'` : sql``;
      const whereFragment = sql`WHERE ${baseWhere}${searchFilter}${roofFilter}`;

      const countResult = await db.execute(sql`
        SELECT COUNT(DISTINCT UPPER(TRIM(bp.contractor))) as total
        FROM building_permits bp
        ${whereFragment}
      `);
      const total = Number((countResult as any).rows?.[0]?.total || 0);

      const result = await db.execute(sql`
        SELECT
          UPPER(TRIM(bp.contractor)) as contractor_name,
          COUNT(*) as permit_count,
          COUNT(CASE WHEN UPPER(bp.work_description) LIKE '%ROOF%' THEN 1 END) as roofing_permit_count,
          MAX(bp.issued_date) as most_recent_permit,
          MIN(bp.contractor_phone) FILTER (WHERE bp.contractor_phone IS NOT NULL AND bp.contractor_phone != '' AND bp.contractor_phone != '() -') as phone,
          MIN(bp.contractor_email) FILTER (WHERE bp.contractor_email IS NOT NULL AND bp.contractor_email != '') as email,
          MIN(bp.contractor_address) FILTER (WHERE bp.contractor_address IS NOT NULL AND bp.contractor_address != '') as address,
          MIN(bp.contractor_city) FILTER (WHERE bp.contractor_city IS NOT NULL AND bp.contractor_city != '') as city,
          MIN(bp.contractor_state) FILTER (WHERE bp.contractor_state IS NOT NULL AND bp.contractor_state != '') as state,
          MIN(bp.contractor_zip) FILTER (WHERE bp.contractor_zip IS NOT NULL AND bp.contractor_zip != '') as zip
        FROM building_permits bp
        ${whereFragment}
        GROUP BY UPPER(TRIM(bp.contractor))
        ORDER BY ${orderByClause}
        LIMIT ${perPage} OFFSET ${offset}
      `);

      const contractors = (result as any).rows || [];

      res.json({
        contractors,
        pagination: {
          page: pageNum,
          perPage,
          total,
          totalPages: Math.ceil(total / perPage),
        },
      });
    } catch (error: any) {
      console.error("Contractors list error:", error);
      res.status(500).json({ message: "Failed to load contractors", error: error.message });
    }
  });

  app.get("/api/contractors/:name/permits", async (req, res) => {
    try {
      const contractorName = decodeURIComponent(req.params.name);
      const result = await db.execute(sql`
        SELECT
          bp.id, bp.permit_number, bp.permit_type, bp.issued_date,
          bp.address, bp.city, bp.zip_code,
          bp.work_description, bp.estimated_value, bp.sqft,
          bp.contractor_phone, bp.contractor_email,
          bp.contractor_address, bp.contractor_city, bp.contractor_state, bp.contractor_zip,
          bp.lead_id
        FROM building_permits bp
        WHERE UPPER(TRIM(bp.contractor)) = UPPER(TRIM(${contractorName}))
        ORDER BY bp.issued_date DESC
        LIMIT 200
      `);
      const permits = (result as any).rows || [];

      const leadIds = [...new Set(permits.filter((p: any) => p.lead_id).map((p: any) => p.lead_id))] as string[];
      let linkedLeads: any[] = [];
      if (leadIds.length > 0) {
        const idParams = leadIds.map(id => sql`${id}`);
        const leadsResult = await db.execute(sql`
          SELECT id, address, city, owner_name, lead_score, total_value
          FROM leads
          WHERE id IN (${sql.join(idParams, sql`, `)})
        `);
        linkedLeads = (leadsResult as any).rows || [];
      }

      res.json({ permits, linkedLeads });
    } catch (error: any) {
      console.error("Contractor permits error:", error);
      res.status(500).json({ message: "Failed to load contractor permits", error: error.message });
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
      const { marketId, yearsBack, commercialOnly, roofingOnly } = req.body;
      if (!marketId) return res.status(400).json({ message: "marketId required" });
      const result = await importFortWorthPermits(marketId, {
        yearsBack: yearsBack ?? 5,
        commercialOnly: commercialOnly ?? true,
        roofingOnly: roofingOnly ?? false,
      });
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
      const { marketId, leadIds } = req.body;
      const filter: any = {};
      if (marketId) filter.marketId = marketId;
      filter.limit = 50000;
      let { leads: allLeads } = await storage.getLeads(filter);
      if (Array.isArray(leadIds) && leadIds.length > 0) {
        const idSet = new Set(leadIds);
        allLeads = allLeads.filter(l => idSet.has(l.id));
      }
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
      const { leadIds } = req.body || {};
      let { leads: allLeads } = await storage.getLeads({ limit: 50000 });
      if (Array.isArray(leadIds) && leadIds.length > 0) {
        const idSet = new Set(leadIds);
        allLeads = allLeads.filter(l => idSet.has(l.id));
      }
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
  // Story Estimation Endpoint (Phase 1: zoning heuristic, Phase 2: permit/GIS cross-reference)
  // ============================================================

  app.post("/api/leads/estimate-stories", async (req, res) => {
    try {
      const marketId = req.body.marketId as string | undefined;
      const leadIds = req.body.leadIds as string[] | undefined;
      const filter: any = { limit: 50000 };
      if (marketId) filter.marketId = marketId;
      let { leads: allLeads } = await storage.getLeads(filter);
      if (Array.isArray(leadIds) && leadIds.length > 0) {
        const idSet = new Set(leadIds);
        allLeads = allLeads.filter(l => idSet.has(l.id));
      }

      const leadMap = new Map(allLeads.map(l => [l.id, l]));

      // Phase 1: Cross-reference roof permits and GIS footprints for real data
      // Get roof replacement permits — these have actual roof sqft
      const roofPermitRows = await db.execute(sql`
        SELECT bp.lead_id, bp.sqft as permit_roof_sqft
        FROM building_permits bp
        WHERE bp.work_description ILIKE '%roof%'
          AND bp.work_description NOT ILIKE '%sign%'
          AND bp.work_description NOT ILIKE '%alarm%'
          AND bp.work_description NOT ILIKE '%solar%'
          AND bp.sqft >= 500
        ORDER BY bp.issued_date DESC
      `);

      // Deduplicate: keep the largest roof permit per lead (most complete roof job)
      const permitRoofArea = new Map<string, number>();
      for (const row of (roofPermitRows as any).rows) {
        const lid = row.lead_id;
        if (!lid || !leadMap.has(lid)) continue;
        const existing = permitRoofArea.get(lid) || 0;
        if (row.permit_roof_sqft > existing) {
          permitRoofArea.set(lid, row.permit_roof_sqft);
        }
      }

      // Get GIS building footprints
      const gisRows = await db.execute(sql`
        SELECT lead_id, roof_area_sqft FROM building_footprints WHERE roof_area_sqft > 100
      `);
      const gisRoofArea = new Map<string, number>();
      for (const row of (gisRows as any).rows) {
        if (row.lead_id && leadMap.has(row.lead_id)) {
          gisRoofArea.set(row.lead_id, row.roof_area_sqft);
        }
      }

      let updatedFromPermit = 0;
      let updatedFromGis = 0;
      let updatedFromZoning = 0;
      let unchanged = 0;

      for (const lead of allLeads) {
        const totalSqft = lead.sqft || 0;
        if (totalSqft <= 0) {
          unchanged++;
          continue;
        }

        let roofFootprint: number | null = null;
        let source = "zoning";

        // Priority 1: Roof permit sqft (most reliable — actual measured roof area)
        if (permitRoofArea.has(lead.id)) {
          roofFootprint = permitRoofArea.get(lead.id)!;
          source = "permit";
        }
        // Priority 2: GIS building footprint from Overpass
        else if (gisRoofArea.has(lead.id)) {
          roofFootprint = gisRoofArea.get(lead.id)!;
          source = "gis";
        }

        let estimatedStories: number;
        let roofArea: number;

        if (roofFootprint && roofFootprint > 0) {
          // Calculate floors from real data: total building sqft / roof footprint
          const calcFloors = totalSqft / roofFootprint;

          if (calcFloors >= 1 && calcFloors <= 100) {
            estimatedStories = Math.round(calcFloors);
            if (estimatedStories < 1) estimatedStories = 1;
            roofArea = roofFootprint;
          } else {
            // Data mismatch (roof area > building sqft) — fall back to zoning heuristic
            source = "zoning";
            estimatedStories = estimateStoriesFromZoning(lead);
            roofArea = Math.round(totalSqft / estimatedStories);
          }
        } else {
          // No real roof data — use zoning heuristic
          estimatedStories = estimateStoriesFromZoning(lead);
          roofArea = Math.round(totalSqft / estimatedStories);
        }

        if (estimatedStories !== (lead.stories || 1) || roofArea !== (lead.estimatedRoofArea || 0)) {
          await storage.updateLead(lead.id, {
            stories: estimatedStories,
            estimatedRoofArea: roofArea,
          } as any);
          if (source === "permit") updatedFromPermit++;
          else if (source === "gis") updatedFromGis++;
          else updatedFromZoning++;
        } else {
          unchanged++;
        }
      }

      const totalUpdated = updatedFromPermit + updatedFromGis + updatedFromZoning;
      res.json({
        message: "Story estimation complete",
        totalLeads: allLeads.length,
        updated: totalUpdated,
        updatedFromPermit,
        updatedFromGis,
        updatedFromZoning,
        unchanged,
        availablePermitData: permitRoofArea.size,
        availableGisData: gisRoofArea.size,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to estimate stories", error: error.message });
    }
  });

  function estimateStoriesFromZoning(lead: any): number {
    const sqft = lead.sqft || 0;
    const zoning = (lead.zoning || "").toLowerCase();

    if (zoning.includes("multi-family") || zoning.includes("multi family") || zoning.includes("apartment")) {
      if (sqft >= 500000) return 4;
      if (sqft >= 200000) return 3;
      if (sqft >= 80000) return 2;
      return 2;
    } else if (zoning.includes("commercial") || zoning.includes("office") || zoning.includes("mixed")) {
      if (sqft >= 1000000) return 10;
      if (sqft >= 500000) return 6;
      if (sqft >= 200000) return 4;
      if (sqft >= 100000) return 3;
      if (sqft >= 50000) return 2;
      return 1;
    } else if (zoning.includes("industrial") || zoning.includes("warehouse")) {
      return 1;
    }
    return 1;
  }

  // ============================================================
  // Roof Type & Construction Type Estimation Endpoint
  // ============================================================

  app.post("/api/leads/estimate-roof-type", async (req, res) => {
    try {
      const marketId = req.body.marketId as string | undefined;
      const leadIds = req.body.leadIds as string[] | undefined;
      const overwrite = req.body.overwrite === true;
      const filter: any = { limit: 50000 };
      if (marketId) filter.marketId = marketId;
      let { leads: allLeads } = await storage.getLeads(filter);
      if (Array.isArray(leadIds) && leadIds.length > 0) {
        const idSet = new Set(leadIds);
        allLeads = allLeads.filter(l => idSet.has(l.id));
      }

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
      const progress = await enrichLead(req.params.id, { skipPaidApis: true });
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: "Enrichment failed", error: error.message });
    }
  });

  app.post("/api/leads/:id/enrich/google-places", async (req, res) => {
    try {
      if (!process.env.GOOGLE_PLACES_API_KEY) {
        return res.status(400).json({ message: "Google Places API key not configured" });
      }
      const { enrichLeadPaidApis } = await import("./lead-enrichment-orchestrator");
      const results = await enrichLeadPaidApis(req.params.id);
      res.json({ message: "Google Places enrichment complete", results: results.googlePlaces, phone: results.phone });
    } catch (error: any) {
      res.status(500).json({ message: "Google Places enrichment failed", error: error.message });
    }
  });

  app.post("/api/leads/:id/enrich/serper", async (req, res) => {
    try {
      if (!process.env.SERPER_API_KEY) {
        return res.status(400).json({ message: "Serper API key not configured" });
      }
      const lead = await db.select().from(leadsTable).where(eq(leadsTable.id, req.params.id)).limit(1);
      if (!lead[0]) return res.status(404).json({ message: "Lead not found" });

      const { runOwnerIntelligence } = await import("./owner-intelligence");
      const result = await runOwnerIntelligence(lead[0] as any, { skipPaidApis: false });

      const paidAgentResults = result.dossier?.agentResults?.filter((r: any) =>
        ["People Search", "Court Records"].includes(r.agent)
      ) || [];

      res.json({
        message: "Serper enrichment complete",
        agentResults: paidAgentResults,
        score: result.score,
        managingMember: result.managingMember,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Serper enrichment failed", error: error.message });
    }
  });

  app.post("/api/enrichment/batch-free", async (_req, res) => {
    try {
      const { runBatchFreeEnrichment, getBatchFreeStatus } = await import("./lead-enrichment-orchestrator");
      const status = getBatchFreeStatus();
      if (status.running) {
        return res.status(409).json({ message: "Batch enrichment already running", status });
      }
      await runBatchFreeEnrichment();
      res.json({ message: "Batch free enrichment started", status: getBatchFreeStatus() });
    } catch (error: any) {
      res.status(500).json({ message: "Batch enrichment failed", error: error.message });
    }
  });

  app.get("/api/enrichment/batch-free/status", async (_req, res) => {
    try {
      const { getBatchFreeStatus } = await import("./lead-enrichment-orchestrator");
      res.json(getBatchFreeStatus());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get status", error: error.message });
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
      const { classifyAndAssignDecisionMakers } = await import("./ownership-classifier");
      console.log("[API] Starting rooftop owner resolution...");
      const resolveResult = await resolveRooftopOwners();
      console.log(`[API] Resolved ${resolveResult.people} people from ${resolveResult.processed} leads`);
      const portfolioResult = await buildPortfolioGroups();
      console.log(`[API] Built ${portfolioResult.groups} portfolio groups (${portfolioResult.multiProperty} multi-property)`);
      console.log("[API] Running ownership classification & decision-maker assignment...");
      const classifyResult = await classifyAndAssignDecisionMakers();
      console.log(`[API] Classified ${classifyResult.classified} leads, ${classifyResult.withDecisionMakers} with decision makers`);
      res.json({
        ...resolveResult,
        portfolioGroups: portfolioResult.groups,
        multiPropertyOwners: portfolioResult.multiProperty,
        classified: classifyResult.classified,
        withDecisionMakers: classifyResult.withDecisionMakers,
        byStructure: classifyResult.byStructure,
      });
    } catch (error: any) {
      console.error("[API] Rooftop owner rebuild failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/leads/:id/decision-makers", async (req, res) => {
    try {
      const leadId = req.params.id;
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const storedStructure = lead.ownershipStructure || null;
      const storedSignals = lead.ownershipSignals || null;
      const storedDms = lead.decisionMakers || null;

      if (storedStructure && storedSignals && storedDms) {
        const LABELS: Record<string, string> = {
          small_private: "Small Private Owner",
          investment_firm: "Real Estate Investment Firm",
          institutional_reit: "Institutional / REIT",
          third_party_managed: "Third-Party Managed",
        };
        const signals = storedSignals as any[];
        const totalWeight = signals.reduce((s: number, sig: any) => s + sig.weight, 0);
        const matchWeight = signals.filter((sig: any) => sig.direction === storedStructure).reduce((s: number, sig: any) => s + sig.weight, 0);
        const confidence = totalWeight > 0 ? Math.min(95, Math.round((matchWeight / totalWeight) * 100)) : 25;

        return res.json({
          ownershipStructure: storedStructure,
          ownershipLabel: LABELS[storedStructure] || storedStructure,
          ownershipConfidence: confidence,
          ownershipSignals: storedSignals,
          decisionMakers: storedDms,
        });
      }

      const { classifyOwnershipStructure, selectDecisionMakers, getPortfolioSizeForLead } = await import("./ownership-classifier");
      const { extractPeopleFromLead } = await import("./rooftop-owner-resolver");

      const portfolioSize = await getPortfolioSizeForLead(lead);
      const classification = classifyOwnershipStructure(lead, portfolioSize);
      const people = extractPeopleFromLead(lead);
      const dms = selectDecisionMakers(people, classification.structure, lead);

      await db.update(leadsTable).set({
        ownershipStructure: classification.structure,
        ownershipSignals: classification.signals as any,
        decisionMakers: dms as any,
      } as any).where(eq(leadsTable.id, leadId));

      res.json({
        ownershipStructure: classification.structure,
        ownershipLabel: classification.label,
        ownershipConfidence: classification.confidence,
        ownershipSignals: classification.signals,
        decisionMakers: dms,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/decision-makers/classify", async (req, res) => {
    try {
      const { classifyAndAssignDecisionMakers } = await import("./ownership-classifier");
      console.log("[API] Starting ownership classification & decision-maker assignment...");
      const result = await classifyAndAssignDecisionMakers();
      console.log(`[API] Classified ${result.classified} leads, ${result.withDecisionMakers} with decision makers`);
      res.json(result);
    } catch (error: any) {
      console.error("[API] Classification failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/permits/sync-contractors", async (req, res) => {
    try {
      const { syncPermitContractorsToLeads } = await import("./permit-contractor-sync");
      const result = await syncPermitContractorsToLeads();
      res.json(result);
    } catch (error: any) {
      console.error("[API] Permit contractor sync failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // Relationship Graph endpoints
  // ============================================================

  app.post("/api/graph/build", async (req, res) => {
    try {
      const { buildRelationshipGraph } = await import("./graph-engine");
      const runId = await buildRelationshipGraph();
      res.json({ runId, message: "Graph build started" });
    } catch (error: any) {
      console.error("[API] Graph build failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/graph/build/status", async (req, res) => {
    try {
      const { getBuildRunStatus, getActiveBuildRunId } = await import("./graph-engine");
      const runId = (req.query.runId as string) || getActiveBuildRunId() || undefined;
      const status = await getBuildRunStatus(runId);
      res.json(status || { status: "none" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/graph/stats", async (req, res) => {
    try {
      const { getGraphStats } = await import("./graph-engine");
      const stats = await getGraphStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/graph/node/:nodeId", async (req, res) => {
    try {
      const { getNodeWithEdges } = await import("./graph-engine");
      const depth = parseInt(req.query.depth as string) || 1;
      const result = await getNodeWithEdges(req.params.nodeId, Math.min(depth, 3));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/graph/search", async (req, res) => {
    try {
      const { searchGraphNodes } = await import("./graph-engine");
      const query = req.query.q as string;
      const nodeType = req.query.type as string | undefined;
      if (!query) return res.json([]);
      const results = await searchGraphNodes(query, nodeType, 20);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/graph/lead/:leadId", async (req, res) => {
    try {
      const { getNodesByLeadId } = await import("./graph-engine");
      const result = await getNodesByLeadId(req.params.leadId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/leads/:id/graph-intelligence", async (req, res) => {
    try {
      const { getGraphIntelligence } = await import("./graph-engine");
      const result = await getGraphIntelligence(req.params.id);
      res.json(result || { hasData: false, lastBuilt: null, sharedOfficers: [], sharedAgents: [], mailingClusters: [], networkContacts: [], connectedPropertyCount: 0 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/enrichment/sec-edgar/:leadId", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const companyName = lead.llcName || lead.businessName || lead.ownerName;
      if (!companyName) {
        return res.status(400).json({ message: "No company/LLC name available for SEC EDGAR lookup" });
      }

      const result = await enrichLeadFromEdgar(lead.id, companyName);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/enrichment/tx-sos/:leadId", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const result = await enrichLeadFromTXSOS(lead.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/enrichment/county-clerk/:leadId", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const result = await enrichLeadFromCountyClerk(lead.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/enrichment/usage", async (_req, res) => {
    try {
      const { getGooglePlacesUsage } = await import("./google-places-tracker");
      const [hunter, pdl, googlePlaces] = await Promise.all([getHunterUsage(), getPDLUsage(), getGooglePlacesUsage()]);
      const serperConfigured = !!process.env.SERPER_API_KEY;

      const summaryResult = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total_leads,
          COUNT(*) FILTER (WHERE enrichment_status = 'complete' OR last_enriched_at IS NOT NULL)::int AS free_enriched,
          COUNT(*) FILTER (WHERE phone_enriched_at IS NOT NULL AND (owner_phone IS NOT NULL OR contact_phone IS NOT NULL))::int AS with_phone_enriched
        FROM leads
      `);
      const summary = (summaryResult as any).rows[0] || { total_leads: 0, free_enriched: 0, with_phone_enriched: 0 };

      res.json({
        hunter,
        pdl,
        googlePlaces,
        serperConfigured,
        summary: {
          totalLeads: summary.total_leads,
          freeEnriched: summary.free_enriched,
          paidGooglePlaces: googlePlaces?.used || 0,
          paidHunter: hunter?.used || 0,
          paidPDL: pdl?.used || 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/enrichment/hunter/:leadId", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const genericDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "live.com", "msn.com", "protonmail.com", "mail.com"]);

      let domain: string | null = null;
      let domainSource = "";

      if (lead.businessWebsite) {
        try {
          const url = lead.businessWebsite.startsWith("http") ? lead.businessWebsite : `https://${lead.businessWebsite}`;
          const d = new URL(url).hostname.replace(/^www\./, "");
          if (!genericDomains.has(d)) { domain = d; domainSource = "business website"; }
        } catch {}
      }

      if (!domain && lead.ownerEmail) {
        const parts = lead.ownerEmail.split("@");
        if (parts.length === 2 && !genericDomains.has(parts[1])) {
          domain = parts[1]; domainSource = "owner email";
        }
      }
      if (!domain && lead.contactEmail) {
        const parts = lead.contactEmail.split("@");
        if (parts.length === 2 && !genericDomains.has(parts[1])) {
          domain = parts[1]; domainSource = "contact email";
        }
      }
      if (!domain && lead.managingMemberEmail) {
        const parts = lead.managingMemberEmail.split("@");
        if (parts.length === 2 && !genericDomains.has(parts[1])) {
          domain = parts[1]; domainSource = "managing member email";
        }
      }

      if (!domain && lead.ownerIntelligence) {
        const intel = lead.ownerIntelligence as any;
        if (intel.businessProfiles) {
          for (const profile of intel.businessProfiles) {
            if (profile.website) {
              try {
                const url = profile.website.startsWith("http") ? profile.website : `https://${profile.website}`;
                const d = new URL(url).hostname.replace(/^www\./, "");
                if (!genericDomains.has(d)) { domain = d; domainSource = `${profile.source || "business"} profile`; break; }
              } catch {}
            }
          }
        }
        if (!domain && intel.emails) {
          for (const em of intel.emails) {
            const addr = typeof em === "string" ? em : em.email;
            if (addr) {
              const parts = addr.split("@");
              if (parts.length === 2 && !genericDomains.has(parts[1])) {
                domain = parts[1]; domainSource = "intelligence email"; break;
              }
            }
          }
        }
      }

      if (!domain && lead.managementEmail) {
        const parts = lead.managementEmail.split("@");
        if (parts.length === 2 && !genericDomains.has(parts[1])) {
          domain = parts[1]; domainSource = "management company email";
        }
      }

      if (!domain) {
        const suggestions: string[] = [];
        if (!lead.businessWebsite) suggestions.push("add a business website to the lead");
        if (!lead.lastEnrichedAt) suggestions.push("run free enrichment first to discover websites");
        suggestions.push("try PDL enrichment instead (works with person name)");
        return res.status(400).json({
          message: "No domain found for Hunter.io lookup.",
          detail: "Hunter.io searches for email addresses at a company domain (e.g. @company.com). This lead has no website or business email on file.",
          suggestions,
        });
      }

      const result = await searchHunterDomain(domain, lead.id);
      res.json({ ...result, domainSource, domainUsed: domain });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/enrichment/pdl/:leadId", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const name = lead.contactName || lead.ownerName || lead.managingMember;
      if (!name) {
        return res.status(400).json({ message: "No person name found on lead for PDL lookup." });
      }

      const company = lead.businessName || lead.llcName || undefined;
      const location = `${lead.city}, ${lead.state}`;

      const result = await enrichPersonPDL(lead.id, name, company, location);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/data-coverage", async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE owner_name IS NOT NULL AND owner_name != '') as has_owner_name,
          COUNT(*) FILTER (WHERE owner_phone IS NOT NULL AND owner_phone != '') as has_phone,
          COUNT(*) FILTER (WHERE owner_email IS NOT NULL AND owner_email != '') as has_email,
          COUNT(*) FILTER (WHERE contact_name IS NOT NULL AND contact_name != '') as has_contact,
          COUNT(*) FILTER (WHERE contact_email IS NOT NULL AND contact_email != '') as has_contact_email,
          COUNT(*) FILTER (WHERE contact_phone IS NOT NULL AND contact_phone != '') as has_contact_phone,
          COUNT(*) FILTER (WHERE business_website IS NOT NULL AND business_website != '') as has_website,
          COUNT(*) FILTER (WHERE managing_member IS NOT NULL AND managing_member != '') as has_managing_member,
          COUNT(*) FILTER (WHERE management_company IS NOT NULL AND management_company != '') as has_mgmt_company,
          COUNT(*) FILTER (WHERE taxpayer_id IS NOT NULL AND taxpayer_id != '') as has_taxpayer_id,
          COUNT(*) FILTER (WHERE sos_file_number IS NOT NULL AND sos_file_number != '') as has_sos_number,
          COUNT(*) FILTER (WHERE intelligence_score IS NOT NULL AND intelligence_score > 0) as has_intelligence,
          COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL) as enriched,
          COUNT(*) FILTER (WHERE phone_enriched_at IS NOT NULL) as phone_attempted,
          COUNT(*) FILTER (WHERE contact_enriched_at IS NOT NULL) as contact_attempted
        FROM leads
      `);

      const phoneSources = await db.execute(sql`
        SELECT phone_source, COUNT(*) as cnt
        FROM leads
        WHERE phone_source IS NOT NULL
        GROUP BY phone_source
        ORDER BY cnt DESC
      `);

      const contactSources = await db.execute(sql`
        SELECT contact_source, COUNT(*) as cnt
        FROM leads
        WHERE contact_source IS NOT NULL
        GROUP BY contact_source
        ORDER BY cnt DESC
      `);

      const evidenceSources = await db.execute(sql`
        SELECT source_name, COUNT(*) as cnt
        FROM contact_evidence
        GROUP BY source_name
        ORDER BY cnt DESC
      `);

      const row = result.rows[0] || {};
      res.json({
        total: Number(row.total) || 0,
        coverage: {
          ownerName: Number(row.has_owner_name) || 0,
          phone: Number(row.has_phone) || 0,
          email: Number(row.has_email) || 0,
          contactPerson: Number(row.has_contact) || 0,
          contactEmail: Number(row.has_contact_email) || 0,
          contactPhone: Number(row.has_contact_phone) || 0,
          website: Number(row.has_website) || 0,
          managingMember: Number(row.has_managing_member) || 0,
          managementCompany: Number(row.has_mgmt_company) || 0,
          taxpayerId: Number(row.has_taxpayer_id) || 0,
          sosFileNumber: Number(row.has_sos_number) || 0,
          intelligenceScore: Number(row.has_intelligence) || 0,
        },
        enrichment: {
          enriched: Number(row.enriched) || 0,
          phoneAttempted: Number(row.phone_attempted) || 0,
          contactAttempted: Number(row.contact_attempted) || 0,
        },
        phoneSources: phoneSources.rows.map((r: any) => ({ source: r.phone_source, count: Number(r.cnt) })),
        contactSources: contactSources.rows.map((r: any) => ({ source: r.contact_source, count: Number(r.cnt) })),
        evidenceSources: evidenceSources.rows.map((r: any) => ({ source: r.source_name, count: Number(r.cnt) })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/leads/:id/building-footprint", async (req, res) => {
    try {
      const rows = await db.select().from(leadsTable).where(eq(leadsTable.id, req.params.id)).limit(1);
      const lead = rows[0];
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (!lead.latitude || !lead.longitude) {
        return res.status(400).json({ message: "Lead has no coordinates" });
      }
      const { getBuildingFootprint } = await import("./building-footprint-agent");
      const result = await getBuildingFootprint(lead.id, lead.latitude, lead.longitude);
      if (!result) {
        return res.json({ found: false, message: "No building footprint found at this location" });
      }
      res.json({ found: true, ...result });
    } catch (error: any) {
      console.error("Building footprint error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/building-footprints/batch", async (req, res) => {
    try {
      const { leadIds } = req.body;
      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ message: "leadIds array required" });
      }
      const leadsData: Array<{ id: string; latitude: number; longitude: number }> = [];
      for (const id of leadIds.slice(0, 50)) {
        const rows = await db.select({ id: leadsTable.id, latitude: leadsTable.latitude, longitude: leadsTable.longitude }).from(leadsTable).where(eq(leadsTable.id, id)).limit(1);
        if (rows[0]?.latitude && rows[0]?.longitude) {
          leadsData.push({ id: rows[0].id, latitude: rows[0].latitude, longitude: rows[0].longitude });
        }
      }
      const { getBuildingFootprintsBatch } = await import("./building-footprint-agent");
      const results = await getBuildingFootprintsBatch(leadsData);
      const output: Record<string, any> = {};
      for (const [id, fp] of results) {
        output[id] = fp;
      }
      res.json(output);
    } catch (error: any) {
      console.error("Batch footprint error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/saved-filters", async (_req, res) => {
    try {
      const filters = await db.select().from(savedFilters).orderBy(savedFilters.createdAt);
      res.json(filters);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/saved-filters", async (req, res) => {
    try {
      const parsed = insertSavedFilterSchema.parse(req.body);
      if (parsed.isDefault) {
        await db.update(savedFilters).set({ isDefault: false });
      }
      const [created] = await db.insert(savedFilters).values(parsed).returning();
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/saved-filters/:id", async (req, res) => {
    try {
      const { name, filters: filterData, color, isDefault } = req.body;
      if (isDefault) {
        await db.update(savedFilters).set({ isDefault: false });
      }
      const [updated] = await db.update(savedFilters)
        .set({ ...(name !== undefined && { name }), ...(filterData !== undefined && { filters: filterData }), ...(color !== undefined && { color }), ...(isDefault !== undefined && { isDefault }) })
        .where(eq(savedFilters.id, req.params.id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Filter not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/saved-filters/:id", async (req, res) => {
    try {
      await db.delete(savedFilters).where(eq(savedFilters.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // Run All Pipeline Orchestrator
  // ============================================================

  app.get("/api/pipeline/preview", async (req, res) => {
    try {
      const { previewFilteredLeads } = await import("./pipeline-orchestrator");
      const filters = {
        minSqft: Number(req.query.minSqft) || 0,
        maxStories: Number(req.query.maxStories) || 0,
        roofTypes: req.query.roofTypes ? String(req.query.roofTypes).split(",").filter(Boolean) : [],
        excludeShellCompanies: req.query.excludeShellCompanies === "true",
        minPropertyValue: Number(req.query.minPropertyValue) || 0,
        onlyUnprocessed: req.query.onlyUnprocessed === "true",
      };
      const result = await previewFilteredLeads(filters);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pipeline/run-all", async (req, res) => {
    try {
      const { runFullPipeline: runPipeline } = await import("./pipeline-orchestrator");
      const { skipPhases, filters } = req.body || {};
      await runPipeline({ skipPhases: skipPhases || [], filters: filters || {} });
      res.json({ message: "Pipeline started", started: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/pipeline/run-all/status", async (_req, res) => {
    try {
      const { getPipelineStatus } = await import("./pipeline-orchestrator");
      res.json(getPipelineStatus());
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pipeline/cancel", async (_req, res) => {
    try {
      const { cancelPipeline } = await import("./pipeline-orchestrator");
      cancelPipeline();
      res.json({ message: "Pipeline cancellation requested" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/cleanup-contact-names", async (_req, res) => {
    try {
      const result = await cleanupPollutedContactNames();
      res.json({
        message: "Contact name cleanup complete",
        nulledOut: result.nulledOut,
        sourcesFixed: result.sourcesFixed,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  let batchReprocessStatus: {
    running: boolean;
    startedAt: string | null;
    completedAt: string | null;
    currentPhase: string;
    progress: { processed: number; total: number };
    phases: Record<string, { status: string; startedAt?: string; completedAt?: string; result?: any }>;
    beforeStatus: Record<string, number>;
    afterStatus: Record<string, number>;
    transitions: Record<string, number>;
    error: string | null;
  } = {
    running: false,
    startedAt: null,
    completedAt: null,
    currentPhase: "idle",
    progress: { processed: 0, total: 0 },
    phases: {},
    beforeStatus: {},
    afterStatus: {},
    transitions: {},
    error: null,
  };

  app.post("/api/admin/batch-reprocess", async (_req, res) => {
    if (batchReprocessStatus.running) {
      return res.status(409).json({ message: "Batch reprocess already running", status: batchReprocessStatus });
    }

    batchReprocessStatus = {
      running: true,
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentPhase: "initializing",
      progress: { processed: 0, total: 0 },
      phases: {},
      beforeStatus: {},
      afterStatus: {},
      transitions: {},
      error: null,
    };

    res.json({ message: "Batch reprocess started", status: batchReprocessStatus });

    (async () => {
      try {
        const CHUNK_SIZE = 500;

        const beforeResult = await db.execute(sql`
          SELECT dm_review_status, COUNT(*)::int AS cnt
          FROM leads
          GROUP BY dm_review_status
        `);
        const beforeStatus: Record<string, number> = {};
        for (const row of (beforeResult as any).rows) {
          beforeStatus[row.dm_review_status || "unreviewed"] = row.cnt;
        }
        batchReprocessStatus.beforeStatus = beforeStatus;

        const allIdRows = await db.execute(sql`SELECT id FROM leads ORDER BY id`);
        const allIds: string[] = (allIdRows as any).rows.map((r: any) => r.id);
        batchReprocessStatus.progress.total = allIds.length;

        console.log(`[batch-reprocess] Starting batch reprocess of ${allIds.length} leads in chunks of ${CHUNK_SIZE}`);

        const chunks: string[][] = [];
        for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
          chunks.push(allIds.slice(i, i + CHUNK_SIZE));
        }

        batchReprocessStatus.currentPhase = "ownership_classification";
        batchReprocessStatus.phases.ownership_classification = { status: "running", startedAt: new Date().toISOString() };
        console.log(`[batch-reprocess] Phase 1: Ownership Classification & DM Assignment`);

        const { classifyAndAssignDecisionMakers } = await import("./ownership-classifier");
        let classifyTotals = { total: 0, classified: 0, withDecisionMakers: 0, byStructure: {} as Record<string, number> };

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci];
          const result = await classifyAndAssignDecisionMakers(chunk);
          classifyTotals.total += result.total;
          classifyTotals.classified += result.classified;
          classifyTotals.withDecisionMakers += result.withDecisionMakers;
          for (const [k, v] of Object.entries(result.byStructure)) {
            classifyTotals.byStructure[k] = (classifyTotals.byStructure[k] || 0) + v;
          }
          batchReprocessStatus.progress.processed = Math.min((ci + 1) * CHUNK_SIZE, allIds.length);
        }

        batchReprocessStatus.phases.ownership_classification = {
          status: "complete",
          startedAt: batchReprocessStatus.phases.ownership_classification.startedAt,
          completedAt: new Date().toISOString(),
          result: classifyTotals,
        };
        console.log(`[batch-reprocess] Phase 1 complete: ${classifyTotals.classified} classified, ${classifyTotals.withDecisionMakers} with DMs`);

        batchReprocessStatus.currentPhase = "management_attribution";
        batchReprocessStatus.phases.management_attribution = { status: "running", startedAt: new Date().toISOString() };
        batchReprocessStatus.progress.processed = 0;
        console.log(`[batch-reprocess] Phase 2: Management Attribution`);

        const { runManagementAttribution } = await import("./management-attribution");
        let mgmtTotals = { totalProcessed: 0, attributed: 0, withCompany: 0, withContact: 0 };

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci];
          const result = await runManagementAttribution(undefined, chunk);
          mgmtTotals.totalProcessed += result.totalProcessed;
          mgmtTotals.attributed += result.attributed;
          mgmtTotals.withCompany += result.withCompany;
          mgmtTotals.withContact += result.withContact;
          batchReprocessStatus.progress.processed = Math.min((ci + 1) * CHUNK_SIZE, allIds.length);
        }

        batchReprocessStatus.phases.management_attribution = {
          status: "complete",
          startedAt: batchReprocessStatus.phases.management_attribution.startedAt,
          completedAt: new Date().toISOString(),
          result: mgmtTotals,
        };
        console.log(`[batch-reprocess] Phase 2 complete: ${mgmtTotals.attributed} attributed, ${mgmtTotals.withCompany} with company`);

        batchReprocessStatus.currentPhase = "role_inference";
        batchReprocessStatus.phases.role_inference = { status: "running", startedAt: new Date().toISOString() };
        batchReprocessStatus.progress.processed = 0;
        console.log(`[batch-reprocess] Phase 3: Role Inference`);

        const { runRoleInference } = await import("./role-inference");
        let roleTotals = { totalProcessed: 0, rolesAssigned: 0, byRole: {} as Record<string, number> };

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci];
          const result = await runRoleInference(undefined, chunk);
          roleTotals.totalProcessed += result.totalProcessed;
          roleTotals.rolesAssigned += result.rolesAssigned;
          for (const [k, v] of Object.entries(result.byRole)) {
            roleTotals.byRole[k] = (roleTotals.byRole[k] || 0) + v;
          }
          batchReprocessStatus.progress.processed = Math.min((ci + 1) * CHUNK_SIZE, allIds.length);
        }

        batchReprocessStatus.phases.role_inference = {
          status: "complete",
          startedAt: batchReprocessStatus.phases.role_inference.startedAt,
          completedAt: new Date().toISOString(),
          result: roleTotals,
        };
        console.log(`[batch-reprocess] Phase 3 complete: ${roleTotals.rolesAssigned} roles assigned`);

        batchReprocessStatus.currentPhase = "confidence_scoring";
        batchReprocessStatus.phases.confidence_scoring = { status: "running", startedAt: new Date().toISOString() };
        batchReprocessStatus.progress.processed = 0;
        console.log(`[batch-reprocess] Phase 4: Confidence Scoring`);

        const { runConfidenceScoring } = await import("./dm-confidence");
        let scoreTotals = { totalProcessed: 0, autoPublish: 0, review: 0, insufficientData: 0, suppress: 0, avgScore: 0 };
        let totalScoreSum = 0;

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci];
          const result = await runConfidenceScoring(undefined, chunk);
          scoreTotals.totalProcessed += result.totalProcessed;
          scoreTotals.autoPublish += result.autoPublish;
          scoreTotals.review += result.review;
          scoreTotals.insufficientData += result.insufficientData;
          scoreTotals.suppress += result.suppress;
          totalScoreSum += result.avgScore * result.totalProcessed;
          batchReprocessStatus.progress.processed = Math.min((ci + 1) * CHUNK_SIZE, allIds.length);
        }

        scoreTotals.avgScore = scoreTotals.totalProcessed > 0 ? Math.round(totalScoreSum / scoreTotals.totalProcessed) : 0;

        batchReprocessStatus.phases.confidence_scoring = {
          status: "complete",
          startedAt: batchReprocessStatus.phases.confidence_scoring.startedAt,
          completedAt: new Date().toISOString(),
          result: scoreTotals,
        };
        console.log(`[batch-reprocess] Phase 4 complete: auto_publish=${scoreTotals.autoPublish}, review=${scoreTotals.review}, insufficient_data=${scoreTotals.insufficientData}, suppress=${scoreTotals.suppress}`);

        const afterResult = await db.execute(sql`
          SELECT dm_review_status, COUNT(*)::int AS cnt
          FROM leads
          GROUP BY dm_review_status
        `);
        const afterStatus: Record<string, number> = {};
        for (const row of (afterResult as any).rows) {
          afterStatus[row.dm_review_status || "unreviewed"] = row.cnt;
        }
        batchReprocessStatus.afterStatus = afterStatus;

        const transitions: Record<string, number> = {};
        const allStatuses = Array.from(new Set([...Object.keys(beforeStatus), ...Object.keys(afterStatus)]));
        for (const status of allStatuses) {
          const before = beforeStatus[status] || 0;
          const after = afterStatus[status] || 0;
          const diff = after - before;
          if (diff !== 0) {
            transitions[status] = diff;
          }
        }
        batchReprocessStatus.transitions = transitions;

        console.log(`[batch-reprocess] Status transitions:`, transitions);
        console.log(`[batch-reprocess] Before:`, beforeStatus);
        console.log(`[batch-reprocess] After:`, afterStatus);

        batchReprocessStatus.currentPhase = "complete";
        batchReprocessStatus.completedAt = new Date().toISOString();
        batchReprocessStatus.running = false;
        batchReprocessStatus.progress.processed = allIds.length;

        console.log(`[batch-reprocess] Batch reprocess complete!`);
      } catch (error: any) {
        console.error(`[batch-reprocess] Error:`, error);
        batchReprocessStatus.error = error.message || "Unknown error";
        batchReprocessStatus.running = false;
        batchReprocessStatus.currentPhase = "error";
        batchReprocessStatus.completedAt = new Date().toISOString();
      }
    })();
  });

  app.get("/api/admin/batch-reprocess/status", async (_req, res) => {
    res.json(batchReprocessStatus);
  });

  app.get("/api/data/quality-summary", async (_req, res) => {
    try {
      const [tierResult, metricsResult, gapsResult] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE
              (CASE WHEN owner_phone IS NOT NULL OR contact_phone IS NOT NULL OR managing_member_phone IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN contact_name IS NOT NULL AND contact_name != '' THEN 1 ELSE 0 END) +
              (CASE WHEN enrichment_status = 'complete' THEN 1 ELSE 0 END) +
              (CASE WHEN ownership_structure IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN decision_makers IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN dm_review_status IN ('auto_approved', 'auto_publish', 'approved') THEN 1 ELSE 0 END)
              >= 3
            )::int AS high_count,
            COUNT(*) FILTER (WHERE
              (CASE WHEN owner_phone IS NOT NULL OR contact_phone IS NOT NULL OR managing_member_phone IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN contact_name IS NOT NULL AND contact_name != '' THEN 1 ELSE 0 END) +
              (CASE WHEN enrichment_status = 'complete' THEN 1 ELSE 0 END) +
              (CASE WHEN ownership_structure IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN decision_makers IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN dm_review_status IN ('auto_approved', 'auto_publish', 'approved') THEN 1 ELSE 0 END)
              BETWEEN 1 AND 2
            )::int AS medium_count,
            COUNT(*) FILTER (WHERE
              (CASE WHEN owner_phone IS NOT NULL OR contact_phone IS NOT NULL OR managing_member_phone IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN contact_name IS NOT NULL AND contact_name != '' THEN 1 ELSE 0 END) +
              (CASE WHEN enrichment_status = 'complete' THEN 1 ELSE 0 END) +
              (CASE WHEN ownership_structure IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN decision_makers IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN dm_review_status IN ('auto_approved', 'auto_publish', 'approved') THEN 1 ELSE 0 END)
              = 0
            )::int AS low_count
          FROM leads
        `),
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE owner_phone IS NOT NULL OR contact_phone IS NOT NULL OR managing_member_phone IS NOT NULL)::int AS has_phone,
            COUNT(*) FILTER (WHERE contact_name IS NOT NULL AND contact_name != '')::int AS has_contact_name,
            COUNT(*) FILTER (WHERE managing_member IS NOT NULL OR decision_makers IS NOT NULL)::int AS has_decision_maker,
            COUNT(*) FILTER (WHERE enrichment_status = 'complete')::int AS enriched,
            COUNT(*) FILTER (WHERE owner_email IS NOT NULL OR contact_email IS NOT NULL)::int AS has_email,
            COUNT(*) FILTER (WHERE ownership_structure IS NOT NULL)::int AS has_ownership
          FROM leads
        `),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE owner_email IS NULL AND contact_email IS NULL)::int AS missing_email,
            COUNT(*) FILTER (WHERE contact_phone IS NULL AND owner_phone IS NULL AND managing_member_phone IS NULL)::int AS missing_phone,
            COUNT(*) FILTER (WHERE contact_name IS NULL OR contact_name = '')::int AS missing_contact_name,
            COUNT(*) FILTER (WHERE ownership_structure IS NULL)::int AS missing_ownership,
            COUNT(*) FILTER (WHERE decision_makers IS NULL AND managing_member IS NULL)::int AS missing_decision_maker,
            COUNT(*) FILTER (WHERE enrichment_status != 'complete' OR enrichment_status IS NULL)::int AS missing_enrichment,
            COUNT(*)::int AS total
          FROM leads
        `),
      ]);

      const tier = (tierResult as any).rows[0];
      const metrics = (metricsResult as any).rows[0];
      const gaps = (gapsResult as any).rows[0];
      const total = tier.total || 1;

      const gapList = [
        { field: "owner_email", label: "Missing email", count: gaps.missing_email, pct: Math.round((gaps.missing_email / total) * 100) },
        { field: "phone", label: "Missing phone", count: gaps.missing_phone, pct: Math.round((gaps.missing_phone / total) * 100) },
        { field: "contact_name", label: "Missing contact name", count: gaps.missing_contact_name, pct: Math.round((gaps.missing_contact_name / total) * 100) },
        { field: "ownership_structure", label: "Missing ownership classification", count: gaps.missing_ownership, pct: Math.round((gaps.missing_ownership / total) * 100) },
        { field: "decision_makers", label: "Missing decision-maker", count: gaps.missing_decision_maker, pct: Math.round((gaps.missing_decision_maker / total) * 100) },
        { field: "enrichment", label: "Not fully enriched", count: gaps.missing_enrichment, pct: Math.round((gaps.missing_enrichment / total) * 100) },
      ].sort((a, b) => b.pct - a.pct).slice(0, 5);

      res.json({
        tiers: {
          high: { count: tier.high_count, pct: Math.round((tier.high_count / total) * 100) },
          medium: { count: tier.medium_count, pct: Math.round((tier.medium_count / total) * 100) },
          low: { count: tier.low_count, pct: Math.round((tier.low_count / total) * 100) },
        },
        metrics: {
          total,
          hasPhone: Math.round((metrics.has_phone / total) * 100),
          hasContactName: Math.round((metrics.has_contact_name / total) * 100),
          hasDecisionMaker: Math.round((metrics.has_decision_maker / total) * 100),
          enriched: Math.round((metrics.enriched / total) * 100),
          hasEmail: Math.round((metrics.has_email / total) * 100),
          hasOwnership: Math.round((metrics.has_ownership / total) * 100),
        },
        gaps: gapList,
      });
    } catch (error) {
      console.error("Quality summary error:", error);
      res.status(500).json({ message: "Failed to compute quality summary" });
    }
  });

  app.post("/api/admin/cleanup-contractor-data", async (_req, res) => {
    try {
      res.json({ message: "Contractor data cleanup started. This may take a few minutes." });
      cleanupContractorData().then((result) => {
        console.log("[Admin] Contractor cleanup complete:", result);
      }).catch((err) => {
        console.error("[Admin] Contractor cleanup failed:", err);
      });
    } catch (error) {
      console.error("Contractor cleanup error:", error);
      res.status(500).json({ message: "Failed to start contractor data cleanup" });
    }
  });

  app.post("/api/admin/batch-google-places", async (req, res) => {
    try {
      const status = getBatchGooglePlacesStatus();
      if (status.running) {
        return res.status(409).json({ message: "Batch already running", status });
      }
      const limit = Math.min(Math.max(parseInt(req.body?.limit) || 1000, 1), 5000);
      res.json({ message: `Batch Google Places lookup started for top ${limit} leads`, limit });
      runBatchGooglePlaces(limit).catch((err) => {
        console.error("[Admin] Batch Google Places failed:", err);
      });
    } catch (error) {
      console.error("Batch Google Places error:", error);
      res.status(500).json({ message: "Failed to start batch" });
    }
  });

  app.get("/api/admin/batch-google-places/status", async (_req, res) => {
    res.json(getBatchGooglePlacesStatus());
  });

  app.post("/api/admin/batch-google-places/cancel", async (_req, res) => {
    cancelBatchGooglePlaces();
    res.json({ message: "Cancellation requested" });
  });

  // Start storm monitor on boot
  startStormMonitor(10);
  startXweatherMonitor(2);

  return httpServer;
}
