import { db } from "./storage";
import { leads } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface EnrichmentStep {
  name: string;
  status: "pending" | "running" | "complete" | "skipped" | "error";
  detail?: string;
}

export interface EnrichmentProgress {
  leadId: string;
  status: "pending" | "running" | "complete" | "error";
  steps: EnrichmentStep[];
  startedAt?: string;
  completedAt?: string;
}

const activeEnrichments = new Map<string, EnrichmentProgress>();

const STEP_NAMES = [
  "Owner Intelligence (16 Agents)",
  "Reverse Address Lookup",
  "Building Tenant & Manager Discovery",
  "Management Attribution",
  "Role Inference",
  "Confidence Scoring",
  "Phone Enrichment",
];

function initProgress(leadId: string): EnrichmentProgress {
  return {
    leadId,
    status: "running",
    steps: STEP_NAMES.map(name => ({ name, status: "pending" })),
    startedAt: new Date().toISOString(),
  };
}

function updateStep(progress: EnrichmentProgress, stepIndex: number, status: EnrichmentStep["status"], detail?: string) {
  if (progress.steps[stepIndex]) {
    progress.steps[stepIndex].status = status;
    if (detail) progress.steps[stepIndex].detail = detail;
  }
}

async function fetchLead(leadId: string): Promise<Lead | null> {
  const rows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  return rows[0] || null;
}

async function runOwnerIntelligenceStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 0, "running");
  try {
    if (!lead.ownerName) {
      updateStep(progress, 0, "skipped", "No owner name for intelligence lookup");
      return lead;
    }
    const { runOwnerIntelligence } = await import("./owner-intelligence");
    const result = await runOwnerIntelligence(lead);

    const updates: any = {
      ownerIntelligence: result.dossier,
      intelligenceScore: result.score,
      intelligenceSources: result.sources,
      intelligenceAt: new Date(),
    };
    if (result.managingMember && !lead.contactName) updates.contactName = result.managingMember;
    if (result.managingMemberTitle) updates.contactRole = result.managingMemberTitle;
    if (result.managingMemberPhone && !lead.ownerPhone) updates.ownerPhone = result.managingMemberPhone;
    if (result.managingMemberEmail && !lead.ownerEmail) updates.ownerEmail = result.managingMemberEmail;
    if (result.llcChain && result.llcChain.length > 0) updates.llcChain = result.llcChain;

    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    const detail = `${result.dossier.realPeople?.length || 0} people, score: ${result.score}/100, ${result.sources.length} sources`;
    updateStep(progress, 0, "complete", detail);
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 0, "error", err.message);
    return lead;
  }
}

async function runReverseAddressStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 1, "running");
  try {
    if (!lead.ownerAddress || lead.reverseAddressEnrichedAt) {
      updateStep(progress, 1, "skipped", lead.reverseAddressEnrichedAt ? "Already enriched" : "No owner address");
      return lead;
    }
    const { enrichLeadReverseAddress } = await import("./reverse-address-enrichment");
    const result = await enrichLeadReverseAddress(lead);
    if (!result) {
      updateStep(progress, 1, "skipped", "Same address as property");
      await db.update(leads).set({
        reverseAddressType: "same_as_property",
        reverseAddressEnrichedAt: new Date(),
      } as any).where(eq(leads.id, lead.id));
      return (await fetchLead(lead.id)) || lead;
    }

    const updates: any = {
      reverseAddressType: result.addressType,
      reverseAddressBusinesses: result.businesses,
      reverseAddressEnrichedAt: new Date(),
    };

    const mgmtBiz = result.businesses.find(b => b.classification === "management_company");
    if (mgmtBiz) {
      if (!lead.managementCompany) updates.managementCompany = mgmtBiz.name;
      if (mgmtBiz.phone && !lead.managementPhone) updates.managementPhone = mgmtBiz.phone;
      const existingEvidence = Array.isArray(lead.managementEvidence) ? (lead.managementEvidence as any[]) : [];
      if (!existingEvidence.some((e: any) => e.source === "reverse_address")) {
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
    updateStep(progress, 1, "complete", `Found: ${result.addressType.replace(/_/g, " ")}`);
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 1, "error", err.message);
    return lead;
  }
}

async function runBuildingDiscoveryStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 2, "running");
  try {
    if (!lead.latitude || !lead.longitude) {
      updateStep(progress, 2, "skipped", "No coordinates for nearby search");
      return lead;
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      updateStep(progress, 2, "skipped", "No Google Places API key");
      return lead;
    }

    const { googlePlacesEnhancedAgent } = await import("./social-intel-agents");
    const result = await googlePlacesEnhancedAgent(lead);

    const updates: any = {};
    if (result.contacts.length > 0) {
      const mgmtContact = result.contacts.find(c => c.role === "property_manager" || c.role === "building_manager");
      if (mgmtContact) {
        if (!lead.managementCompany) updates.managementCompany = mgmtContact.company;
        if (mgmtContact.phone && !lead.managementPhone) updates.managementPhone = mgmtContact.phone;
      }
    }

    if (result.people.length > 0 && !lead.contactName) {
      const best = result.people.sort((a, b) => b.confidence - a.confidence)[0];
      updates.contactName = best.name;
      if (best.title) updates.contactTitle = best.title;
      if (best.phone && !lead.ownerPhone) updates.ownerPhone = best.phone;
      if (best.email && !lead.ownerEmail) updates.ownerEmail = best.email;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    }

    const detail = `${result.contacts.length} building contacts, ${result.people.length} people`;
    updateStep(progress, 2, "complete", detail);
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 2, "error", err.message);
    return lead;
  }
}

async function runAttributionStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 3, "running");
  try {
    if (lead.managementCompany && lead.managementEvidence) {
      updateStep(progress, 3, "skipped", "Already attributed");
      return lead;
    }
    const { attributeLeadManagement } = await import("./management-attribution");
    const result = await attributeLeadManagement(lead);

    if (result.evidence.length > 0) {
      const updates: any = {
        managementEvidence: result.evidence,
        managementAttributedAt: new Date(),
      };
      if (result.managementCompany) updates.managementCompany = result.managementCompany;
      if (result.managementContact) updates.managementContact = result.managementContact;
      if (result.managementPhone) updates.managementPhone = result.managementPhone;
      if (result.managementEmail) updates.managementEmail = result.managementEmail;

      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
      updateStep(progress, 3, "complete", result.managementCompany ? `Found: ${result.managementCompany}` : `${result.evidence.length} evidence items`);
    } else {
      updateStep(progress, 3, "complete", "No management company found");
    }
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 3, "error", err.message);
    return lead;
  }
}

async function runRoleInferenceStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 4, "running");
  try {
    if (lead.contactRole && lead.contactRole !== "Unknown" && lead.roleConfidence && lead.roleConfidence > 30) {
      updateStep(progress, 4, "skipped", `Already: ${lead.contactRole} (${lead.roleConfidence}%)`);
      return lead;
    }
    const { inferLeadRoles } = await import("./role-inference");
    const candidates = await inferLeadRoles(lead);

    if (candidates.length > 0) {
      const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      const updates: any = {
        contactRole: best.role,
        roleConfidence: best.confidence,
        decisionMakerRank: 1,
        roleEvidence: best.evidence,
      };
      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
      updateStep(progress, 4, "complete", `${best.role} (${best.confidence}%)`);
    } else {
      updateStep(progress, 4, "complete", "Insufficient data for role inference");
    }
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 4, "error", err.message);
    return lead;
  }
}

async function runConfidenceScoringStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 5, "running");
  try {
    const { computeDecisionMakerConfidence } = await import("./dm-confidence");
    const result = computeDecisionMakerConfidence(lead);

    const reviewUpdates: any = {
      dmConfidenceScore: result.overallScore,
      dmConfidenceComponents: result.components,
    };
    const currentReview = lead.dmReviewStatus;
    if (!currentReview || currentReview === "unreviewed") {
      reviewUpdates.dmReviewStatus = result.tier === "auto_publish" ? "auto_approved" :
        result.tier === "suppress" ? "auto_suppressed" : "pending_review";
    }

    await db.update(leads).set(reviewUpdates).where(eq(leads.id, lead.id));
    updateStep(progress, 5, "complete", `Score: ${result.overallScore}/100 (${result.tier})`);
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 5, "error", err.message);
    return lead;
  }
}

async function runPhoneEnrichmentStep(lead: Lead, progress: EnrichmentProgress): Promise<Lead> {
  updateStep(progress, 6, "running");
  try {
    if (lead.ownerPhone || lead.phoneEnrichedAt) {
      updateStep(progress, 6, "skipped", lead.ownerPhone ? "Phone already exists" : "Already attempted");
      return lead;
    }
    if (!lead.ownerName) {
      updateStep(progress, 6, "skipped", "No owner name for lookup");
      return lead;
    }

    const { enrichSingleLeadPhone } = await import("./phone-enrichment");
    const result = await enrichSingleLeadPhone(lead);

    if (result) {
      await db.update(leads).set({
        ownerPhone: result.phone,
        phoneEnrichedAt: new Date(),
        phoneSource: result.source,
      } as any).where(eq(leads.id, lead.id));
      updateStep(progress, 6, "complete", `Found: ${result.phone} (${result.source})`);
    } else {
      await db.update(leads).set({ phoneEnrichedAt: new Date() } as any).where(eq(leads.id, lead.id));
      updateStep(progress, 6, "complete", "No phone found");
    }
    return (await fetchLead(lead.id)) || lead;
  } catch (err: any) {
    updateStep(progress, 6, "error", err.message);
    return lead;
  }
}

export async function enrichLead(leadId: string): Promise<EnrichmentProgress> {
  const existing = activeEnrichments.get(leadId);
  if (existing && existing.status === "running") {
    return existing;
  }

  let lead = await fetchLead(leadId);
  if (!lead) {
    return { leadId, status: "error", steps: [], completedAt: new Date().toISOString() };
  }

  await db.update(leads).set({ enrichmentStatus: "running" } as any).where(eq(leads.id, leadId));

  const progress = initProgress(leadId);
  activeEnrichments.set(leadId, progress);

  (async () => {
    try {
      lead = await runOwnerIntelligenceStep(lead!, progress);
      lead = await runReverseAddressStep(lead, progress);
      lead = await runBuildingDiscoveryStep(lead, progress);
      lead = await runAttributionStep(lead, progress);
      lead = await runRoleInferenceStep(lead, progress);
      lead = await runConfidenceScoringStep(lead, progress);
      lead = await runPhoneEnrichmentStep(lead, progress);

      progress.status = "complete";
      progress.completedAt = new Date().toISOString();

      await db.update(leads).set({
        lastEnrichedAt: new Date(),
        enrichmentStatus: "complete",
      } as any).where(eq(leads.id, leadId));

      console.log(`[Orchestrator] Lead ${leadId} enrichment complete`);
    } catch (err: any) {
      progress.status = "error";
      progress.completedAt = new Date().toISOString();
      await db.update(leads).set({ enrichmentStatus: "error" } as any).where(eq(leads.id, leadId));
      console.error(`[Orchestrator] Lead ${leadId} enrichment failed:`, err.message);
    } finally {
      setTimeout(() => activeEnrichments.delete(leadId), 60000);
    }
  })();

  return progress;
}

export function getEnrichmentProgress(leadId: string): EnrichmentProgress | null {
  return activeEnrichments.get(leadId) || null;
}
