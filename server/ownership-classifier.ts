import { db } from "./storage";
import { leads } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export type OwnershipStructure =
  | "small_private"
  | "investment_firm"
  | "institutional_reit"
  | "third_party_managed";

interface ClassificationSignal {
  factor: string;
  value: string;
  weight: number;
  direction: OwnershipStructure;
}

interface ClassificationResult {
  structure: OwnershipStructure;
  confidence: number;
  signals: ClassificationSignal[];
  label: string;
}

const STRUCTURE_LABELS: Record<OwnershipStructure, string> = {
  small_private: "Small Private Owner",
  investment_firm: "Real Estate Investment Firm",
  institutional_reit: "Institutional / REIT",
  third_party_managed: "Third-Party Managed",
};

const INVESTMENT_PATTERNS = /\b(invest|capital|equity|fund|ventures|partners|acquisitions|holdings|asset\s+management|real\s+estate\s+(?:investment|capital))\b/i;
const INSTITUTIONAL_PATTERNS = /\b(reit|trust|pension|endowment|insurance|mutual|institutional|national|american|united|global)\b/i;
const MANAGEMENT_PATTERNS = /\b(management|property\s+(?:management|services)|pm\s+group|realty|leasing|facilities)\b/i;

export function classifyOwnershipStructure(lead: Lead, portfolioSize?: number): ClassificationResult {
  const signals: ClassificationSignal[] = [];
  const scores: Record<OwnershipStructure, number> = {
    small_private: 0,
    investment_firm: 0,
    institutional_reit: 0,
    third_party_managed: 0,
  };

  const ownerName = lead.ownerName || "";
  const ownerType = lead.ownerType || "";
  const reverseAddrType = (lead as any).reverseAddressType || "";
  const llcChain = lead.llcChain as any[] | null;
  const mgmtCompany = lead.managementCompany || "";
  const totalValue = lead.totalValue || 0;

  if (ownerType === "Individual" || ownerType === "Trust") {
    signals.push({ factor: "ownerType", value: ownerType, weight: 40, direction: "small_private" });
    scores.small_private += 40;
  }

  if (ownerType === "LLC" || ownerType === "Corp") {
    if (INVESTMENT_PATTERNS.test(ownerName)) {
      signals.push({ factor: "entityName", value: "Investment/capital keywords in name", weight: 35, direction: "investment_firm" });
      scores.investment_firm += 35;
    } else if (INSTITUTIONAL_PATTERNS.test(ownerName)) {
      signals.push({ factor: "entityName", value: "Institutional/REIT keywords in name", weight: 30, direction: "institutional_reit" });
      scores.institutional_reit += 30;
    } else {
      signals.push({ factor: "ownerType", value: `${ownerType} entity`, weight: 15, direction: "small_private" });
      scores.small_private += 15;
    }
  }

  const chainDepth = llcChain && Array.isArray(llcChain) ? llcChain.length : 0;
  if (chainDepth === 0) {
    signals.push({ factor: "llcChain", value: "No LLC chain", weight: 15, direction: "small_private" });
    scores.small_private += 15;
  } else if (chainDepth === 1) {
    signals.push({ factor: "llcChain", value: "Single LLC", weight: 10, direction: "small_private" });
    scores.small_private += 10;
  } else if (chainDepth >= 2 && chainDepth <= 3) {
    signals.push({ factor: "llcChain", value: `${chainDepth}-layer LLC chain`, weight: 20, direction: "investment_firm" });
    scores.investment_firm += 20;
  } else {
    signals.push({ factor: "llcChain", value: `Deep ${chainDepth}-layer LLC chain`, weight: 25, direction: "institutional_reit" });
    scores.institutional_reit += 25;
  }

  if (reverseAddrType === "management_office" || reverseAddrType === "mixed_commercial") {
    signals.push({ factor: "mailingAddress", value: "Management/commercial office", weight: 25, direction: "third_party_managed" });
    scores.third_party_managed += 25;
  } else if (reverseAddrType === "corporate_hq") {
    signals.push({ factor: "mailingAddress", value: "Corporate headquarters", weight: 20, direction: "institutional_reit" });
    scores.institutional_reit += 20;
  } else if (reverseAddrType === "residential_or_vacant") {
    signals.push({ factor: "mailingAddress", value: "Residential mailing address", weight: 20, direction: "small_private" });
    scores.small_private += 20;
  } else if (reverseAddrType === "law_firm_office" || reverseAddrType === "accounting_office") {
    signals.push({ factor: "mailingAddress", value: "Professional office (law/accounting)", weight: 15, direction: "investment_firm" });
    scores.investment_firm += 15;
  }

  if (mgmtCompany) {
    signals.push({ factor: "managementCompany", value: mgmtCompany, weight: 30, direction: "third_party_managed" });
    scores.third_party_managed += 30;
  }

  const pSize = portfolioSize || 1;
  if (pSize >= 20) {
    signals.push({ factor: "portfolioSize", value: `${pSize} properties`, weight: 30, direction: "institutional_reit" });
    scores.institutional_reit += 30;
  } else if (pSize >= 5) {
    signals.push({ factor: "portfolioSize", value: `${pSize} properties`, weight: 20, direction: "investment_firm" });
    scores.investment_firm += 20;
  } else if (pSize >= 2) {
    signals.push({ factor: "portfolioSize", value: `${pSize} properties`, weight: 10, direction: "investment_firm" });
    scores.investment_firm += 10;
  } else {
    signals.push({ factor: "portfolioSize", value: "Single property", weight: 10, direction: "small_private" });
    scores.small_private += 10;
  }

  if (totalValue >= 10000000) {
    signals.push({ factor: "propertyValue", value: `$${(totalValue / 1000000).toFixed(1)}M`, weight: 15, direction: "institutional_reit" });
    scores.institutional_reit += 15;
  } else if (totalValue >= 2000000) {
    signals.push({ factor: "propertyValue", value: `$${(totalValue / 1000000).toFixed(1)}M`, weight: 10, direction: "investment_firm" });
    scores.investment_firm += 10;
  }

  if (lead.managingMember && !mgmtCompany) {
    signals.push({ factor: "managingMember", value: "Has managing member, no PM company", weight: 15, direction: "small_private" });
    scores.small_private += 15;
  }

  let best: OwnershipStructure = "small_private";
  let bestScore = scores.small_private;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = key as OwnershipStructure;
      bestScore = score;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? Math.round((bestScore / total) * 100) : 25;

  return {
    structure: best,
    confidence: Math.min(confidence, 95),
    signals,
    label: STRUCTURE_LABELS[best],
  };
}

const TITLE_RELEVANCE: Record<OwnershipStructure, Record<string, number>> = {
  small_private: {
    "Managing Member": 100,
    "Owner": 100,
    "Managing Partner": 95,
    "Principal": 90,
    "President": 85,
    "CEO": 80,
    "Property Manager": 60,
    "Facilities Director": 50,
    "Asset Manager": 40,
    "Building Engineer": 30,
    "Leasing Agent": 15,
    "General Contractor": 10,
    "Registered Agent": 20,
  },
  investment_firm: {
    "Asset Manager": 100,
    "VP Real Estate": 95,
    "Director of Real Estate": 95,
    "VP Acquisitions": 90,
    "Portfolio Manager": 85,
    "Managing Partner": 80,
    "Principal": 75,
    "Property Manager": 70,
    "Facilities Director": 65,
    "President": 50,
    "CEO": 40,
    "Building Engineer": 35,
    "Owner": 30,
    "Leasing Agent": 20,
    "General Contractor": 10,
    "Registered Agent": 10,
  },
  institutional_reit: {
    "Facilities Director": 100,
    "Director of Capital Projects": 100,
    "Regional Facilities Manager": 95,
    "VP Property Management": 90,
    "Asset Manager": 85,
    "Director of Engineering": 80,
    "Property Manager": 75,
    "Building Engineer": 70,
    "Portfolio Manager": 65,
    "VP Real Estate": 60,
    "Managing Partner": 30,
    "CEO": 20,
    "President": 20,
    "Owner": 15,
    "Leasing Agent": 10,
    "General Contractor": 10,
    "Registered Agent": 5,
  },
  third_party_managed: {
    "Property Manager": 100,
    "Regional Property Manager": 95,
    "Facilities Director": 90,
    "Maintenance Director": 90,
    "Building Engineer": 80,
    "Site Manager": 75,
    "Community Manager": 70,
    "Asset Manager": 65,
    "Owner": 50,
    "Managing Member": 45,
    "Managing Partner": 40,
    "Principal": 35,
    "CEO": 20,
    "President": 20,
    "Leasing Agent": 15,
    "General Contractor": 10,
    "Registered Agent": 10,
  },
};

export function getTitleRelevance(title: string | null, structure: OwnershipStructure): number {
  if (!title) return 20;
  const relevanceMap = TITLE_RELEVANCE[structure];
  const lower = title.toLowerCase().trim();

  for (const [key, score] of Object.entries(relevanceMap)) {
    if (lower.includes(key.toLowerCase())) return score;
  }

  if (lower.includes("director") || lower.includes("vp") || lower.includes("vice president")) return 60;
  if (lower.includes("manager")) return 50;
  if (lower.includes("officer")) return 40;

  return 20;
}

export interface DecisionMakerContact {
  name: string;
  title: string | null;
  role: string;
  tier: "primary" | "secondary" | "operational";
  titleRelevance: number;
  confidence: number;
  combinedScore: number;
  phone: string | null;
  email: string | null;
  source: string;
  reasoning: string;
}

export function selectDecisionMakers(
  people: Array<{
    name: string;
    normalizedName: string;
    role: string;
    title: string | null;
    confidence: number;
    source: string;
    phone: string | null;
    email: string | null;
  }>,
  structure: OwnershipStructure,
  lead?: any
): DecisionMakerContact[] {
  if (people.length === 0 && lead) {
    const fallbacks: DecisionMakerContact[] = [];
    if (lead.managementContact) {
      fallbacks.push({
        name: lead.managementContact,
        title: "Property Manager",
        role: "manager",
        tier: "primary",
        titleRelevance: getTitleRelevance("Property Manager", structure),
        confidence: 70,
        combinedScore: 55,
        phone: lead.managementPhone || null,
        email: lead.managementEmail || null,
        source: "Management Attribution",
        reasoning: `Fallback: management contact for ${STRUCTURE_LABELS[structure]}`,
      });
    }
    if (lead.ownerName) {
      fallbacks.push({
        name: lead.ownerName,
        title: lead.ownerType === "Individual" ? "Owner" : "Entity Owner",
        role: "owner",
        tier: fallbacks.length === 0 ? "primary" : "secondary",
        titleRelevance: getTitleRelevance("Owner", structure),
        confidence: 50,
        combinedScore: 40,
        phone: lead.ownerPhone || null,
        email: lead.ownerEmail || null,
        source: "Property Record",
        reasoning: `Fallback: owner entity from DCAD record`,
      });
    }
    return fallbacks;
  }
  if (people.length === 0) return [];

  const scored = people.map((p) => {
    const titleRelevance = getTitleRelevance(p.title, structure);
    const hasContact = (p.phone || p.email) ? 15 : 0;
    const combinedScore = titleRelevance * 0.5 + p.confidence * 0.35 + hasContact;
    return { ...p, titleRelevance, combinedScore, hasContact };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  const results: DecisionMakerContact[] = [];

  if (scored.length >= 1) {
    const p = scored[0];
    results.push({
      name: p.name,
      title: p.title,
      role: p.role,
      tier: "primary",
      titleRelevance: p.titleRelevance,
      confidence: p.confidence,
      combinedScore: Math.round(p.combinedScore),
      phone: p.phone,
      email: p.email,
      source: p.source,
      reasoning: `Highest combined score (${Math.round(p.combinedScore)}) for ${STRUCTURE_LABELS[structure]} structure`,
    });
  }

  if (scored.length >= 2) {
    const p = scored[1];
    results.push({
      name: p.name,
      title: p.title,
      role: p.role,
      tier: "secondary",
      titleRelevance: p.titleRelevance,
      confidence: p.confidence,
      combinedScore: Math.round(p.combinedScore),
      phone: p.phone,
      email: p.email,
      source: p.source,
      reasoning: `Secondary decision maker for escalation`,
    });
  }

  const operational = scored.find((p, i) => {
    if (i <= 1) return false;
    const opRoles = ["manager", "contact", "Property Manager", "Facilities Director", "Building Engineer"];
    return opRoles.some(r => p.role.toLowerCase().includes(r.toLowerCase()) || (p.title && p.title.toLowerCase().includes(r.toLowerCase())));
  });

  if (operational) {
    results.push({
      name: operational.name,
      title: operational.title,
      role: operational.role,
      tier: "operational",
      titleRelevance: operational.titleRelevance,
      confidence: operational.confidence,
      combinedScore: Math.round(operational.combinedScore),
      phone: operational.phone,
      email: operational.email,
      source: operational.source,
      reasoning: `Operational contact for day-to-day coordination`,
    });
  } else if (scored.length >= 3) {
    const p = scored[2];
    results.push({
      name: p.name,
      title: p.title,
      role: p.role,
      tier: "operational",
      titleRelevance: p.titleRelevance,
      confidence: p.confidence,
      combinedScore: Math.round(p.combinedScore),
      phone: p.phone,
      email: p.email,
      source: p.source,
      reasoning: `Third-ranked contact for operational reach`,
    });
  }

  return results;
}

export async function classifyAllLeads(): Promise<{
  total: number;
  classified: number;
  byStructure: Record<string, number>;
}> {
  const allLeads = await db.select().from(leads).limit(50000);
  const byStructure: Record<string, number> = {};
  let classified = 0;

  const portfolioSizes = new Map<string, number>();
  for (const lead of allLeads) {
    const ownerNorm = (lead.ownerName || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
    if (ownerNorm) {
      portfolioSizes.set(ownerNorm, (portfolioSizes.get(ownerNorm) || 0) + 1);
    }
  }

  const batchSize = 100;
  for (let i = 0; i < allLeads.length; i += batchSize) {
    const batch = allLeads.slice(i, i + batchSize);

    for (const lead of batch) {
      const ownerNorm = (lead.ownerName || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
      const pSize = portfolioSizes.get(ownerNorm) || 1;

      const result = classifyOwnershipStructure(lead, pSize);
      byStructure[result.structure] = (byStructure[result.structure] || 0) + 1;
      classified++;

      await db.update(leads).set({
        ownershipStructure: result.structure,
        ownershipSignals: result.signals as any,
      } as any).where(eq(leads.id, lead.id));
    }
  }

  return {
    total: allLeads.length,
    classified,
    byStructure,
  };
}

export async function classifyAndAssignDecisionMakers(filterLeadIds?: string[]): Promise<{
  total: number;
  classified: number;
  withDecisionMakers: number;
  byStructure: Record<string, number>;
}> {
  let allLeads = await db.select().from(leads).limit(50000);
  if (Array.isArray(filterLeadIds) && filterLeadIds.length > 0) {
    const idSet = new Set(filterLeadIds);
    allLeads = allLeads.filter(l => idSet.has(l.id));
  }
  const byStructure: Record<string, number> = {};
  let classified = 0;
  let withDecisionMakers = 0;

  const portfolioSizes = new Map<string, number>();
  for (const lead of allLeads) {
    const ownerNorm = (lead.ownerName || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
    if (ownerNorm) {
      portfolioSizes.set(ownerNorm, (portfolioSizes.get(ownerNorm) || 0) + 1);
    }
  }

  const { extractPeopleFromLead } = await import("./rooftop-owner-resolver");

  for (const lead of allLeads) {
    const ownerNorm = (lead.ownerName || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
    const pSize = portfolioSizes.get(ownerNorm) || 1;

    const classification = classifyOwnershipStructure(lead, pSize);
    byStructure[classification.structure] = (byStructure[classification.structure] || 0) + 1;
    classified++;

    const people = extractPeopleFromLead(lead);
    const dms = selectDecisionMakers(people, classification.structure, lead);

    if (dms.length > 0) withDecisionMakers++;

    await db.update(leads).set({
      ownershipStructure: classification.structure,
      ownershipSignals: classification.signals as any,
      decisionMakers: dms as any,
    } as any).where(eq(leads.id, lead.id));
  }

  return {
    total: allLeads.length,
    classified,
    withDecisionMakers,
    byStructure,
  };
}

export async function getPortfolioSizeForLead(lead: any): Promise<number> {
  const ownerNorm = (lead.ownerName || "").toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim();
  if (!ownerNorm) return 1;

  const result = await db.select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`UPPER(REGEXP_REPLACE(${leads.ownerName}, '[^A-Za-z0-9 ]', '', 'g')) = ${ownerNorm}`)
    .limit(1);

  return result[0]?.count || 1;
}
