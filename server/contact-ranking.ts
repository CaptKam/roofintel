import { db } from "./storage";
import { contactEvidence } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface RankedContact {
  rank: number;
  evidenceId: string;
  contactType: string;
  value: string;
  displayValue: string;
  effectiveScore: number;
  reasons: string[];
  warnings: string[];
  lineType: string | null;
  carrierName: string | null;
  sourceName: string;
  sourceCount: number;
  validationStatus: string;
  isRecommended: boolean;
  ageInDays: number;
}

interface ContactPath {
  leadId: string;
  phones: RankedContact[];
  emails: RankedContact[];
  bestPhone: RankedContact | null;
  bestEmail: RankedContact | null;
  overallConfidence: "high" | "medium" | "low" | "none";
  warnings: string[];
}

const CONFIDENCE_DECAY_PER_MONTH = 0.05;
const MIN_SOURCES_FOR_RECOMMENDED = 2;

function computeDecayedScore(computedScore: number, extractedAt: Date | null): number {
  if (!extractedAt) return computedScore * 0.5;
  const monthsOld = (Date.now() - new Date(extractedAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
  const decayFactor = Math.max(0.1, 1 - (monthsOld * CONFIDENCE_DECAY_PER_MONTH));
  return computedScore * decayFactor;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length === 10) {
    return `(${last10.substring(0, 3)}) ${last10.substring(3, 6)}-${last10.substring(6)}`;
  }
  return value;
}

export async function buildContactPath(leadId: string): Promise<ContactPath> {
  const allEvidence = await db
    .select()
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, leadId),
        eq(contactEvidence.isActive, true)
      )
    );

  const activeEvidence = allEvidence.filter(ev => !ev.suppressedAt);

  const phoneEvidence = activeEvidence.filter(ev => ev.contactType === "PHONE");
  const emailEvidence = activeEvidence.filter(ev => ev.contactType === "EMAIL");

  const phoneGroups = groupByNormalized(phoneEvidence);
  const emailGroups = groupByNormalized(emailEvidence);

  const phones = rankContactGroup(phoneGroups, "PHONE");
  const emails = rankContactGroup(emailGroups, "EMAIL");

  const bestPhone = phones.length > 0 ? phones[0] : null;
  const bestEmail = emails.length > 0 ? emails[0] : null;

  const warnings: string[] = [];
  if (phones.length === 0) warnings.push("No phone numbers on file");
  if (emails.length === 0) warnings.push("No email addresses on file");
  if (bestPhone && !bestPhone.isRecommended) warnings.push("Best phone number has low confidence — single source only");
  if (bestPhone && bestPhone.ageInDays > 180) warnings.push("Best phone number is over 6 months old — may be stale");
  if (phones.every(p => p.validationStatus === "UNVERIFIED")) warnings.push("No phone numbers have been verified");

  let overallConfidence: "high" | "medium" | "low" | "none" = "none";
  if (bestPhone && bestPhone.effectiveScore >= 70 && bestPhone.isRecommended) overallConfidence = "high";
  else if (bestPhone && bestPhone.effectiveScore >= 40) overallConfidence = "medium";
  else if (bestPhone) overallConfidence = "low";

  return {
    leadId,
    phones,
    emails,
    bestPhone,
    bestEmail,
    overallConfidence,
    warnings,
  };
}

function groupByNormalized(evidence: any[]): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const ev of evidence) {
    const key = (ev.normalizedValue || ev.contactValue).toUpperCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }
  return groups;
}

function rankContactGroup(groups: Map<string, any[]>, contactType: string): RankedContact[] {
  const ranked: RankedContact[] = [];

  groups.forEach((evidences, normalizedValue) => {
    const bestEvidence = evidences.reduce((best: any, curr: any) =>
      (curr.computedScore ?? 0) > (best.computedScore ?? 0) ? curr : best
    );

    const sourceNames = Array.from(new Set(evidences.map((e: any) => e.sourceName)));
    const sourceCount = sourceNames.length;

    const baseScore = bestEvidence.computedScore ?? 50;
    let effectiveScore = computeDecayedScore(baseScore, bestEvidence.extractedAt);

    const reasons: string[] = [];
    const warnings: string[] = [];

    if (contactType === "PHONE") {
      if (bestEvidence.phoneLineType === "mobile") {
        effectiveScore *= 1.2;
        reasons.push("Mobile number (preferred)");
      } else if (bestEvidence.phoneLineType === "landline") {
        reasons.push("Landline");
      } else if (bestEvidence.phoneLineType === "voip") {
        effectiveScore *= 0.9;
        reasons.push("VoIP number");
      }
    }

    if (bestEvidence.validationStatus === "VERIFIED" || bestEvidence.validationStatus === "CONFIRMED") {
      effectiveScore *= 1.15;
      reasons.push("Verified");
    } else if (bestEvidence.validationStatus === "INVALID") {
      effectiveScore *= 0.1;
      warnings.push("Failed validation");
    } else {
      warnings.push("Unverified");
    }

    if (sourceCount >= MIN_SOURCES_FOR_RECOMMENDED) {
      effectiveScore *= 1.1;
      reasons.push(`Found in ${sourceCount} sources`);
    } else {
      warnings.push("Single source only");
    }

    const ageInDays = bestEvidence.extractedAt
      ? Math.floor((Date.now() - new Date(bestEvidence.extractedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    if (ageInDays > 365) warnings.push("Over 1 year old");
    else if (ageInDays > 180) warnings.push("Over 6 months old");
    else if (ageInDays <= 30) reasons.push("Recently found");

    if (bestEvidence.domainMatchFactor > 0) {
      effectiveScore *= 1.1;
      reasons.push("Matches org domain");
    }

    effectiveScore = Math.min(effectiveScore, 100);
    const isRecommended = sourceCount >= MIN_SOURCES_FOR_RECOMMENDED && effectiveScore >= 40 && bestEvidence.validationStatus !== "INVALID";

    ranked.push({
      rank: 0,
      evidenceId: bestEvidence.id,
      contactType,
      value: normalizedValue,
      displayValue: contactType === "PHONE" ? formatPhone(bestEvidence.contactValue) : bestEvidence.contactValue,
      effectiveScore: Math.round(effectiveScore * 10) / 10,
      reasons,
      warnings,
      lineType: bestEvidence.phoneLineType || null,
      carrierName: bestEvidence.carrierName || null,
      sourceName: sourceNames.join(", "),
      sourceCount,
      validationStatus: bestEvidence.validationStatus,
      isRecommended,
      ageInDays,
    });
  });

  ranked.sort((a, b) => b.effectiveScore - a.effectiveScore);
  ranked.forEach((item, i) => { item.rank = i + 1; });

  return ranked;
}
