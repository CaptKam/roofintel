import { db } from "./storage";
import { leads, buildingPermits, intelligenceClaims } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

interface ManagementAttribution {
  managementCompany: string | null;
  managementContact: string | null;
  managementPhone: string | null;
  managementEmail: string | null;
  evidence: ManagementEvidence[];
}

interface ManagementEvidence {
  source: string;
  field: string;
  value: string;
  recency: string | null;
  confidence: number;
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(suite|ste)\b/g, "ste")
    .replace(/\b(north|n)\b/g, "n")
    .replace(/\b(south|s)\b/g, "s")
    .replace(/\b(east|e)\b/g, "e")
    .replace(/\b(west|w)\b/g, "w")
    .trim();
}

function isManagementCompany(name: string): boolean {
  const mgmtKeywords = [
    "management", "property management", "realty", "real estate",
    "properties", "asset management", "facilities", "maintenance",
    "pm group", "pm services", "building services", "leasing",
    "commercial management", "residential management",
  ];
  const lower = name.toLowerCase();
  return mgmtKeywords.some(k => lower.includes(k));
}

function isRegisteredAgentService(name: string): boolean {
  const agentKeywords = [
    "registered agent", "ct corporation", "corporation service",
    "national registered agents", "nrai", "incorp services",
    "cogency global", "csc global", "statutory agent",
  ];
  const lower = name.toLowerCase();
  return agentKeywords.some(k => lower.includes(k));
}

function ownerDiffersFromPermitApplicant(ownerName: string, applicantName: string): boolean {
  if (!ownerName || !applicantName) return false;
  const normOwner = ownerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normApplicant = applicantName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normOwner === normApplicant) return false;
  if (normOwner.includes(normApplicant) || normApplicant.includes(normOwner)) return false;
  return true;
}

async function attributeLeadManagement(lead: Lead): Promise<ManagementAttribution> {
  const evidence: ManagementEvidence[] = [];
  let mgmtCompany: string | null = null;
  let mgmtContact: string | null = null;
  let mgmtPhone: string | null = null;
  let mgmtEmail: string | null = null;

  const normalizedAddr = normalizeAddress(lead.address);
  const permits = await db.select().from(buildingPermits)
    .where(eq(buildingPermits.leadId, lead.id))
    .limit(20);

  if (permits.length === 0) {
    const allPermits = await db.select().from(buildingPermits).limit(5000);
    const matched = allPermits.filter(p => {
      const normPermitAddr = normalizeAddress(p.address);
      return normPermitAddr === normalizedAddr || normalizedAddr.includes(normPermitAddr.split(" ").slice(0, 3).join(" "));
    });
    permits.push(...matched.slice(0, 20));
  }

  const sortedPermits = permits.sort((a, b) => {
    const dateA = a.issuedDate ? new Date(a.issuedDate).getTime() : 0;
    const dateB = b.issuedDate ? new Date(b.issuedDate).getTime() : 0;
    return dateB - dateA;
  });

  for (const permit of sortedPermits) {
    if (permit.contractor && ownerDiffersFromPermitApplicant(lead.ownerName, permit.contractor)) {
      evidence.push({
        source: "building_permit",
        field: "contractor",
        value: permit.contractor,
        recency: permit.issuedDate,
        confidence: 60,
      });
    }

    if (permit.owner && ownerDiffersFromPermitApplicant(lead.ownerName, permit.owner)) {
      if (isManagementCompany(permit.owner)) {
        mgmtCompany = mgmtCompany || permit.owner;
        evidence.push({
          source: "building_permit",
          field: "management_company",
          value: permit.owner,
          recency: permit.issuedDate,
          confidence: 85,
        });
      }
    }

    if (permit.contractorPhone && !mgmtPhone) {
      mgmtPhone = permit.contractorPhone;
      evidence.push({
        source: "building_permit",
        field: "contractor_phone",
        value: permit.contractorPhone,
        recency: permit.issuedDate,
        confidence: 70,
      });
    }
  }

  if (lead.ownerAddress && lead.address) {
    const ownerAddr = normalizeAddress(lead.ownerAddress);
    const propAddr = normalizeAddress(lead.address);
    if (ownerAddr !== propAddr && lead.ownerAddress.toLowerCase().includes("c/o")) {
      const coMatch = lead.ownerAddress.match(/c\/o\s+(.+?)(?:,|\d)/i);
      if (coMatch) {
        const coEntity = coMatch[1].trim();
        if (!isRegisteredAgentService(coEntity)) {
          mgmtCompany = mgmtCompany || coEntity;
          evidence.push({
            source: "assessor_mailing",
            field: "c/o_entity",
            value: coEntity,
            recency: null,
            confidence: 75,
          });
        }
      }
    }
  }

  if (lead.registeredAgent && !isRegisteredAgentService(lead.registeredAgent)) {
    evidence.push({
      source: "corporate_registry",
      field: "registered_agent",
      value: lead.registeredAgent,
      recency: null,
      confidence: 30,
    });
  }

  if (lead.businessWebsite) {
    evidence.push({
      source: "web_research",
      field: "business_website",
      value: lead.businessWebsite,
      recency: lead.webResearchedAt?.toISOString() || null,
      confidence: 65,
    });
  }

  if (lead.contactName && lead.contactSource === "web_research") {
    mgmtContact = mgmtContact || lead.contactName;
    if (lead.contactPhone) mgmtPhone = mgmtPhone || lead.contactPhone;
    if (lead.contactEmail) mgmtEmail = mgmtEmail || lead.contactEmail;
    evidence.push({
      source: "web_research",
      field: "contact_person",
      value: lead.contactName,
      recency: lead.webResearchedAt?.toISOString() || null,
      confidence: 70,
    });
  }

  if (lead.managingMember) {
    evidence.push({
      source: "corporate_registry",
      field: "managing_member",
      value: lead.managingMember,
      recency: lead.contactEnrichedAt?.toISOString() || null,
      confidence: 65,
    });
    mgmtContact = mgmtContact || lead.managingMember;
    if (lead.managingMemberPhone) mgmtPhone = mgmtPhone || lead.managingMemberPhone;
    if (lead.managingMemberEmail) mgmtEmail = mgmtEmail || lead.managingMemberEmail;
  }

  const claims = await db.select().from(intelligenceClaims)
    .where(eq(intelligenceClaims.leadId, lead.id))
    .limit(50);

  for (const claim of claims) {
    if (claim.fieldName === "building_contact" || claim.fieldName === "facility_manager" ||
        claim.fieldName === "property_manager") {
      mgmtContact = mgmtContact || claim.fieldValue;
      evidence.push({
        source: claim.agentName,
        field: claim.fieldName,
        value: claim.fieldValue,
        recency: claim.retrievedAt?.toISOString() || null,
        confidence: claim.confidence,
      });
    }
  }

  return {
    managementCompany: mgmtCompany,
    managementContact: mgmtContact,
    managementPhone: mgmtPhone,
    managementEmail: mgmtEmail,
    evidence,
  };
}

export async function runManagementAttribution(marketId?: string): Promise<{
  totalProcessed: number;
  attributed: number;
  withCompany: number;
  withContact: number;
}> {
  const filter: any = { limit: 50000 };
  if (marketId) filter.marketId = marketId;

  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  let attributed = 0;
  let withCompany = 0;
  let withContact = 0;

  for (const lead of allLeads) {
    const result = await attributeLeadManagement(lead);

    if (result.evidence.length === 0) continue;

    const updates: any = {
      managementEvidence: result.evidence,
      managementAttributedAt: new Date(),
    };

    if (result.managementCompany) {
      updates.managementCompany = result.managementCompany;
      withCompany++;
    }
    if (result.managementContact) {
      updates.managementContact = result.managementContact;
      withContact++;
    }
    if (result.managementPhone) updates.managementPhone = result.managementPhone;
    if (result.managementEmail) updates.managementEmail = result.managementEmail;

    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    attributed++;
  }

  return {
    totalProcessed: allLeads.length,
    attributed,
    withCompany,
    withContact,
  };
}

export async function getManagementAttributionStats(marketId?: string) {
  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  return {
    total: allLeads.length,
    attributed: allLeads.filter(l => l.managementCompany || l.managementContact).length,
    withCompany: allLeads.filter(l => l.managementCompany).length,
    withContact: allLeads.filter(l => l.managementContact).length,
    withPhone: allLeads.filter(l => l.managementPhone).length,
    withEmail: allLeads.filter(l => l.managementEmail).length,
  };
}
