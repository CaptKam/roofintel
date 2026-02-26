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

async function runOwnerIntelligenceStep(lead: Lead, progress: EnrichmentProgress, options?: { skipPaidApis?: boolean }): Promise<Lead> {
  updateStep(progress, 0, "running");
  try {
    if (!lead.ownerName) {
      updateStep(progress, 0, "skipped", "No owner name for intelligence lookup");
      return lead;
    }
    const { runOwnerIntelligence } = await import("./owner-intelligence");
    const result = await runOwnerIntelligence(lead, { skipPaidApis: options?.skipPaidApis ?? true });

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

async function runReverseAddressStep(lead: Lead, progress: EnrichmentProgress, options?: { skipPaidApis?: boolean }): Promise<Lead> {
  updateStep(progress, 1, "running");
  try {
    if (options?.skipPaidApis) {
      updateStep(progress, 1, "skipped", "Skipped (paid API — use manual Google Places enrich)");
      return lead;
    }
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

async function runBuildingDiscoveryStep(lead: Lead, progress: EnrichmentProgress, options?: { skipPaidApis?: boolean }): Promise<Lead> {
  updateStep(progress, 2, "running");
  try {
    if (options?.skipPaidApis) {
      updateStep(progress, 2, "skipped", "Skipped (paid API — use manual Google Places enrich)");
      return lead;
    }
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

async function runPhoneEnrichmentStep(lead: Lead, progress: EnrichmentProgress, options?: { skipPaidApis?: boolean }): Promise<Lead> {
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

    const freshLead = await fetchLead(lead.id);
    const phoneCandidate = freshLead || lead;

    const freeOnly = options?.skipPaidApis ?? true;
    const { enrichSingleLeadPhone } = await import("./phone-enrichment");
    const result = await enrichSingleLeadPhone(phoneCandidate, { freeOnly });

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

export async function enrichLead(leadId: string, options?: { skipPaidApis?: boolean }): Promise<EnrichmentProgress> {
  const skipPaid = options?.skipPaidApis ?? true;
  const existing = activeEnrichments.get(leadId);
  if (existing && existing.status === "running") {
    return existing;
  }

  let lead = await fetchLead(leadId);
  if (!lead) {
    return { leadId, status: "error", steps: [], completedAt: new Date().toISOString() };
  }

  await db.update(leads).set({
    enrichmentStatus: "running",
    phoneEnrichedAt: null,
    lastEnrichedAt: null,
  } as any).where(eq(leads.id, leadId));

  lead = await fetchLead(leadId);
  if (!lead) {
    return { leadId, status: "error", steps: [], completedAt: new Date().toISOString() };
  }

  const progress = initProgress(leadId);
  activeEnrichments.set(leadId, progress);

  const mode = skipPaid ? "free sources only" : "all agents (including paid)";
  console.log(`[Orchestrator] Starting enrichment for ${leadId} — ${mode}`);

  (async () => {
    try {
      lead = await runOwnerIntelligenceStep(lead!, progress, { skipPaidApis: skipPaid });
      lead = await runReverseAddressStep(lead, progress, { skipPaidApis: skipPaid });
      lead = await runBuildingDiscoveryStep(lead, progress, { skipPaidApis: skipPaid });
      lead = await runAttributionStep(lead, progress);
      lead = await runRoleInferenceStep(lead, progress);
      lead = await runConfidenceScoringStep(lead, progress);
      lead = await runPhoneEnrichmentStep(lead, progress, { skipPaidApis: skipPaid });

      progress.status = "complete";
      progress.completedAt = new Date().toISOString();

      await db.update(leads).set({
        lastEnrichedAt: new Date(),
        enrichmentStatus: "complete",
      } as any).where(eq(leads.id, leadId));

      console.log(`[Orchestrator] Lead ${leadId} enrichment complete (${mode})`);
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

export async function enrichLeadPaidApis(leadId: string): Promise<{ googlePlaces: any; serper: any; phone: any }> {
  let lead = await fetchLead(leadId);
  if (!lead) throw new Error("Lead not found");

  console.log(`[Orchestrator] Running PAID API enrichment for ${leadId} (${lead.ownerName})`);

  const results: { googlePlaces: any; serper: any; phone: any } = {
    googlePlaces: { steps: [] as string[] },
    serper: { steps: [] as string[] },
    phone: null,
  };

  if (process.env.GOOGLE_PLACES_API_KEY) {
    if (lead.ownerAddress && !lead.reverseAddressEnrichedAt) {
      try {
        const { enrichLeadReverseAddress } = await import("./reverse-address-enrichment");
        const reverseResult = await enrichLeadReverseAddress(lead);
        if (reverseResult) {
          const updates: any = {
            reverseAddressType: reverseResult.addressType,
            reverseAddressBusinesses: reverseResult.businesses,
            reverseAddressEnrichedAt: new Date(),
          };
          const mgmtBiz = reverseResult.businesses.find((b: any) => b.classification === "management_company");
          if (mgmtBiz) {
            if (!lead.managementCompany) updates.managementCompany = mgmtBiz.name;
            if (mgmtBiz.phone && !lead.managementPhone) updates.managementPhone = mgmtBiz.phone;
          }
          await db.update(leads).set(updates).where(eq(leads.id, leadId));
          results.googlePlaces.steps.push(`Reverse address: ${reverseResult.addressType}`);
        }
      } catch (err: any) {
        results.googlePlaces.steps.push(`Reverse address error: ${err.message}`);
      }
    }

    if (lead.latitude && lead.longitude) {
      try {
        const { googlePlacesEnhancedAgent } = await import("./social-intel-agents");
        const gpeResult = await googlePlacesEnhancedAgent(lead);
        const updates: any = {};
        if (gpeResult.contacts.length > 0) {
          const mgmt = gpeResult.contacts.find((c: any) => c.role === "property_manager" || c.role === "building_manager");
          if (mgmt) {
            if (!lead.managementCompany) updates.managementCompany = mgmt.company;
            if (mgmt.phone && !lead.managementPhone) updates.managementPhone = mgmt.phone;
          }
        }
        if (gpeResult.people.length > 0 && !lead.contactName) {
          const best = gpeResult.people.sort((a: any, b: any) => b.confidence - a.confidence)[0];
          updates.contactName = best.name;
          if (best.title) updates.contactTitle = best.title;
        }
        if (Object.keys(updates).length > 0) {
          await db.update(leads).set(updates).where(eq(leads.id, leadId));
        }
        results.googlePlaces.steps.push(`Building discovery: ${gpeResult.contacts.length} contacts, ${gpeResult.people.length} people`);
      } catch (err: any) {
        results.googlePlaces.steps.push(`Building discovery error: ${err.message}`);
      }
    }

    try {
      lead = await fetchLead(leadId) || lead;
      const { runOwnerIntelligence } = await import("./owner-intelligence");
      const googleBusinessResult = await (await import("./owner-intelligence")).googleBusinessAgentOnly(lead);
      if (googleBusinessResult) {
        results.googlePlaces.steps.push(`Google Business: ${googleBusinessResult.detail}`);
      }
    } catch {}
  }

  lead = await fetchLead(leadId) || lead;
  if (!lead.ownerPhone) {
    try {
      const { enrichSingleLeadPhonePaidOnly } = await import("./phone-enrichment");
      const phoneResult = await enrichSingleLeadPhonePaidOnly(lead);
      if (phoneResult) {
        await db.update(leads).set({
          ownerPhone: phoneResult.phone,
          phoneSource: phoneResult.source,
          phoneEnrichedAt: new Date(),
        } as any).where(eq(leads.id, leadId));
        results.phone = phoneResult;
      }
    } catch (err: any) {
      results.phone = { error: err.message };
    }
  }

  await db.update(leads).set({ lastEnrichedAt: new Date() } as any).where(eq(leads.id, leadId));
  console.log(`[Orchestrator] Paid API enrichment complete for ${leadId}`);
  return results;
}

let batchFreeStatus: { running: boolean; total: number; processed: number; enriched: number; errors: number; currentLead?: string; startedAt?: string } = {
  running: false, total: 0, processed: 0, enriched: 0, errors: 0,
};

export function getBatchFreeStatus() {
  return { ...batchFreeStatus };
}

export async function runBatchFreeEnrichment(): Promise<void> {
  if (batchFreeStatus.running) throw new Error("Batch enrichment already running");

  const { leads: allLeads } = await (await import("./storage")).storage.getLeads();
  const eligible = allLeads.filter(l => !l.lastEnrichedAt && l.ownerName);

  batchFreeStatus = {
    running: true,
    total: eligible.length,
    processed: 0,
    enriched: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
  };

  console.log(`[Batch Free Enrichment] Starting full pipeline for ${eligible.length} unenriched leads`);
  console.log(`[Batch Free Enrichment] Pipeline: Owner Intelligence → Management Attribution → Role Inference → Confidence Scoring → Phone Enrichment`);

  (async () => {
    for (const lead of eligible) {
      try {
        batchFreeStatus.currentLead = `${lead.address} (${lead.ownerName})`;

        const progress = initProgress(lead.id);
        let current: Lead = lead;

        current = await runOwnerIntelligenceStep(current, progress, { skipPaidApis: true });

        current = await runAttributionStep(current, progress);

        current = await runRoleInferenceStep(current, progress);

        current = await runConfidenceScoringStep(current, progress);

        current = await runPhoneEnrichmentStep(current, progress, { skipPaidApis: true });

        await db.update(leads).set({
          lastEnrichedAt: new Date(),
          enrichmentStatus: "complete",
        } as any).where(eq(leads.id, lead.id));

        batchFreeStatus.enriched++;
      } catch (err: any) {
        console.error(`[Batch Free] Error enriching ${lead.id}:`, err.message);
        batchFreeStatus.errors++;
      }

      batchFreeStatus.processed++;

      if (batchFreeStatus.processed % 25 === 0) {
        console.log(`[Batch Free Enrichment] Progress: ${batchFreeStatus.processed}/${batchFreeStatus.total} (${batchFreeStatus.enriched} enriched, ${batchFreeStatus.errors} errors)`);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    batchFreeStatus.running = false;
    batchFreeStatus.currentLead = undefined;
    console.log(`[Batch Free Enrichment] Complete: ${batchFreeStatus.enriched} enriched, ${batchFreeStatus.errors} errors out of ${batchFreeStatus.total}`);
  })();
}

export function getEnrichmentProgress(leadId: string): EnrichmentProgress | null {
  return activeEnrichments.get(leadId) || null;
}
