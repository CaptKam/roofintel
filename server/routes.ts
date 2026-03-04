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
import { updateLeadSchema, insertStormAlertConfigSchema, type LeadFilter, buildingPermits, leads as leadsTable, enrichmentJobs, apiUsageTracker, savedFilters, insertSavedFilterSchema, suppressionList } from "@shared/schema";
import { getHunterUsage, searchHunterDomain, findHunterEmail } from "./hunter-io";
import { runBatchGooglePlaces, getBatchGooglePlacesStatus, cancelBatchGooglePlaces } from "./batch-google-places";
import { getPDLUsage, enrichPersonPDL, enrichCompanyPDL } from "./pdl-enrichment";
import { enrichLeadFromEdgar, searchEdgarCompany } from "./sec-edgar";
import { enrichLeadFromTXSOS } from "./tx-sos";
import { enrichLeadFromCountyClerk } from "./county-clerk";
import { db } from "./storage";
import { sql, eq, desc } from "drizzle-orm";
import { fetchAllYearsForProperty, getCachedSnapshots, naipBatchProgress, type NAIPBatchProgress } from "./naip-imagery-agent";
import { analyzePropertyRoof } from "./roof-change-detector";

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

  app.get("/api/dashboard/command-center", async (req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const marketId = req.query.marketId as string | undefined;
      const mFilter = marketId ? sql`AND market_id = ${marketId}` : sql``;
      const mWhere = marketId ? sql`WHERE market_id = ${marketId}` : sql``;
      const lmFilter = marketId ? sql`AND l.market_id = ${marketId}` : sql``;

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
          FROM leads WHERE 1=1 ${mFilter}
        `),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'new')::int AS new,
            COUNT(*) FILTER (WHERE status = 'contacted')::int AS contacted,
            COUNT(*) FILTER (WHERE status = 'qualified')::int AS qualified,
            COUNT(*) FILTER (WHERE status = 'proposal')::int AS proposal,
            COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
          FROM leads WHERE 1=1 ${mFilter}
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
          FROM leads WHERE 1=1 ${mFilter}
        `),
        db.execute(sql`
          SELECT
            l.id, l.address, l.city, l.lead_score, l.roof_last_replaced, l.hail_events,
            l.last_hail_date, l.claim_window_open, l.owner_name,
            COALESCE(l.contact_name, l.management_contact) AS contact_name,
            COALESCE(l.owner_phone, l.contact_phone, l.management_phone, l.managing_member_phone) AS contact_phone,
            l.total_value,
            COALESCE((SELECT COUNT(*)::int FROM contact_evidence ce WHERE ce.lead_id = l.id), 0) AS evidence_count,
            COALESCE((SELECT COUNT(*)::int FROM building_permits bp WHERE bp.lead_id = l.id), 0) AS permit_count,
            CASE
              WHEN l.claim_window_open = true AND l.last_hail_date IS NOT NULL
              THEN GREATEST(0, 730 - (CURRENT_DATE - l.last_hail_date::date))::int
              ELSE NULL
            END AS claim_window_days,
            COALESCE((SELECT MAX(ro.property_count) FROM rooftop_owners ro WHERE ro.lead_id = l.id AND ro.is_primary = true), 0) AS portfolio_size
          FROM leads l
          WHERE l.lead_score >= 50
            AND (l.owner_phone IS NOT NULL OR l.contact_phone IS NOT NULL OR l.managing_member_phone IS NOT NULL)
            ${lmFilter}
          ORDER BY l.lead_score DESC, l.hail_events DESC
          LIMIT 10
        `),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE event_date >= ${d30})::int AS recent_30d,
            COUNT(*) FILTER (WHERE event_date >= ${d7})::int AS recent_7d,
            AVG(hail_size) FILTER (WHERE event_date >= ${d30})::float AS avg_hail_size_30d
          FROM hail_events ${marketId ? sql`WHERE market_id = ${marketId}` : sql``}
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS affected
          FROM leads
          WHERE last_hail_date >= ${d30} ${mFilter}
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
          FROM leads WHERE 1=1 ${mFilter}
          GROUP BY 1
          ORDER BY 1
        `),
        db.execute(sql`
          SELECT id, address, total_value, lead_score, owner_name
          FROM leads
          WHERE total_value IS NOT NULL ${mFilter}
          ORDER BY total_value DESC
          LIMIT 5
        `),
        db.execute(sql`
          SELECT permit_contractors
          FROM leads
          WHERE permit_contractors IS NOT NULL ${mFilter}
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
          evidenceCount: r.evidence_count || 0,
          permitCount: r.permit_count || 0,
          claimWindowDays: r.claim_window_days ?? null,
          portfolioSize: r.portfolio_size || 0,
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
        riskTier: req.query.riskTier as string | undefined,
        sortBy: req.query.sortBy as string | undefined,
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
      const { dualWriteUpdate } = await import("./dual-write");
      const updated = await dualWriteUpdate(req.params.id, parsed.data, "api_patch");
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

  app.get("/api/data-sources", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const sources = await storage.getDataSources();
      const filtered = marketId ? sources.filter(s => s.marketId === marketId) : sources;
      res.json(filtered);
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
      const market = await storage.getMarketById(marketId);
      if (market?.state !== "TX") {
        return res.status(400).json({ message: `Not yet available for ${market?.state || "unknown"} markets. Use CSV import instead.` });
      }
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
      const market = await storage.getMarketById(marketId);
      if (market?.state !== "TX") {
        return res.status(400).json({ message: `Not yet available for ${market?.state || "unknown"} markets. Use CSV import instead.` });
      }
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
      const market = await storage.getMarketById(marketId);
      if (market?.state !== "TX") {
        return res.status(400).json({ message: `Not yet available for ${market?.state || "unknown"} markets. Use CSV import instead.` });
      }
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
      const market = await storage.getMarketById(marketId);
      if (market?.state !== "TX") {
        return res.status(400).json({ message: `Not yet available for ${market?.state || "unknown"} markets. Use CSV import instead.` });
      }
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
      const market = await storage.getMarketById(marketId);
      if (market?.state !== "TX") {
        return res.status(400).json({ message: `Not yet available for ${market?.state || "unknown"} markets. Use CSV import instead.` });
      }
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

  app.get("/api/suppression/list", async (_req, res) => {
    try {
      const items = await db.select().from(suppressionList)
        .where(eq(suppressionList.isActive, true))
        .orderBy(desc(suppressionList.addedAt))
        .limit(500);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to list suppressions", error: error.message });
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

  app.get("/api/data/quality-summary", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const mf = marketId ? sql`AND market_id = ${marketId}` : sql``;
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
          FROM leads WHERE 1=1 ${mf}
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
          FROM leads WHERE 1=1 ${mf}
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
          FROM leads WHERE 1=1 ${mf}
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

  // ============================================================
  // Roof Risk Index
  // ============================================================

  app.post("/api/admin/roof-risk/compute", async (_req, res) => {
    try {
      const { batchComputeRoofRisk, batchProgress } = await import("./roof-risk-index");
      if (batchProgress.running) {
        return res.status(409).json({ message: "Roof risk computation already running", progress: batchProgress });
      }
      res.json({ message: "Roof risk computation started" });
      batchComputeRoofRisk().catch(err => console.error("[roof-risk] Error:", err.message));
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start roof risk computation", error: error.message });
    }
  });

  app.get("/api/admin/roof-risk/status", async (_req, res) => {
    const { batchProgress } = await import("./roof-risk-index");
    res.json(batchProgress);
  });

  app.get("/api/leads/:id/roof-risk", async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      if (lead.roofRiskBreakdown) {
        return res.json(lead.roofRiskBreakdown);
      }

      const { calculateRoofRiskIndex } = await import("./roof-risk-index");

      let portfolioInfo;
      const portfolioRow = (await db.execute(sql`
        SELECT p.property_count,
          (SELECT ARRAY_AGG(l2.year_built) FROM portfolio_leads pl2 JOIN leads l2 ON l2.id = pl2.lead_id WHERE pl2.portfolio_id = p.id) as year_built_array,
          (SELECT ARRAY_AGG(l2.roof_type) FROM portfolio_leads pl2 JOIN leads l2 ON l2.id = pl2.lead_id WHERE pl2.portfolio_id = p.id) as roof_type_array
        FROM portfolio_leads pl
        JOIN portfolios p ON p.id = pl.portfolio_id
        WHERE pl.lead_id = ${req.params.id} AND p.property_count >= 3
        LIMIT 1
      `)) as any;

      if (portfolioRow.rows[0]) {
        portfolioInfo = {
          propertyCount: portfolioRow.rows[0].property_count,
          yearBuiltArray: (portfolioRow.rows[0].year_built_array || []).filter((y: any) => y != null),
          roofTypes: (portfolioRow.rows[0].roof_type_array || []).filter((t: any) => t != null),
        };
      }

      const result = calculateRoofRiskIndex(lead, portfolioInfo);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to compute roof risk", error: error.message });
    }
  });

  app.get("/api/dashboard/roof-risk-summary", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const mf = marketId ? sql`AND market_id = ${marketId}` : sql``;
      const distribution = (await db.execute(sql`
        SELECT
          COUNT(CASE WHEN roof_risk_index >= 81 THEN 1 END) as critical,
          COUNT(CASE WHEN roof_risk_index >= 61 AND roof_risk_index < 81 THEN 1 END) as high,
          COUNT(CASE WHEN roof_risk_index >= 31 AND roof_risk_index < 61 THEN 1 END) as moderate,
          COUNT(CASE WHEN roof_risk_index < 31 THEN 1 END) as low,
          COUNT(roof_risk_index) as total,
          ROUND(AVG(roof_risk_index)::numeric, 1) as avg_score
        FROM leads WHERE roof_risk_index IS NOT NULL ${mf}
      `)) as any;

      const topRisk = (await db.execute(sql`
        SELECT id, address, city, roof_risk_index, roof_type, year_built,
               (roof_risk_breakdown->>'tier') as tier,
               (roof_risk_breakdown->>'exposureWindow') as exposure_window
        FROM leads
        WHERE roof_risk_index IS NOT NULL ${mf}
        ORDER BY roof_risk_index DESC
        LIMIT 10
      `)) as any;

      const dist = distribution.rows[0] || {};
      res.json({
        distribution: {
          critical: Number(dist.critical || 0),
          high: Number(dist.high || 0),
          moderate: Number(dist.moderate || 0),
          low: Number(dist.low || 0),
        },
        total: Number(dist.total || 0),
        avgScore: Number(dist.avg_score || 0),
        topRisk: topRisk.rows || [],
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch roof risk summary", error: error.message });
    }
  });

  app.get("/api/portfolios/:id/risk-summary", async (req, res) => {
    try {
      const portfolioId = req.params.id;
      const result = (await db.execute(sql`
        SELECT
          p.id, p.name, p.property_count,
          ROUND(AVG(l.roof_risk_index)::numeric, 1) as avg_risk,
          MAX(l.roof_risk_index) as max_risk,
          COUNT(CASE WHEN l.roof_risk_index >= 81 THEN 1 END) as critical_count,
          COUNT(CASE WHEN l.roof_risk_index >= 61 AND l.roof_risk_index < 81 THEN 1 END) as high_count,
          MODE() WITHIN GROUP (ORDER BY l.roof_type) as dominant_roof_type,
          MODE() WITHIN GROUP (ORDER BY (l.year_built / 10) * 10) as dominant_decade,
          ARRAY_AGG(DISTINCT l.year_built ORDER BY l.year_built) as year_built_array,
          ROUND(AVG(l.year_built)::numeric, 0) as avg_year_built
        FROM portfolios p
        JOIN portfolio_leads pl ON pl.portfolio_id = p.id
        JOIN leads l ON l.id = pl.lead_id
        WHERE p.id = ${portfolioId}
        GROUP BY p.id, p.name, p.property_count
      `)) as any;

      if (!result.rows[0]) return res.status(404).json({ message: "Portfolio not found" });
      const row = result.rows[0];

      const years = (row.year_built_array || []).filter((y: any) => y != null);
      const avgYear = Number(row.avg_year_built) || 0;
      const withinEra = years.filter((y: number) => Math.abs(y - avgYear) <= 5).length;
      const eraConcentration = years.length > 0 ? Math.round((withinEra / years.length) * 100) : 0;

      const { getRoofLifespan } = await import("./roof-risk-index");
      const lifespan = getRoofLifespan(row.dominant_roof_type);
      const currentYear = new Date().getFullYear();
      const avgAge = currentYear - avgYear;
      const yearsToWindow = Math.max(lifespan.minYears - avgAge, 0);
      const yearsToEnd = Math.max(lifespan.maxYears - avgAge, 0);

      res.json({
        portfolioId: row.id,
        name: row.name,
        propertyCount: row.property_count,
        avgRisk: Number(row.avg_risk) || 0,
        maxRisk: Number(row.max_risk) || 0,
        criticalCount: Number(row.critical_count) || 0,
        highCount: Number(row.high_count) || 0,
        dominantRoofType: row.dominant_roof_type || "Unknown",
        dominantDecade: row.dominant_decade ? `${row.dominant_decade}s` : "Unknown era",
        eraConcentration,
        avgYearBuilt: avgYear,
        systemicWindow: !avgYear ? "Insufficient data" : yearsToWindow <= 0
          ? `Active now — ${row.property_count} properties past expected replacement window`
          : `${yearsToWindow * 12}–${yearsToEnd * 12} months (${eraConcentration}% built in same era)`,
        boardLevelRisk: Number(row.avg_risk) >= 70 && row.property_count >= 5,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch portfolio risk", error: error.message });
    }
  });

  // ============================================================
  // AI Data Quality Agent
  // ============================================================

  app.post("/api/admin/ai-agent/run", async (req, res) => {
    try {
      const { runDataAudit, getAuditProgress, resetAuditProgress, runContractorScrub, runWebsiteExtract, runPortfolioDetection, runStaleDataDetection, runPermitAudit } = await import("./data-audit-agent");
      const { runAiWebSearch } = await import("./ai-web-search-agent");
      const progress = getAuditProgress();
      if (progress.running) {
        return res.status(409).json({ message: "AI agent already running", status: progress });
      }
      resetAuditProgress();
      const batchSize = Math.min(Math.max(parseInt(req.body?.batchSize) || 25, 1), 5000);
      const mode = (req.body?.mode || "audit") as string;

      res.json({ message: `AI agent started in ${mode} mode for ${batchSize} leads`, batchSize, mode });

      const allModes = ["audit", "search", "contractor_scrub", "website_extract", "portfolio", "stale_data", "permit_audit", "roof_risk"];
      const modesToRun = mode === "all" ? allModes : mode === "both" ? ["audit", "search"] : [mode];

      (async () => {
        try {
          for (let i = 0; i < modesToRun.length; i++) {
            const currentMode = modesToRun[i];
            if (i > 0) resetAuditProgress();
            const { getAuditProgress: getProgress } = await import("./data-audit-agent");
            const p = getProgress();
            p.mode = currentMode;

            if (currentMode === "audit") await runDataAudit(batchSize);
            else if (currentMode === "search") await runAiWebSearch(batchSize);
            else if (currentMode === "contractor_scrub") await runContractorScrub(batchSize);
            else if (currentMode === "website_extract") await runWebsiteExtract(batchSize);
            else if (currentMode === "portfolio") await runPortfolioDetection(batchSize);
            else if (currentMode === "stale_data") await runStaleDataDetection(batchSize);
            else if (currentMode === "permit_audit") await runPermitAudit(batchSize);
            else if (currentMode === "roof_risk") {
              const { batchComputeRoofRisk } = await import("./roof-risk-index");
              await batchComputeRoofRisk();
            }

            console.log(`[ai-agent] Completed ${currentMode} (${i + 1}/${modesToRun.length})`);
          }
        } catch (err: any) {
          console.error("[ai-agent] Error:", err.message);
        }
      })();
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start AI agent", error: error.message });
    }
  });

  app.get("/api/admin/ai-agent/status", async (_req, res) => {
    const { getAuditProgress } = await import("./data-audit-agent");
    res.json(getAuditProgress());
  });

  app.post("/api/admin/ai-agent/cancel", async (_req, res) => {
    const { auditProgress } = await import("./data-audit-agent");
    auditProgress.running = false;
    res.json({ message: "Cancel requested" });
  });

  app.get("/api/admin/ai-agent/results", async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const status = req.query.status as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      let query = `
        SELECT a.*, l.owner_name, l.address, l.city, l.total_value, l.contact_name, l.contact_phone
        FROM ai_audit_results a
        JOIN leads l ON a.lead_id = l.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIdx = 1;

      if (type) {
        query += ` AND a.audit_type = $${paramIdx++}`;
        params.push(type);
      }
      if (status) {
        query += ` AND a.status = $${paramIdx++}`;
        params.push(status);
      }
      query += ` ORDER BY a.confidence DESC, a.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      params.push(limit, offset);

      const results = await db.execute(sql.raw(query.replace(/\$(\d+)/g, (_, n) => {
        const val = params[parseInt(n) - 1];
        if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
        return String(val);
      })));

      const countQuery = `
        SELECT COUNT(*)::int as total FROM ai_audit_results
        WHERE 1=1
        ${type ? `AND audit_type = '${type}'` : ""}
        ${status ? `AND status = '${status}'` : ""}
      `;
      const countResult = await db.execute(sql.raw(countQuery));

      res.json({
        results: (results as any).rows,
        total: (countResult as any).rows[0]?.total || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch results", error: error.message });
    }
  });

  app.post("/api/admin/ai-agent/apply/:resultId", async (req, res) => {
    try {
      const resultId = req.params.resultId;

      const rows = await db.execute(sql`
        SELECT * FROM ai_audit_results WHERE id = ${resultId}
      `);
      const result = (rows as any).rows[0];
      if (!result) {
        return res.status(404).json({ message: "Result not found" });
      }

      const findings = result.findings as any;

      if (result.audit_type === "web_search" && findings.foundContacts?.length > 0) {
        const bestContact = findings.foundContacts.reduce((best: any, c: any) =>
          (c.confidence > (best?.confidence || 0)) ? c : best, null);

        if (bestContact) {
          const updates: any = {};
          if (bestContact.name && isPersonName(bestContact.name)) {
            updates.contactName = bestContact.name;
          }
          if (bestContact.phone) {
            const normalizedPhone = normalizePhoneE164(bestContact.phone);
            if (normalizedPhone) updates.contactPhone = normalizedPhone;
          }
          if (bestContact.email) {
            const emailCheck = validateEmailSyntax(bestContact.email);
            if (emailCheck.valid) updates.contactEmail = bestContact.email;
          }
          if (bestContact.title) {
            updates.contactTitle = bestContact.title;
          }
          if (Object.keys(updates).length > 0) {
            await storage.updateLead(result.lead_id, updates);
          }

          if (bestContact.name || bestContact.phone || bestContact.email) {
            const evidenceInputs: EvidenceInput[] = [];
            if (bestContact.name && isPersonName(bestContact.name)) {
              evidenceInputs.push({
                leadId: result.lead_id,
                evidenceType: "PERSON",
                value: bestContact.name,
                source: "ai_web_research",
                trustScore: 50,
              });
            }
            if (bestContact.phone) {
              const validPhone = normalizePhoneE164(bestContact.phone);
              if (validPhone) {
                evidenceInputs.push({
                  leadId: result.lead_id,
                  evidenceType: "PHONE",
                  value: validPhone,
                  source: "ai_web_research",
                  trustScore: 50,
                });
              }
            }
            if (bestContact.email) {
              const emailValid = validateEmailSyntax(bestContact.email);
              if (emailValid.valid) {
                evidenceInputs.push({
                  leadId: result.lead_id,
                  evidenceType: "EMAIL",
                  value: bestContact.email,
                  source: "ai_web_research",
                  trustScore: 50,
                });
              }
            }
            if (evidenceInputs.length > 0) {
              await recordBatchEvidence(evidenceInputs);
            }
          }
        }
      }

      if (result.audit_type === "owner_analysis" && findings.entityType) {
        const updates: any = {};
        if (findings.isManagementCompany && !findings.isActualUser) {
          updates.ownerType = "management_company";
        }
        if (findings.isHoldingCompany) {
          updates.ownerType = "holding_company";
        }
        if (findings.likelyBusinessType) {
          updates.businessType = findings.likelyBusinessType;
        }
        if (Object.keys(updates).length > 0) {
          await storage.updateLead(result.lead_id, updates);
        }
      }

      if (result.audit_type === "contractor_scrub" && findings.isContractor) {
        const updates: any = { managingMember: null, managingMemberTitle: null };
        if (findings.suggestedReplacement && isPersonName(findings.suggestedReplacement)) {
          updates.managingMember = findings.suggestedReplacement;
          updates.managingMemberTitle = findings.replacementSource || "Corrected by AI";
        }
        const existingLead = await storage.getLeadById(result.lead_id);
        const existingNotes = existingLead?.notes || "";
        updates.notes = existingNotes
          ? `${existingNotes}\n[AI Scrub] Removed contractor "${findings.flaggedValue}" from managing member`
          : `[AI Scrub] Removed contractor "${findings.flaggedValue}" from managing member`;
        await storage.updateLead(result.lead_id, updates);
      }

      if (result.audit_type === "website_extract") {
        const contacts = findings.contacts || [];
        const companyInfo = findings.companyInfo || {};
        const updates: any = {};
        const evidenceInputs: EvidenceInput[] = [];

        const existingLead = await storage.getLeadById(result.lead_id);
        const bestContact = contacts[0];
        if (bestContact) {
          if (bestContact.name && isPersonName(bestContact.name) && !existingLead?.contactName) {
            updates.contactName = bestContact.name;
            evidenceInputs.push({ leadId: result.lead_id, evidenceType: "PERSON", value: bestContact.name, source: "ai_website_extraction", trustScore: 55 });
          }
          if (bestContact.title && !existingLead?.contactTitle) updates.contactTitle = bestContact.title;
          if (bestContact.phone && !existingLead?.contactPhone) {
            const norm = normalizePhoneE164(bestContact.phone);
            if (norm) {
              updates.contactPhone = norm;
              evidenceInputs.push({ leadId: result.lead_id, evidenceType: "PHONE", value: norm, source: "ai_website_extraction", trustScore: 55 });
            }
          }
          if (bestContact.email && !existingLead?.contactEmail) {
            const check = validateEmailSyntax(bestContact.email);
            if (check.valid) {
              updates.contactEmail = bestContact.email;
              evidenceInputs.push({ leadId: result.lead_id, evidenceType: "EMAIL", value: bestContact.email, source: "ai_website_extraction", trustScore: 55 });
            }
          }
        }

        if (!updates.contactPhone && !existingLead?.contactPhone && companyInfo.mainPhone) {
          const norm = normalizePhoneE164(companyInfo.mainPhone);
          if (norm) {
            updates.contactPhone = norm;
            evidenceInputs.push({ leadId: result.lead_id, evidenceType: "PHONE", value: norm, source: "ai_website_extraction", trustScore: 50 });
          }
        }
        if (!updates.contactEmail && !existingLead?.contactEmail && companyInfo.mainEmail) {
          const check = validateEmailSyntax(companyInfo.mainEmail);
          if (check.valid) {
            updates.contactEmail = companyInfo.mainEmail;
            evidenceInputs.push({ leadId: result.lead_id, evidenceType: "EMAIL", value: companyInfo.mainEmail, source: "ai_website_extraction", trustScore: 50 });
          }
        }
        if (companyInfo.companyName && !updates.contactName && !existingLead?.businessName) {
          updates.businessName = companyInfo.companyName;
        }

        if (Object.keys(updates).length > 0) await storage.updateLead(result.lead_id, updates);
        if (evidenceInputs.length > 0) await recordBatchEvidence(evidenceInputs);
      }

      if (result.audit_type === "portfolio_analysis") {
        const existingNotes = (await storage.getLeadById(result.lead_id))?.notes || "";
        const portfolioNote = `[Portfolio] ${findings.ownerName}: ${findings.propertyCount} properties, $${Number(findings.totalValue || 0).toLocaleString()} total value. ${findings.contactStrategy || ""}`;
        const updates: any = {
          notes: existingNotes ? `${existingNotes}\n${portfolioNote}` : portfolioNote,
        };
        await storage.updateLead(result.lead_id, updates);
      }

      if (result.audit_type === "stale_data") {
        const existingNotes = (await storage.getLeadById(result.lead_id))?.notes || "";
        let staleNote = "";
        if (findings.subType === "shared_phone") {
          staleNote = `[Stale Data] Phone ${findings.phone} shared by ${findings.sharedByCount} leads — likely contractor/service phone`;
        } else if (findings.subType === "absentee_owner") {
          staleNote = `[Stale Data] Absentee owner — mailing address (${findings.ownerAddress}) differs from property`;
        } else if (findings.subType === "old_roof_unknown") {
          staleNote = `[Stale Data] Building ${findings.buildingAge}yrs old (${findings.yearBuilt}), no roof replacement record — likely replaced, data incomplete`;
        }
        if (staleNote) {
          const updates: any = {
            notes: existingNotes ? `${existingNotes}\n${staleNote}` : staleNote,
          };
          await storage.updateLead(result.lead_id, updates);
        }
      }

      await db.execute(sql`
        UPDATE ai_audit_results SET status = 'applied', applied_at = CURRENT_TIMESTAMP
        WHERE id = ${resultId}
      `);

      res.json({ message: "Finding applied successfully", resultId });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to apply finding", error: error.message });
    }
  });

  app.post("/api/admin/ai-agent/dismiss/:resultId", async (req, res) => {
    try {
      await db.execute(sql`
        UPDATE ai_audit_results SET status = 'dismissed'
        WHERE id = ${req.params.resultId}
      `);
      res.json({ message: "Finding dismissed" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to dismiss", error: error.message });
    }
  });

  app.get("/api/admin/ai-agent/summary", async (_req, res) => {
    try {
      const summaryRows = await db.execute(sql`
        SELECT audit_type, status, COUNT(*)::int as count,
               ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
               SUM(tokens_used)::int as total_tokens
        FROM ai_audit_results
        GROUP BY audit_type, status
        ORDER BY audit_type, status
      `);
      const totalRows = await db.execute(sql`
        SELECT COUNT(*)::int as total,
               SUM(tokens_used)::int as total_tokens
        FROM ai_audit_results
      `);

      res.json({
        byType: (summaryRows as any).rows,
        total: (totalRows as any).rows[0]?.total || 0,
        totalTokens: (totalRows as any).rows[0]?.total_tokens || 0,
        estimatedCost: ((totalRows as any).rows[0]?.total_tokens || 0) * 0.0000008,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get summary", error: error.message });
    }
  });

  // ============================================================
  // Data Normalization Migration
  // ============================================================

  app.post("/api/admin/migrate/normalize", async (_req, res) => {
    try {
      const { runNormalizationMigration, migrationProgress } = await import("./migrations/normalize-leads");
      if (migrationProgress.running) {
        return res.status(409).json({ message: "Migration already running", progress: migrationProgress });
      }
      res.json({ message: "Normalization migration started" });
      runNormalizationMigration().catch(err => console.error("[migration] Fatal:", err.message));
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start migration", error: error.message });
    }
  });

  app.get("/api/admin/migrate/status", async (_req, res) => {
    try {
      const { migrationProgress } = await import("./migrations/normalize-leads");
      res.json(migrationProgress);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get migration status", error: error.message });
    }
  });

  app.get("/api/admin/normalize/stats", async (_req, res) => {
    try {
      const result = (await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM property_roof) as roof,
          (SELECT COUNT(*) FROM property_owner) as owner,
          (SELECT COUNT(*) FROM property_risk_signals) as risk_signals,
          (SELECT COUNT(*) FROM property_contacts) as contacts,
          (SELECT COUNT(*) FROM property_intelligence) as intelligence,
          (SELECT COUNT(*) FROM leads) as leads
      `)) as any;
      const row = result.rows[0];
      res.json({
        leads: Number(row.leads),
        satellite: {
          property_roof: Number(row.roof),
          property_owner: Number(row.owner),
          property_risk_signals: Number(row.risk_signals),
          property_contacts: Number(row.contacts),
          property_intelligence: Number(row.intelligence),
        },
        coverage: {
          property_roof: `${Math.round((Number(row.roof) / Number(row.leads)) * 100)}%`,
          property_owner: `${Math.round((Number(row.owner) / Number(row.leads)) * 100)}%`,
          property_risk_signals: `${Math.round((Number(row.risk_signals) / Number(row.leads)) * 100)}%`,
          property_contacts: `${Math.round((Number(row.contacts) / Number(row.leads)) * 100)}%`,
          property_intelligence: `${Math.round((Number(row.intelligence) / Number(row.leads)) * 100)}%`,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get normalize stats", error: error.message });
    }
  });

  // ============================================================
  // Market Readiness & Data Quality
  // ============================================================

  app.get("/api/markets/:id/readiness", async (req, res) => {
    try {
      const { computeMarketReadiness } = await import("./data-quality-metrics");
      const readiness = await computeMarketReadiness(req.params.id);
      res.json(readiness);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to compute market readiness", error: error.message });
    }
  });

  app.post("/api/admin/quality/snapshot", async (req, res) => {
    try {
      const { snapshotQualityMetrics } = await import("./data-quality-metrics");
      const marketId = req.body.marketId;
      if (!marketId) {
        return res.status(400).json({ message: "marketId required" });
      }
      await snapshotQualityMetrics(marketId);
      res.json({ message: "Quality metrics snapshot stored" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to snapshot quality metrics", error: error.message });
    }
  });

  app.get("/api/admin/quality/history", async (req, res) => {
    try {
      const marketId = req.query.marketId as string;
      const metricName = req.query.metric as string;
      let query;
      if (marketId && metricName) {
        query = sql`SELECT * FROM data_quality_metrics WHERE market_id = ${marketId} AND metric_name = ${metricName} ORDER BY measured_at DESC LIMIT 100`;
      } else if (marketId) {
        query = sql`SELECT * FROM data_quality_metrics WHERE market_id = ${marketId} ORDER BY measured_at DESC LIMIT 200`;
      } else {
        query = sql`SELECT * FROM data_quality_metrics ORDER BY measured_at DESC LIMIT 200`;
      }
      const result = (await db.execute(query)) as any;
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get quality history", error: error.message });
    }
  });

  // Satellite table endpoints for individual properties
  app.get("/api/leads/:id/satellite", async (req, res) => {
    try {
      const id = req.params.id;
      const [roof, owner, risk, contacts, intel] = await Promise.all([
        storage.getPropertyRoof(id),
        storage.getPropertyOwner(id),
        storage.getPropertyRiskSignals(id),
        storage.getPropertyContacts(id),
        storage.getPropertyIntelligence(id),
      ]);
      res.json({ propertyId: id, roof, owner, riskSignals: risk, contacts, intelligence: intel });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get satellite data", error: error.message });
    }
  });

  // ── NAIP Satellite Imagery Endpoints ──

  app.get("/api/leads/:id/naip-history", async (req, res) => {
    try {
      const leadId = req.params.id;
      const snapshots = (await db.execute(sql`
        SELECT * FROM naip_roof_snapshots WHERE lead_id = ${leadId} ORDER BY capture_year ASC
      `)) as any;
      const changes = (await db.execute(sql`
        SELECT * FROM naip_roof_changes WHERE lead_id = ${leadId} ORDER BY confidence DESC
      `)) as any;
      res.json({
        leadId,
        snapshots: snapshots.rows || [],
        changes: changes.rows || [],
        hasData: (snapshots.rows || []).length > 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get NAIP history", error: error.message });
    }
  });

  app.post("/api/leads/:id/naip-analyze", async (req, res) => {
    try {
      const leadId = req.params.id;
      const lead = await storage.getLeadById(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const lat = lead.latitude;
      const lon = lead.longitude;
      if (!lat || !lon) return res.status(400).json({ message: "Lead has no coordinates" });

      const crops = await fetchAllYearsForProperty(lat, lon);
      if (crops.length === 0) return res.json({ message: "No NAIP imagery available", snapshots: 0, change: null });

      const result = await analyzePropertyRoof(leadId, crops);

      if (result.estimatedYear && result.confidence >= 70) {
        await db.execute(sql`
          UPDATE leads SET roof_last_replaced = ${result.estimatedYear}, roof_age_source = 'naip_change_detection'
          WHERE id = ${leadId}
        `);
        try {
          await db.execute(sql`
            INSERT INTO property_roof (property_id, roof_last_replaced, source, updated_at)
            VALUES (${leadId}, ${result.estimatedYear}, 'naip_change_detection', NOW())
            ON CONFLICT (property_id) DO UPDATE SET
              roof_last_replaced = EXCLUDED.roof_last_replaced,
              source = 'naip_change_detection',
              updated_at = NOW()
          `);
        } catch {}
      }

      res.json({
        message: "Analysis complete",
        snapshotsAnalyzed: crops.length,
        yearsAvailable: crops.map(c => c.year),
        result,
      });
    } catch (error: any) {
      console.error(`[NAIP] Error analyzing lead:`, error.message);
      res.status(500).json({ message: "NAIP analysis failed", error: error.message });
    }
  });

  app.post("/api/admin/naip/analyze", async (_req, res) => {
    if (naipBatchProgress.running) {
      return res.status(409).json({ message: "NAIP batch analysis already running", progress: naipBatchProgress });
    }

    const { naipBatchProgress: progress } = await import("./naip-imagery-agent");
    Object.assign(progress, {
      running: true,
      phase: "querying",
      processed: 0,
      total: 0,
      detected: 0,
      applied: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });

    res.json({ message: "NAIP batch analysis started", progress });

    (async () => {
      try {
        const candidateResult = (await db.execute(sql`
          SELECT id, latitude, longitude, year_built, roof_last_replaced
          FROM leads
          WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            AND (roof_last_replaced IS NULL OR roof_last_replaced = year_built)
          ORDER BY year_built ASC NULLS FIRST
          LIMIT 5000
        `)) as any;
        const candidates = candidateResult.rows || [];
        progress.total = candidates.length;
        progress.phase = "processing";
        console.log(`[NAIP] Starting batch analysis of ${candidates.length} leads`);

        for (let i = 0; i < candidates.length; i++) {
          if (!progress.running) break;
          const lead = candidates[i];

          try {
            const cached = await getCachedSnapshots(lead.id);
            if (cached.length >= 2) {
              progress.processed++;
              continue;
            }

            const crops = await fetchAllYearsForProperty(lead.latitude, lead.longitude);
            if (crops.length < 2) {
              progress.processed++;
              continue;
            }

            const result = await analyzePropertyRoof(lead.id, crops);

            if (result.estimatedYear && result.confidence >= 70) {
              progress.detected++;
              await db.execute(sql`
                UPDATE leads SET roof_last_replaced = ${result.estimatedYear}, roof_age_source = 'naip_change_detection'
                WHERE id = ${lead.id}
              `);
              try {
                await db.execute(sql`
                  INSERT INTO property_roof (property_id, roof_last_replaced, source, updated_at)
                  VALUES (${lead.id}, ${result.estimatedYear}, 'naip_change_detection', NOW())
                  ON CONFLICT (property_id) DO UPDATE SET
                    roof_last_replaced = EXCLUDED.roof_last_replaced,
                    source = 'naip_change_detection',
                    updated_at = NOW()
                `);
              } catch {}
              progress.applied++;
            }
          } catch (err: any) {
            progress.errors++;
            if (progress.errors <= 5) {
              console.error(`[NAIP] Error on lead ${lead.id}:`, err.message);
            }
          }

          progress.processed++;
          if (progress.processed % 50 === 0) {
            console.log(`[NAIP] Progress: ${progress.processed}/${progress.total}, detected: ${progress.detected}, applied: ${progress.applied}, errors: ${progress.errors}`);
          }
        }

        progress.running = false;
        progress.phase = "complete";
        progress.completedAt = new Date().toISOString();
        console.log(`[NAIP] Batch complete: ${progress.processed} processed, ${progress.detected} detected, ${progress.applied} applied, ${progress.errors} errors`);
      } catch (error: any) {
        console.error(`[NAIP] Fatal batch error:`, error.message);
        progress.running = false;
        progress.phase = "error";
        progress.completedAt = new Date().toISOString();
      }
    })();
  });

  app.get("/api/admin/naip/status", async (_req, res) => {
    res.json(naipBatchProgress);
  });

  app.post("/api/admin/naip/cancel", async (_req, res) => {
    if (!naipBatchProgress.running) {
      return res.json({ message: "No batch running" });
    }
    naipBatchProgress.running = false;
    naipBatchProgress.phase = "cancelled";
    res.json({ message: "Batch cancelled", progress: naipBatchProgress });
  });

  app.get("/api/admin/naip/results", async (req, res) => {
    try {
      const minConfidence = parseInt(req.query.minConfidence as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;

      const results = (await db.execute(sql`
        SELECT nc.*, l.property_name, l.address, l.year_built, l.roof_type
        FROM naip_roof_changes nc
        JOIN leads l ON l.id = nc.lead_id
        WHERE nc.confidence >= ${minConfidence}
        ORDER BY nc.confidence DESC, nc.analyzed_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)) as any;

      const countResult = (await db.execute(sql`
        SELECT COUNT(*) as total FROM naip_roof_changes WHERE confidence >= ${minConfidence}
      `)) as any;

      const stats = (await db.execute(sql`
        SELECT
          COUNT(*) as total_changes,
          COUNT(*) FILTER (WHERE confidence >= 70) as high_confidence,
          COUNT(*) FILTER (WHERE confidence >= 30 AND confidence < 70) as medium_confidence,
          COUNT(*) FILTER (WHERE confidence < 30) as low_confidence,
          COUNT(*) FILTER (WHERE applied = true) as applied,
          AVG(confidence) as avg_confidence
        FROM naip_roof_changes
      `)) as any;

      res.json({
        results: results.rows || [],
        total: parseInt(countResult.rows?.[0]?.total || "0"),
        stats: stats.rows?.[0] || {},
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get NAIP results", error: error.message });
    }
  });

  app.get("/api/admin/naip/stats", async (_req, res) => {
    try {
      const snapshotStats = (await db.execute(sql`
        SELECT
          COUNT(DISTINCT lead_id) as leads_with_snapshots,
          COUNT(*) as total_snapshots,
          MIN(capture_year) as earliest_year,
          MAX(capture_year) as latest_year
        FROM naip_roof_snapshots
      `)) as any;

      const changeStats = (await db.execute(sql`
        SELECT
          COUNT(*) as total_changes,
          COUNT(*) FILTER (WHERE confidence >= 70) as high_confidence,
          COUNT(*) FILTER (WHERE applied = true) as applied_count,
          AVG(confidence) as avg_confidence
        FROM naip_roof_changes
      `)) as any;

      const byYear = (await db.execute(sql`
        SELECT capture_year, COUNT(DISTINCT lead_id) as lead_count, AVG(mean_brightness) as avg_brightness
        FROM naip_roof_snapshots
        GROUP BY capture_year ORDER BY capture_year
      `)) as any;

      res.json({
        snapshots: snapshotStats.rows?.[0] || {},
        changes: changeStats.rows?.[0] || {},
        byYear: byYear.rows || [],
        batchProgress: naipBatchProgress,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get NAIP stats", error: error.message });
    }
  });

  // Property Data Scanner endpoints
  app.get("/api/admin/property-scan/gaps", async (_req, res) => {
    try {
      const { getDataGapSummary } = await import("./property-data-scanner");
      const gaps = await getDataGapSummary();
      res.json(gaps);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get data gaps", error: error.message });
    }
  });

  app.post("/api/admin/property-scan/run", async (req, res) => {
    try {
      const { runPropertyScan, getScanStatus } = await import("./property-data-scanner");
      const status = getScanStatus();
      if (status.status === "running") {
        return res.status(409).json({ message: "Scan already in progress", status });
      }
      const { maxLeads, stages, countyFilter } = req.body || {};
      runPropertyScan({ maxLeads, stages, countyFilter });
      res.json({ message: "Property scan started", status: getScanStatus() });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start scan", error: error.message });
    }
  });

  app.get("/api/admin/property-scan/status", async (_req, res) => {
    try {
      const { getScanStatus } = await import("./property-data-scanner");
      res.json(getScanStatus());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get scan status", error: error.message });
    }
  });

  app.get("/api/admin/property-scan/results", async (req, res) => {
    try {
      const { getScanResults } = await import("./property-data-scanner");
      const results = getScanResults();
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      res.json({
        total: results.length,
        results: results.slice(offset, offset + limit),
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get scan results", error: error.message });
    }
  });

  // CAD Reimport endpoints
  app.post("/api/admin/cad/reimport", async (req, res) => {
    try {
      const { runCadReimport, getReimportStatus } = await import("./cad-reimport");
      const status = getReimportStatus();
      if (status.status === "running") {
        return res.status(409).json({ message: "Reimport already in progress", status });
      }
      const { counties, maxRecords, dryRun } = req.body || {};
      runCadReimport({ counties, maxRecords, dryRun });
      res.json({ message: "CAD reimport started", status: getReimportStatus() });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start reimport", error: error.message });
    }
  });

  app.get("/api/admin/cad/reimport/status", async (_req, res) => {
    try {
      const { getReimportStatus } = await import("./cad-reimport");
      res.json(getReimportStatus());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get reimport status", error: error.message });
    }
  });

  // PropStream CSV/Excel Import endpoints
  app.post("/api/import/propstream-csv", upload.single("file"), async (req, res) => {
    try {
      const { importPropStreamFile, getPropStreamImportProgress } = await import("./propstream-importer");
      const progress = getPropStreamImportProgress();
      if (progress.status === "running") {
        return res.status(409).json({ message: "Import already in progress", progress });
      }
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const fileName = req.file.originalname || "import.csv";
      importPropStreamFile(req.file.buffer, fileName);
      res.json({ message: "PropStream import started", progress: getPropStreamImportProgress() });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start PropStream import", error: error.message });
    }
  });

  app.get("/api/import/propstream-csv/status", async (_req, res) => {
    try {
      const { getPropStreamImportProgress } = await import("./propstream-importer");
      res.json(getPropStreamImportProgress());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get import status", error: error.message });
    }
  });

  app.post("/api/admin/roi/run-batch", async (req, res) => {
    try {
      const { runBatch, getBatchProgress } = await import("./enrichment-roi-agent");
      const progress = getBatchProgress();
      if (progress.running) {
        return res.status(409).json({ message: "ROI batch already running", progress });
      }
      const { marketId, zipCode } = req.body || {};
      runBatch(marketId || undefined, undefined, zipCode || undefined);
      res.json({ message: "ROI batch started", progress: getBatchProgress() });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start ROI batch", error: error.message });
    }
  });

  app.get("/api/admin/roi/status", async (_req, res) => {
    try {
      const { getBatchProgress } = await import("./enrichment-roi-agent");
      res.json(getBatchProgress());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ROI status", error: error.message });
    }
  });

  app.get("/api/admin/roi/stats", async (req, res) => {
    try {
      const { getEnrichmentStats } = await import("./enrichment-roi-agent");
      const stats = await getEnrichmentStats(req.query.marketId as string || undefined);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ROI stats", error: error.message });
    }
  });

  app.get("/api/admin/roi/decisions", async (req, res) => {
    try {
      const { enrichmentDecisions, leads } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const limit = Number(req.query.limit) || 50;
      const baseQuery = db
        .select({
          id: enrichmentDecisions.id,
          leadId: enrichmentDecisions.leadId,
          marketId: enrichmentDecisions.marketId,
          decisionType: enrichmentDecisions.decisionType,
          roiScore: enrichmentDecisions.roiScore,
          expectedValue: enrichmentDecisions.expectedValue,
          enrichmentCost: enrichmentDecisions.enrichmentCost,
          recommendedApis: enrichmentDecisions.recommendedApis,
          confidence: enrichmentDecisions.confidence,
          reasonSummary: enrichmentDecisions.reasonSummary,
          createdAt: enrichmentDecisions.createdAt,
          address: leads.address,
          leadScore: leads.leadScore,
        })
        .from(enrichmentDecisions)
        .leftJoin(leads, eq(enrichmentDecisions.leadId, leads.id))
        .orderBy(desc(enrichmentDecisions.roiScore))
        .limit(limit);
      if (req.query.marketId) {
        baseQuery.where(eq(enrichmentDecisions.marketId, req.query.marketId as string));
      }
      const decisions = await baseQuery;
      res.json(decisions);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ROI decisions", error: error.message });
    }
  });

  app.get("/api/leads/:id/roi-decision", async (req, res) => {
    try {
      const { getSingleLeadDecision } = await import("./enrichment-roi-agent");
      const decision = await getSingleLeadDecision(req.params.id);
      res.json(decision);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get lead ROI decision", error: error.message });
    }
  });

  app.post("/api/admin/zip-tiles/compute", async (req, res) => {
    try {
      const { scoreAllZips, getComputeProgress } = await import("./zip-tile-scoring");
      const progress = getComputeProgress();
      if (progress.running) {
        return res.status(409).json({ message: "ZIP computation already running", progress });
      }
      const { marketId } = req.body || {};
      scoreAllZips(marketId || undefined);
      res.json({ message: "ZIP tile computation started", progress: getComputeProgress() });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start ZIP computation", error: error.message });
    }
  });

  app.get("/api/admin/zip-tiles/status", async (_req, res) => {
    try {
      const { getComputeProgress } = await import("./zip-tile-scoring");
      res.json(getComputeProgress());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ZIP status", error: error.message });
    }
  });

  app.get("/api/zip-tiles", async (req, res) => {
    try {
      const { getZipTiles } = await import("./zip-tile-scoring");
      const tiles = await getZipTiles(req.query.marketId as string || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da");
      res.json(tiles);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ZIP tiles", error: error.message });
    }
  });

  app.get("/api/zip-tiles/:zipCode", async (req, res) => {
    try {
      const { getZipTile } = await import("./zip-tile-scoring");
      const tile = await getZipTile(req.params.zipCode);
      if (!tile) return res.status(404).json({ message: "ZIP tile not found" });
      res.json(tile);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get ZIP tile", error: error.message });
    }
  });

  // ==================== SECTOR ROUTES ====================

  app.get("/api/sectors", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const sectorList = await storage.getSectors(marketId);
      res.json(sectorList);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get sectors", error: error.message });
    }
  });

  app.get("/api/sectors/:id", async (req, res) => {
    try {
      const sector = await storage.getSectorById(req.params.id);
      if (!sector) return res.status(404).json({ message: "Sector not found" });
      res.json(sector);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get sector", error: error.message });
    }
  });

  app.post("/api/sectors", async (req, res) => {
    try {
      const { insertSectorSchema } = await import("@shared/schema");
      const parsed = insertSectorSchema.parse(req.body);
      const sector = await storage.createSector(parsed);
      res.json(sector);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: "Failed to create sector", error: error.message });
    }
  });

  app.patch("/api/sectors/:id", async (req, res) => {
    try {
      const { insertSectorSchema } = await import("@shared/schema");
      const partial = insertSectorSchema.partial().parse(req.body);
      const sector = await storage.updateSector(req.params.id, partial);
      if (!sector) return res.status(404).json({ message: "Sector not found" });
      res.json(sector);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: "Failed to update sector", error: error.message });
    }
  });

  app.delete("/api/sectors/:id", async (req, res) => {
    try {
      await storage.deleteSector(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete sector", error: error.message });
    }
  });

  app.post("/api/sectors/:id/compute", async (req, res) => {
    try {
      const sector = await storage.getSectorById(req.params.id);
      if (!sector) return res.status(404).json({ message: "Sector not found" });

      const { zipTiles: zipTilesTable } = await import("@shared/schema");
      const { inArray } = await import("drizzle-orm");
      const tiles = await db.select().from(zipTilesTable).where(
        inArray(zipTilesTable.zipCode, sector.zipCodes)
      );

      if (tiles.length === 0) {
        return res.json({ ...sector, sectorScore: 0, leadCount: 0 });
      }

      const totalLeads = tiles.reduce((s, t) => s + (t.leadCount || 0), 0);
      const avgScore = Math.round(tiles.reduce((s, t) => s + (t.zipScore || 0), 0) / tiles.length);
      const avgLeadScore = tiles.reduce((s, t) => s + (t.avgLeadScore || 0), 0) / tiles.length;
      const totalValue = tiles.reduce((s, t) => s + (t.medianPropertyValue || 0) * (t.leadCount || 0), 0);

      const updated = await storage.updateSector(sector.id, {
        sectorScore: avgScore,
        leadCount: totalLeads,
        avgLeadScore: Math.round(avgLeadScore * 10) / 10,
        totalPropertyValue: totalValue,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to compute sector score", error: error.message });
    }
  });

  app.post("/api/sectors/auto-generate", async (req, res) => {
    try {
      const marketId = req.body.marketId;
      if (!marketId) return res.status(400).json({ message: "marketId required" });

      const { zipTiles: zipTilesTable } = await import("@shared/schema");
      const tiles = await db.select().from(zipTilesTable).where(eq(zipTilesTable.marketId, marketId));

      if (tiles.length === 0) {
        return res.json({ message: "No ZIP tiles found for this market. Compute ZIP tiles first.", sectors: [] });
      }

      const tilesWithCoords = tiles.filter(t => t.centerLat && t.centerLng);
      if (tilesWithCoords.length === 0) {
        return res.json({ message: "No ZIP tiles with coordinates found.", sectors: [] });
      }

      const latCenter = tilesWithCoords.reduce((s, t) => s + t.centerLat!, 0) / tilesWithCoords.length;
      const lngCenter = tilesWithCoords.reduce((s, t) => s + t.centerLng!, 0) / tilesWithCoords.length;

      const quadrants: { name: string; color: string; zips: string[] }[] = [
        { name: "North", color: "#3B82F6", zips: [] },
        { name: "South", color: "#EF4444", zips: [] },
        { name: "East", color: "#10B981", zips: [] },
        { name: "West", color: "#F59E0B", zips: [] },
        { name: "Northeast", color: "#8B5CF6", zips: [] },
        { name: "Northwest", color: "#EC4899", zips: [] },
        { name: "Southeast", color: "#06B6D4", zips: [] },
        { name: "Southwest", color: "#F97316", zips: [] },
      ];

      for (const tile of tilesWithCoords) {
        const isNorth = tile.centerLat! > latCenter;
        const isEast = tile.centerLng! > lngCenter;
        const latDist = Math.abs(tile.centerLat! - latCenter);
        const lngDist = Math.abs(tile.centerLng! - lngCenter);
        const isDiagonal = latDist > 0.02 && lngDist > 0.02;

        if (isDiagonal) {
          if (isNorth && isEast) quadrants[4].zips.push(tile.zipCode);
          else if (isNorth && !isEast) quadrants[5].zips.push(tile.zipCode);
          else if (!isNorth && isEast) quadrants[6].zips.push(tile.zipCode);
          else quadrants[7].zips.push(tile.zipCode);
        } else {
          if (isNorth && latDist >= lngDist) quadrants[0].zips.push(tile.zipCode);
          else if (!isNorth && latDist >= lngDist) quadrants[1].zips.push(tile.zipCode);
          else if (isEast) quadrants[2].zips.push(tile.zipCode);
          else quadrants[3].zips.push(tile.zipCode);
        }
      }

      const market = await storage.getMarketById(marketId);
      const marketName = market?.name || "Market";

      const created = [];
      for (const q of quadrants) {
        if (q.zips.length === 0) continue;
        const sector = await storage.createSector({
          marketId,
          name: `${marketName} - ${q.name}`,
          color: q.color,
          zipCodes: q.zips,
          priority: "medium",
        });
        created.push(sector);
      }

      res.json({ message: `Generated ${created.length} sectors`, sectors: created });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to auto-generate sectors", error: error.message });
    }
  });

  app.get("/api/admin/budgets", async (req, res) => {
    try {
      const { getMarketConfig } = await import("./enrichment-roi-agent");
      const config = await getMarketConfig(req.query.marketId as string || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da");
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get budget config", error: error.message });
    }
  });

  app.patch("/api/admin/budgets", async (req, res) => {
    try {
      const { enrichmentBudgets } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const marketId = req.body.marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const { marketId: _, ...updates } = req.body;
      await db.update(enrichmentBudgets).set(updates).where(eq(enrichmentBudgets.marketId, marketId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update budget", error: error.message });
    }
  });

  // ==================== OUTCOME TRACKING ROUTES ====================

  app.post("/api/leads/:id/outcome", async (req, res) => {
    try {
      const { recordOutcome } = await import("./outcome-tracker");
      const result = await recordOutcome(req.params.id, req.body.status, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to record outcome", error: error.message });
    }
  });

  app.get("/api/leads/:id/outcomes", async (req, res) => {
    try {
      const { getOutcomesForLead } = await import("./outcome-tracker");
      const outcomes = await getOutcomesForLead(req.params.id);
      res.json(outcomes);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get outcomes", error: error.message });
    }
  });

  app.patch("/api/leads/:id/outcome/:outcomeId", async (req, res) => {
    try {
      const { updateOutcome } = await import("./outcome-tracker");
      const result = await updateOutcome(req.params.outcomeId, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update outcome", error: error.message });
    }
  });

  // ==================== KPI ROUTES ====================

  app.get("/api/admin/kpis/current", async (req, res) => {
    try {
      const { getCurrentKpi } = await import("./outcome-tracker");
      const marketId = (req.query.marketId as string) || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const kpi = await getCurrentKpi(marketId);
      res.json(kpi);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get KPI", error: error.message });
    }
  });

  app.get("/api/admin/kpis/timeseries", async (req, res) => {
    try {
      const { getKpiTimeSeries } = await import("./outcome-tracker");
      const marketId = (req.query.marketId as string) || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const days = parseInt(req.query.days as string) || 30;
      const series = await getKpiTimeSeries(marketId, days);
      res.json(series);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get timeseries", error: error.message });
    }
  });

  app.post("/api/admin/kpis/snapshot", async (req, res) => {
    try {
      const { computeKpiSnapshot } = await import("./outcome-tracker");
      const marketId = req.body.marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const snapshot = await computeKpiSnapshot(marketId);
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to compute snapshot", error: error.message });
    }
  });

  app.get("/api/admin/kpis/funnel", async (req, res) => {
    try {
      const { getConversionFunnel } = await import("./outcome-tracker");
      const marketId = (req.query.marketId as string) || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const funnel = await getConversionFunnel(marketId);
      res.json(funnel);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get funnel", error: error.message });
    }
  });

  app.post("/api/admin/kpis/retrain-weights", async (req, res) => {
    try {
      const { retrainWeights } = await import("./outcome-tracker");
      const marketId = req.body.marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const result = await retrainWeights(marketId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to retrain weights", error: error.message });
    }
  });

  // ==================== SKIP-TRACE TTL ROUTES ====================

  app.get("/api/leads/:id/trace-history", async (req, res) => {
    try {
      const { getTraceHistory } = await import("./skip-trace-ttl");
      const history = await getTraceHistory(req.params.id);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get trace history", error: error.message });
    }
  });

  app.get("/api/admin/trace-costs", async (req, res) => {
    try {
      const { getTraceCostSummary } = await import("./skip-trace-ttl");
      const marketId = req.query.marketId as string;
      const days = parseInt(req.query.days as string) || 30;
      const summary = await getTraceCostSummary(marketId, days);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get trace costs", error: error.message });
    }
  });

  app.post("/api/admin/trace/cleanup", async (req, res) => {
    try {
      const { cleanExpiredTraces } = await import("./skip-trace-ttl");
      const result = await cleanExpiredTraces();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to clean traces", error: error.message });
    }
  });

  app.get("/api/admin/trace/batch-economics", async (req, res) => {
    try {
      const { computeBatchEconomics } = await import("./skip-trace-ttl");
      const leadCount = parseInt(req.query.leadCount as string) || 1000;
      const result = computeBatchEconomics(leadCount);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to compute economics", error: error.message });
    }
  });

  // ==================== CONSENT & COMPLIANCE ROUTES ====================

  app.post("/api/leads/:id/consent", async (req, res) => {
    try {
      const { recordConsent } = await import("./consent-manager");
      const result = await recordConsent(
        req.params.id,
        req.body.tokenType,
        req.body.tokenValue,
        req.body.captureUrl,
        req.body.ipAddress,
        req.body.userAgent
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to record consent", error: error.message });
    }
  });

  app.get("/api/leads/:id/consent", async (req, res) => {
    try {
      const { verifyConsent } = await import("./consent-manager");
      const result = await verifyConsent(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to verify consent", error: error.message });
    }
  });

  app.delete("/api/leads/:id/consent", async (req, res) => {
    try {
      const { revokeConsent } = await import("./consent-manager");
      const result = await revokeConsent(req.params.id, req.body.reason || "User revoked");
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to revoke consent", error: error.message });
    }
  });

  app.get("/api/leads/:id/consent/audit", async (req, res) => {
    try {
      const { getConsentAuditTrail } = await import("./consent-manager");
      const trail = await getConsentAuditTrail(req.params.id);
      res.json(trail);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get audit trail", error: error.message });
    }
  });

  app.get("/api/admin/compliance/report", async (req, res) => {
    try {
      const { generateComplianceReport } = await import("./consent-manager");
      const marketId = (req.query.marketId as string) || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const report = await generateComplianceReport(marketId);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to generate report", error: error.message });
    }
  });

  // ==================== PHONE VALIDATION ROUTES ====================

  app.post("/api/leads/:id/validate-phone", async (req, res) => {
    try {
      const { validateAndClassify } = await import("./phone-validation-pipeline");
      const lead = await db.query.leads.findFirst({ where: eq(leads.id, req.params.id) });
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      const phone = req.body.phone || lead.ownerPhone || lead.contactPhone;
      if (!phone) return res.status(400).json({ message: "No phone to validate" });
      const result = await validateAndClassify(phone, req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to validate phone", error: error.message });
    }
  });

  let phoneValidationProgress = { processed: 0, total: 0, running: false };

  app.post("/api/admin/phone-validation/batch", async (req, res) => {
    try {
      const { batchValidatePhones } = await import("./phone-validation-pipeline");
      const leadIds = req.body.leadIds;
      if (!leadIds || !Array.isArray(leadIds)) {
        const leadsWithPhone = await db.select({ id: leads.id }).from(leads)
          .where(sql`${leads.ownerPhone} IS NOT NULL`)
          .limit(req.body.limit || 100);
        const ids = leadsWithPhone.map(l => l.id);
        phoneValidationProgress = { processed: 0, total: ids.length, running: true };
        res.json({ message: "Batch validation started", total: ids.length });
        batchValidatePhones(ids).then(result => {
          phoneValidationProgress = { processed: result.validated + result.invalid, total: ids.length, running: false };
        });
        return;
      }
      phoneValidationProgress = { processed: 0, total: leadIds.length, running: true };
      res.json({ message: "Batch validation started", total: leadIds.length });
      batchValidatePhones(leadIds).then(result => {
        phoneValidationProgress = { processed: result.validated + result.invalid, total: leadIds.length, running: false };
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to start batch", error: error.message });
    }
  });

  app.get("/api/admin/phone-validation/status", async (_req, res) => {
    res.json(phoneValidationProgress);
  });

  app.get("/api/admin/phone-validation/summary", async (req, res) => {
    try {
      const { getValidationSummary } = await import("./phone-validation-pipeline");
      const marketId = (req.query.marketId as string) || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
      const summary = await getValidationSummary(marketId);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get summary", error: error.message });
    }
  });

  // === Grok Intelligence Core ===

  app.post("/api/ops/grok-ask", async (req, res) => {
    try {
      const { runSupervisor } = await import("./intelligence/supervisor");
      const { prompt, marketId, sessionId, leadId } = req.body;
      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ message: "prompt is required" });
      }
      const sid = sessionId || `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await runSupervisor(prompt.trim(), {
        marketId: marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da",
        sessionId: sid,
        leadId: leadId || undefined,
        sessionType: "ops_chat",
      });
      res.json(result);
    } catch (error: any) {
      console.error("[Grok Core] Error:", error);
      res.status(500).json({ message: "Grok Core error", error: error.message });
    }
  });

  app.get("/api/ops/alerts", async (req, res) => {
    try {
      const { generateOpsAlerts } = await import("./intelligence/alerts-engine");
      const marketId = req.query.marketId as string | undefined;
      const alerts = await generateOpsAlerts(marketId);
      res.json(alerts);
    } catch (error: any) {
      console.error("Ops alerts error:", error);
      res.status(500).json({ message: "Failed to generate alerts", error: error.message });
    }
  });

  app.get("/api/ops/intel-briefing", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const mf = marketId ? sql`AND market_id = ${marketId}` : sql``;

      const [
        claimWindowResult,
        permitsResult,
        evidenceResult,
        evidenceSourcesResult,
        ownersResult,
        portfolioOwnersResult,
        coverageResult,
        graphResult,
      ] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int AS count FROM leads WHERE claim_window_open = true ${mf}`),
        db.execute(sql`
          SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE source = 'dallas_open_data')::int AS dallas,
            COUNT(*) FILTER (WHERE source = 'fort_worth_open_data')::int AS fort_worth,
            COUNT(*) FILTER (WHERE source NOT IN ('dallas_open_data', 'fort_worth_open_data'))::int AS other
          FROM building_permits
          ${marketId ? sql`WHERE market_id = ${marketId}` : sql``}
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS total FROM contact_evidence ce
          ${marketId ? sql`JOIN leads l ON l.id = ce.lead_id WHERE ce.is_active = true AND l.market_id = ${marketId}` : sql`WHERE ce.is_active = true`}
        `),
        db.execute(sql`
          SELECT ce.source_name, COUNT(*)::int AS count
          FROM contact_evidence ce
          ${marketId ? sql`JOIN leads l ON l.id = ce.lead_id WHERE ce.is_active = true AND l.market_id = ${marketId}` : sql`WHERE ce.is_active = true`}
          GROUP BY ce.source_name
          ORDER BY count DESC
          LIMIT 5
        `),
        db.execute(sql`
          SELECT COUNT(DISTINCT ro.normalized_name)::int AS count FROM rooftop_owners ro
          ${marketId ? sql`JOIN leads l ON l.id = ro.lead_id WHERE l.market_id = ${marketId}` : sql``}
        `),
        db.execute(sql`
          SELECT COUNT(DISTINCT ro.normalized_name)::int AS count
          FROM rooftop_owners ro
          ${marketId ? sql`JOIN leads l ON l.id = ro.lead_id WHERE ro.property_count >= 3 AND l.market_id = ${marketId}` : sql`WHERE ro.property_count >= 3`}
        `),
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE owner_phone IS NOT NULL OR contact_phone IS NOT NULL)::int AS has_phone,
            COUNT(*) FILTER (WHERE owner_email IS NOT NULL OR contact_email IS NOT NULL)::int AS has_email,
            COUNT(*) FILTER (WHERE managing_member IS NOT NULL)::int AS has_decision_maker,
            COUNT(*) FILTER (WHERE ownership_structure IS NOT NULL)::int AS has_ownership
          FROM leads WHERE 1=1 ${mf}
        `),
        db.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM graph_nodes) AS nodes,
            (SELECT COUNT(*)::int FROM graph_edges) AS edges
        `),
      ]);

      const claimRow = (claimWindowResult as any).rows[0];
      const permitRow = (permitsResult as any).rows[0];
      const evidenceRow = (evidenceResult as any).rows[0];
      const evidenceSources = (evidenceSourcesResult as any).rows;
      const ownerRow = (ownersResult as any).rows[0];
      const portfolioRow = (portfolioOwnersResult as any).rows[0];
      const covRow = (coverageResult as any).rows[0];
      const graphRow = (graphResult as any).rows[0];

      const total = covRow.total || 1;
      const pct = (v: number) => Math.round((v / total) * 100);

      res.json({
        claimWindows: claimRow.count,
        permits: {
          total: permitRow.total,
          dallas: permitRow.dallas,
          fortWorth: permitRow.fort_worth,
          other: permitRow.other,
        },
        contactEvidence: {
          total: evidenceRow.total,
          topSources: evidenceSources.map((r: any) => ({ name: r.source_name, count: r.count })),
        },
        owners: {
          resolved: ownerRow.count,
          multiProperty: portfolioRow.count,
        },
        coverage: {
          hasPhone: pct(covRow.has_phone),
          hasEmail: pct(covRow.has_email),
          hasDecisionMaker: pct(covRow.has_decision_maker),
          hasOwnership: pct(covRow.has_ownership),
        },
        graph: {
          nodes: graphRow.nodes,
          edges: graphRow.edges,
        },
      });
    } catch (error: any) {
      console.error("Intel briefing error:", error);
      res.status(500).json({ message: "Failed to generate intel briefing", error: error.message });
    }
  });

  app.get("/api/ops/grok-sessions", async (_req, res) => {
    try {
      const sessions = await storage.listAgentSessions(50);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to list sessions", error: error.message });
    }
  });

  app.get("/api/ops/grok-sessions/:sessionId", async (req, res) => {
    try {
      const session = await storage.getAgentSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      const traces = await storage.listAgentTraces(req.params.sessionId, 50);
      res.json({ session, traces });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get session", error: error.message });
    }
  });

  app.get("/api/ops/grok-cost-summary", async (_req, res) => {
    try {
      const traces = await storage.listAgentTraces(undefined, 1000);
      const now = Date.now();
      const h24 = now - 86400000;
      const d7 = now - 604800000;
      const d30 = now - 2592000000;

      const summarize = (cutoff: number) => {
        const filtered = traces.filter(t => t.createdAt && new Date(t.createdAt).getTime() > cutoff);
        return {
          calls: filtered.length,
          tokens: filtered.reduce((s, t) => s + (t.tokensUsed || 0), 0),
          costUsd: filtered.reduce((s, t) => s + parseFloat(t.costUsd || "0"), 0),
        };
      };

      res.json({
        last24h: summarize(h24),
        last7d: summarize(d7),
        last30d: summarize(d30),
        allTime: summarize(0),
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get cost summary", error: error.message });
    }
  });

  app.post("/api/leads/:leadId/grok-ask", async (req, res) => {
    try {
      const { runSupervisor } = await import("./intelligence/supervisor");
      const { prompt, sessionId } = req.body;
      const leadId = req.params.leadId;

      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ message: "prompt is required" });
      }

      const lead = await storage.getLeadById(leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      const leadContext = {
        address: lead.address,
        city: lead.city,
        county: lead.county,
        zipCode: lead.zipCode,
        ownerName: lead.ownerName,
        contactName: lead.contactName,
        phone: lead.phone,
        leadScore: lead.leadScore,
        totalValue: lead.totalValue,
        hailEvents: lead.hailEvents,
        lastHailDate: lead.lastHailDate,
        yearBuilt: lead.yearBuilt,
        buildingArea: lead.buildingArea,
        dataConfidence: lead.dataConfidence,
      };

      const sid = sessionId || `lead-${leadId}-${Date.now()}`;
      const result = await runSupervisor(prompt.trim(), {
        marketId: lead.marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da",
        sessionId: sid,
        leadId,
        sessionType: "lead_chat",
        leadContext,
      });
      res.json(result);
    } catch (error: any) {
      console.error("[Grok Core] Lead chat error:", error);
      res.status(500).json({ message: "Grok Core error", error: error.message });
    }
  });

  // Start storm monitor on boot
  startStormMonitor(10);
  startXweatherMonitor(2);

  return httpServer;
}
