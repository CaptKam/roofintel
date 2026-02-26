import { eq, and, gte, lte, ilike, or, desc, sql, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  leads, hailEvents, markets, dataSources, importRuns, jobs,
  stormAlertConfigs, stormRuns, alertHistory, responseQueue, intelligenceClaims,
  marketDataSources,
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

    let query = db
      .select()
      .from(leads)
      .where(whereClause)
      .orderBy(desc(leads.leadScore));

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
}

export const storage = new DatabaseStorage();
