import { eq, and, gte, lte, ilike, or, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { leads, hailEvents, type Lead, type InsertLead, type HailEvent, type InsertHailEvent, type LeadFilter } from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export interface IStorage {
  getLeads(filter?: LeadFilter): Promise<Lead[]>;
  getLeadById(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined>;
  getHailEvents(): Promise<HailEvent[]>;
  createHailEvent(event: InsertHailEvent): Promise<HailEvent>;
  getDashboardStats(): Promise<{
    totalLeads: number;
    hotLeads: number;
    avgScore: number;
    totalHailEvents: number;
    scoreDistribution: { range: string; count: number }[];
    countyDistribution: { county: string; count: number }[];
    recentLeads: Lead[];
  }>;
  getLeadCount(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getLeads(filter?: LeadFilter): Promise<Lead[]> {
    const conditions = [];

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

    if (conditions.length > 0) {
      return db.select().from(leads).where(and(...conditions)).orderBy(desc(leads.leadScore));
    }
    return db.select().from(leads).orderBy(desc(leads.leadScore));
  }

  async getLeadById(id: string): Promise<Lead | undefined> {
    const result = await db.select().from(leads).where(eq(leads.id, id));
    return result[0];
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const result = await db.insert(leads).values(lead).returning();
    return result[0];
  }

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined> {
    const { id: _id, createdAt: _ca, ...safeUpdates } = updates as any;
    const result = await db.update(leads).set(safeUpdates).where(eq(leads.id, id)).returning();
    return result[0];
  }

  async getHailEvents(): Promise<HailEvent[]> {
    return db.select().from(hailEvents).orderBy(desc(hailEvents.eventDate));
  }

  async createHailEvent(event: InsertHailEvent): Promise<HailEvent> {
    const result = await db.insert(hailEvents).values(event).returning();
    return result[0];
  }

  async getLeadCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(leads);
    return Number(result[0].count);
  }

  async getDashboardStats() {
    const allLeads = await db.select().from(leads).orderBy(desc(leads.leadScore));
    const allHailEvents = await db.select().from(hailEvents);

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

    return {
      totalLeads,
      hotLeads,
      avgScore,
      totalHailEvents: allHailEvents.length,
      scoreDistribution,
      countyDistribution,
      recentLeads: allLeads.slice(0, 8),
    };
  }
}

export const storage = new DatabaseStorage();
