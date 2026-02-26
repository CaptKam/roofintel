import { db } from "./storage";
import { contactEvidence, leads } from "@shared/schema";
import { eq, isNull, isNotNull, sql } from "drizzle-orm";
import dns from "dns";
import { promisify } from "util";

const resolveMx = promisify(dns.resolveMx);

const BUSINESS_KEYWORDS = [
  "LLC", "INC", "CORP", "LTD", "LP", "TRUST", "DBA", "CO.",
  "CHURCH", "SCHOOL", "SERVICES", "PRINTING", "LANDSCAPE", "LANDSCAPING",
  "RESTAURANT", "PLUMBING", "ELECTRIC", "ELECTRICAL", "DESIGN", "CONSTRUCTION",
  "ASSOCIATES", "HOLDINGS", "INVESTMENTS", "PROPERTIES", "MANAGEMENT",
  "REALTY", "COMPANY", "PARTNERS", "CAPITAL", "FUND", "DEVELOPMENT",
  "INDUSTRIAL", "COMMERCIAL", "RESIDENTIAL", "ENTERPRISE", "GROUP",
  "MISSIONARY", "METHODIST", "BAPTIST", "APOSTOLIC", "PTSO", "ISD",
  "HOLDING", "VENTURES", "ENTERPRISES",
  "MOTORSPORT", "MOTORSPORTS", "AUTO ", "AUTOMOTIVE",
  "SYSTEMS", "SIGNS", "SOLUTIONS", "AGENCY",
  "RESOURCES", "CONTRACTING", "BUILDERS", "CONSULTING",
  "ADVISORS", "TECHNOLOGIES", "TECHNOLOGY",
  "DENTAL", "MEDICAL", "CLINIC", "HOSPITAL", "PHARMACY",
  "SALON", "SPA", "HOTEL", "MOTEL", "INN ",
  "STUDIO", "MEDIA", "LABS", "LABORATORY",
  "SUPPLY", "WELDING", "PAVING", "CONCRETE", "DRYWALL",
  "INSULATION", "DEMOLITION", "REFRIGERAT", "SPRINKLER",
  "ALARM", "ELEVATOR", "GENERATOR",
  "HVAC", "ROOFING", "HEATING", "COOLING", "AIR CONDITION",
  "MECHANICAL", "RESTORATION", "REMEDIATION",
  "SECURITY", "FIRE ", "SOLAR", "PEST", "TERMITE",
  "CLEAN", "JANITORIAL", "FLOORING", "FENCE", "FENCING",
  "LAWN", "GLASS", "GLAZING", "PAINTING", "PAINT",
  "GARAGE", "REPAIR", "TOWING",
  "FOUNDATION", "MINISTRY", "TEMPLE", "MOSQUE", "SYNAGOGUE",
  "ACADEMY", "INSTITUTE", "UNIVERSITY", "COLLEGE",
  "ASSOCIATION", "NEIGHBORHOOD", "COMMUNITY",
  "CENTER", "CENTRE",
  " PRO ", "PROS ",
];

const PREFIX_PATTERNS = [/^C\/O\s/i, /^ATTN\s/i, /^ATTN:\s/i, /^DEPT\s/i, /^DEPT:\s/i];

const JUNK_PATTERNS = [
  /statewide/i, /links/i, /navigation/i, /menu/i, /footer/i, /header/i,
  /click here/i, /read more/i, /learn more/i, /sign in/i, /log in/i, /sign up/i,
  /contact us/i, /about us/i, /home page/i, /skip to/i, /toggle/i,
  /cookie/i, /privacy/i, /terms of/i, /copyright/i, /all rights/i,
  /subscribe/i, /follow us/i, /powered by/i, /page \d/i,
  /^\s*us\s/i, /^the\s/i, /^a\s/i, /^an\s/i,
];

export function isPersonName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  const cleaned = name.replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (cleaned.length < 3) return false;
  const upper = cleaned.toUpperCase();
  if (BUSINESS_KEYWORDS.some(w => upper.includes(w))) return false;
  if (PREFIX_PATTERNS.some(p => p.test(cleaned))) return false;
  if (JUNK_PATTERNS.some(p => p.test(cleaned))) return false;
  if (/[<>{}|\\]/.test(cleaned)) return false;
  if ((cleaned.match(/[^a-zA-Z\s.\-']/g) || []).length > 2) return false;
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2 || parts.length > 5) return false;
  if (!parts.every(p => /^[A-Z]/i.test(p) && p.length >= 2)) return false;
  return true;
}

export function validateContactName(name: string | null | undefined): { isValid: boolean; businessName?: string } {
  if (!name) return { isValid: false };
  if (isPersonName(name)) return { isValid: true };
  return { isValid: false, businessName: name };
}

export async function cleanupPollutedContactNames(): Promise<{ nulledOut: number; sourcesFixed: number; migratedToBusinessName: number }> {
  const allLeads = await db.select({ id: leads.id, contactName: leads.contactName, contactSource: leads.contactSource, businessName: leads.businessName }).from(leads).where(isNotNull(leads.contactName));

  let nulledOut = 0;
  let sourcesFixed = 0;
  let migratedToBusinessName = 0;

  for (const lead of allLeads) {
    if (lead.contactName && !isPersonName(lead.contactName)) {
      const updates: any = { contactName: null };
      if (!lead.businessName) {
        updates.businessName = lead.contactName;
        migratedToBusinessName++;
      }
      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
      nulledOut++;
    }
  }

  const result = await db.execute(sql`UPDATE leads SET contact_source = 'Unknown (Legacy)' WHERE contact_source IS NULL AND contact_name IS NOT NULL`);
  sourcesFixed = Number((result as any)?.rowCount ?? 0);

  console.log(`[Contact Cleanup] Nulled out ${nulledOut} polluted contact names, migrated ${migratedToBusinessName} to businessName, fixed ${sourcesFixed} missing sources`);
  return { nulledOut, sourcesFixed, migratedToBusinessName };
}

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

export function isE164Format(phone: string): boolean {
  const e164Pattern = /^\+[1-9]\d{6,14}$/;
  if (e164Pattern.test(phone)) return true;
  const normalized = normalizePhoneE164(phone);
  return normalized !== null && e164Pattern.test(normalized);
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
