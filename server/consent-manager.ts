import { db } from "./storage";
import { leads, consentTokens, suppressionList, complianceConsent } from "@shared/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";

interface ConsentResult {
  hasConsent: boolean;
  tokenType: string | null;
  verifiedAt: Date | null;
  expiresIn: number | null;
}

interface ContactPermission {
  allowed: boolean;
  reasons: string[];
  dnc: boolean;
  hasConsent: boolean;
  suppressed: boolean;
}

export async function recordConsent(
  leadId: string,
  tokenType: string,
  tokenValue: string,
  captureUrl?: string,
  ipAddress?: string,
  userAgent?: string
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const [token] = await db.insert(consentTokens).values({
    leadId,
    tokenType,
    tokenValue,
    captureUrl: captureUrl || null,
    captureTimestamp: now,
    verifiedAt: now,
    verificationResult: "valid",
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    expiresAt,
  }).returning();

  await db.update(leads).set({
    consentStatus: "granted",
    consentDate: now.toISOString(),
    consentChannel: tokenType,
  } as any).where(eq(leads.id, leadId));

  return token;
}

export async function verifyConsent(leadId: string): Promise<ConsentResult> {
  const tokens = await db.select().from(consentTokens)
    .where(eq(consentTokens.leadId, leadId))
    .orderBy(desc(consentTokens.createdAt));

  if (tokens.length === 0) {
    return { hasConsent: false, tokenType: null, verifiedAt: null, expiresIn: null };
  }

  const now = new Date();
  const validToken = tokens.find(t => {
    if (t.verificationResult === "invalid") return false;
    if (t.expiresAt && new Date(t.expiresAt) < now) return false;
    return true;
  });

  if (!validToken) {
    return { hasConsent: false, tokenType: null, verifiedAt: null, expiresIn: null };
  }

  const expiresIn = validToken.expiresAt
    ? Math.max(0, Math.floor((new Date(validToken.expiresAt).getTime() - now.getTime()) / 1000))
    : null;

  return {
    hasConsent: true,
    tokenType: validToken.tokenType,
    verifiedAt: validToken.verifiedAt,
    expiresIn,
  };
}

export async function revokeConsent(leadId: string, reason: string) {
  const now = new Date();

  await db.update(consentTokens).set({
    verificationResult: "invalid",
    verifiedAt: now,
  }).where(eq(consentTokens.leadId, leadId));

  await db.update(leads).set({
    consentStatus: "revoked",
    consentDate: now.toISOString(),
    consentChannel: reason,
  } as any).where(eq(leads.id, leadId));

  return { leadId, status: "revoked", revokedAt: now, reason };
}

export async function getConsentAuditTrail(leadId: string) {
  const tokens = await db.select().from(consentTokens)
    .where(eq(consentTokens.leadId, leadId))
    .orderBy(desc(consentTokens.createdAt));

  const consentRecords = await db.select().from(complianceConsent)
    .where(eq(complianceConsent.leadId, leadId))
    .orderBy(desc(complianceConsent.createdAt));

  const [lead] = await db.select({
    consentStatus: leads.consentStatus,
    consentDate: leads.consentDate,
    consentChannel: leads.consentChannel,
    dncRegistered: leads.dncRegistered,
  }).from(leads).where(eq(leads.id, leadId)).limit(1);

  return {
    leadId,
    currentStatus: lead?.consentStatus || "unknown",
    consentDate: lead?.consentDate || null,
    consentChannel: lead?.consentChannel || null,
    dncRegistered: lead?.dncRegistered || false,
    tokens,
    consentRecords,
  };
}

export async function generateComplianceReport(marketId: string, dateRange?: { start: Date; end: Date }) {
  const allLeads = await db.select().from(leads)
    .where(eq(leads.marketId, marketId))
    .limit(50000);

  const leadIds = new Set(allLeads.map(l => l.id));
  const allTokens = leadIds.size > 0
    ? await db.select().from(consentTokens)
        .where(inArray(consentTokens.leadId, Array.from(leadIds)))
    : [];
  const tokensByLead = new Map<string, typeof allTokens>();
  for (const t of allTokens) {
    if (!tokensByLead.has(t.leadId)) tokensByLead.set(t.leadId, []);
    tokensByLead.get(t.leadId)!.push(t);
  }

  const suppressions = await db.select().from(suppressionList)
    .where(eq(suppressionList.isActive, true));

  const now = new Date();
  const stats = {
    totalLeads: allLeads.length,
    consented: 0,
    unconsented: 0,
    revoked: 0,
    denied: 0,
    dncRegistered: 0,
    suppressed: suppressions.length,
    withValidTokens: 0,
    withExpiredTokens: 0,
    byTokenType: {} as Record<string, number>,
    byChannel: {} as Record<string, number>,
    consentRate: 0,
    complianceScore: 0,
  };

  for (const lead of allLeads) {
    const status = lead.consentStatus || "unknown";
    if (status === "granted") stats.consented++;
    else if (status === "revoked") stats.revoked++;
    else if (status === "denied") stats.denied++;
    else stats.unconsented++;

    if (lead.dncRegistered) stats.dncRegistered++;

    if (lead.consentChannel) {
      stats.byChannel[lead.consentChannel] = (stats.byChannel[lead.consentChannel] || 0) + 1;
    }

    const leadTokens = tokensByLead.get(lead.id) || [];
    let hasValid = false;
    for (const t of leadTokens) {
      stats.byTokenType[t.tokenType] = (stats.byTokenType[t.tokenType] || 0) + 1;
      if (t.verificationResult !== "invalid" && (!t.expiresAt || new Date(t.expiresAt) > now)) {
        hasValid = true;
      }
    }
    if (hasValid) stats.withValidTokens++;
    else if (leadTokens.length > 0) stats.withExpiredTokens++;
  }

  stats.consentRate = allLeads.length > 0 ? stats.consented / allLeads.length : 0;
  stats.complianceScore = allLeads.length > 0
    ? Math.round(((stats.consented + stats.unconsented) / allLeads.length) * 100)
    : 0;

  return stats;
}

export async function checkContactPermission(leadId: string): Promise<ContactPermission> {
  const reasons: string[] = [];

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) {
    return { allowed: false, reasons: ["Lead not found"], dnc: false, hasConsent: false, suppressed: false };
  }

  let dnc = false;
  if (lead.dncRegistered) {
    dnc = true;
    reasons.push("Lead is on DNC registry");
  }

  if (lead.consentStatus === "denied") {
    reasons.push("Consent has been denied");
  }
  if (lead.consentStatus === "revoked") {
    reasons.push("Consent has been revoked");
  }

  const consent = await verifyConsent(leadId);

  const suppressions = await db.select().from(suppressionList)
    .where(
      and(
        eq(suppressionList.isActive, true),
        eq(suppressionList.leadId, leadId)
      )
    );

  const now = new Date();
  const activeSuppression = suppressions.some(s => !s.expiresAt || new Date(s.expiresAt) > now);
  if (activeSuppression) {
    reasons.push("Lead is on suppression list");
  }

  const allowed = !dnc
    && lead.consentStatus !== "denied"
    && lead.consentStatus !== "revoked"
    && !activeSuppression;

  return {
    allowed,
    reasons,
    dnc,
    hasConsent: consent.hasConsent,
    suppressed: activeSuppression,
  };
}
