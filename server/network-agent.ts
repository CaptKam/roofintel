import { db } from "./storage";
import { leads, portfolios, portfolioLeads, type Lead, type InsertPortfolio } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";

function normalize(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toUpperCase()
    .replace(/[,.\-'"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(LLC|L\.L\.C|LC|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC|PC|CO)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wordsA = new Set(na.split(" "));
  const wordsB = new Set(nb.split(" "));
  const intersection = Array.from(wordsA).filter((w) => wordsB.has(w));
  const union = new Set(Array.from(wordsA).concat(Array.from(wordsB)));
  const jaccard = intersection.length / union.size;
  return jaccard;
}

interface OwnerCluster {
  leadIds: Set<string>;
  ownerNames: Set<string>;
  llcNames: Set<string>;
  registeredAgents: Set<string>;
  managingMembers: Set<string>;
  taxpayerIds: Set<string>;
  sosFileNumbers: Set<string>;
  linkReasons: Map<string, string>;
}

function extractLlcChainEntities(lead: Lead): { entities: string[]; agents: string[]; members: string[] } {
  const entities: string[] = [];
  const agents: string[] = [];
  const members: string[] = [];

  if (!lead.llcChain || !Array.isArray(lead.llcChain)) return { entities, agents, members };

  for (const entry of lead.llcChain as any[]) {
    if (entry.entityName) entities.push(entry.entityName);
    if (entry.registeredAgent) agents.push(entry.registeredAgent);
    if (entry.registeredAgentAddress) agents.push(entry.registeredAgentAddress);
    if (entry.officers && Array.isArray(entry.officers)) {
      for (const officer of entry.officers) {
        if (officer.name) members.push(officer.name);
      }
    }
  }

  return { entities, agents, members };
}

function extractDecisionMaker(lead: Lead): { name: string | null; title: string | null; phone: string | null; email: string | null } {
  if (lead.contactName) {
    return {
      name: lead.contactName,
      title: lead.contactTitle,
      phone: lead.contactPhone || lead.ownerPhone,
      email: lead.contactEmail || lead.ownerEmail,
    };
  }
  if (lead.managingMember && !lead.managingMember.includes("LLC") && !lead.managingMember.includes("INC")) {
    return {
      name: lead.managingMember,
      title: lead.managingMemberTitle,
      phone: lead.managingMemberPhone || lead.ownerPhone,
      email: lead.managingMemberEmail || lead.ownerEmail,
    };
  }
  if (lead.officerName && !lead.officerName.startsWith("TX Filing:")) {
    return {
      name: lead.officerName,
      title: lead.officerTitle,
      phone: lead.ownerPhone,
      email: lead.ownerEmail,
    };
  }
  const intel = lead.ownerIntelligence as any;
  if (intel?.realPeople?.length > 0) {
    const person = intel.realPeople[0];
    return {
      name: person.name,
      title: person.title,
      phone: intel.phones?.[0]?.phone || lead.ownerPhone,
      email: lead.ownerEmail,
    };
  }
  return { name: null, title: null, phone: lead.ownerPhone, email: lead.ownerEmail };
}

export async function analyzeNetwork(marketId?: string): Promise<{
  portfoliosCreated: number;
  leadsLinked: number;
  totalLeadsAnalyzed: number;
}> {
  console.log("[Network Agent] Starting relationship network analysis...");

  if (marketId) {
    const existingPortfolios = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.marketId, marketId));
    if (existingPortfolios.length > 0) {
      const portfolioIds = existingPortfolios.map(p => p.id);
      for (const pid of portfolioIds) {
        await db.delete(portfolioLeads).where(eq(portfolioLeads.portfolioId, pid));
      }
      await db.delete(portfolios).where(eq(portfolios.marketId, marketId));
      console.log(`[Network Agent] Cleaned up ${existingPortfolios.length} existing portfolios for market ${marketId}`);
    }
  } else {
    await db.delete(portfolioLeads);
    await db.delete(portfolios);
    console.log("[Network Agent] Cleaned up all existing portfolios");
  }

  const conditions = marketId ? [eq(leads.marketId, marketId)] : [];
  const allLeads = await db
    .select()
    .from(leads)
    .where(conditions.length > 0 ? conditions[0] : undefined);

  console.log(`[Network Agent] Analyzing ${allLeads.length} leads...`);

  const clusters: OwnerCluster[] = [];
  const leadToCluster = new Map<string, number>();

  function findOrCreateCluster(leadId: string): number {
    const existing = leadToCluster.get(leadId);
    if (existing !== undefined) return existing;
    const idx = clusters.length;
    clusters.push({
      leadIds: new Set([leadId]),
      ownerNames: new Set(),
      llcNames: new Set(),
      registeredAgents: new Set(),
      managingMembers: new Set(),
      taxpayerIds: new Set(),
      sosFileNumbers: new Set(),
      linkReasons: new Map([[leadId, "seed"]]),
    });
    leadToCluster.set(leadId, idx);
    return idx;
  }

  function mergeClusters(a: number, b: number): number {
    if (a === b) return a;
    const keep = Math.min(a, b);
    const merge = Math.max(a, b);
    const keepCluster = clusters[keep];
    const mergeCluster = clusters[merge];

    Array.from(mergeCluster.leadIds).forEach((lid) => {
      keepCluster.leadIds.add(lid);
      leadToCluster.set(lid, keep);
    });
    mergeCluster.ownerNames.forEach((n) => keepCluster.ownerNames.add(n));
    mergeCluster.llcNames.forEach((n) => keepCluster.llcNames.add(n));
    mergeCluster.registeredAgents.forEach((n) => keepCluster.registeredAgents.add(n));
    mergeCluster.managingMembers.forEach((n) => keepCluster.managingMembers.add(n));
    mergeCluster.taxpayerIds.forEach((n) => keepCluster.taxpayerIds.add(n));
    mergeCluster.sosFileNumbers.forEach((n) => keepCluster.sosFileNumbers.add(n));
    mergeCluster.linkReasons.forEach((v, k) => keepCluster.linkReasons.set(k, v));

    mergeCluster.leadIds = new Set();
    return keep;
  }

  const ownerIndex = new Map<string, string[]>();
  const llcIndex = new Map<string, string[]>();
  const agentIndex = new Map<string, string[]>();
  const memberIndex = new Map<string, string[]>();
  const taxpayerIndex = new Map<string, string[]>();
  const sosIndex = new Map<string, string[]>();

  function addToIndex(index: Map<string, string[]>, key: string, leadId: string) {
    const norm = normalize(key);
    if (!norm || norm.length < 3) return;
    const arr = index.get(norm) || [];
    arr.push(leadId);
    index.set(norm, arr);
  }

  for (const lead of allLeads) {
    addToIndex(ownerIndex, lead.ownerName, lead.id);
    if (lead.llcName) addToIndex(llcIndex, lead.llcName, lead.id);
    if (lead.registeredAgent) addToIndex(agentIndex, lead.registeredAgent, lead.id);
    if (lead.managingMember) addToIndex(memberIndex, lead.managingMember, lead.id);
    if (lead.taxpayerId) addToIndex(taxpayerIndex, lead.taxpayerId, lead.id);
    if (lead.sosFileNumber) addToIndex(sosIndex, lead.sosFileNumber, lead.id);

    const { entities, agents, members } = extractLlcChainEntities(lead);
    for (const entity of entities) addToIndex(llcIndex, entity, lead.id);
    for (const agent of agents) addToIndex(agentIndex, agent, lead.id);
    for (const member of members) addToIndex(memberIndex, member, lead.id);
  }

  function clusterFromIndex(index: Map<string, string[]>, linkReason: string, clusterField: keyof OwnerCluster) {
    for (const [key, leadIds] of Array.from(index.entries())) {
      if (leadIds.length < 2) continue;

      let targetCluster = -1;
      for (const lid of leadIds) {
        const existing = leadToCluster.get(lid);
        if (existing !== undefined) {
          if (targetCluster === -1) {
            targetCluster = existing;
          } else {
            targetCluster = mergeClusters(targetCluster, existing);
          }
        }
      }

      if (targetCluster === -1) {
        targetCluster = findOrCreateCluster(leadIds[0]);
      }

      for (const lid of leadIds) {
        const existing = leadToCluster.get(lid);
        if (existing !== undefined && existing !== targetCluster) {
          targetCluster = mergeClusters(targetCluster, existing);
        } else if (existing === undefined) {
          clusters[targetCluster].leadIds.add(lid);
          leadToCluster.set(lid, targetCluster);
        }
        clusters[targetCluster].linkReasons.set(lid, linkReason);
      }

      const field = clusters[targetCluster][clusterField];
      if (field instanceof Set) {
        (field as Set<string>).add(key);
      }
    }
  }

  clusterFromIndex(ownerIndex, "Same owner name", "ownerNames");
  clusterFromIndex(taxpayerIndex, "Same taxpayer ID", "taxpayerIds");
  clusterFromIndex(sosIndex, "Same SOS file number", "sosFileNumbers");
  clusterFromIndex(llcIndex, "LLC chain entity match", "llcNames");
  clusterFromIndex(agentIndex, "Same registered agent", "registeredAgents");
  clusterFromIndex(memberIndex, "Same managing member", "managingMembers");

  const fuzzyThreshold = 0.8;
  const ownerKeys = Array.from(ownerIndex.keys());
  console.log(`[Network Agent] Running fuzzy matching on ${ownerKeys.length} unique owner keys...`);

  const prefixBuckets = new Map<string, string[]>();
  for (const key of ownerKeys) {
    const prefix = key.substring(0, 4);
    const bucket = prefixBuckets.get(prefix) || [];
    bucket.push(key);
    prefixBuckets.set(prefix, bucket);
  }

  let fuzzyMatches = 0;
  for (const [, bucket] of Array.from(prefixBuckets.entries())) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (similarity(bucket[i], bucket[j]) >= fuzzyThreshold) {
          fuzzyMatches++;
          const leadsA = ownerIndex.get(bucket[i])!;
          const leadsB = ownerIndex.get(bucket[j])!;
          const firstA = leadsA[0];
          const firstB = leadsB[0];

          let clusterA = leadToCluster.get(firstA);
          let clusterB = leadToCluster.get(firstB);

          if (clusterA === undefined) clusterA = findOrCreateCluster(firstA);
          if (clusterB === undefined) clusterB = findOrCreateCluster(firstB);

          const merged = mergeClusters(clusterA, clusterB);

          for (const lid of [...leadsA, ...leadsB]) {
            const existing = leadToCluster.get(lid);
            if (existing !== undefined && existing !== merged) {
              mergeClusters(merged, existing);
            } else if (existing === undefined) {
              clusters[merged].leadIds.add(lid);
              leadToCluster.set(lid, merged);
              clusters[merged].linkReasons.set(lid, "Fuzzy owner name match");
            }
          }
        }
      }
    }
  }
  console.log(`[Network Agent] Fuzzy matching found ${fuzzyMatches} additional matches`);

  const validClusters = clusters.filter((c) => c.leadIds.size >= 2);
  console.log(`[Network Agent] Found ${validClusters.length} portfolio clusters with 2+ properties`);

  const leadMap = new Map<string, Lead>();
  for (const lead of allLeads) leadMap.set(lead.id, lead);

  let portfoliosCreated = 0;
  let leadsLinked = 0;

  for (const cluster of validClusters) {
    const clusterLeads = Array.from(cluster.leadIds).map((id) => leadMap.get(id)).filter(Boolean) as Lead[];
    if (clusterLeads.length < 2) continue;

    const totalSqft = clusterLeads.reduce((sum, l) => sum + (l.sqft || 0), 0);
    const totalRoofArea = clusterLeads.reduce((sum, l) => sum + (l.estimatedRoofArea || l.sqft || 0), 0);
    const totalValue = clusterLeads.reduce((sum, l) => sum + (l.totalValue || 0), 0);
    const avgScore = Math.round(clusterLeads.reduce((sum, l) => sum + (l.leadScore || 0), 0) / clusterLeads.length);
    const totalHailEvents = clusterLeads.reduce((sum, l) => sum + (l.hailEvents || 0), 0);
    const claimWindowCount = clusterLeads.filter((l) => l.claimWindowOpen).length;

    const bestLead = clusterLeads.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0))[0];
    const dm = extractDecisionMaker(bestLead);

    const primaryOwner = bestLead.ownerName;
    const ownerType = bestLead.ownerType || "Unknown";

    const portfolioScore = calculatePortfolioScore({
      propertyCount: clusterLeads.length,
      totalRoofArea,
      totalValue,
      avgScore,
      totalHailEvents,
      claimWindowCount,
      hasDecisionMaker: !!dm.name,
      hasPhone: !!dm.phone,
      hasEmail: !!dm.email,
    });

    const linkageType = cluster.taxpayerIds.size > 0
      ? "taxpayer_id"
      : cluster.sosFileNumbers.size > 0
        ? "sos_file_number"
        : cluster.registeredAgents.size > 0
          ? "registered_agent"
          : cluster.llcNames.size > 0
            ? "llc_chain"
            : cluster.managingMembers.size > 0
              ? "managing_member"
              : "owner_name";

    const portfolioData: InsertPortfolio = {
      marketId: marketId || bestLead.marketId || null,
      name: `${primaryOwner} Portfolio`,
      keyOwner: primaryOwner,
      ownerType,
      propertyCount: clusterLeads.length,
      totalSqft,
      totalRoofArea,
      totalValue,
      avgLeadScore: avgScore,
      totalHailEvents,
      claimWindowCount,
      portfolioScore,
      keyDecisionMaker: dm.name,
      keyDecisionMakerTitle: dm.title,
      keyPhone: dm.phone,
      keyEmail: dm.email,
      linkageType,
      linkageKeys: Array.from(cluster.ownerNames).concat(Array.from(cluster.llcNames)).slice(0, 20),
      registeredAgent: Array.from(cluster.registeredAgents)[0] || null,
      managingMember: Array.from(cluster.managingMembers)[0] || null,
      llcEntities: Array.from(cluster.llcNames).slice(0, 20),
    };

    const [portfolio] = await db.insert(portfolios).values(portfolioData).returning();

    const plEntries = clusterLeads.map((lead) => ({
      portfolioId: portfolio.id,
      leadId: lead.id,
      linkReason: cluster.linkReasons.get(lead.id) || "owner_name",
    }));

    for (let i = 0; i < plEntries.length; i += 50) {
      const batch = plEntries.slice(i, i + 50);
      await db.insert(portfolioLeads).values(batch);
    }

    portfoliosCreated++;
    leadsLinked += clusterLeads.length;
    if (portfoliosCreated % 100 === 0) {
      console.log(`[Network Agent] Saved ${portfoliosCreated}/${validClusters.length} portfolios...`);
    }
  }

  console.log(`[Network Agent] Created ${portfoliosCreated} portfolios linking ${leadsLinked} leads`);

  return {
    portfoliosCreated,
    leadsLinked,
    totalLeadsAnalyzed: allLeads.length,
  };
}

function calculatePortfolioScore(params: {
  propertyCount: number;
  totalRoofArea: number;
  totalValue: number;
  avgScore: number;
  totalHailEvents: number;
  claimWindowCount: number;
  hasDecisionMaker: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
}): number {
  let score = 0;

  if (params.propertyCount >= 10) score += 25;
  else if (params.propertyCount >= 5) score += 20;
  else if (params.propertyCount >= 3) score += 15;
  else score += 8;

  if (params.totalRoofArea >= 500000) score += 20;
  else if (params.totalRoofArea >= 100000) score += 15;
  else if (params.totalRoofArea >= 50000) score += 10;
  else score += 5;

  score += Math.min(15, Math.round(params.avgScore / 6.67));

  if (params.totalHailEvents >= 20) score += 15;
  else if (params.totalHailEvents >= 10) score += 12;
  else if (params.totalHailEvents >= 5) score += 8;
  else score += Math.min(5, params.totalHailEvents * 2);

  if (params.claimWindowCount > 0) {
    score += Math.min(10, params.claimWindowCount * 3);
  }

  if (params.hasDecisionMaker) score += 5;
  if (params.hasPhone) score += 5;
  if (params.hasEmail) score += 3;

  if (params.totalValue >= 50000000) score += 2;

  return Math.min(100, score);
}

export async function getPortfolios(marketId?: string, sortBy?: string): Promise<any[]> {
  const conditions = marketId ? [eq(portfolios.marketId, marketId)] : [];
  const orderCol = sortBy === "properties" ? portfolios.propertyCount
    : sortBy === "value" ? portfolios.totalValue
    : sortBy === "roofArea" ? portfolios.totalRoofArea
    : portfolios.portfolioScore;

  const result = await db
    .select()
    .from(portfolios)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(orderCol));

  return result;
}

export async function getPortfolioDetail(portfolioId: string): Promise<{
  portfolio: any;
  leads: Lead[];
  linkReasons: Record<string, string>;
} | null> {
  const [portfolio] = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId));

  if (!portfolio) return null;

  const links = await db
    .select()
    .from(portfolioLeads)
    .where(eq(portfolioLeads.portfolioId, portfolioId));

  const leadIds = links.map((l) => l.leadId);
  if (leadIds.length === 0) return { portfolio, leads: [], linkReasons: {} };

  const linkedLeads = await db
    .select()
    .from(leads)
    .where(
      sql`${leads.id} = ANY(${sql`ARRAY[${sql.join(leadIds.map(id => sql`${id}`), sql`, `)}]`})`
    )
    .orderBy(desc(leads.leadScore));

  const linkReasons: Record<string, string> = {};
  for (const link of links) {
    linkReasons[link.leadId] = link.linkReason;
  }

  return { portfolio, leads: linkedLeads, linkReasons };
}

export async function getNetworkStats(marketId?: string): Promise<{
  totalPortfolios: number;
  totalLinkedLeads: number;
  totalUnlinkedLeads: number;
  avgPortfolioSize: number;
  largestPortfolio: number;
  topPortfolios: any[];
}> {
  const conditions = marketId ? [eq(portfolios.marketId, marketId)] : [];
  const allPortfolios = await db
    .select()
    .from(portfolios)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(portfolios.portfolioScore));

  const totalLinkedLeads = allPortfolios.reduce((sum, p) => sum + p.propertyCount, 0);
  const leadConditions = marketId ? [eq(leads.marketId, marketId)] : [];
  const [{ count: totalLeadCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(leadConditions.length > 0 ? leadConditions[0] : undefined);

  return {
    totalPortfolios: allPortfolios.length,
    totalLinkedLeads,
    totalUnlinkedLeads: totalLeadCount - totalLinkedLeads,
    avgPortfolioSize: allPortfolios.length > 0 ? Math.round(totalLinkedLeads / allPortfolios.length) : 0,
    largestPortfolio: allPortfolios.length > 0 ? Math.max(...allPortfolios.map((p) => p.propertyCount)) : 0,
    topPortfolios: allPortfolios.slice(0, 10),
  };
}
