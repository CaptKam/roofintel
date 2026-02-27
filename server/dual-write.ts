import { storage } from "./storage";
import type { Lead } from "@shared/schema";

const ROOF_FIELDS = new Set([
  "roofType", "roofMaterial", "roofLastReplaced", "estimatedRoofArea",
  "lastRoofingPermitDate", "lastRoofingContractor", "lastRoofingPermitType",
  "claimWindowOpen", "roofRiskIndex", "roofRiskBreakdown",
]);

const OWNER_FIELDS = new Set([
  "ownerName", "ownerType", "ownerAddress", "ownerPhone", "ownerEmail",
  "phoneSource", "phoneEnrichedAt", "llcName", "registeredAgent",
  "officerName", "officerTitle", "sosFileNumber", "taxpayerId",
  "managingMember", "managingMemberTitle", "managingMemberPhone", "managingMemberEmail",
  "llcChain", "ownershipFlag", "ownershipStructure", "ownershipSignals",
]);

const RISK_FIELDS = new Set([
  "hailEvents", "lastHailDate", "lastHailSize", "floodZone", "floodZoneSubtype",
  "isFloodHighRisk", "lienCount", "foreclosureFlag", "taxDelinquent",
  "violationCount", "openViolations", "lastViolationDate", "permitCount",
  "lastPermitDate", "permitContractors", "distressScore", "lastDeedDate",
]);

const CONTACTS_FIELDS = new Set([
  "contactName", "contactTitle", "contactPhone", "contactEmail",
  "contactSource", "contactRole", "roleConfidence", "decisionMakerRank",
  "roleEvidence", "dmConfidenceScore", "dmConfidenceComponents", "dmReviewStatus",
  "decisionMakers", "managementCompany", "managementContact", "managementPhone",
  "managementEmail", "managementEvidence", "managementAttributedAt",
  "reverseAddressType", "reverseAddressBusinesses", "reverseAddressEnrichedAt",
]);

const INTEL_FIELDS = new Set([
  "ownerIntelligence", "intelligenceScore", "intelligenceSources",
  "buildingContacts", "intelligenceAt", "businessName", "businessWebsite",
  "webResearchedAt",
]);

function hasOverlap(updates: Record<string, any>, fieldSet: Set<string>): boolean {
  return Object.keys(updates).some(k => fieldSet.has(k));
}

function pick(updates: Record<string, any>, fieldSet: Set<string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(updates)) {
    if (fieldSet.has(key)) {
      result[key] = updates[key];
    }
  }
  return result;
}

export async function dualWriteUpdate(
  leadId: string,
  updates: Partial<Lead>,
  source?: string
): Promise<Lead | undefined> {
  const result = await storage.updateLead(leadId, updates);

  const lead = result || await storage.getLeadById(leadId);
  const marketId = lead?.marketId ?? null;

  try {
    const promises: Promise<any>[] = [];

    if (hasOverlap(updates as any, ROOF_FIELDS)) {
      const roofData = pick(updates as any, ROOF_FIELDS);
      promises.push(storage.upsertPropertyRoof({
        propertyId: leadId,
        marketId,
        source: source || "dual_write",
        ...roofData,
      }));
    }

    if (hasOverlap(updates as any, OWNER_FIELDS)) {
      const ownerData = pick(updates as any, OWNER_FIELDS);
      if (!ownerData.ownerName) ownerData.ownerName = lead?.ownerName || "Unknown";
      if (!ownerData.ownerType) ownerData.ownerType = lead?.ownerType || "Unknown";
      promises.push(storage.upsertPropertyOwner({
        propertyId: leadId,
        marketId,
        source: source || "dual_write",
        ...ownerData,
      }));
    }

    if (hasOverlap(updates as any, RISK_FIELDS)) {
      const riskData = pick(updates as any, RISK_FIELDS);
      promises.push(storage.upsertPropertyRiskSignals({
        propertyId: leadId,
        marketId,
        source: source || "dual_write",
        ...riskData,
      }));
    }

    if (hasOverlap(updates as any, CONTACTS_FIELDS)) {
      const contactData = pick(updates as any, CONTACTS_FIELDS);
      promises.push(storage.upsertPropertyContacts({
        propertyId: leadId,
        marketId,
        source: source || "dual_write",
        ...contactData,
      }));
    }

    if (hasOverlap(updates as any, INTEL_FIELDS)) {
      const intelData = pick(updates as any, INTEL_FIELDS);
      promises.push(storage.upsertPropertyIntelligence({
        propertyId: leadId,
        marketId,
        source: source || "dual_write",
        ...intelData,
      }));
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  } catch (err: any) {
    console.error(`[dual-write] Satellite write failed for lead ${leadId}:`, err.message);
  }

  return result;
}
