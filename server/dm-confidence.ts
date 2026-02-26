import { db } from "./storage";
import { leads, buildingPermits, intelligenceClaims, recordedDocuments, decisionMakerReviews } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

interface ConfidenceComponents {
  propertyMatch: number;
  ownerMatch: number;
  managementMatch: number;
  personRoleFit: number;
  contactReachability: number;
  conflictPenalty: number;
  stalenessPenalty: number;
}

interface ConfidenceResult {
  overallScore: number;
  components: ConfidenceComponents;
  tier: "auto_publish" | "review" | "suppress";
  explanation: string[];
}

const WEIGHTS = {
  propertyMatch: 0.20,
  ownerMatch: 0.25,
  managementMatch: 0.15,
  personRoleFit: 0.20,
  contactReachability: 0.10,
  conflictPenalty: 0.05,
  stalenessPenalty: 0.05,
};

function computePropertyMatch(lead: Lead): { score: number; explanations: string[] } {
  let score = 0;
  const explanations: string[] = [];

  if (lead.latitude && lead.longitude) {
    score += 30;
    explanations.push("Geocoded property location");
  }
  if (lead.address) {
    score += 20;
    explanations.push("Address present");
  }
  if (lead.sqft && lead.sqft > 0) {
    score += 15;
    explanations.push("Square footage known");
  }
  if (lead.yearBuilt && lead.yearBuilt > 1900) {
    score += 15;
    explanations.push("Year built known");
  }
  if (lead.sourceType === "dcad_api") {
    score += 20;
    explanations.push("Verified via DCAD API");
  } else if (lead.sourceId) {
    score += 10;
    explanations.push("Has source ID");
  }

  return { score: Math.min(100, score), explanations };
}

function computeOwnerMatch(lead: Lead): { score: number; explanations: string[] } {
  let score = 0;
  const explanations: string[] = [];

  if (lead.ownerName) {
    score += 20;
    explanations.push("Owner name on record");
  }
  if (lead.taxpayerId) {
    score += 25;
    explanations.push("Taxpayer ID verified");
  }
  if (lead.sosFileNumber) {
    score += 20;
    explanations.push("SOS file number linked");
  }
  if (lead.officerName) {
    score += 15;
    explanations.push("Corporate officer identified");
  }
  if (lead.llcChain && Array.isArray(lead.llcChain) && (lead.llcChain as any[]).length > 0) {
    score += 10;
    explanations.push("LLC chain mapped");
  }
  if (lead.ownerAddress) {
    score += 10;
    explanations.push("Owner mailing address known");
  }

  return { score: Math.min(100, score), explanations };
}

function computeManagementMatch(lead: Lead): { score: number; explanations: string[] } {
  let score = 0;
  const explanations: string[] = [];

  if (lead.managementCompany) {
    score += 35;
    explanations.push(`Management company: ${lead.managementCompany}`);
  }
  if (lead.managementContact) {
    score += 25;
    explanations.push("Management contact identified");
  }
  if (lead.managementEvidence && Array.isArray(lead.managementEvidence)) {
    const evidenceCount = (lead.managementEvidence as any[]).length;
    score += Math.min(20, evidenceCount * 5);
    explanations.push(`${evidenceCount} evidence sources`);
    const sources = new Set((lead.managementEvidence as any[]).map(e => e.source));
    if (sources.size >= 2) {
      score += 20;
      explanations.push("Triangulated across multiple sources");
    }
  }

  return { score: Math.min(100, score), explanations };
}

function computePersonRoleFit(lead: Lead): { score: number; explanations: string[] } {
  let score = 0;
  const explanations: string[] = [];

  if (lead.contactRole && lead.contactRole !== "Unknown") {
    score += 30;
    explanations.push(`Role: ${lead.contactRole}`);
  }
  if (lead.roleConfidence) {
    score += Math.min(40, lead.roleConfidence * 0.5);
    explanations.push(`Role confidence: ${lead.roleConfidence}%`);
  }
  if (lead.decisionMakerRank && lead.decisionMakerRank <= 3) {
    score += 20;
    explanations.push("High-authority decision maker");
  }
  if (lead.contactTitle) {
    score += 10;
    explanations.push(`Title: ${lead.contactTitle}`);
  }

  return { score: Math.min(100, score), explanations };
}

function computeContactReachability(lead: Lead): { score: number; explanations: string[] } {
  let score = 0;
  const explanations: string[] = [];

  const phones = [lead.ownerPhone, lead.contactPhone, lead.managingMemberPhone, lead.managementPhone].filter(Boolean);
  const emails = [lead.ownerEmail, lead.contactEmail, lead.managingMemberEmail, lead.managementEmail].filter(Boolean);

  if (lead.ownerName) {
    score += 15;
    explanations.push("Owner identity known");
  }
  if (lead.ownerAddress) {
    score += 10;
    explanations.push("Mailing address available");
  }
  if (phones.length > 0) {
    score += 25 + Math.min(15, (phones.length - 1) * 10);
    explanations.push(`${phones.length} phone number(s)`);
  }
  if (emails.length > 0) {
    score += 20 + Math.min(10, (emails.length - 1) * 7);
    explanations.push(`${emails.length} email(s)`);
  }
  if (lead.businessWebsite) {
    score += 10;
    explanations.push("Business website known");
  }

  if (lead.consentStatus === "granted") {
    score += 10;
    explanations.push("Consent granted");
  } else if (lead.consentStatus === "denied" || lead.consentStatus === "revoked") {
    score = Math.max(0, score - 20);
    explanations.push("Consent denied/revoked");
  }

  return { score: Math.min(100, score), explanations };
}

function computeConflictPenalty(lead: Lead): { score: number; explanations: string[] } {
  let penalty = 0;
  const explanations: string[] = [];

  if (lead.ownershipFlag === "complex" || lead.ownershipFlag === "disputed") {
    penalty += 40;
    explanations.push("Complex/disputed ownership");
  }

  if (lead.roleEvidence && Array.isArray(lead.roleEvidence)) {
    const roles = new Set((lead.roleEvidence as any[]).map(e => e.role).filter(Boolean));
    if (roles.size > 2) {
      penalty += 20;
      explanations.push(`${roles.size} competing role hypotheses`);
    }
  }

  if (lead.managementCompany && lead.ownerName &&
      lead.managementCompany.toLowerCase() !== lead.ownerName.toLowerCase()) {
    const hasManagementEvidence = lead.managementEvidence && Array.isArray(lead.managementEvidence) && (lead.managementEvidence as any[]).length > 0;
    if (!hasManagementEvidence) {
      penalty += 15;
      explanations.push("Management company without evidence");
    }
  }

  return { score: Math.min(100, penalty), explanations };
}

function computeStalenessPenalty(lead: Lead): { score: number; explanations: string[] } {
  let penalty = 0;
  const explanations: string[] = [];
  const now = Date.now();

  const dates: { label: string; date: Date | null }[] = [
    { label: "intelligence", date: lead.intelligenceAt },
    { label: "web_research", date: lead.webResearchedAt },
    { label: "contact_enrichment", date: lead.contactEnrichedAt },
    { label: "management_attribution", date: lead.managementAttributedAt },
    { label: "phone_enrichment", date: lead.phoneEnrichedAt },
  ];

  const validDates = dates.filter(d => d.date).map(d => ({
    label: d.label,
    ageMs: now - (d.date as Date).getTime(),
    ageDays: Math.floor((now - (d.date as Date).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  if (validDates.length === 0) {
    penalty = 20;
    explanations.push("No enrichment timestamps yet");
  } else {
    const oldestDays = Math.max(...validDates.map(d => d.ageDays));
    const newestDays = Math.min(...validDates.map(d => d.ageDays));

    if (newestDays > 365) {
      penalty = 50;
      explanations.push("All data older than 1 year");
    } else if (newestDays > 180) {
      penalty = 30;
      explanations.push("Most recent data is 6+ months old");
    } else if (newestDays > 90) {
      penalty = 15;
      explanations.push("Most recent data is 3+ months old");
    } else if (newestDays > 30) {
      penalty = 5;
      explanations.push("Data refreshed within last 3 months");
    }
  }

  return { score: Math.min(100, penalty), explanations };
}

export function computeDecisionMakerConfidence(lead: Lead): ConfidenceResult {
  const property = computePropertyMatch(lead);
  const owner = computeOwnerMatch(lead);
  const management = computeManagementMatch(lead);
  const roleFit = computePersonRoleFit(lead);
  const reachability = computeContactReachability(lead);
  const conflict = computeConflictPenalty(lead);
  const staleness = computeStalenessPenalty(lead);

  const components: ConfidenceComponents = {
    propertyMatch: property.score,
    ownerMatch: owner.score,
    managementMatch: management.score,
    personRoleFit: roleFit.score,
    contactReachability: reachability.score,
    conflictPenalty: conflict.score,
    stalenessPenalty: staleness.score,
  };

  const raw =
    WEIGHTS.propertyMatch * property.score +
    WEIGHTS.ownerMatch * owner.score +
    WEIGHTS.managementMatch * management.score +
    WEIGHTS.personRoleFit * roleFit.score +
    WEIGHTS.contactReachability * reachability.score -
    WEIGHTS.conflictPenalty * conflict.score -
    WEIGHTS.stalenessPenalty * staleness.score;

  const overallScore = Math.max(0, Math.min(100, Math.round(raw)));

  let tier: "auto_publish" | "review" | "suppress";
  if (overallScore >= 85) tier = "auto_publish";
  else if (overallScore >= 60) tier = "review";
  else tier = "suppress";

  const explanation = [
    ...property.explanations,
    ...owner.explanations,
    ...management.explanations,
    ...roleFit.explanations,
    ...reachability.explanations,
    ...conflict.explanations.map(e => `⚠ ${e}`),
    ...staleness.explanations.map(e => `⏳ ${e}`),
  ];

  return { overallScore, components, tier, explanation };
}

export async function runConfidenceScoring(marketId?: string, filterLeadIds?: string[]): Promise<{
  totalProcessed: number;
  autoPublish: number;
  review: number;
  suppress: number;
  avgScore: number;
}> {
  let allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);
  if (Array.isArray(filterLeadIds) && filterLeadIds.length > 0) {
    const idSet = new Set(filterLeadIds);
    allLeads = allLeads.filter(l => idSet.has(l.id));
  }

  let autoPublish = 0;
  let review = 0;
  let suppress = 0;
  let totalScore = 0;

  for (const lead of allLeads) {
    const result = computeDecisionMakerConfidence(lead);

    if (result.tier === "auto_publish") autoPublish++;
    else if (result.tier === "review") review++;
    else suppress++;
    totalScore += result.overallScore;

    const preserveManualReview = lead.dmReviewStatus === "approved" || lead.dmReviewStatus === "rejected" || lead.dmReviewStatus === "reassigned";
    const newStatus = preserveManualReview ? lead.dmReviewStatus : (
      result.tier === "auto_publish" ? "auto_approved" :
      result.tier === "suppress" ? "suppressed" : "pending_review"
    );

    await db.update(leads).set({
      dmConfidenceScore: result.overallScore,
      dmConfidenceComponents: result.components,
      dmReviewStatus: newStatus,
    } as any).where(eq(leads.id, lead.id));
  }

  return {
    totalProcessed: allLeads.length,
    autoPublish,
    review,
    suppress,
    avgScore: allLeads.length > 0 ? Math.round(totalScore / allLeads.length) : 0,
  };
}

export async function getConfidenceStats(marketId?: string) {
  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  let scored = 0;
  let autoPublish = 0;
  let review = 0;
  let suppress = 0;
  let totalScore = 0;
  const reviewStatuses: Record<string, number> = {};

  for (const lead of allLeads) {
    if (lead.dmConfidenceScore !== null && lead.dmConfidenceScore !== undefined) {
      scored++;
      totalScore += lead.dmConfidenceScore;
      if (lead.dmConfidenceScore >= 85) autoPublish++;
      else if (lead.dmConfidenceScore >= 60) review++;
      else suppress++;
    }
    const status = lead.dmReviewStatus || "unreviewed";
    reviewStatuses[status] = (reviewStatuses[status] || 0) + 1;
  }

  return {
    total: allLeads.length,
    scored,
    avgScore: scored > 0 ? Math.round(totalScore / scored) : 0,
    autoPublish,
    review,
    suppress,
    reviewStatuses,
  };
}

export async function reviewDecisionMaker(leadId: string, action: string, reviewerNotes?: string, newRole?: string): Promise<any> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");

  const reviewRecord = {
    leadId,
    action,
    previousRole: lead.contactRole,
    newRole: newRole || lead.contactRole,
    previousConfidence: lead.dmConfidenceScore,
    newConfidence: action === "approve" ? Math.max(lead.dmConfidenceScore || 0, 85) :
                   action === "reject" ? 0 : lead.dmConfidenceScore,
    reviewerNotes: reviewerNotes || null,
    evidenceSummary: lead.dmConfidenceComponents,
    reviewedBy: "admin",
  };

  await db.insert(decisionMakerReviews).values(reviewRecord);

  const updates: any = {
    dmReviewStatus: action === "approve" ? "approved" : action === "reject" ? "rejected" : "reassigned",
    dmReviewedAt: new Date(),
    dmReviewedBy: "admin",
  };

  if (action === "approve") {
    updates.dmConfidenceScore = Math.max(lead.dmConfidenceScore || 0, 85);
  } else if (action === "reject") {
    updates.dmConfidenceScore = 0;
  } else if (action === "reassign" && newRole) {
    updates.contactRole = newRole;
  }

  await db.update(leads).set(updates).where(eq(leads.id, lead.id));

  return { success: true, action, leadId };
}

export async function getReviewQueue(marketId?: string, limit = 20, offset = 0) {
  const allLeads = await db.select().from(leads)
    .where(
      marketId
        ? and(eq(leads.marketId, marketId), sql`${leads.dmReviewStatus} = 'pending_review'`)
        : sql`${leads.dmReviewStatus} = 'pending_review'`
    )
    .limit(limit)
    .offset(offset);

  return allLeads.map(lead => ({
    id: lead.id,
    address: lead.address,
    city: lead.city,
    ownerName: lead.ownerName,
    ownerType: lead.ownerType,
    contactRole: lead.contactRole,
    roleConfidence: lead.roleConfidence,
    managementCompany: lead.managementCompany,
    managementContact: lead.managementContact,
    dmConfidenceScore: lead.dmConfidenceScore,
    dmConfidenceComponents: lead.dmConfidenceComponents,
    roleEvidence: lead.roleEvidence,
    managementEvidence: lead.managementEvidence,
    contactName: lead.contactName,
    contactTitle: lead.contactTitle,
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail,
    ownerPhone: lead.ownerPhone,
    ownerEmail: lead.ownerEmail,
    managementPhone: lead.managementPhone,
    managementEmail: lead.managementEmail,
    sqft: lead.sqft,
    leadScore: lead.leadScore,
  }));
}
