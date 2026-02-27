import { db } from "./storage";
import { leads } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq, sql, isNull, isNotNull } from "drizzle-orm";

interface BusinessResult {
  name: string;
  type: string;
  address: string;
  phone?: string;
  website?: string;
  rating?: number;
  classification: string;
}

interface ReverseAddressResult {
  addressType: string;
  businesses: BusinessResult[];
  ownerMailingAddress: string;
  propertyAddress: string;
}

const MANAGEMENT_KEYWORDS = [
  "property management", "management company", "realty", "real estate",
  "asset management", "property group", "properties", "commercial management",
  "residential management", "pm group", "apartment management",
  "facilities management", "building management", "leasing",
];

const LAW_FIRM_KEYWORDS = [
  "law", "attorney", "legal", "counsel", "advocates", "solicitor",
  "pllc", "law firm", "law office", "law group",
];

const TITLE_COMPANY_KEYWORDS = [
  "title", "escrow", "closing", "settlement", "abstract",
];

const ACCOUNTING_KEYWORDS = [
  "accounting", "accountant", "cpa", "tax", "financial services",
  "bookkeeping", "audit",
];

const CORPORATE_KEYWORDS = [
  "headquarters", "corporate office", "inc", "corporation", "llc",
  "holdings", "investments", "capital", "ventures", "equity",
  "partners", "fund", "trust",
];

function classifyBusiness(name: string, types: string[]): string {
  const lower = name.toLowerCase();
  const typeStr = types.join(" ").toLowerCase();

  if (MANAGEMENT_KEYWORDS.some(k => lower.includes(k))) return "management_company";
  if (LAW_FIRM_KEYWORDS.some(k => lower.includes(k)) || typeStr.includes("lawyer")) return "law_firm";
  if (TITLE_COMPANY_KEYWORDS.some(k => lower.includes(k))) return "title_company";
  if (ACCOUNTING_KEYWORDS.some(k => lower.includes(k)) || typeStr.includes("accounting")) return "accounting_firm";
  if (typeStr.includes("real_estate_agency")) return "management_company";
  if (typeStr.includes("insurance")) return "insurance_company";
  if (typeStr.includes("bank") || typeStr.includes("finance")) return "financial_institution";
  if (CORPORATE_KEYWORDS.some(k => lower.includes(k))) return "corporate_office";
  if (typeStr.includes("store") || typeStr.includes("restaurant") || typeStr.includes("food"))
    return "retail_commercial";

  return "other_business";
}

function classifyAddressType(businesses: BusinessResult[]): string {
  if (businesses.length === 0) return "residential_or_vacant";

  const classifications = businesses.map(b => b.classification);
  if (classifications.includes("management_company")) return "management_office";
  if (classifications.includes("law_firm")) return "law_firm_office";
  if (classifications.includes("title_company")) return "title_company_office";
  if (classifications.includes("accounting_firm")) return "accounting_office";
  if (classifications.includes("corporate_office")) return "corporate_hq";
  if (classifications.includes("financial_institution")) return "financial_office";
  if (classifications.every(c => c === "retail_commercial")) return "retail_location";

  return "mixed_commercial";
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase()
    .replace(/[,.\-#]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(suite|ste)\b/g, "ste")
    .trim();
}

function addressesDiffer(propertyAddr: string, ownerAddr: string): boolean {
  if (!propertyAddr || !ownerAddr) return false;
  const normProp = normalizeAddress(propertyAddr);
  const normOwner = normalizeAddress(ownerAddr);
  if (normProp === normOwner) return false;

  const propParts = normProp.split(/\s+/).slice(0, 3).join(" ");
  const ownerParts = normOwner.split(/\s+/).slice(0, 3).join(" ");
  if (propParts === ownerParts) return false;

  return true;
}

async function lookupAddress(address: string): Promise<BusinessResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const businesses: BusinessResult[] = [];

  try {
    const { trackedGooglePlacesFetch } = await import("./google-places-tracker");
    const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(address)}&key=${apiKey}`;
    const res = await trackedGooglePlacesFetch(textSearchUrl, "reverse-address");
    if (!res || !res.ok) return [];

    const data = await res.json();
    const results = (data.results || []).slice(0, 8);

    for (const place of results) {
      const name = place.name || "";
      const types = place.types || [];
      const classification = classifyBusiness(name, types);

      businesses.push({
        name,
        type: types[0] || "unknown",
        address: place.formatted_address || "",
        phone: undefined,
        website: undefined,
        rating: place.rating,
        classification,
      });
    }

    if (businesses.length > 0 && businesses[0].classification !== "other_business") {
      const placeId = results[0]?.place_id;
      if (placeId) {
        try {
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${apiKey}`;
          const detailRes = await trackedGooglePlacesFetch(detailUrl, "reverse-address");
          if (detailRes && detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData.result) {
              businesses[0].phone = detailData.result.formatted_phone_number;
              businesses[0].website = detailData.result.website;
            }
          }
        } catch {}
      }
    }
  } catch (error: any) {
    console.error("[Reverse Address] Google Places error:", error.message);
  }

  return businesses;
}

export async function enrichLeadReverseAddress(lead: Lead): Promise<ReverseAddressResult | null> {
  if (!lead.ownerAddress || !lead.address) return null;
  if (!addressesDiffer(lead.address, lead.ownerAddress)) return null;

  const businesses = await lookupAddress(lead.ownerAddress);
  const addressType = classifyAddressType(businesses);

  return {
    addressType,
    businesses,
    ownerMailingAddress: lead.ownerAddress,
    propertyAddress: lead.address,
  };
}

export async function runReverseAddressEnrichment(marketId?: string, batchSize = 200, filterLeadIds?: string[]): Promise<{
  totalProcessed: number;
  enriched: number;
  skipped: number;
  byType: Record<string, number>;
}> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.log("[Reverse Address] No Google Places API key configured");
    return { totalProcessed: 0, enriched: 0, skipped: 0, byType: {} };
  }

  let eligibleLeads = await db.select().from(leads)
    .where(
      marketId
        ? sql`${leads.marketId} = ${marketId} AND ${leads.ownerAddress} IS NOT NULL AND ${leads.reverseAddressEnrichedAt} IS NULL`
        : sql`${leads.ownerAddress} IS NOT NULL AND ${leads.reverseAddressEnrichedAt} IS NULL`
    )
    .limit(batchSize);
  if (Array.isArray(filterLeadIds) && filterLeadIds.length > 0) {
    const idSet = new Set(filterLeadIds);
    eligibleLeads = eligibleLeads.filter(l => idSet.has(l.id));
  }

  console.log(`[Reverse Address] Found ${eligibleLeads.length} leads with owner addresses to enrich`);

  let enriched = 0;
  let skipped = 0;
  const byType: Record<string, number> = {};

  for (const lead of eligibleLeads) {
    if (!addressesDiffer(lead.address, lead.ownerAddress || "")) {
      await db.update(leads).set({
        reverseAddressType: "same_as_property",
        reverseAddressEnrichedAt: new Date(),
      } as any).where(eq(leads.id, lead.id));
      try {
        const { storage } = await import("./storage");
        await storage.upsertPropertyContacts({ propertyId: lead.id, marketId: lead.marketId, reverseAddressType: "same_as_property", reverseAddressEnrichedAt: new Date(), source: "reverse_address" });
      } catch {}
      skipped++;
      byType["same_as_property"] = (byType["same_as_property"] || 0) + 1;
      continue;
    }

    try {
      const result = await enrichLeadReverseAddress(lead);
      if (!result) {
        skipped++;
        continue;
      }

      const updates: any = {
        reverseAddressType: result.addressType,
        reverseAddressBusinesses: result.businesses,
        reverseAddressEnrichedAt: new Date(),
      };

      const mgmtBiz = result.businesses.find(b => b.classification === "management_company");
      if (mgmtBiz) {
        if (!lead.managementCompany) {
          updates.managementCompany = mgmtBiz.name;
        }
        if (mgmtBiz.phone && !lead.managementPhone) {
          updates.managementPhone = mgmtBiz.phone;
        }

        const existingEvidence = Array.isArray(lead.managementEvidence) ? (lead.managementEvidence as any[]) : [];
        const alreadyHasReverseEvidence = existingEvidence.some((e: any) => e.source === "reverse_address");
        if (!alreadyHasReverseEvidence) {
          existingEvidence.push({
            source: "reverse_address",
            field: "management_company_at_mailing_address",
            value: mgmtBiz.name,
            recency: new Date().toISOString(),
            confidence: 80,
          });
          updates.managementEvidence = existingEvidence;
        }
      }

      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
      try {
        const { storage } = await import("./storage");
        await storage.upsertPropertyContacts({
          propertyId: lead.id, marketId: lead.marketId,
          reverseAddressType: updates.reverseAddressType,
          reverseAddressBusinesses: updates.reverseAddressBusinesses,
          reverseAddressEnrichedAt: updates.reverseAddressEnrichedAt,
          managementCompany: updates.managementCompany,
          managementPhone: updates.managementPhone,
          managementEvidence: updates.managementEvidence,
          source: "reverse_address",
        });
      } catch {}
      enriched++;
      byType[result.addressType] = (byType[result.addressType] || 0) + 1;

      await new Promise(r => setTimeout(r, 200));
    } catch (error: any) {
      console.error(`[Reverse Address] Error processing lead ${lead.id}:`, error.message);
      skipped++;
    }
  }

  console.log(`[Reverse Address] Done: ${enriched} enriched, ${skipped} skipped`);
  return { totalProcessed: eligibleLeads.length, enriched, skipped, byType };
}

export async function getReverseAddressStats(marketId?: string) {
  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  const total = allLeads.length;
  const enriched = allLeads.filter(l => l.reverseAddressEnrichedAt).length;
  const withDifferentAddress = allLeads.filter(l => l.ownerAddress && addressesDiffer(l.address, l.ownerAddress || "")).length;
  const pending = withDifferentAddress - allLeads.filter(l => l.reverseAddressEnrichedAt && l.reverseAddressType !== "same_as_property").length;

  const byType: Record<string, number> = {};
  for (const lead of allLeads) {
    if (lead.reverseAddressType) {
      byType[lead.reverseAddressType] = (byType[lead.reverseAddressType] || 0) + 1;
    }
  }

  const mgmtDiscovered = allLeads.filter(l =>
    l.reverseAddressType === "management_office" &&
    l.reverseAddressBusinesses &&
    Array.isArray(l.reverseAddressBusinesses)
  ).length;

  return {
    total,
    withDifferentAddress,
    enriched,
    pending: Math.max(0, pending),
    mgmtDiscovered,
    byType,
  };
}
