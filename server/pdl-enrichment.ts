import { db } from "./storage";
import { apiUsageTracker, leads as leadsTable } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { recordEvidence } from "./evidence-recorder";

const PDL_MONTHLY_LIMIT = 100;
const SERVICE_NAME = "pdl";

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getOrCreateUsageRow() {
  const month = getCurrentMonth();
  const existing = await db
    .select()
    .from(apiUsageTracker)
    .where(and(eq(apiUsageTracker.service, SERVICE_NAME), eq(apiUsageTracker.month, month)));

  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(apiUsageTracker)
    .values({ service: SERVICE_NAME, month, usedCount: 0, monthlyLimit: PDL_MONTHLY_LIMIT })
    .returning();
  return row;
}

async function incrementUsage() {
  const month = getCurrentMonth();
  await db
    .update(apiUsageTracker)
    .set({ usedCount: sql`${apiUsageTracker.usedCount} + 1`, lastUsedAt: new Date() })
    .where(and(eq(apiUsageTracker.service, SERVICE_NAME), eq(apiUsageTracker.month, month)));
}

export async function getPDLUsage() {
  const row = await getOrCreateUsageRow();
  return {
    service: "People Data Labs",
    used: row.usedCount,
    limit: row.monthlyLimit,
    remaining: Math.max(0, row.monthlyLimit - row.usedCount),
    month: row.month,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function enrichPersonPDL(
  leadId: string,
  name: string,
  company?: string,
  location?: string
): Promise<{
  success: boolean;
  person?: {
    fullName: string;
    emails: string[];
    phones: string[];
    title?: string;
    linkedinUrl?: string;
    company?: string;
  };
  error?: string;
}> {
  const apiKey = process.env.PDL_API_KEY;
  if (!apiKey) return { success: false, error: "PDL_API_KEY not configured" };

  const usage = await getPDLUsage();
  if (usage.remaining <= 0) {
    return { success: false, error: `Monthly limit reached (${usage.limit}/${usage.limit} used). Resets next month.` };
  }

  try {
    const params: Record<string, string> = { name };
    if (company) params.company = company;
    if (location) params.location = location;

    const searchParams = new URLSearchParams(params);
    const searchResp = await fetch(
      `https://api.peopledatalabs.com/v5/person/enrich?${searchParams.toString()}`,
      {
        headers: { "X-Api-Key": apiKey },
      }
    );
    await incrementUsage();

    if (!searchResp.ok) {
      if (searchResp.status === 404) {
        return { success: true, error: "No match found in PDL database" };
      }
      const errBody = await searchResp.text();
      return { success: false, error: `PDL API error ${searchResp.status}: ${errBody}` };
    }

    const data = await searchResp.json() as any;

    const person = {
      fullName: data.full_name || name,
      emails: (data.emails || []).map((e: any) => (typeof e === "string" ? e : e.address)).filter(Boolean),
      phones: (data.phone_numbers || []).filter(Boolean),
      title: data.job_title || undefined,
      linkedinUrl: data.linkedin_url || undefined,
      company: data.job_company_name || company,
    };

    for (const email of person.emails) {
      await recordEvidence({
        leadId,
        contactType: "EMAIL",
        contactValue: email,
        sourceName: "People Data Labs",
        sourceType: "API",
        extractorMethod: "PDL_PERSON_ENRICH",
        confidence: 75,
        rawSnippet: `${person.fullName}${person.title ? ` - ${person.title}` : ""}`,
      });
    }

    for (const phone of person.phones) {
      await recordEvidence({
        leadId,
        contactType: "PHONE",
        contactValue: phone,
        sourceName: "People Data Labs",
        sourceType: "API",
        extractorMethod: "PDL_PERSON_ENRICH",
        confidence: 70,
        rawSnippet: `${person.fullName}${person.title ? ` - ${person.title}` : ""}`,
      });
    }

    const updates: Record<string, any> = { contactSource: "People Data Labs" };
    if (person.emails.length > 0) {
      updates.ownerEmail = person.emails[0];
      updates.contactEmail = person.emails[0];
    }
    if (person.phones.length > 0) {
      updates.ownerPhone = person.phones[0];
      updates.contactPhone = person.phones[0];
      updates.phoneSource = "People Data Labs";
      updates.phoneEnrichedAt = new Date();
    }
    if (person.title) updates.contactTitle = person.title;
    if (person.fullName) updates.contactName = person.fullName;

    if (Object.keys(updates).length > 1) {
      await db.update(leadsTable).set(updates).where(eq(leadsTable.id, leadId));
    }

    return { success: true, person };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function enrichCompanyPDL(
  leadId: string,
  companyName: string,
  domain?: string
): Promise<{
  success: boolean;
  company?: {
    name: string;
    website?: string;
    phone?: string;
    industry?: string;
    size?: string;
    linkedinUrl?: string;
  };
  error?: string;
}> {
  const apiKey = process.env.PDL_API_KEY;
  if (!apiKey) return { success: false, error: "PDL_API_KEY not configured" };

  const usage = await getPDLUsage();
  if (usage.remaining <= 0) {
    return { success: false, error: `Monthly limit reached (${usage.limit}/${usage.limit} used). Resets next month.` };
  }

  try {
    const params: Record<string, string> = { name: companyName };
    if (domain) params.website = domain;

    const searchParams = new URLSearchParams(params);
    const resp = await fetch(
      `https://api.peopledatalabs.com/v5/company/enrich?${searchParams.toString()}`,
      {
        headers: { "X-Api-Key": apiKey },
      }
    );
    await incrementUsage();

    if (!resp.ok) {
      if (resp.status === 404) {
        return { success: true, error: "No match found in PDL database" };
      }
      const errBody = await resp.text();
      return { success: false, error: `PDL API error ${resp.status}: ${errBody}` };
    }

    const data = await resp.json() as any;

    const company = {
      name: data.name || companyName,
      website: data.website || undefined,
      phone: data.phone || undefined,
      industry: data.industry || undefined,
      size: data.size || undefined,
      linkedinUrl: data.linkedin_url || undefined,
    };

    if (company.phone) {
      await recordEvidence({
        leadId,
        contactType: "PHONE",
        contactValue: company.phone,
        sourceName: "People Data Labs",
        sourceType: "API",
        extractorMethod: "PDL_COMPANY_ENRICH",
        confidence: 65,
        rawSnippet: `Company: ${company.name}`,
      });

      await db
        .update(leadsTable)
        .set({
          ownerPhone: company.phone,
          phoneSource: "People Data Labs",
          phoneEnrichedAt: new Date(),
        })
        .where(eq(leadsTable.id, leadId));
    }

    if (company.website) {
      await db
        .update(leadsTable)
        .set({ businessWebsite: company.website })
        .where(eq(leadsTable.id, leadId));
    }

    return { success: true, company };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
