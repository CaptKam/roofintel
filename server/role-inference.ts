import { db } from "./storage";
import { leads, intelligenceClaims, buildingPermits } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

type ContactRole =
  | "Property Manager"
  | "Facilities Director"
  | "Asset Manager"
  | "Owner Representative"
  | "Building Engineer"
  | "Leasing Agent"
  | "General Contractor"
  | "Unknown";

interface RoleCandidate {
  name: string;
  role: ContactRole;
  confidence: number;
  evidence: RoleEvidence[];
  phone?: string;
  email?: string;
}

interface RoleEvidence {
  source: string;
  signal: string;
  weight: number;
}

const TITLE_ROLE_MAP: Record<string, ContactRole> = {
  "property manager": "Property Manager",
  "pm": "Property Manager",
  "prop mgr": "Property Manager",
  "community manager": "Property Manager",
  "site manager": "Property Manager",
  "regional manager": "Property Manager",
  "portfolio manager": "Property Manager",
  "facilities manager": "Facilities Director",
  "facilities director": "Facilities Director",
  "director of facilities": "Facilities Director",
  "facility manager": "Facilities Director",
  "maintenance director": "Facilities Director",
  "maintenance manager": "Facilities Director",
  "building engineer": "Building Engineer",
  "chief engineer": "Building Engineer",
  "plant engineer": "Building Engineer",
  "maintenance engineer": "Building Engineer",
  "asset manager": "Asset Manager",
  "vp of asset management": "Asset Manager",
  "director of asset management": "Asset Manager",
  "owner": "Owner Representative",
  "president": "Owner Representative",
  "ceo": "Owner Representative",
  "managing partner": "Owner Representative",
  "managing member": "Owner Representative",
  "principal": "Owner Representative",
  "general partner": "Owner Representative",
  "leasing agent": "Leasing Agent",
  "leasing manager": "Leasing Agent",
  "leasing director": "Leasing Agent",
  "general contractor": "General Contractor",
  "contractor": "General Contractor",
};

const ROLE_AUTHORITY_RANK: Record<ContactRole, number> = {
  "Asset Manager": 1,
  "Owner Representative": 2,
  "Property Manager": 3,
  "Facilities Director": 4,
  "Building Engineer": 5,
  "General Contractor": 6,
  "Leasing Agent": 7,
  "Unknown": 8,
};

function inferRoleFromTitle(title: string): { role: ContactRole; confidence: number } {
  const lower = title.toLowerCase().trim();
  for (const [pattern, role] of Object.entries(TITLE_ROLE_MAP)) {
    if (lower.includes(pattern)) {
      return { role, confidence: 85 };
    }
  }
  return { role: "Unknown", confidence: 20 };
}

function inferRoleFromContext(lead: Lead): { role: ContactRole; confidence: number; signal: string } {
  if (lead.managementCompany) {
    return { role: "Property Manager", confidence: 70, signal: "management_company_present" };
  }

  if (lead.ownerType === "Individual" || lead.ownerType === "Trust") {
    return { role: "Owner Representative", confidence: 65, signal: "individual_owner" };
  }

  if (lead.ownerType === "LLC" || lead.ownerType === "Corp") {
    if (lead.managingMember) {
      return { role: "Owner Representative", confidence: 60, signal: "llc_managing_member" };
    }
    return { role: "Asset Manager", confidence: 40, signal: "corporate_owner_structure" };
  }

  return { role: "Unknown", confidence: 15, signal: "insufficient_data" };
}

export async function inferLeadRoles(lead: Lead): Promise<RoleCandidate[]> {
  const candidates: RoleCandidate[] = [];

  if (lead.contactName && lead.contactTitle) {
    const { role, confidence } = inferRoleFromTitle(lead.contactTitle);
    candidates.push({
      name: lead.contactName,
      role,
      confidence,
      evidence: [{ source: "web_research", signal: `title: ${lead.contactTitle}`, weight: confidence }],
      phone: lead.contactPhone || undefined,
      email: lead.contactEmail || undefined,
    });
  }

  if (lead.managingMember) {
    const { role, confidence } = lead.managingMemberTitle
      ? inferRoleFromTitle(lead.managingMemberTitle)
      : { role: "Owner Representative" as ContactRole, confidence: 60 };
    candidates.push({
      name: lead.managingMember,
      role,
      confidence,
      evidence: [{ source: "corporate_registry", signal: "managing_member", weight: confidence }],
      phone: lead.managingMemberPhone || undefined,
      email: lead.managingMemberEmail || undefined,
    });
  }

  if (lead.officerName) {
    const { role, confidence } = lead.officerTitle
      ? inferRoleFromTitle(lead.officerTitle)
      : { role: "Owner Representative" as ContactRole, confidence: 55 };
    candidates.push({
      name: lead.officerName,
      role,
      confidence,
      evidence: [{ source: "tx_comptroller", signal: `officer: ${lead.officerTitle || "unknown title"}`, weight: confidence }],
    });
  }

  if (lead.managementContact) {
    candidates.push({
      name: lead.managementContact,
      role: "Property Manager",
      confidence: 75,
      evidence: [{ source: "management_attribution", signal: "attributed_contact", weight: 75 }],
      phone: lead.managementPhone || undefined,
      email: lead.managementEmail || undefined,
    });
  }

  const claims = await db.select().from(intelligenceClaims)
    .where(eq(intelligenceClaims.leadId, lead.id))
    .limit(50);

  for (const claim of claims) {
    if (claim.fieldName === "facility_manager" || claim.fieldName === "building_contact" ||
        claim.fieldName === "property_manager" || claim.fieldName === "maintenance_contact") {
      const roleMap: Record<string, ContactRole> = {
        "facility_manager": "Facilities Director",
        "building_contact": "Building Engineer",
        "property_manager": "Property Manager",
        "maintenance_contact": "Facilities Director",
      };
      candidates.push({
        name: claim.fieldValue,
        role: roleMap[claim.fieldName] || "Unknown",
        confidence: claim.confidence,
        evidence: [{ source: claim.agentName, signal: claim.fieldName, weight: claim.confidence }],
      });
    }
  }

  if (candidates.length === 0) {
    const context = inferRoleFromContext(lead);
    const name = lead.ownerName || "Unknown";
    candidates.push({
      name,
      role: context.role,
      confidence: context.confidence,
      evidence: [{ source: "context_inference", signal: context.signal, weight: context.confidence }],
      phone: lead.ownerPhone || undefined,
      email: lead.ownerEmail || undefined,
    });
  }

  const deduped = new Map<string, RoleCandidate>();
  for (const c of candidates) {
    const key = c.name.toLowerCase().replace(/[^a-z]/g, "");
    const existing = deduped.get(key);
    if (!existing || c.confidence > existing.confidence) {
      if (existing) {
        c.evidence = [...c.evidence, ...existing.evidence];
        c.confidence = Math.max(c.confidence, existing.confidence);
        if (!c.phone && existing.phone) c.phone = existing.phone;
        if (!c.email && existing.email) c.email = existing.email;
      }
      deduped.set(key, c);
    }
  }

  const ranked = Array.from(deduped.values()).sort((a, b) => {
    const rankDiff = ROLE_AUTHORITY_RANK[a.role] - ROLE_AUTHORITY_RANK[b.role];
    if (rankDiff !== 0) return rankDiff;
    return b.confidence - a.confidence;
  });

  return ranked.map((c, i) => ({ ...c, }));
}

export async function runRoleInference(marketId?: string): Promise<{
  totalProcessed: number;
  rolesAssigned: number;
  byRole: Record<string, number>;
}> {
  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  let rolesAssigned = 0;
  const byRole: Record<string, number> = {};

  for (const lead of allLeads) {
    const candidates = await inferLeadRoles(lead);
    if (candidates.length === 0) continue;

    const top = candidates[0];
    byRole[top.role] = (byRole[top.role] || 0) + 1;

    await db.update(leads).set({
      contactRole: top.role,
      roleConfidence: top.confidence,
      decisionMakerRank: ROLE_AUTHORITY_RANK[top.role],
      roleEvidence: candidates.map(c => ({
        name: c.name,
        role: c.role,
        confidence: c.confidence,
        evidence: c.evidence,
        phone: c.phone,
        email: c.email,
      })),
    } as any).where(eq(leads.id, lead.id));

    rolesAssigned++;
  }

  return {
    totalProcessed: allLeads.length,
    rolesAssigned,
    byRole,
  };
}

export async function getRoleInferenceStats(marketId?: string) {
  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  const byRole: Record<string, number> = {};
  let withRole = 0;
  let avgConfidence = 0;
  let confidenceCount = 0;

  for (const lead of allLeads) {
    if (lead.contactRole) {
      withRole++;
      byRole[lead.contactRole] = (byRole[lead.contactRole] || 0) + 1;
      if (lead.roleConfidence) {
        avgConfidence += lead.roleConfidence;
        confidenceCount++;
      }
    }
  }

  return {
    total: allLeads.length,
    withRole,
    avgConfidence: confidenceCount > 0 ? Math.round(avgConfidence / confidenceCount) : 0,
    byRole,
  };
}

export async function getLeadDecisionMakers(leadId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;

  const candidates = await inferLeadRoles(lead);
  return {
    leadId,
    topCandidate: candidates[0] || null,
    allCandidates: candidates,
    currentRole: lead.contactRole,
    currentConfidence: lead.roleConfidence,
  };
}
