import { db } from "./storage";
import { apiUsageTracker, leads as leadsTable } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { recordEvidence } from "./evidence-recorder";

const HUNTER_MONTHLY_LIMIT = 25;
const SERVICE_NAME = "hunter_io";

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
    .values({ service: SERVICE_NAME, month, usedCount: 0, monthlyLimit: HUNTER_MONTHLY_LIMIT })
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

export async function getHunterUsage() {
  const row = await getOrCreateUsageRow();
  return {
    service: "Hunter.io",
    used: row.usedCount,
    limit: row.monthlyLimit,
    remaining: Math.max(0, row.monthlyLimit - row.usedCount),
    month: row.month,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function searchHunterDomain(domain: string, leadId: string): Promise<{
  success: boolean;
  emails: Array<{ value: string; firstName?: string; lastName?: string; position?: string; confidence: number }>;
  error?: string;
}> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { success: false, emails: [], error: "HUNTER_API_KEY not configured" };

  const usage = await getHunterUsage();
  if (usage.remaining <= 0) {
    return { success: false, emails: [], error: `Monthly limit reached (${usage.limit}/${usage.limit} used). Resets next month.` };
  }

  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
    const resp = await fetch(url);
    await incrementUsage();

    if (!resp.ok) {
      const errBody = await resp.text();
      return { success: false, emails: [], error: `Hunter API error ${resp.status}: ${errBody}` };
    }

    const data = await resp.json() as any;
    const emails = (data.data?.emails || []).map((e: any) => ({
      value: e.value,
      firstName: e.first_name || undefined,
      lastName: e.last_name || undefined,
      position: e.position || undefined,
      confidence: e.confidence || 0,
    }));

    for (const email of emails) {
      await recordEvidence({
        leadId,
        contactType: "EMAIL",
        contactValue: email.value,
        sourceName: "Hunter.io",
        sourceUrl: `https://hunter.io/search/${domain}`,
        sourceType: "API",
        extractorMethod: "HUNTER_DOMAIN_SEARCH",
        confidence: email.confidence,
        rawSnippet: email.position
          ? `${email.firstName || ""} ${email.lastName || ""} - ${email.position}`.trim()
          : undefined,
      });
    }

    if (emails.length > 0) {
      const best = emails.reduce((a: any, b: any) => (b.confidence > a.confidence ? b : a), emails[0]);
      await db
        .update(leadsTable)
        .set({
          ownerEmail: best.value,
          contactEmail: best.value,
          contactName: best.firstName && best.lastName ? `${best.firstName} ${best.lastName}` : undefined,
          contactTitle: best.position || undefined,
          contactSource: "Hunter.io",
        })
        .where(eq(leadsTable.id, leadId));
    }

    return { success: true, emails };
  } catch (err: any) {
    return { success: false, emails: [], error: err.message };
  }
}

export async function findHunterEmail(
  firstName: string,
  lastName: string,
  domain: string,
  leadId: string
): Promise<{ success: boolean; email?: string; confidence?: number; error?: string }> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { success: false, error: "HUNTER_API_KEY not configured" };

  const usage = await getHunterUsage();
  if (usage.remaining <= 0) {
    return { success: false, error: `Monthly limit reached (${usage.limit}/${usage.limit} used). Resets next month.` };
  }

  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`;
    const resp = await fetch(url);
    await incrementUsage();

    if (!resp.ok) {
      const errBody = await resp.text();
      return { success: false, error: `Hunter API error ${resp.status}: ${errBody}` };
    }

    const data = await resp.json() as any;
    const email = data.data?.email;
    const confidence = data.data?.score || 0;

    if (email) {
      await recordEvidence({
        leadId,
        contactType: "EMAIL",
        contactValue: email,
        sourceName: "Hunter.io",
        sourceUrl: `https://hunter.io/email-finder`,
        sourceType: "API",
        extractorMethod: "HUNTER_EMAIL_FINDER",
        confidence,
        rawSnippet: `${firstName} ${lastName}`,
      });

      await db
        .update(leadsTable)
        .set({ ownerEmail: email, contactEmail: email, contactSource: "Hunter.io" })
        .where(eq(leadsTable.id, leadId));
    }

    return { success: true, email, confidence };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
