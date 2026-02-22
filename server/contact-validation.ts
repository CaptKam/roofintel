import { db } from "./storage";
import { contactEvidence } from "@shared/schema";
import { eq } from "drizzle-orm";
import dns from "dns";
import { promisify } from "util";

const resolveMx = promisify(dns.resolveMx);

export function normalizePhoneE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return digits.startsWith("+") ? digits : `+${digits}`;
  }
  return null;
}

export function formatPhoneDisplay(e164: string): string {
  if (e164.startsWith("+1") && e164.length === 12) {
    const area = e164.substring(2, 5);
    const prefix = e164.substring(5, 8);
    const line = e164.substring(8, 12);
    return `(${area}) ${prefix}-${line}`;
  }
  return e164;
}

export function isValidPhoneStructure(phone: string): { valid: boolean; reason?: string } {
  const e164 = normalizePhoneE164(phone);
  if (!e164) return { valid: false, reason: "Cannot parse phone number" };

  const digits = e164.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const areaCode = last10.substring(0, 3);

  if (/^(\d)\1{9}$/.test(last10)) return { valid: false, reason: "Repeated digit pattern" };
  if (last10 === "1234567890") return { valid: false, reason: "Sequential number" };
  if (areaCode === "000" || areaCode === "911" || areaCode === "555") {
    return { valid: false, reason: `Invalid area code: ${areaCode}` };
  }

  const exchange = last10.substring(3, 6);
  if (exchange === "555") return { valid: false, reason: "Fictional 555 exchange" };
  if (exchange.startsWith("0") || exchange.startsWith("1")) {
    return { valid: false, reason: `Invalid exchange: ${exchange}` };
  }

  const TX_AREA_CODES = new Set([
    "210", "214", "254", "281", "325", "346", "361", "409", "430", "432",
    "469", "512", "682", "713", "726", "737", "806", "817", "830", "832",
    "903", "915", "936", "940", "945", "956", "972", "979",
  ]);
  const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

  const isTollFree = TOLL_FREE.has(areaCode);
  const isTexas = TX_AREA_CODES.has(areaCode);

  return {
    valid: true,
    reason: isTollFree ? "Toll-free number" : isTexas ? "Texas area code" : "Valid US number",
  };
}

export function validateEmailSyntax(email: string): { valid: boolean; reason?: string } {
  const pattern = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!pattern.test(email)) return { valid: false, reason: "Invalid email syntax" };

  const [local, domain] = email.split("@");
  if (local.length > 64) return { valid: false, reason: "Local part too long" };
  if (domain.length > 255) return { valid: false, reason: "Domain too long" };

  const disposableDomains = new Set([
    "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
    "yopmail.com", "sharklasers.com", "guerrillamailblock.com",
  ]);
  if (disposableDomains.has(domain.toLowerCase())) {
    return { valid: false, reason: "Disposable email domain" };
  }

  const personalDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com"]);
  if (personalDomains.has(domain.toLowerCase())) {
    return { valid: true, reason: "Personal email domain — may not be business contact" };
  }

  return { valid: true, reason: "Valid business email" };
}

export async function checkMxRecord(email: string): Promise<{ hasMx: boolean; records?: string[] }> {
  try {
    const domain = email.split("@")[1];
    if (!domain) return { hasMx: false };

    const records = await resolveMx(domain);
    if (records && records.length > 0) {
      return {
        hasMx: true,
        records: records.sort((a, b) => a.priority - b.priority).map(r => r.exchange),
      };
    }
    return { hasMx: false };
  } catch {
    return { hasMx: false };
  }
}

export function checkDomainMatch(email: string, orgWebsite: string | null): boolean {
  if (!orgWebsite) return false;
  try {
    const emailDomain = email.split("@")[1]?.toLowerCase();
    const websiteDomain = new URL(orgWebsite.startsWith("http") ? orgWebsite : `https://${orgWebsite}`).hostname.replace(/^www\./, "").toLowerCase();
    return emailDomain === websiteDomain;
  } catch {
    return false;
  }
}

export async function validateContact(
  evidenceId: string,
  contactType: string,
  contactValue: string,
  orgWebsite?: string | null
): Promise<{ status: string; detail: string }> {
  if (contactType === "PHONE") {
    const phoneCheck = isValidPhoneStructure(contactValue);
    const normalized = normalizePhoneE164(contactValue);
    const status = phoneCheck.valid ? "VERIFIED" : "INVALID";
    const detail = phoneCheck.reason || "Unknown";

    await db
      .update(contactEvidence)
      .set({
        validationStatus: status,
        validationDetail: detail,
        normalizedValue: normalized || contactValue,
        validatedAt: new Date(),
      })
      .where(eq(contactEvidence.id, evidenceId));

    return { status, detail };
  }

  if (contactType === "EMAIL") {
    const syntaxCheck = validateEmailSyntax(contactValue);
    if (!syntaxCheck.valid) {
      await db
        .update(contactEvidence)
        .set({
          validationStatus: "INVALID",
          validationDetail: syntaxCheck.reason || "Invalid syntax",
          normalizedValue: contactValue.toLowerCase(),
          validatedAt: new Date(),
        })
        .where(eq(contactEvidence.id, evidenceId));
      return { status: "INVALID", detail: syntaxCheck.reason || "Invalid syntax" };
    }

    const mxCheck = await checkMxRecord(contactValue);
    const domainMatch = checkDomainMatch(contactValue, orgWebsite || null);
    let status = mxCheck.hasMx ? "VERIFIED" : "UNVERIFIED";
    let detail = syntaxCheck.reason || "";
    if (mxCheck.hasMx) detail += " | MX verified";
    else detail += " | No MX records";
    if (domainMatch) {
      detail += " | Domain matches org";
      status = "VERIFIED";
    }

    await db
      .update(contactEvidence)
      .set({
        validationStatus: status,
        validationDetail: detail,
        normalizedValue: contactValue.toLowerCase(),
        domainMatchFactor: domainMatch ? 1.0 : 0,
        validatedAt: new Date(),
      })
      .where(eq(contactEvidence.id, evidenceId));

    return { status, detail };
  }

  return { status: "UNVERIFIED", detail: "Unsupported contact type for validation" };
}

export async function validateAllEvidenceForLead(leadId: string): Promise<{ validated: number; errors: number }> {
  const allEvidence = await db
    .select()
    .from(contactEvidence)
    .where(eq(contactEvidence.leadId, leadId));

  let validated = 0;
  let errors = 0;

  const toValidate = allEvidence.filter(ev => ev.contactType === "PHONE" || ev.contactType === "EMAIL");
  const batchSize = 5;
  for (let i = 0; i < toValidate.length; i += batchSize) {
    const batch = toValidate.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(ev => {
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000));
        return Promise.race([validateContact(ev.id, ev.contactType, ev.contactValue), timeout]);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") validated++;
      else errors++;
    }
  }

  return { validated, errors };
}
