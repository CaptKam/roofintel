import { db } from "./storage";
import { leads, suppressionList, complianceConsent, decisionMakerReviews } from "@shared/schema";
import type { Lead } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";

interface ComplianceCheckResult {
  allowed: boolean;
  channels: {
    phone: { allowed: boolean; reason: string };
    email: { allowed: boolean; reason: string };
    mail: { allowed: boolean; reason: string };
  };
  flags: string[];
  suppressionHits: number;
}

export async function checkLeadCompliance(leadId: string): Promise<ComplianceCheckResult> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    return {
      allowed: false,
      channels: {
        phone: { allowed: false, reason: "Lead not found" },
        email: { allowed: false, reason: "Lead not found" },
        mail: { allowed: false, reason: "Lead not found" },
      },
      flags: ["lead_not_found"],
      suppressionHits: 0,
    };
  }

  const flags: string[] = [];
  let phoneAllowed = true;
  let phoneReason = "No restrictions";
  let emailAllowed = true;
  let emailReason = "No restrictions";
  let mailAllowed = true;
  let mailReason = "No restrictions";

  if (lead.dncRegistered) {
    phoneAllowed = false;
    phoneReason = "DNC registered";
    flags.push("dnc_registered");
  }

  if (lead.consentStatus === "denied") {
    phoneAllowed = false;
    phoneReason = "Consent denied";
    emailAllowed = false;
    emailReason = "Consent denied";
    flags.push("consent_denied");
  }

  if (lead.consentStatus === "revoked") {
    phoneAllowed = false;
    phoneReason = "Consent revoked";
    emailAllowed = false;
    emailReason = "Consent revoked";
    flags.push("consent_revoked");
  }

  const suppressions = await db.select().from(suppressionList)
    .where(
      and(
        eq(suppressionList.isActive, true),
        or(
          eq(suppressionList.leadId, leadId),
          lead.ownerPhone ? eq(suppressionList.phone, lead.ownerPhone) : sql`false`,
          lead.ownerEmail ? eq(suppressionList.email, lead.ownerEmail) : sql`false`,
          lead.contactPhone ? eq(suppressionList.phone, lead.contactPhone) : sql`false`,
          lead.contactEmail ? eq(suppressionList.email, lead.contactEmail) : sql`false`,
        )
      )
    );

  for (const entry of suppressions) {
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) continue;

    if (entry.channel === "phone" || entry.channel === "all") {
      phoneAllowed = false;
      phoneReason = `Suppressed: ${entry.reason}`;
      flags.push(`suppressed_phone_${entry.source}`);
    }
    if (entry.channel === "email" || entry.channel === "all") {
      emailAllowed = false;
      emailReason = `Suppressed: ${entry.reason}`;
      flags.push(`suppressed_email_${entry.source}`);
    }
    if (entry.channel === "mail" || entry.channel === "all") {
      mailAllowed = false;
      mailReason = `Suppressed: ${entry.reason}`;
      flags.push(`suppressed_mail_${entry.source}`);
    }
  }

  if (!lead.ownerPhone && !lead.contactPhone && !lead.managingMemberPhone) {
    phoneAllowed = false;
    phoneReason = "No phone number available";
  }
  if (!lead.ownerEmail && !lead.contactEmail && !lead.managingMemberEmail) {
    emailAllowed = false;
    emailReason = "No email available";
  }

  return {
    allowed: phoneAllowed || emailAllowed || mailAllowed,
    channels: {
      phone: { allowed: phoneAllowed, reason: phoneReason },
      email: { allowed: emailAllowed, reason: emailReason },
      mail: { allowed: mailAllowed, reason: mailReason },
    },
    flags: Array.from(new Set(flags)),
    suppressionHits: suppressions.length,
  };
}

export async function addToSuppressionList(entry: {
  leadId?: string;
  entityName?: string;
  phone?: string;
  email?: string;
  channel: string;
  reason: string;
  source?: string;
  expiresAt?: Date;
}) {
  const [result] = await db.insert(suppressionList).values({
    leadId: entry.leadId || null,
    entityName: entry.entityName || null,
    phone: entry.phone || null,
    email: entry.email || null,
    channel: entry.channel,
    reason: entry.reason,
    source: entry.source || "manual",
    expiresAt: entry.expiresAt || null,
    isActive: true,
  }).returning();

  if (entry.leadId) {
    await db.update(leads).set({
      consentStatus: "denied",
      consentDate: new Date().toISOString(),
      consentChannel: entry.channel,
    } as any).where(eq(leads.id, entry.leadId));
  }

  return result;
}

export async function removeFromSuppressionList(id: string) {
  await db.update(suppressionList)
    .set({ isActive: false })
    .where(eq(suppressionList.id, id));
}

export async function getSuppressionStats(marketId?: string) {
  const allSuppressions = await db.select().from(suppressionList)
    .where(eq(suppressionList.isActive, true));

  const byChannel: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byReason: Record<string, number> = {};

  for (const s of allSuppressions) {
    byChannel[s.channel] = (byChannel[s.channel] || 0) + 1;
    bySource[s.source] = (bySource[s.source] || 0) + 1;
    byReason[s.reason] = (byReason[s.reason] || 0) + 1;
  }

  return {
    totalActive: allSuppressions.length,
    byChannel,
    bySource,
    byReason,
  };
}

export async function getComplianceOverview(marketId?: string) {
  const allLeads = await db.select().from(leads)
    .where(marketId ? eq(leads.marketId, marketId) : sql`1=1`)
    .limit(50000);

  const suppressions = await db.select().from(suppressionList)
    .where(eq(suppressionList.isActive, true));

  const consentStats = {
    total: allLeads.length,
    unknown: 0,
    granted: 0,
    denied: 0,
    revoked: 0,
    dncRegistered: 0,
  };

  const reachability = {
    hasPhone: 0,
    hasEmail: 0,
    phoneClear: 0,
    emailClear: 0,
    fullyBlocked: 0,
  };

  const suppressedPhones = new Set(suppressions.filter(s => s.phone && (s.channel === "phone" || s.channel === "all")).map(s => s.phone));
  const suppressedEmails = new Set(suppressions.filter(s => s.email && (s.channel === "email" || s.channel === "all")).map(s => s.email));
  const suppressedLeadIds = new Set(suppressions.filter(s => s.leadId).map(s => s.leadId));

  for (const lead of allLeads) {
    if (!lead.consentStatus || lead.consentStatus === "unknown") consentStats.unknown++;
    else if (lead.consentStatus === "granted") consentStats.granted++;
    else if (lead.consentStatus === "denied") consentStats.denied++;
    else if (lead.consentStatus === "revoked") consentStats.revoked++;
    if (lead.dncRegistered) consentStats.dncRegistered++;

    const hasPhone = !!(lead.ownerPhone || lead.contactPhone || lead.managingMemberPhone);
    const hasEmail = !!(lead.ownerEmail || lead.contactEmail || lead.managingMemberEmail);
    if (hasPhone) reachability.hasPhone++;
    if (hasEmail) reachability.hasEmail++;

    const phoneBlocked = lead.dncRegistered ||
      lead.consentStatus === "denied" ||
      lead.consentStatus === "revoked" ||
      suppressedLeadIds.has(lead.id) ||
      (lead.ownerPhone && suppressedPhones.has(lead.ownerPhone)) ||
      (lead.contactPhone && suppressedPhones.has(lead.contactPhone));

    const emailBlocked = lead.consentStatus === "denied" ||
      lead.consentStatus === "revoked" ||
      suppressedLeadIds.has(lead.id) ||
      (lead.ownerEmail && suppressedEmails.has(lead.ownerEmail)) ||
      (lead.contactEmail && suppressedEmails.has(lead.contactEmail));

    if (hasPhone && !phoneBlocked) reachability.phoneClear++;
    if (hasEmail && !emailBlocked) reachability.emailClear++;
    if (!hasPhone && !hasEmail) reachability.fullyBlocked++;
  }

  return {
    consent: consentStats,
    reachability,
    suppressions: {
      totalActive: suppressions.length,
    },
  };
}

export async function gateExportCompliance(leadIds: string[]): Promise<{
  allowed: string[];
  blocked: string[];
  reasons: Record<string, string[]>;
}> {
  const allowed: string[] = [];
  const blocked: string[] = [];
  const reasons: Record<string, string[]> = {};

  for (const id of leadIds) {
    const check = await checkLeadCompliance(id);
    if (check.allowed) {
      allowed.push(id);
    } else {
      blocked.push(id);
      reasons[id] = check.flags;
    }
  }

  return { allowed, blocked, reasons };
}
