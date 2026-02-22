import { db } from "./storage";
import { leads, duplicateClusters, entityMerges, portfolioLeads, type Lead } from "@shared/schema";
import { eq, sql, and, inArray } from "drizzle-orm";

function normalizeOwner(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toUpperCase()
    .replace(/[,.\-'"#&()]/g, "")
    .replace(/\b(LLC|L\.L\.C|LC|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC|PC|CO|COMPANY|TRUST|REVOCABLE|IRREVOCABLE|LIVING|FAMILY|SERIES|SER|THE)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddress(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toUpperCase()
    .replace(/[,.\-#]/g, "")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bPLACE\b/g, "PL")
    .replace(/\bCIRCLE\b/g, "CIR")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bPARKWAY\b/g, "PKWY")
    .replace(/\bHIGHWAY\b/g, "HWY")
    .replace(/\bSUITE\b/g, "STE")
    .replace(/\bAPARTMENT\b/g, "APT")
    .replace(/\bBUILDING\b/g, "BLDG")
    .replace(/\bFLOOR\b/g, "FL")
    .replace(/\bUNIT\b/g, "UNIT")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .replace(/\s+/g, " ")
    .trim();
}

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

interface MatchResult {
  leadIds: string[];
  matchType: "deterministic" | "probabilistic";
  matchKeys: string[];
  confidence: number;
  explanation: string;
}

interface ScanResult {
  clustersFound: number;
  totalDuplicateLeads: number;
  byMatchType: { deterministic: number; probabilistic: number };
  scanDurationMs: number;
}

export async function runEntityResolutionScan(marketId?: string): Promise<ScanResult> {
  const startTime = Date.now();

  const whereClause = marketId ? eq(leads.marketId, marketId) : undefined;
  const allLeads = await db.select().from(leads).where(whereClause);

  if (allLeads.length === 0) {
    return { clustersFound: 0, totalDuplicateLeads: 0, byMatchType: { deterministic: 0, probabilistic: 0 }, scanDurationMs: Date.now() - startTime };
  }

  if (marketId) {
    await db.delete(duplicateClusters).where(eq(duplicateClusters.marketId, marketId));
  } else {
    await db.delete(duplicateClusters);
  }

  const unionFind = new Map<string, string>();
  function find(x: string): string {
    if (!unionFind.has(x)) unionFind.set(x, x);
    let root = unionFind.get(x)!;
    while (root !== unionFind.get(root)!) root = unionFind.get(root)!;
    let curr = x;
    while (curr !== root) {
      const next = unionFind.get(curr)!;
      unionFind.set(curr, root);
      curr = next;
    }
    return root;
  }
  function unite(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) unionFind.set(ra, rb);
  }

  const matchReasons = new Map<string, { type: "deterministic" | "probabilistic"; keys: string[]; confidence: number; explanation: string }>();
  function recordMatch(a: string, b: string, type: "deterministic" | "probabilistic", keys: string[], confidence: number, explanation: string) {
    unite(a, b);
    const key = [a, b].sort().join(":");
    const existing = matchReasons.get(key);
    if (!existing || existing.confidence < confidence) {
      matchReasons.set(key, { type, keys, confidence, explanation });
    }
  }

  const taxpayerIndex = new Map<string, string[]>();
  const sosIndex = new Map<string, string[]>();
  const sourceIndex = new Map<string, string[]>();
  const addressIndex = new Map<string, string[]>();
  const ownerPrefixIndex = new Map<string, string[]>();

  for (const lead of allLeads) {
    if (lead.taxpayerId) {
      const key = lead.taxpayerId.trim().toUpperCase();
      if (key.length >= 3) {
        if (!taxpayerIndex.has(key)) taxpayerIndex.set(key, []);
        taxpayerIndex.get(key)!.push(lead.id);
      }
    }

    if (lead.sosFileNumber) {
      const key = lead.sosFileNumber.trim().toUpperCase();
      if (key.length >= 3) {
        if (!sosIndex.has(key)) sosIndex.set(key, []);
        sosIndex.get(key)!.push(lead.id);
      }
    }

    if (lead.sourceId) {
      const key = lead.sourceId.trim();
      if (key.length >= 3) {
        if (!sourceIndex.has(key)) sourceIndex.set(key, []);
        sourceIndex.get(key)!.push(lead.id);
      }
    }

    const normAddr = normalizeAddress(lead.address);
    if (normAddr.length >= 5) {
      if (!addressIndex.has(normAddr)) addressIndex.set(normAddr, []);
      addressIndex.get(normAddr)!.push(lead.id);
    }

    const normOwner = normalizeOwner(lead.ownerName);
    if (normOwner.length >= 4) {
      const prefix = normOwner.substring(0, 4);
      if (!ownerPrefixIndex.has(prefix)) ownerPrefixIndex.set(prefix, []);
      ownerPrefixIndex.get(prefix)!.push(lead.id);
    }
  }

  for (const [key, ids] of Array.from(taxpayerIndex.entries())) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        recordMatch(ids[0], ids[i], "deterministic", [`taxpayerId:${key}`], 98, `Exact taxpayer ID match: ${key}`);
      }
    }
  }

  for (const [key, ids] of Array.from(sosIndex.entries())) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        recordMatch(ids[0], ids[i], "deterministic", [`sosFileNumber:${key}`], 97, `Exact SOS file number match: ${key}`);
      }
    }
  }

  for (const [key, ids] of Array.from(sourceIndex.entries())) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        recordMatch(ids[0], ids[i], "deterministic", [`sourceId:${key}`], 99, `Exact source ID match: ${key}`);
      }
    }
  }

  for (const [key, ids] of Array.from(addressIndex.entries())) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        recordMatch(ids[0], ids[i], "deterministic", [`address:${key}`], 95, `Exact normalized address match: ${key}`);
      }
    }
  }

  const leadMap = new Map<string, Lead>();
  for (const lead of allLeads) leadMap.set(lead.id, lead);

  for (const [prefix, ids] of Array.from(ownerPrefixIndex.entries())) {
    if (ids.length < 2 || ids.length > 200) continue;
    for (let i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (find(ids[i]) === find(ids[j])) continue;

        const leadA = leadMap.get(ids[i])!;
        const leadB = leadMap.get(ids[j])!;
        const normA = normalizeOwner(leadA.ownerName);
        const normB = normalizeOwner(leadB.ownerName);

        if (normA === normB && normA.length >= 4) {
          recordMatch(ids[i], ids[j], "deterministic", [`ownerName:${normA}`], 90, `Exact normalized owner match: ${normA}`);
          continue;
        }

        const jw = jaroWinkler(normA, normB);
        if (jw >= 0.92) {
          let boosted = false;
          let boostReason = "";
          if (leadA.ownerAddress && leadB.ownerAddress) {
            const addrA = normalizeAddress(leadA.ownerAddress);
            const addrB = normalizeAddress(leadB.ownerAddress);
            if (addrA === addrB && addrA.length >= 5) {
              boosted = true;
              boostReason = ` + same owner mailing address`;
            }
          }

          const confidence = Math.round(jw * 100) + (boosted ? 5 : 0);
          if (confidence >= 92) {
            recordMatch(
              ids[i], ids[j], "probabilistic",
              [`ownerName:${normA}~${normB}`],
              Math.min(confidence, 99),
              `Fuzzy owner name match (${Math.round(jw * 100)}% Jaro-Winkler): "${leadA.ownerName}" ≈ "${leadB.ownerName}"${boostReason}`
            );
          }
        }
      }
    }
  }

  const clusterMap = new Map<string, Set<string>>();
  for (const lead of allLeads) {
    const root = find(lead.id);
    if (!clusterMap.has(root)) clusterMap.set(root, new Set());
    clusterMap.get(root)!.add(lead.id);
  }

  let clustersFound = 0;
  let totalDuplicateLeads = 0;
  let deterministicCount = 0;
  let probabilisticCount = 0;

  const insertBatch: any[] = [];

  for (const [root, members] of Array.from(clusterMap.entries())) {
    if (members.size < 2) continue;

    const memberIds = Array.from(members);
    let bestType: "deterministic" | "probabilistic" = "probabilistic";
    let bestConfidence = 0;
    const allKeys: string[] = [];
    const explanations: string[] = [];

    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const key = [memberIds[i], memberIds[j]].sort().join(":");
        const reason = matchReasons.get(key);
        if (reason) {
          if (reason.type === "deterministic") bestType = "deterministic";
          if (reason.confidence > bestConfidence) bestConfidence = reason.confidence;
          allKeys.push(...reason.keys);
          explanations.push(reason.explanation);
        }
      }
    }

    const canonicalId = pickCanonical(memberIds, leadMap);

    insertBatch.push({
      marketId: marketId || leadMap.get(canonicalId)?.marketId || null,
      canonicalLeadId: canonicalId,
      memberLeadIds: memberIds,
      matchType: bestType,
      matchKeys: Array.from(new Set(allKeys)),
      matchConfidence: bestConfidence,
      matchExplanation: Array.from(new Set(explanations)).join("; "),
      status: "pending",
    });

    clustersFound++;
    totalDuplicateLeads += memberIds.length - 1;
    if (bestType === "deterministic") deterministicCount++;
    else probabilisticCount++;
  }

  if (insertBatch.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < insertBatch.length; i += BATCH_SIZE) {
      await db.insert(duplicateClusters).values(insertBatch.slice(i, i + BATCH_SIZE));
    }
  }

  return {
    clustersFound,
    totalDuplicateLeads,
    byMatchType: { deterministic: deterministicCount, probabilistic: probabilisticCount },
    scanDurationMs: Date.now() - startTime,
  };
}

function pickCanonical(ids: string[], leadMap: Map<string, Lead>): string {
  let bestId = ids[0];
  let bestScore = -1;

  for (const id of ids) {
    const lead = leadMap.get(id);
    if (!lead) continue;

    let richness = 0;
    if (lead.ownerPhone) richness += 3;
    if (lead.ownerEmail) richness += 3;
    if (lead.contactName) richness += 2;
    if (lead.contactPhone) richness += 2;
    if (lead.contactEmail) richness += 2;
    if (lead.businessName) richness += 1;
    if (lead.businessWebsite) richness += 1;
    if (lead.managingMember) richness += 2;
    if (lead.sosFileNumber) richness += 1;
    if (lead.taxpayerId) richness += 1;
    if (lead.officerName) richness += 1;
    if (lead.registeredAgent) richness += 1;
    richness += lead.leadScore / 10;
    if (lead.hailEvents > 0) richness += 1;
    if (lead.sqft > 0) richness += 1;

    if (richness > bestScore) {
      bestScore = richness;
      bestId = id;
    }
  }

  return bestId;
}

export async function mergeCluster(clusterId: string): Promise<{ merged: number; fieldsEnriched: string[] }> {
  const [cluster] = await db.select().from(duplicateClusters).where(eq(duplicateClusters.id, clusterId));
  if (!cluster) throw new Error("Cluster not found");
  if (cluster.status === "merged") throw new Error("Cluster already merged");

  const memberIds = cluster.memberLeadIds;
  const canonicalId = cluster.canonicalLeadId;

  const memberLeads = await db.select().from(leads).where(inArray(leads.id, memberIds));
  const leadMap = new Map<string, Lead>();
  for (const l of memberLeads) leadMap.set(l.id, l);

  const canonical = leadMap.get(canonicalId);
  if (!canonical) throw new Error("Canonical lead not found");

  const enrichableFields: (keyof Lead)[] = [
    "ownerPhone", "ownerEmail", "contactName", "contactTitle", "contactPhone",
    "contactEmail", "businessName", "businessWebsite", "managingMember",
    "managingMemberTitle", "managingMemberPhone", "managingMemberEmail",
    "registeredAgent", "officerName", "officerTitle", "sosFileNumber",
    "taxpayerId", "llcName", "ownerAddress", "phoneSource", "contactSource",
  ];

  const fieldsEnriched: string[] = [];
  const updates: Record<string, any> = {};
  const previousValues: Record<string, any> = {};

  const otherLeads = memberLeads.filter(l => l.id !== canonicalId);

  for (const field of enrichableFields) {
    if (!canonical[field] || (typeof canonical[field] === "string" && (canonical[field] as string).trim() === "")) {
      for (const other of otherLeads) {
        const val = other[field];
        if (val && (typeof val !== "string" || val.trim() !== "")) {
          updates[field] = val;
          previousValues[field] = canonical[field] ?? null;
          fieldsEnriched.push(field);
          break;
        }
      }
    }
  }

  let bestHailEvents = canonical.hailEvents;
  let bestLastHailDate = canonical.lastHailDate;
  let bestLastHailSize = canonical.lastHailSize;
  for (const other of otherLeads) {
    if (other.hailEvents > bestHailEvents) {
      bestHailEvents = other.hailEvents;
      updates.hailEvents = bestHailEvents;
    }
    if (other.lastHailDate && (!bestLastHailDate || other.lastHailDate > bestLastHailDate)) {
      bestLastHailDate = other.lastHailDate;
      updates.lastHailDate = bestLastHailDate;
      if (other.lastHailSize) {
        bestLastHailSize = other.lastHailSize;
        updates.lastHailSize = bestLastHailSize;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(leads).set(updates).where(eq(leads.id, canonicalId));
  }

  for (const other of otherLeads) {
    await db.update(leads).set({ status: "merged_duplicate" }).where(eq(leads.id, other.id));

    await db.update(portfolioLeads)
      .set({ leadId: canonicalId })
      .where(eq(portfolioLeads.leadId, other.id));

    await db.insert(entityMerges).values({
      clusterId: cluster.id,
      canonicalLeadId: canonicalId,
      mergedLeadId: other.id,
      fieldsApplied: updates,
      previousValues,
    });
  }

  await db.update(duplicateClusters)
    .set({ status: "merged", mergedAt: new Date() })
    .where(eq(duplicateClusters.id, clusterId));

  return { merged: otherLeads.length, fieldsEnriched };
}

export async function getEntityResolutionStats(marketId?: string) {
  const whereClause = marketId ? eq(duplicateClusters.marketId, marketId) : undefined;
  const clusters = await db.select().from(duplicateClusters).where(whereClause);

  const total = clusters.length;
  const pending = clusters.filter(c => c.status === "pending").length;
  const merged = clusters.filter(c => c.status === "merged").length;
  const skipped = clusters.filter(c => c.status === "skipped").length;
  const totalDuplicates = clusters.reduce((sum, c) => sum + (c.memberLeadIds.length - 1), 0);
  const deterministicClusters = clusters.filter(c => c.matchType === "deterministic").length;
  const probabilisticClusters = clusters.filter(c => c.matchType === "probabilistic").length;
  const avgConfidence = total > 0 ? Math.round(clusters.reduce((s, c) => s + c.matchConfidence, 0) / total) : 0;

  return {
    totalClusters: total,
    pendingClusters: pending,
    mergedClusters: merged,
    skippedClusters: skipped,
    totalDuplicates,
    deterministicClusters,
    probabilisticClusters,
    avgConfidence,
  };
}

export async function getClustersList(marketId?: string, status?: string, limit = 50, offset = 0) {
  let query = db.select().from(duplicateClusters);
  const conditions: any[] = [];
  if (marketId) conditions.push(eq(duplicateClusters.marketId, marketId));
  if (status) conditions.push(eq(duplicateClusters.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const clusters = await db.select().from(duplicateClusters)
    .where(where)
    .orderBy(sql`${duplicateClusters.matchConfidence} DESC`)
    .limit(limit)
    .offset(offset);

  const enriched = [];
  for (const cluster of clusters) {
    const memberLeads = await db.select({
      id: leads.id,
      address: leads.address,
      city: leads.city,
      ownerName: leads.ownerName,
      ownerType: leads.ownerType,
      sqft: leads.sqft,
      leadScore: leads.leadScore,
      ownerPhone: leads.ownerPhone,
      ownerEmail: leads.ownerEmail,
      contactName: leads.contactName,
      taxpayerId: leads.taxpayerId,
      sosFileNumber: leads.sosFileNumber,
      status: leads.status,
    }).from(leads).where(inArray(leads.id, cluster.memberLeadIds));

    enriched.push({
      ...cluster,
      leads: memberLeads,
    });
  }

  return enriched;
}

export async function skipCluster(clusterId: string) {
  await db.update(duplicateClusters)
    .set({ status: "skipped", reviewedAt: new Date() })
    .where(eq(duplicateClusters.id, clusterId));
}
