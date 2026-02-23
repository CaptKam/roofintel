import { db } from "./storage";
import { contactEvidence } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { normalizePhoneE164 } from "./contact-validation";

interface TwilioLookupResult {
  phoneNumber: string;
  lineType: string | null;
  carrierName: string | null;
  isValid: boolean;
  errorCode?: string;
}

export async function lookupPhone(phone: string): Promise<TwilioLookupResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  const normalized = normalizePhoneE164(phone);
  if (!normalized) {
    return { phoneNumber: phone, lineType: null, carrierName: null, isValid: false, errorCode: "INVALID_FORMAT" };
  }

  if (!accountSid || !authToken) {
    console.log("[Twilio] Credentials not configured, using structure-only validation");
    return { phoneNumber: normalized, lineType: null, carrierName: null, isValid: true };
  }

  try {
    const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(normalized)}?Fields=line_type_intelligence`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[Twilio] Lookup failed for ${normalized}: ${res.status} ${errText}`);
      return { phoneNumber: normalized, lineType: null, carrierName: null, isValid: res.status !== 404, errorCode: `HTTP_${res.status}` };
    }

    const data = await res.json();
    const lineTypeInfo = data.line_type_intelligence || {};
    const lineType = lineTypeInfo.type || null;
    const carrierName = lineTypeInfo.carrier_name || null;
    const isValid = data.valid !== false;

    return { phoneNumber: normalized, lineType, carrierName, isValid };
  } catch (err: any) {
    console.error(`[Twilio] Lookup error for ${normalized}:`, err.message);
    return { phoneNumber: normalized, lineType: null, carrierName: null, isValid: true };
  }
}

export async function verifyAndUpdateEvidence(evidenceId: string): Promise<TwilioLookupResult> {
  const [ev] = await db
    .select()
    .from(contactEvidence)
    .where(eq(contactEvidence.id, evidenceId));

  if (!ev || ev.contactType !== "PHONE") {
    throw new Error("Evidence not found or not a phone type");
  }

  const result = await lookupPhone(ev.contactValue);

  const updates: Record<string, any> = {
    lastVerifiedAt: new Date(),
  };

  if (result.lineType) {
    updates.phoneLineType = result.lineType;
  }
  if (result.carrierName) {
    updates.carrierName = result.carrierName;
  }

  if (!result.isValid) {
    updates.validationStatus = "INVALID";
    updates.validationDetail = `Twilio: number not valid (${result.errorCode || "invalid"})`;
    updates.computedScore = 0;
  } else {
    updates.validationStatus = "VERIFIED";
    let detail = "Twilio verified";
    if (result.lineType) detail += ` | ${result.lineType}`;
    if (result.carrierName) detail += ` | ${result.carrierName}`;
    updates.validationDetail = detail;
  }

  await db
    .update(contactEvidence)
    .set(updates)
    .where(eq(contactEvidence.id, evidenceId));

  return result;
}

export async function verifyAllPhonesForLead(leadId: string): Promise<{ verified: number; invalid: number; skipped: number }> {
  const allEvidence = await db
    .select()
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, leadId),
        eq(contactEvidence.isActive, true)
      )
    );

  const phones = allEvidence.filter(ev => ev.contactType === "PHONE");
  let verified = 0;
  let invalid = 0;
  let skipped = 0;

  for (const phone of phones) {
    if (phone.suppressedAt) {
      skipped++;
      continue;
    }
    try {
      const result = await verifyAndUpdateEvidence(phone.id);
      if (result.isValid) verified++;
      else invalid++;
      await new Promise(r => setTimeout(r, 500));
    } catch {
      skipped++;
    }
  }

  return { verified, invalid, skipped };
}

export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}
