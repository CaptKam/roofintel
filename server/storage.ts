import { eq, and, gte, lte, ilike, or, desc, sql, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  leads, hailEvents, markets, dataSources, importRuns, jobs,
  stormAlertConfigs, stormRuns, alertHistory, responseQueue, intelligenceClaims,
  marketDataSources,
  propertyRoof, propertyOwner, propertyRiskSignals, propertyContacts, propertyIntelligence,
  type Lead, type InsertLead, type HailEvent, type InsertHailEvent,
  type LeadFilter, type Market, type InsertMarket,
  type MarketDataSource, type InsertMarketDataSource,
  type DataSource, type InsertDataSource,
  type ImportRun, type InsertImportRun,
  type Job, type InsertJob,
  type StormAlertConfig, type InsertStormAlertConfig,
  type StormRun, type InsertStormRun,
  type AlertHistoryRecord, type InsertAlertHistory,
  type ResponseQueueItem, type InsertResponseQueue,
  type IntelligenceClaim, type InsertIntelligenceClaim,
  type PropertyRoof, type InsertPropertyRoof,
  type PropertyOwner, type InsertPropertyOwner,
  type PropertyRiskSignals, type InsertPropertyRiskSignals,
  type PropertyContacts, type InsertPropertyContacts,
  type PropertyIntelligence, type InsertPropertyIntelligence,
  agentSessions, agentTraces, sectors,
  type AgentSession, type InsertAgentSession,
  type AgentTrace, type InsertAgentTrace,
  type Sector, type InsertSector,
} from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export interface IStorage {
  getMarkets(): Promise<Market[]>;
  getMarketById(id: string): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;

  getLeads(filter?: LeadFilter): Promise<{ leads: Lead[]; total: number }>;
  getLeadById(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  createLeadsBatch(leadsData: InsertLead[]): Promise<number>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined>;
  getLeadCount(marketId?: string): Promise<number>;
  getLeadBySourceId(sourceType: string, sourceId: string): Promise<Lead | undefined>;

  getHailEvents(marketId?: string): Promise<HailEvent[]>;
  createHailEvent(event: InsertHailEvent): Promise<HailEvent>;
  createHailEventsBatch(events: InsertHailEvent[]): Promise<number>;
  getHailEventByNoaaId(noaaEventId: string): Promise<HailEvent | undefined>;

  getDataSources(): Promise<DataSource[]>;
  createDataSource(ds: InsertDataSource): Promise<DataSource>;
  updateDataSource(id: string, updates: Partial<DataSource>): Promise<DataSource | undefined>;

  getImportRuns(limit?: number): Promise<ImportRun[]>;
  createImportRun(run: InsertImportRun): Promise<ImportRun>;
  updateImportRun(id: string, updates: Partial<ImportRun>): Promise<ImportRun | undefined>;

  getJobs(): Promise<Job[]>;
  getJobByName(name: string): Promise<Job | undefined>;
  createJob(job: InsertJob): Promise<Job>;
  updateJob(id: string, updates: Partial<Job>): Promise<Job | undefined>;

  getDashboardStats(marketId?: string): Promise<{
    totalLeads: number;
    hotLeads: number;
    avgScore: number;
    totalHailEvents: number;
    scoreDistribution: { range: string; count: number }[];
    countyDistribution: { county: string; count: number }[];
    recentLeads: Lead[];
  }>;

  updateLeadHailData(leadId: string, hailCount: number, lastDate: string, lastSize: number): Promise<void>;
  updateLeadScore(leadId: string, score: number): Promise<void>;

  getStormAlertConfigs(marketId?: string): Promise<StormAlertConfig[]>;
  getStormAlertConfigById(id: string): Promise<StormAlertConfig | undefined>;
  createStormAlertConfig(config: InsertStormAlertConfig): Promise<StormAlertConfig>;
  updateStormAlertConfig(id: string, updates: Partial<StormAlertConfig>): Promise<StormAlertConfig | undefined>;
  deleteStormAlertConfig(id: string): Promise<void>;

  getStormRuns(limit?: number): Promise<StormRun[]>;
  getStormRunById(id: string): Promise<StormRun | undefined>;
  createStormRun(run: InsertStormRun): Promise<StormRun>;
  updateStormRun(id: string, updates: Partial<StormRun>): Promise<StormRun | undefined>;
  getActiveStormRuns(): Promise<StormRun[]>;

  getAlertHistory(stormRunId?: string, limit?: number): Promise<AlertHistoryRecord[]>;
  createAlertHistory(alert: InsertAlertHistory): Promise<AlertHistoryRecord>;

  getResponseQueue(stormRunId: string): Promise<ResponseQueueItem[]>;
  getActiveResponseQueue(): Promise<(ResponseQueueItem & { lead?: Lead; stormRun?: StormRun })[]>;
  createResponseQueueItems(items: InsertResponseQueue[]): Promise<number>;
  updateResponseQueueItem(id: string, updates: Partial<ResponseQueueItem>): Promise<ResponseQueueItem | undefined>;

  getLeadsInBounds(west: number, south: number, east: number, north: number, marketId?: string): Promise<Lead[]>;

  createIntelligenceClaims(claims: InsertIntelligenceClaim[]): Promise<number>;
  getClaimsForLead(leadId: string): Promise<IntelligenceClaim[]>;
  deleteClaimsForLead(leadId: string): Promise<void>;

  getMarketDataSources(marketId?: string): Promise<MarketDataSource[]>;
  getMarketDataSourceById(id: string): Promise<MarketDataSource | undefined>;
  createMarketDataSource(ds: InsertMarketDataSource): Promise<MarketDataSource>;
  updateMarketDataSource(id: string, updates: Partial<MarketDataSource>): Promise<MarketDataSource | undefined>;

  getPropertyRoof(propertyId: string): Promise<PropertyRoof | undefined>;
  upsertPropertyRoof(data: InsertPropertyRoof): Promise<PropertyRoof>;
  getPropertyOwner(propertyId: string): Promise<PropertyOwner | undefined>;
  upsertPropertyOwner(data: InsertPropertyOwner): Promise<PropertyOwner>;
  getPropertyRiskSignals(propertyId: string): Promise<PropertyRiskSignals | undefined>;
  upsertPropertyRiskSignals(data: InsertPropertyRiskSignals): Promise<PropertyRiskSignals>;
  getPropertyContacts(propertyId: string): Promise<PropertyContacts | undefined>;
  upsertPropertyContacts(data: InsertPropertyContacts): Promise<PropertyContacts>;
  getPropertyIntelligence(propertyId: string): Promise<PropertyIntelligence | undefined>;
  upsertPropertyIntelligence(data: InsertPropertyIntelligence): Promise<PropertyIntelligence>;

  createAgentSession(session: InsertAgentSession): Promise<AgentSession>;
  getAgentSession(sessionId: string): Promise<AgentSession | undefined>;
  updateAgentSession(sessionId: string, updates: Partial<AgentSession>): Promise<AgentSession | undefined>;
  listAgentSessions(limit?: number): Promise<AgentSession[]>;
  createAgentTrace(trace: InsertAgentTrace): Promise<AgentTrace>;
  listAgentTraces(sessionId?: string, limit?: number): Promise<AgentTrace[]>;

  getSectors(marketId?: string): Promise<Sector[]>;
  getSectorById(id: string): Promise<Sector | undefined>;
  createSector(sector: InsertSector): Promise<Sector>;
  updateSector(id: string, updates: Partial<Sector>): Promise<Sector | undefined>;
  deleteSector(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getMarkets(): Promise<Market[]> {
    return db.select().from(markets).orderBy(markets.name);
  }

  async getMarketById(id: string): Promise<Market | undefined> {
    const result = await db.select().from(markets).where(eq(markets.id, id));
    return result[0];
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    const result = await db.insert(markets).values(market).returning();
    return result[0];
  }

  async getLeads(filter?: LeadFilter): Promise<{ leads: Lead[]; total: number }> {
    const conditions = [];

    if (filter?.marketId && filter.marketId !== "all") {
      conditions.push(eq(leads.marketId, filter.marketId));
    }
    if (filter?.county && filter.county !== "all") {
      conditions.push(eq(leads.county, filter.county));
    }
    if (filter?.minScore) {
      conditions.push(gte(leads.leadScore, filter.minScore));
    }
    if (filter?.maxScore) {
      conditions.push(lte(leads.leadScore, filter.maxScore));
    }
    if (filter?.minSqft) {
      conditions.push(gte(leads.sqft, filter.minSqft));
    }
    if (filter?.zoning && filter.zoning !== "all") {
      conditions.push(eq(leads.zoning, filter.zoning));
    }
    if (filter?.ownerType && filter.ownerType !== "all") {
      conditions.push(eq(leads.ownerType, filter.ownerType));
    }
    if (filter?.status && filter.status !== "all") {
      conditions.push(eq(leads.status, filter.status));
    }
    if (filter?.hasPhone) {
      conditions.push(
        or(
          isNotNull(leads.ownerPhone),
          isNotNull(leads.contactPhone),
        )!
      );
    }
    if (filter?.hasEmail) {
      conditions.push(
        or(
          isNotNull(leads.ownerEmail),
          isNotNull(leads.contactEmail),
        )!
      );
    }
    if (filter?.hasDecisionMaker) {
      conditions.push(isNotNull(leads.contactName));
    }
    if (filter?.minRoofAge) {
      const cutoffYear = new Date().getFullYear() - filter.minRoofAge;
      conditions.push(
        or(
          lte(leads.roofLastReplaced, cutoffYear),
          and(sql`${leads.roofLastReplaced} IS NULL`, lte(leads.yearBuilt, cutoffYear))
        )!
      );
    }
    if (filter?.maxRoofAge) {
      const cutoffYear = new Date().getFullYear() - filter.maxRoofAge;
      conditions.push(
        or(
          gte(leads.roofLastReplaced, cutoffYear),
          and(sql`${leads.roofLastReplaced} IS NULL`, gte(leads.yearBuilt, cutoffYear))
        )!
      );
    }
    if (filter?.minRoofArea) {
      conditions.push(gte(leads.estimatedRoofArea, filter.minRoofArea));
    }
    if (filter?.maxRoofArea) {
      conditions.push(lte(leads.estimatedRoofArea, filter.maxRoofArea));
    }
    if (filter?.minHailEvents) {
      conditions.push(gte(leads.hailEvents, filter.minHailEvents));
    }
    if (filter?.lastHailWithin) {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - filter.lastHailWithin);
      conditions.push(gte(leads.lastHailDate, cutoffDate.toISOString().split("T")[0]));
    }
    if (filter?.minHailSize) {
      conditions.push(gte(leads.lastHailSize, filter.minHailSize));
    }
    if (filter?.claimWindowOpen) {
      conditions.push(eq(leads.claimWindowOpen, true));
    }
    if (filter?.minPropertyValue) {
      conditions.push(gte(leads.totalValue, filter.minPropertyValue));
    }
    if (filter?.maxPropertyValue) {
      conditions.push(lte(leads.totalValue, filter.maxPropertyValue));
    }
    if (filter?.ownershipStructure && filter.ownershipStructure !== "all") {
      conditions.push(eq(leads.ownershipStructure, filter.ownershipStructure));
    }
    if (filter?.roofType && filter.roofType !== "all") {
      conditions.push(eq(leads.roofType, filter.roofType));
    }
    if (filter?.enrichmentStatus && filter.enrichmentStatus !== "all") {
      if (filter.enrichmentStatus === "complete") {
        conditions.push(isNotNull(leads.lastEnrichedAt));
      } else if (filter.enrichmentStatus === "none") {
        conditions.push(sql`${leads.lastEnrichedAt} IS NULL`);
      }
    }
    if (filter?.riskTier && filter.riskTier !== "all") {
      if (filter.riskTier === "critical") {
        conditions.push(gte(leads.roofRiskIndex, 81));
      } else if (filter.riskTier === "high") {
        conditions.push(and(gte(leads.roofRiskIndex, 61), lte(leads.roofRiskIndex, 80))!);
      } else if (filter.riskTier === "moderate") {
        conditions.push(and(gte(leads.roofRiskIndex, 31), lte(leads.roofRiskIndex, 60))!);
      } else if (filter.riskTier === "low") {
        conditions.push(lte(leads.roofRiskIndex, 30));
      }
    }
    if (filter?.search) {
      const term = `%${filter.search}%`;
      conditions.push(
        or(
          ilike(leads.address, term),
          ilike(leads.city, term),
          ilike(leads.ownerName, term),
          ilike(leads.county, term),
        )!
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    const orderColumn = filter?.sortBy === "roofRiskIndex" ? leads.roofRiskIndex : leads.leadScore;
    let query = db
      .select()
      .from(leads)
      .where(whereClause)
      .orderBy(filter?.sortBy === "roofRiskIndex" ? sql`${leads.roofRiskIndex} DESC NULLS LAST` : desc(orderColumn));

    if (filter?.limit) {
      query = query.limit(filter.limit) as typeof query;
    }
    if (filter?.offset) {
      query = query.offset(filter.offset) as typeof query;
    }

    const result = await query;
    return { leads: result, total };
  }

  async getLeadById(id: string): Promise<Lead | undefined> {
    const result = await db.select().from(leads).where(eq(leads.id, id));
    return result[0];
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const result = await db.insert(leads).values(lead).returning();
    return result[0];
  }

  async createLeadsBatch(leadsData: InsertLead[]): Promise<number> {
    if (leadsData.length === 0) return 0;
    const batchSize = 100;
    let total = 0;
    for (let i = 0; i < leadsData.length; i += batchSize) {
      const batch = leadsData.slice(i, i + batchSize);
      await db.insert(leads).values(batch);
      total += batch.length;
    }
    return total;
  }

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(leads).set(safeUpdates).where(eq(leads.id, id)).returning();
    return result[0];
  }

  async getLeadCount(marketId?: string): Promise<number> {
    if (marketId) {
      const result = await db.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.marketId, marketId));
      return Number(result[0].count);
    }
    const result = await db.select({ count: sql<number>`count(*)` }).from(leads);
    return Number(result[0].count);
  }

  async getLeadBySourceId(sourceType: string, sourceId: string): Promise<Lead | undefined> {
    const result = await db.select().from(leads)
      .where(and(eq(leads.sourceType, sourceType), eq(leads.sourceId, sourceId)));
    return result[0];
  }

  async getHailEvents(marketId?: string): Promise<HailEvent[]> {
    if (marketId && marketId !== "all") {
      return db.select().from(hailEvents).where(eq(hailEvents.marketId, marketId)).orderBy(desc(hailEvents.eventDate));
    }
    return db.select().from(hailEvents).orderBy(desc(hailEvents.eventDate));
  }

  async createHailEvent(event: InsertHailEvent): Promise<HailEvent> {
    const result = await db.insert(hailEvents).values(event).returning();
    return result[0];
  }

  async createHailEventsBatch(events: InsertHailEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const batchSize = 100;
    let total = 0;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await db.insert(hailEvents).values(batch);
      total += batch.length;
    }
    return total;
  }

  async getHailEventByNoaaId(noaaEventId: string): Promise<HailEvent | undefined> {
    const result = await db.select().from(hailEvents).where(eq(hailEvents.noaaEventId, noaaEventId));
    return result[0];
  }

  async getDataSources(): Promise<DataSource[]> {
    return db.select().from(dataSources).orderBy(dataSources.name);
  }

  async createDataSource(ds: InsertDataSource): Promise<DataSource> {
    const result = await db.insert(dataSources).values(ds).returning();
    return result[0];
  }

  async updateDataSource(id: string, updates: Partial<DataSource>): Promise<DataSource | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(dataSources).set(safeUpdates).where(eq(dataSources.id, id)).returning();
    return result[0];
  }

  async getImportRuns(limit = 50): Promise<ImportRun[]> {
    return db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(limit);
  }

  async createImportRun(run: InsertImportRun): Promise<ImportRun> {
    const result = await db.insert(importRuns).values(run).returning();
    return result[0];
  }

  async updateImportRun(id: string, updates: Partial<ImportRun>): Promise<ImportRun | undefined> {
    const result = await db.update(importRuns).set(updates).where(eq(importRuns.id, id)).returning();
    return result[0];
  }

  async getJobs(): Promise<Job[]> {
    return db.select().from(jobs).orderBy(jobs.name);
  }

  async getJobByName(name: string): Promise<Job | undefined> {
    const result = await db.select().from(jobs).where(eq(jobs.name, name));
    return result[0];
  }

  async createJob(job: InsertJob): Promise<Job> {
    const result = await db.insert(jobs).values(job).returning();
    return result[0];
  }

  async updateJob(id: string, updates: Partial<Job>): Promise<Job | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(jobs).set(safeUpdates).where(eq(jobs.id, id)).returning();
    return result[0];
  }

  async updateLeadHailData(leadId: string, hailCount: number, lastDate: string, lastSize: number): Promise<void> {
    await db.update(leads).set({
      hailEvents: hailCount,
      lastHailDate: lastDate,
      lastHailSize: lastSize,
    }).where(eq(leads.id, leadId));
  }

  async updateLeadScore(leadId: string, score: number): Promise<void> {
    await db.update(leads).set({ leadScore: score }).where(eq(leads.id, leadId));
  }

  async getStormAlertConfigs(marketId?: string): Promise<StormAlertConfig[]> {
    if (marketId && marketId !== "all") {
      return db.select().from(stormAlertConfigs).where(eq(stormAlertConfigs.marketId, marketId));
    }
    return db.select().from(stormAlertConfigs);
  }

  async getStormAlertConfigById(id: string): Promise<StormAlertConfig | undefined> {
    const result = await db.select().from(stormAlertConfigs).where(eq(stormAlertConfigs.id, id));
    return result[0];
  }

  async createStormAlertConfig(config: InsertStormAlertConfig): Promise<StormAlertConfig> {
    const result = await db.insert(stormAlertConfigs).values(config).returning();
    return result[0];
  }

  async updateStormAlertConfig(id: string, updates: Partial<StormAlertConfig>): Promise<StormAlertConfig | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(stormAlertConfigs).set(safeUpdates).where(eq(stormAlertConfigs.id, id)).returning();
    return result[0];
  }

  async deleteStormAlertConfig(id: string): Promise<void> {
    await db.delete(stormAlertConfigs).where(eq(stormAlertConfigs.id, id));
  }

  async getStormRuns(limit = 50): Promise<StormRun[]> {
    return db.select().from(stormRuns).orderBy(desc(stormRuns.detectedAt)).limit(limit);
  }

  async getStormRunById(id: string): Promise<StormRun | undefined> {
    const result = await db.select().from(stormRuns).where(eq(stormRuns.id, id));
    return result[0];
  }

  async createStormRun(run: InsertStormRun): Promise<StormRun> {
    const result = await db.insert(stormRuns).values(run).returning();
    return result[0];
  }

  async updateStormRun(id: string, updates: Partial<StormRun>): Promise<StormRun | undefined> {
    const { id: _id, ...safeUpdates } = updates as any;
    const result = await db.update(stormRuns).set(safeUpdates).where(eq(stormRuns.id, id)).returning();
    return result[0];
  }

  async getActiveStormRuns(): Promise<StormRun[]> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return db.select().from(stormRuns)
      .where(gte(stormRuns.detectedAt, oneDayAgo))
      .orderBy(desc(stormRuns.detectedAt));
  }

  async getAlertHistory(stormRunId?: string, limit = 100): Promise<AlertHistoryRecord[]> {
    if (stormRunId) {
      return db.select().from(alertHistory)
        .where(eq(alertHistory.stormRunId, stormRunId))
        .orderBy(desc(alertHistory.sentAt)).limit(limit);
    }
    return db.select().from(alertHistory).orderBy(desc(alertHistory.sentAt)).limit(limit);
  }

  async createAlertHistory(alert: InsertAlertHistory): Promise<AlertHistoryRecord> {
    const result = await db.insert(alertHistory).values(alert).returning();
    return result[0];
  }

  async getResponseQueue(stormRunId: string): Promise<ResponseQueueItem[]> {
    return db.select().from(responseQueue)
      .where(eq(responseQueue.stormRunId, stormRunId))
      .orderBy(desc(responseQueue.priority));
  }

  async getActiveResponseQueue(): Promise<(ResponseQueueItem & { lead?: Lead; stormRun?: StormRun })[]> {
    const items = await db.select().from(responseQueue)
      .where(eq(responseQueue.status, "pending"))
      .orderBy(desc(responseQueue.priority))
      .limit(200);

    const enriched = await Promise.all(items.map(async (item) => {
      const lead = await this.getLeadById(item.leadId);
      const run = await this.getStormRunById(item.stormRunId);
      return { ...item, lead: lead || undefined, stormRun: run || undefined };
    }));
    return enriched;
  }

  async createResponseQueueItems(items: InsertResponseQueue[]): Promise<number> {
    if (items.length === 0) return 0;
    const batchSize = 100;
    let total = 0;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await db.insert(responseQueue).values(batch);
      total += batch.length;
    }
    return total;
  }

  async updateResponseQueueItem(id: string, updates: Partial<ResponseQueueItem>): Promise<ResponseQueueItem | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(responseQueue).set(safeUpdates).where(eq(responseQueue.id, id)).returning();
    return result[0];
  }

  async getLeadsInBounds(west: number, south: number, east: number, north: number, marketId?: string): Promise<Lead[]> {
    const conditions = [
      gte(leads.latitude, south),
      lte(leads.latitude, north),
      gte(leads.longitude, west),
      lte(leads.longitude, east),
    ];
    if (marketId && marketId !== "all") {
      conditions.push(eq(leads.marketId, marketId));
    }
    return db.select().from(leads).where(and(...conditions)).orderBy(desc(leads.leadScore)).limit(5000);
  }

  async getDashboardStats(marketId?: string) {
    let allLeads: Lead[];
    let allHailEvts: HailEvent[];

    if (marketId && marketId !== "all") {
      allLeads = await db.select().from(leads).where(eq(leads.marketId, marketId)).orderBy(desc(leads.leadScore));
      allHailEvts = await db.select().from(hailEvents).where(eq(hailEvents.marketId, marketId));
    } else {
      allLeads = await db.select().from(leads).orderBy(desc(leads.leadScore));
      allHailEvts = await db.select().from(hailEvents);
    }

    const totalLeads = allLeads.length;
    const hotLeads = allLeads.filter((l) => l.leadScore >= 80).length;
    const avgScore = totalLeads > 0 ? allLeads.reduce((sum, l) => sum + l.leadScore, 0) / totalLeads : 0;

    const scoreBuckets = [
      { range: "0-20", min: 0, max: 20 },
      { range: "21-40", min: 21, max: 40 },
      { range: "41-60", min: 41, max: 60 },
      { range: "61-80", min: 61, max: 80 },
      { range: "81-100", min: 81, max: 100 },
    ];

    const scoreDistribution = scoreBuckets.map((b) => ({
      range: b.range,
      count: allLeads.filter((l) => l.leadScore >= b.min && l.leadScore <= b.max).length,
    }));

    const countyMap = new Map<string, number>();
    allLeads.forEach((l) => {
      countyMap.set(l.county, (countyMap.get(l.county) || 0) + 1);
    });
    const countyDistribution = Array.from(countyMap.entries())
      .map(([county, count]) => ({ county, count }))
      .sort((a, b) => b.count - a.count);

    const ownersUnmasked = allLeads.filter((l) => l.intelligenceScore >= 70).length;

    return {
      totalLeads,
      hotLeads,
      avgScore,
      totalHailEvents: allHailEvts.length,
      ownersUnmasked,
      scoreDistribution,
      countyDistribution,
      recentLeads: allLeads.slice(0, 8),
    };
  }

  async createIntelligenceClaims(claims: InsertIntelligenceClaim[]): Promise<number> {
    if (claims.length === 0) return 0;
    const batchSize = 50;
    let total = 0;
    for (let i = 0; i < claims.length; i += batchSize) {
      const batch = claims.slice(i, i + batchSize);
      await db.insert(intelligenceClaims).values(batch);
      total += batch.length;
    }
    return total;
  }

  async getClaimsForLead(leadId: string): Promise<IntelligenceClaim[]> {
    return db.select().from(intelligenceClaims)
      .where(eq(intelligenceClaims.leadId, leadId))
      .orderBy(desc(intelligenceClaims.confidence));
  }

  async deleteClaimsForLead(leadId: string): Promise<void> {
    await db.delete(intelligenceClaims).where(eq(intelligenceClaims.leadId, leadId));
  }

  async getMarketDataSources(marketId?: string): Promise<MarketDataSource[]> {
    if (marketId) {
      return db.select().from(marketDataSources).where(eq(marketDataSources.marketId, marketId)).orderBy(marketDataSources.sourceName);
    }
    return db.select().from(marketDataSources).orderBy(marketDataSources.sourceName);
  }

  async getMarketDataSourceById(id: string): Promise<MarketDataSource | undefined> {
    const result = await db.select().from(marketDataSources).where(eq(marketDataSources.id, id));
    return result[0];
  }

  async createMarketDataSource(ds: InsertMarketDataSource): Promise<MarketDataSource> {
    const result = await db.insert(marketDataSources).values(ds).returning();
    return result[0];
  }

  async updateMarketDataSource(id: string, updates: Partial<MarketDataSource>): Promise<MarketDataSource | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(marketDataSources).set(safeUpdates).where(eq(marketDataSources.id, id)).returning();
    return result[0];
  }

  async getPropertyRoof(propertyId: string): Promise<PropertyRoof | undefined> {
    const result = await db.select().from(propertyRoof).where(eq(propertyRoof.propertyId, propertyId));
    return result[0];
  }

  async upsertPropertyRoof(data: InsertPropertyRoof): Promise<PropertyRoof> {
    const result = await db.execute(sql`
      INSERT INTO property_roof (property_id, market_id, roof_type, roof_material, roof_last_replaced,
        estimated_roof_area, last_roofing_permit_date, last_roofing_contractor, last_roofing_permit_type,
        claim_window_open, roof_risk_index, roof_risk_breakdown, source, updated_at)
      VALUES (${data.propertyId}, ${data.marketId ?? null}, ${data.roofType ?? null}, ${data.roofMaterial ?? null},
        ${data.roofLastReplaced ?? null}, ${data.estimatedRoofArea ?? null}, ${data.lastRoofingPermitDate ?? null},
        ${data.lastRoofingContractor ?? null}, ${data.lastRoofingPermitType ?? null}, ${data.claimWindowOpen ?? null},
        ${data.roofRiskIndex ?? null}, ${data.roofRiskBreakdown ? JSON.stringify(data.roofRiskBreakdown) : null}::jsonb,
        ${data.source ?? null}, NOW())
      ON CONFLICT (property_id) DO UPDATE SET
        market_id = COALESCE(EXCLUDED.market_id, property_roof.market_id),
        roof_type = COALESCE(EXCLUDED.roof_type, property_roof.roof_type),
        roof_material = COALESCE(EXCLUDED.roof_material, property_roof.roof_material),
        roof_last_replaced = COALESCE(EXCLUDED.roof_last_replaced, property_roof.roof_last_replaced),
        estimated_roof_area = COALESCE(EXCLUDED.estimated_roof_area, property_roof.estimated_roof_area),
        last_roofing_permit_date = COALESCE(EXCLUDED.last_roofing_permit_date, property_roof.last_roofing_permit_date),
        last_roofing_contractor = COALESCE(EXCLUDED.last_roofing_contractor, property_roof.last_roofing_contractor),
        last_roofing_permit_type = COALESCE(EXCLUDED.last_roofing_permit_type, property_roof.last_roofing_permit_type),
        claim_window_open = COALESCE(EXCLUDED.claim_window_open, property_roof.claim_window_open),
        roof_risk_index = COALESCE(EXCLUDED.roof_risk_index, property_roof.roof_risk_index),
        roof_risk_breakdown = COALESCE(EXCLUDED.roof_risk_breakdown, property_roof.roof_risk_breakdown),
        source = COALESCE(EXCLUDED.source, property_roof.source),
        updated_at = NOW()
      RETURNING *
    `) as any;
    return result.rows[0];
  }

  async getPropertyOwner(propertyId: string): Promise<PropertyOwner | undefined> {
    const result = await db.select().from(propertyOwner).where(eq(propertyOwner.propertyId, propertyId));
    return result[0];
  }

  async upsertPropertyOwner(data: InsertPropertyOwner): Promise<PropertyOwner> {
    const result = await db.execute(sql`
      INSERT INTO property_owner (property_id, market_id, owner_name, owner_type, owner_address,
        owner_phone, owner_email, phone_source, phone_enriched_at, llc_name, registered_agent,
        officer_name, officer_title, sos_file_number, taxpayer_id, managing_member, managing_member_title,
        managing_member_phone, managing_member_email, llc_chain, ownership_flag, ownership_structure,
        ownership_signals, normalized_owner_id, source, updated_at)
      VALUES (${data.propertyId}, ${data.marketId ?? null}, ${data.ownerName}, ${data.ownerType},
        ${data.ownerAddress ?? null}, ${data.ownerPhone ?? null}, ${data.ownerEmail ?? null},
        ${data.phoneSource ?? null}, ${data.phoneEnrichedAt ?? null}, ${data.llcName ?? null},
        ${data.registeredAgent ?? null}, ${data.officerName ?? null}, ${data.officerTitle ?? null},
        ${data.sosFileNumber ?? null}, ${data.taxpayerId ?? null}, ${data.managingMember ?? null},
        ${data.managingMemberTitle ?? null}, ${data.managingMemberPhone ?? null}, ${data.managingMemberEmail ?? null},
        ${data.llcChain ? JSON.stringify(data.llcChain) : null}::jsonb, ${data.ownershipFlag ?? null},
        ${data.ownershipStructure ?? null}, ${data.ownershipSignals ? JSON.stringify(data.ownershipSignals) : null}::jsonb,
        ${data.normalizedOwnerId ?? null}, ${data.source ?? null}, NOW())
      ON CONFLICT (property_id) DO UPDATE SET
        market_id = COALESCE(EXCLUDED.market_id, property_owner.market_id),
        owner_name = COALESCE(EXCLUDED.owner_name, property_owner.owner_name),
        owner_type = COALESCE(EXCLUDED.owner_type, property_owner.owner_type),
        owner_address = COALESCE(EXCLUDED.owner_address, property_owner.owner_address),
        owner_phone = COALESCE(EXCLUDED.owner_phone, property_owner.owner_phone),
        owner_email = COALESCE(EXCLUDED.owner_email, property_owner.owner_email),
        phone_source = COALESCE(EXCLUDED.phone_source, property_owner.phone_source),
        phone_enriched_at = COALESCE(EXCLUDED.phone_enriched_at, property_owner.phone_enriched_at),
        llc_name = COALESCE(EXCLUDED.llc_name, property_owner.llc_name),
        registered_agent = COALESCE(EXCLUDED.registered_agent, property_owner.registered_agent),
        officer_name = COALESCE(EXCLUDED.officer_name, property_owner.officer_name),
        officer_title = COALESCE(EXCLUDED.officer_title, property_owner.officer_title),
        sos_file_number = COALESCE(EXCLUDED.sos_file_number, property_owner.sos_file_number),
        taxpayer_id = COALESCE(EXCLUDED.taxpayer_id, property_owner.taxpayer_id),
        managing_member = COALESCE(EXCLUDED.managing_member, property_owner.managing_member),
        managing_member_title = COALESCE(EXCLUDED.managing_member_title, property_owner.managing_member_title),
        managing_member_phone = COALESCE(EXCLUDED.managing_member_phone, property_owner.managing_member_phone),
        managing_member_email = COALESCE(EXCLUDED.managing_member_email, property_owner.managing_member_email),
        llc_chain = COALESCE(EXCLUDED.llc_chain, property_owner.llc_chain),
        ownership_flag = COALESCE(EXCLUDED.ownership_flag, property_owner.ownership_flag),
        ownership_structure = COALESCE(EXCLUDED.ownership_structure, property_owner.ownership_structure),
        ownership_signals = COALESCE(EXCLUDED.ownership_signals, property_owner.ownership_signals),
        normalized_owner_id = COALESCE(EXCLUDED.normalized_owner_id, property_owner.normalized_owner_id),
        source = COALESCE(EXCLUDED.source, property_owner.source),
        updated_at = NOW()
      RETURNING *
    `) as any;
    return result.rows[0];
  }

  async getPropertyRiskSignals(propertyId: string): Promise<PropertyRiskSignals | undefined> {
    const result = await db.select().from(propertyRiskSignals).where(eq(propertyRiskSignals.propertyId, propertyId));
    return result[0];
  }

  async upsertPropertyRiskSignals(data: InsertPropertyRiskSignals): Promise<PropertyRiskSignals> {
    const result = await db.execute(sql`
      INSERT INTO property_risk_signals (property_id, market_id, hail_events, last_hail_date, last_hail_size,
        flood_zone, flood_zone_subtype, is_flood_high_risk, lien_count, foreclosure_flag, tax_delinquent,
        violation_count, open_violations, last_violation_date, permit_count, last_permit_date,
        permit_contractors, distress_score, last_deed_date, source, updated_at)
      VALUES (${data.propertyId}, ${data.marketId ?? null}, ${data.hailEvents ?? 0}, ${data.lastHailDate ?? null},
        ${data.lastHailSize ?? null}, ${data.floodZone ?? null}, ${data.floodZoneSubtype ?? null},
        ${data.isFloodHighRisk ?? false}, ${data.lienCount ?? 0}, ${data.foreclosureFlag ?? false},
        ${data.taxDelinquent ?? false}, ${data.violationCount ?? 0}, ${data.openViolations ?? 0},
        ${data.lastViolationDate ?? null}, ${data.permitCount ?? 0}, ${data.lastPermitDate ?? null},
        ${data.permitContractors ? JSON.stringify(data.permitContractors) : null}::jsonb,
        ${data.distressScore ?? 0}, ${data.lastDeedDate ?? null}, ${data.source ?? null}, NOW())
      ON CONFLICT (property_id) DO UPDATE SET
        market_id = COALESCE(EXCLUDED.market_id, property_risk_signals.market_id),
        hail_events = COALESCE(EXCLUDED.hail_events, property_risk_signals.hail_events),
        last_hail_date = COALESCE(EXCLUDED.last_hail_date, property_risk_signals.last_hail_date),
        last_hail_size = COALESCE(EXCLUDED.last_hail_size, property_risk_signals.last_hail_size),
        flood_zone = COALESCE(EXCLUDED.flood_zone, property_risk_signals.flood_zone),
        flood_zone_subtype = COALESCE(EXCLUDED.flood_zone_subtype, property_risk_signals.flood_zone_subtype),
        is_flood_high_risk = COALESCE(EXCLUDED.is_flood_high_risk, property_risk_signals.is_flood_high_risk),
        lien_count = COALESCE(EXCLUDED.lien_count, property_risk_signals.lien_count),
        foreclosure_flag = COALESCE(EXCLUDED.foreclosure_flag, property_risk_signals.foreclosure_flag),
        tax_delinquent = COALESCE(EXCLUDED.tax_delinquent, property_risk_signals.tax_delinquent),
        violation_count = COALESCE(EXCLUDED.violation_count, property_risk_signals.violation_count),
        open_violations = COALESCE(EXCLUDED.open_violations, property_risk_signals.open_violations),
        last_violation_date = COALESCE(EXCLUDED.last_violation_date, property_risk_signals.last_violation_date),
        permit_count = COALESCE(EXCLUDED.permit_count, property_risk_signals.permit_count),
        last_permit_date = COALESCE(EXCLUDED.last_permit_date, property_risk_signals.last_permit_date),
        permit_contractors = COALESCE(EXCLUDED.permit_contractors, property_risk_signals.permit_contractors),
        distress_score = COALESCE(EXCLUDED.distress_score, property_risk_signals.distress_score),
        last_deed_date = COALESCE(EXCLUDED.last_deed_date, property_risk_signals.last_deed_date),
        source = COALESCE(EXCLUDED.source, property_risk_signals.source),
        updated_at = NOW()
      RETURNING *
    `) as any;
    return result.rows[0];
  }

  async getPropertyContacts(propertyId: string): Promise<PropertyContacts | undefined> {
    const result = await db.select().from(propertyContacts).where(eq(propertyContacts.propertyId, propertyId));
    return result[0];
  }

  async upsertPropertyContacts(data: InsertPropertyContacts): Promise<PropertyContacts> {
    const result = await db.execute(sql`
      INSERT INTO property_contacts (property_id, market_id, contact_name, contact_title, contact_phone,
        contact_email, contact_source, contact_role, role_confidence, decision_maker_rank, role_evidence,
        dm_confidence_score, dm_confidence_components, dm_review_status, decision_makers,
        management_company, management_contact, management_phone, management_email,
        management_evidence, management_attributed_at, reverse_address_type, reverse_address_businesses,
        reverse_address_enriched_at, source, updated_at)
      VALUES (${data.propertyId}, ${data.marketId ?? null}, ${data.contactName ?? null}, ${data.contactTitle ?? null},
        ${data.contactPhone ?? null}, ${data.contactEmail ?? null}, ${data.contactSource ?? null},
        ${data.contactRole ?? null}, ${data.roleConfidence ?? null}, ${data.decisionMakerRank ?? null},
        ${data.roleEvidence ? JSON.stringify(data.roleEvidence) : null}::jsonb,
        ${data.dmConfidenceScore ?? null}, ${data.dmConfidenceComponents ? JSON.stringify(data.dmConfidenceComponents) : null}::jsonb,
        ${data.dmReviewStatus ?? 'unreviewed'}, ${data.decisionMakers ? JSON.stringify(data.decisionMakers) : null}::jsonb,
        ${data.managementCompany ?? null}, ${data.managementContact ?? null}, ${data.managementPhone ?? null},
        ${data.managementEmail ?? null}, ${data.managementEvidence ? JSON.stringify(data.managementEvidence) : null}::jsonb,
        ${data.managementAttributedAt ?? null}, ${data.reverseAddressType ?? null},
        ${data.reverseAddressBusinesses ? JSON.stringify(data.reverseAddressBusinesses) : null}::jsonb,
        ${data.reverseAddressEnrichedAt ?? null}, ${data.source ?? null}, NOW())
      ON CONFLICT (property_id) DO UPDATE SET
        market_id = COALESCE(EXCLUDED.market_id, property_contacts.market_id),
        contact_name = COALESCE(EXCLUDED.contact_name, property_contacts.contact_name),
        contact_title = COALESCE(EXCLUDED.contact_title, property_contacts.contact_title),
        contact_phone = COALESCE(EXCLUDED.contact_phone, property_contacts.contact_phone),
        contact_email = COALESCE(EXCLUDED.contact_email, property_contacts.contact_email),
        contact_source = COALESCE(EXCLUDED.contact_source, property_contacts.contact_source),
        contact_role = COALESCE(EXCLUDED.contact_role, property_contacts.contact_role),
        role_confidence = COALESCE(EXCLUDED.role_confidence, property_contacts.role_confidence),
        decision_maker_rank = COALESCE(EXCLUDED.decision_maker_rank, property_contacts.decision_maker_rank),
        role_evidence = COALESCE(EXCLUDED.role_evidence, property_contacts.role_evidence),
        dm_confidence_score = COALESCE(EXCLUDED.dm_confidence_score, property_contacts.dm_confidence_score),
        dm_confidence_components = COALESCE(EXCLUDED.dm_confidence_components, property_contacts.dm_confidence_components),
        dm_review_status = COALESCE(EXCLUDED.dm_review_status, property_contacts.dm_review_status),
        decision_makers = COALESCE(EXCLUDED.decision_makers, property_contacts.decision_makers),
        management_company = COALESCE(EXCLUDED.management_company, property_contacts.management_company),
        management_contact = COALESCE(EXCLUDED.management_contact, property_contacts.management_contact),
        management_phone = COALESCE(EXCLUDED.management_phone, property_contacts.management_phone),
        management_email = COALESCE(EXCLUDED.management_email, property_contacts.management_email),
        management_evidence = COALESCE(EXCLUDED.management_evidence, property_contacts.management_evidence),
        management_attributed_at = COALESCE(EXCLUDED.management_attributed_at, property_contacts.management_attributed_at),
        reverse_address_type = COALESCE(EXCLUDED.reverse_address_type, property_contacts.reverse_address_type),
        reverse_address_businesses = COALESCE(EXCLUDED.reverse_address_businesses, property_contacts.reverse_address_businesses),
        reverse_address_enriched_at = COALESCE(EXCLUDED.reverse_address_enriched_at, property_contacts.reverse_address_enriched_at),
        source = COALESCE(EXCLUDED.source, property_contacts.source),
        updated_at = NOW()
      RETURNING *
    `) as any;
    return result.rows[0];
  }

  async getPropertyIntelligence(propertyId: string): Promise<PropertyIntelligence | undefined> {
    const result = await db.select().from(propertyIntelligence).where(eq(propertyIntelligence.propertyId, propertyId));
    return result[0];
  }

  async upsertPropertyIntelligence(data: InsertPropertyIntelligence): Promise<PropertyIntelligence> {
    const result = await db.execute(sql`
      INSERT INTO property_intelligence (property_id, market_id, owner_intelligence, intelligence_score,
        intelligence_sources, building_contacts, intelligence_at, business_name, business_website,
        web_researched_at, source, updated_at)
      VALUES (${data.propertyId}, ${data.marketId ?? null},
        ${data.ownerIntelligence ? JSON.stringify(data.ownerIntelligence) : null}::jsonb,
        ${data.intelligenceScore ?? 0}, ${data.intelligenceSources ?? null},
        ${data.buildingContacts ? JSON.stringify(data.buildingContacts) : null}::jsonb,
        ${data.intelligenceAt ?? null}, ${data.businessName ?? null}, ${data.businessWebsite ?? null},
        ${data.webResearchedAt ?? null}, ${data.source ?? null}, NOW())
      ON CONFLICT (property_id) DO UPDATE SET
        market_id = COALESCE(EXCLUDED.market_id, property_intelligence.market_id),
        owner_intelligence = COALESCE(EXCLUDED.owner_intelligence, property_intelligence.owner_intelligence),
        intelligence_score = COALESCE(EXCLUDED.intelligence_score, property_intelligence.intelligence_score),
        intelligence_sources = COALESCE(EXCLUDED.intelligence_sources, property_intelligence.intelligence_sources),
        building_contacts = COALESCE(EXCLUDED.building_contacts, property_intelligence.building_contacts),
        intelligence_at = COALESCE(EXCLUDED.intelligence_at, property_intelligence.intelligence_at),
        business_name = COALESCE(EXCLUDED.business_name, property_intelligence.business_name),
        business_website = COALESCE(EXCLUDED.business_website, property_intelligence.business_website),
        web_researched_at = COALESCE(EXCLUDED.web_researched_at, property_intelligence.web_researched_at),
        source = COALESCE(EXCLUDED.source, property_intelligence.source),
        updated_at = NOW()
      RETURNING *
    `) as any;
    return result.rows[0];
  }

  async createAgentSession(session: InsertAgentSession): Promise<AgentSession> {
    const [created] = await db.insert(agentSessions).values(session).returning();
    return created;
  }

  async getAgentSession(sessionId: string): Promise<AgentSession | undefined> {
    const [found] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.sessionId, sessionId))
      .limit(1);
    return found;
  }

  async updateAgentSession(sessionId: string, updates: Partial<AgentSession>): Promise<AgentSession | undefined> {
    const [updated] = await db
      .update(agentSessions)
      .set({ ...updates, lastActiveAt: new Date() })
      .where(eq(agentSessions.sessionId, sessionId))
      .returning();
    return updated;
  }

  async listAgentSessions(limit = 50): Promise<AgentSession[]> {
    return db
      .select()
      .from(agentSessions)
      .orderBy(desc(agentSessions.lastActiveAt))
      .limit(limit);
  }

  async createAgentTrace(trace: InsertAgentTrace): Promise<AgentTrace> {
    const [created] = await db.insert(agentTraces).values(trace).returning();
    return created;
  }

  async listAgentTraces(sessionId?: string, limit = 100): Promise<AgentTrace[]> {
    if (sessionId) {
      return db
        .select()
        .from(agentTraces)
        .where(eq(agentTraces.sessionId, sessionId))
        .orderBy(desc(agentTraces.createdAt))
        .limit(limit);
    }
    return db
      .select()
      .from(agentTraces)
      .orderBy(desc(agentTraces.createdAt))
      .limit(limit);
  }

  async getSectors(marketId?: string): Promise<Sector[]> {
    if (marketId) {
      return db.select().from(sectors).where(eq(sectors.marketId, marketId)).orderBy(desc(sectors.sectorScore));
    }
    return db.select().from(sectors).orderBy(desc(sectors.sectorScore));
  }

  async getSectorById(id: string): Promise<Sector | undefined> {
    const result = await db.select().from(sectors).where(eq(sectors.id, id));
    return result[0];
  }

  async createSector(sector: InsertSector): Promise<Sector> {
    const [created] = await db.insert(sectors).values(sector).returning();
    return created;
  }

  async updateSector(id: string, updates: Partial<Sector>): Promise<Sector | undefined> {
    const [updated] = await db
      .update(sectors)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sectors.id, id))
      .returning();
    return updated;
  }

  async deleteSector(id: string): Promise<void> {
    await db.delete(sectors).where(eq(sectors.id, id));
  }
}

export const storage = new DatabaseStorage();
