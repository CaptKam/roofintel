import { db } from "./storage";
import { leads, contactEvidence, skipTraceLog } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { lookupPhone } from "./twilio-lookup";
import { recordEvidence } from "./evidence-recorder";
import type { Lead } from "@shared/schema";

interface ValidationResult {
  leadId: string;
  phone: string;
  isValid: boolean;
  lineType: string | null;
  carrierName: string | null;
  errorCode?: string;
}

export async function validateAndClassify(phone: string, leadId: string): Promise<ValidationResult> {
  const { canRetrace } = await import("./skip-trace-ttl");
  const traceCheck = await canRetrace(leadId, "twilio_lookup");
  if (!traceCheck.allowed) {
    return {
      leadId,
      phone,
      isValid: false,
      lineType: null,
      carrierName: null,
      errorCode: `TTL cooldown active until ${traceCheck.expiresAt?.toISOString()?.split("T")[0]}`,
    };
  }

  const result = await lookupPhone(phone);

  await recordEvidence({
    leadId,
    contactType: "PHONE",
    contactValue: result.phoneNumber,
    sourceName: "twilio_lookup",
    sourceType: "API",
    extractorMethod: "API_LOOKUP",
    confidence: result.isValid ? 85 : 10,
    rawSnippet: JSON.stringify({
      lineType: result.lineType,
      carrierName: result.carrierName,
      isValid: result.isValid,
    }),
  });

  if (result.lineType) {
    await db
      .update(contactEvidence)
      .set({
        phoneLineType: result.lineType,
        carrierName: result.carrierName,
        validationStatus: result.isValid ? "VERIFIED" : "INVALID",
        validationDetail: result.isValid
          ? `Twilio verified | ${result.lineType}${result.carrierName ? ` | ${result.carrierName}` : ""}`
          : `Twilio invalid: ${result.errorCode || "unknown"}`,
        lastVerifiedAt: new Date(),
      })
      .where(
        and(
          eq(contactEvidence.leadId, leadId),
          eq(contactEvidence.contactType, "PHONE"),
          eq(contactEvidence.contactValue, result.phoneNumber)
        )
      );
  }

  const fieldsReturned: string[] = [];
  if (result.lineType) fieldsReturned.push("lineType");
  if (result.carrierName) fieldsReturned.push("carrierName");
  if (result.isValid !== undefined) fieldsReturned.push("isValid");

  const tracedAt = new Date();
  const cooldownDays = 90;
  const expiresAt = new Date(tracedAt.getTime() + cooldownDays * 86400000);

  await db.insert(skipTraceLog).values({
    leadId,
    provider: "twilio_lookup",
    cost: 0.005,
    fieldsReturned,
    matchQuality: result.isValid ? (result.lineType ? "exact" : "partial") : "none",
    tracedAt,
    expiresAt,
    cooldownDays,
  });

  return {
    leadId,
    phone: result.phoneNumber,
    isValid: result.isValid,
    lineType: result.lineType,
    carrierName: result.carrierName,
    errorCode: result.errorCode,
  };
}

interface BatchValidationSummary {
  validated: number;
  invalid: number;
  mobile: number;
  landline: number;
  voip: number;
  unknown: number;
}

export async function batchValidatePhones(leadIds: string[]): Promise<BatchValidationSummary> {
  const summary: BatchValidationSummary = {
    validated: 0,
    invalid: 0,
    mobile: 0,
    landline: 0,
    voip: 0,
    unknown: 0,
  };

  const batchLeads = await db
    .select()
    .from(leads)
    .where(inArray(leads.id, leadIds));

  const leadsWithPhones = batchLeads.filter(
    (l) => l.ownerPhone || l.contactPhone || l.managingMemberPhone
  );

  const rateLimitDelay = 100;
  let requestsThisSecond = 0;
  let secondStart = Date.now();

  for (const lead of leadsWithPhones) {
    const phones = [lead.ownerPhone, lead.contactPhone, lead.managingMemberPhone].filter(Boolean) as string[];
    const uniquePhones = Array.from(new Set(phones));

    for (const phone of uniquePhones) {
      if (requestsThisSecond >= 10) {
        const elapsed = Date.now() - secondStart;
        if (elapsed < 1000) {
          await new Promise((r) => setTimeout(r, 1000 - elapsed));
        }
        requestsThisSecond = 0;
        secondStart = Date.now();
      }

      try {
        const result = await validateAndClassify(phone, lead.id);
        requestsThisSecond++;

        if (result.isValid) {
          summary.validated++;
          const lt = (result.lineType || "").toLowerCase();
          if (lt === "mobile") summary.mobile++;
          else if (lt === "landline") summary.landline++;
          else if (lt === "voip") summary.voip++;
          else summary.unknown++;
        } else {
          summary.invalid++;
        }

        await new Promise((r) => setTimeout(r, rateLimitDelay));
      } catch (err: any) {
        console.error(`[PhoneValidation] Error validating ${phone} for lead ${lead.id}:`, err.message);
        summary.invalid++;
      }
    }
  }

  return summary;
}

interface PhoneQualityMetrics {
  totalPhones: number;
  validatedCount: number;
  invalidCount: number;
  mobileCount: number;
  landlineCount: number;
  voipCount: number;
  unknownCount: number;
  validatedPct: number;
  mobilePct: number;
  landlinePct: number;
  voipPct: number;
  invalidPct: number;
}

export async function getValidationSummary(marketId: string): Promise<PhoneQualityMetrics> {
  const rows = await db
    .select({
      totalPhones: sql<number>`count(*)::int`,
      validatedCount: sql<number>`count(*) filter (where ${contactEvidence.validationStatus} = 'VERIFIED')::int`,
      invalidCount: sql<number>`count(*) filter (where ${contactEvidence.validationStatus} = 'INVALID')::int`,
      mobileCount: sql<number>`count(*) filter (where lower(${contactEvidence.phoneLineType}) = 'mobile')::int`,
      landlineCount: sql<number>`count(*) filter (where lower(${contactEvidence.phoneLineType}) = 'landline')::int`,
      voipCount: sql<number>`count(*) filter (where lower(${contactEvidence.phoneLineType}) = 'voip')::int`,
    })
    .from(contactEvidence)
    .innerJoin(leads, eq(contactEvidence.leadId, leads.id))
    .where(
      and(
        eq(leads.marketId, marketId),
        eq(contactEvidence.contactType, "PHONE"),
        eq(contactEvidence.isActive, true)
      )
    );

  const r = rows[0] || {
    totalPhones: 0,
    validatedCount: 0,
    invalidCount: 0,
    mobileCount: 0,
    landlineCount: 0,
    voipCount: 0,
  };

  const total = r.totalPhones || 1;
  const unknownCount = total - r.mobileCount - r.landlineCount - r.voipCount - r.invalidCount;

  return {
    totalPhones: r.totalPhones,
    validatedCount: r.validatedCount,
    invalidCount: r.invalidCount,
    mobileCount: r.mobileCount,
    landlineCount: r.landlineCount,
    voipCount: r.voipCount,
    unknownCount: Math.max(0, unknownCount),
    validatedPct: Math.round((r.validatedCount / total) * 100),
    mobilePct: Math.round((r.mobileCount / total) * 100),
    landlinePct: Math.round((r.landlineCount / total) * 100),
    voipPct: Math.round((r.voipCount / total) * 100),
    invalidPct: Math.round((r.invalidCount / total) * 100),
  };
}

export function prioritizeByLineType(leadsToSort: Lead[]): Lead[] {
  const lineTypePriority: Record<string, number> = {
    mobile: 0,
    landline: 1,
    voip: 2,
  };

  return [...leadsToSort].sort((a, b) => {
    const aHasPhone = a.ownerPhone || a.contactPhone || a.managingMemberPhone;
    const bHasPhone = b.ownerPhone || b.contactPhone || b.managingMemberPhone;

    if (!aHasPhone && !bHasPhone) return 0;
    if (!aHasPhone) return 1;
    if (!bHasPhone) return -1;

    const aType = ((a as any).phoneLineType || "unknown").toLowerCase();
    const bType = ((b as any).phoneLineType || "unknown").toLowerCase();

    const aPriority = lineTypePriority[aType] ?? 3;
    const bPriority = lineTypePriority[bType] ?? 3;

    if (aPriority !== bPriority) return aPriority - bPriority;

    return (b.leadScore || 0) - (a.leadScore || 0);
  });
}
