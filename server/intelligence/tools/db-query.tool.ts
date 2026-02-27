import { db } from "../../storage";
import { leads } from "@shared/schema";
import { and, eq, gte, lte, ilike, sql, desc } from "drizzle-orm";

export const name = "query_leads";

export const schema = {
  type: "function" as const,
  function: {
    name: "query_leads",
    description: "Query the leads database to find commercial properties matching specific criteria. Returns up to 50 results with key fields. Use this to answer questions about properties, find leads by location, score, value, or hail exposure.",
    parameters: {
      type: "object",
      properties: {
        zipCode: { type: "string", description: "Filter by ZIP code (e.g., '75001')" },
        county: { type: "string", description: "Filter by county name (e.g., 'Dallas', 'Tarrant')" },
        city: { type: "string", description: "Filter by city name" },
        minScore: { type: "number", description: "Minimum lead score (0-100)" },
        maxScore: { type: "number", description: "Maximum lead score (0-100)" },
        minHailEvents: { type: "number", description: "Minimum number of hail events" },
        minValue: { type: "number", description: "Minimum total property value in USD" },
        ownerSearch: { type: "string", description: "Search owner name (partial match)" },
        hasPhone: { type: "boolean", description: "Only return leads with a phone number" },
        limit: { type: "number", description: "Max results to return (default 20, max 50)" },
      },
      required: [],
    },
  },
};

export async function execute(args: any): Promise<any> {
  const conditions: any[] = [];

  if (args.zipCode) conditions.push(eq(leads.zipCode, args.zipCode));
  if (args.county) conditions.push(ilike(leads.county, `%${args.county}%`));
  if (args.city) conditions.push(ilike(leads.city, `%${args.city}%`));
  if (args.minScore) conditions.push(gte(leads.leadScore, args.minScore));
  if (args.maxScore) conditions.push(lte(leads.leadScore, args.maxScore));
  if (args.minHailEvents) conditions.push(gte(leads.hailEvents, args.minHailEvents));
  if (args.minValue) conditions.push(gte(leads.totalValue, args.minValue));
  if (args.ownerSearch) conditions.push(ilike(leads.ownerName, `%${args.ownerSearch}%`));
  if (args.hasPhone) conditions.push(sql`${leads.phone} IS NOT NULL AND ${leads.phone} != ''`);

  const limit = Math.min(args.limit || 20, 50);

  const results = await db
    .select({
      id: leads.id,
      address: leads.address,
      city: leads.city,
      county: leads.county,
      zipCode: leads.zipCode,
      leadScore: leads.leadScore,
      totalValue: leads.totalValue,
      hailEvents: leads.hailEvents,
      lastHailDate: leads.lastHailDate,
      ownerName: leads.ownerName,
      phone: leads.phone,
      contactName: leads.contactName,
      yearBuilt: leads.yearBuilt,
      buildingArea: leads.buildingArea,
      dataConfidence: leads.dataConfidence,
    })
    .from(leads)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(leads.leadScore))
    .limit(limit);

  return {
    count: results.length,
    leads: results,
    query: args,
  };
}
