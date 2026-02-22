import { db } from "./storage";
import { contactEvidence, conflictSets } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSourceTrust, computeEvidenceScore, computeRecencyFactor, CONFLICT_AUTO_RESOLVE_MARGIN } from "./config/sourceTrust";

export interface EvidenceInput {
  leadId: string;
  entityType?: string;
  entityId?: string;
  contactType: string;
  contactValue: string;
  normalizedValue?: string;
  isPublicBusiness?: boolean;
  sourceName: string;
  sourceUrl?: string;
  sourceType?: string;
  extractorMethod?: string;
  rawSnippet?: string;
  confidence?: number;
}

export async function recordEvidence(input: EvidenceInput): Promise<string> {
  const trust = getSourceTrust(input.sourceName);
  const now = new Date();
  const recencyFactor = computeRecencyFactor(now);
  const existing = await db
    .select()
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, input.leadId),
        eq(contactEvidence.contactType, input.contactType),
        eq(contactEvidence.contactValue, input.contactValue),
        eq(contactEvidence.sourceName, input.sourceName)
      )
    );

  if (existing.length > 0) {
    await db
      .update(contactEvidence)
      .set({
        extractedAt: now,
        confidence: input.confidence ?? trust.baseScore,
        sourceTrustScore: trust.baseScore,
        recencyFactor,
        computedScore: computeEvidenceScore({
          sourceTrustScore: trust.baseScore,
          recencyFactor,
          corroborationCount: existing[0].corroborationCount + 1,
          domainMatchFactor: existing[0].domainMatchFactor ?? 0,
          extractionQuality: existing[0].extractionQuality ?? 0.7,
        }),
        corroborationCount: existing[0].corroborationCount + 1,
        rawSnippet: input.rawSnippet || existing[0].rawSnippet,
        sourceUrl: input.sourceUrl || existing[0].sourceUrl,
      })
      .where(eq(contactEvidence.id, existing[0].id));
    return existing[0].id;
  }

  const corroborationCount = await countCorroboration(input.leadId, input.contactType, input.contactValue);
  const computedScore = computeEvidenceScore({
    sourceTrustScore: trust.baseScore,
    recencyFactor,
    corroborationCount: corroborationCount + 1,
    domainMatchFactor: 0,
    extractionQuality: 0.7,
  });

  const [row] = await db
    .insert(contactEvidence)
    .values({
      leadId: input.leadId,
      entityType: input.entityType || "LEAD",
      entityId: input.entityId || input.leadId,
      contactType: input.contactType,
      contactValue: input.contactValue,
      normalizedValue: input.normalizedValue || input.contactValue,
      isPublicBusiness: input.isPublicBusiness ?? true,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl || null,
      sourceType: input.sourceType || trust.type,
      extractorMethod: input.extractorMethod || "RULE",
      rawSnippet: input.rawSnippet || null,
      confidence: input.confidence ?? trust.baseScore,
      sourceTrustScore: trust.baseScore,
      recencyFactor,
      corroborationCount: corroborationCount + 1,
      domainMatchFactor: 0,
      extractionQuality: 0.7,
      computedScore,
      validationStatus: "UNVERIFIED",
    })
    .returning({ id: contactEvidence.id });

  return row.id;
}

export async function recordBatchEvidence(inputs: EvidenceInput[]): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) {
    try {
      const id = await recordEvidence(input);
      ids.push(id);
    } catch (err: any) {
      console.error(`[Evidence] Failed to record evidence for ${input.contactType}:${input.contactValue}:`, err.message);
    }
  }
  return ids;
}

async function countCorroboration(leadId: string, contactType: string, contactValue: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, leadId),
        eq(contactEvidence.contactType, contactType),
        eq(contactEvidence.contactValue, contactValue)
      )
    );
  return Number(rows[0]?.count || 0);
}

export async function detectAndStoreConflicts(leadId: string, contactType: string): Promise<void> {
  const allEvidence = await db
    .select()
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, leadId),
        eq(contactEvidence.contactType, contactType),
        eq(contactEvidence.isActive, true)
      )
    );

  const valueMap = new Map<string, typeof allEvidence>();
  for (const ev of allEvidence) {
    const norm = (ev.normalizedValue || ev.contactValue).toUpperCase().trim();
    if (!valueMap.has(norm)) valueMap.set(norm, []);
    valueMap.get(norm)!.push(ev);
  }

  if (valueMap.size <= 1) return;

  const candidates = Array.from(valueMap.entries()).map(([value, evidences]) => {
    const bestScore = Math.max(...evidences.map((e: any) => e.computedScore ?? 0));
    return { value, bestScore, evidenceIds: evidences.map((e: any) => e.id), count: evidences.length };
  }).sort((a, b) => b.bestScore - a.bestScore);

  const existing = await db
    .select()
    .from(conflictSets)
    .where(
      and(
        eq(conflictSets.leadId, leadId),
        eq(conflictSets.contactType, contactType)
      )
    );

  const margin = candidates.length >= 2 ? candidates[0].bestScore - candidates[1].bestScore : 100;
  const resolution = margin >= CONFLICT_AUTO_RESOLVE_MARGIN ? "AUTO_RESOLVED" : "UNRESOLVED";
  const winnerEvidenceId = resolution === "AUTO_RESOLVED" ? candidates[0].evidenceIds[0] : null;

  if (existing.length > 0) {
    await db
      .update(conflictSets)
      .set({
        candidateValues: candidates,
        resolution,
        winnerEvidenceId,
        scoreMargin: margin,
        updatedAt: new Date(),
      })
      .where(eq(conflictSets.id, existing[0].id));
  } else {
    await db
      .insert(conflictSets)
      .values({
        leadId,
        contactType,
        candidateValues: candidates,
        resolution,
        winnerEvidenceId,
        scoreMargin: margin,
      });
  }
}

export async function getEvidenceForLead(leadId: string): Promise<any[]> {
  return db
    .select()
    .from(contactEvidence)
    .where(eq(contactEvidence.leadId, leadId));
}

export async function getConflictsForLead(leadId: string): Promise<any[]> {
  return db
    .select()
    .from(conflictSets)
    .where(eq(conflictSets.leadId, leadId));
}

export async function resolveConflict(conflictId: string, pickedEvidenceId: string, resolvedBy: string): Promise<void> {
  const [conflict] = await db
    .select()
    .from(conflictSets)
    .where(eq(conflictSets.id, conflictId));

  if (!conflict) throw new Error("Conflict set not found");

  const existingTrail = (conflict.auditTrail as any[]) || [];
  existingTrail.push({
    action: "manual_resolve",
    previousResolution: conflict.resolution,
    previousWinner: conflict.winnerEvidenceId,
    newWinner: pickedEvidenceId,
    resolvedBy,
    resolvedAt: new Date().toISOString(),
  });

  await db
    .update(conflictSets)
    .set({
      resolution: "MANUAL_RESOLVED",
      winnerEvidenceId: pickedEvidenceId,
      resolvedBy,
      resolvedAt: new Date(),
      auditTrail: existingTrail,
      updatedAt: new Date(),
    })
    .where(eq(conflictSets.id, conflictId));
}
