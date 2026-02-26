import { db } from "./storage";
import { aiAuditResults } from "@shared/schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import { askClaudeJson, estimateCost } from "./ai-client";
import { isPersonName, normalizePhoneE164, validateEmailSyntax } from "./contact-validation";
import { auditProgress } from "./data-audit-agent";

const SYSTEM_PROMPT = `You are a commercial property research specialist. Your job is to analyze web content and identify the right decision-maker for a commercial roofing company to contact about a specific property.

CRITICAL RULES:
- NEVER fabricate or guess any contact data (emails, phones, names)
- Only extract information that is explicitly present in the provided text
- If you cannot find specific information, return null for that field
- Focus on people who make facility/roofing decisions: facility managers, property managers, building maintenance directors, operations managers, owners
- Rate your confidence in each finding

Respond ONLY with valid JSON.`;

interface WebSearchResult {
  queries: string[];
  foundContacts: Array<{
    name: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
    source: string;
    confidence: number;
    reasoning: string;
  }>;
  businessInsights: {
    businessType: string | null;
    website: string | null;
    managementCompany: string | null;
    relatedEntities: string[];
  };
  overallConfidence: number;
}

export async function generateSearchQueries(lead: any): Promise<{
  queries: string[];
  tokens: number;
} | null> {
  const ownerName = lead.ownerName || lead.owner_name;
  if (!ownerName) return null;

  const prompt = `Generate 3-5 targeted web search queries to find the decision-maker for roofing work at this commercial property:

Owner/Entity: "${ownerName}"
Property Address: ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX
Property Type: ${lead.zoning || "N/A"}
${lead.businessName || lead.business_name ? `Business Name: ${lead.businessName || lead.business_name}` : ""}
${lead.managingMember || lead.managing_member ? `Managing Member: ${lead.managingMember || lead.managing_member}` : ""}

Return JSON:
{
  "queries": [
    "specific search query 1",
    "specific search query 2",
    "specific search query 3"
  ],
  "reasoning": "brief explanation of search strategy"
}`;

  try {
    const { data, tokens } = await askClaudeJson<{ queries: string[]; reasoning: string }>(
      prompt,
      SYSTEM_PROMPT
    );
    return { queries: data.queries || [], tokens };
  } catch (error: any) {
    console.error("[ai-web-search] Error generating queries:", error.message);
    return null;
  }
}

export async function analyzeWebContent(
  lead: any,
  pageContent: string,
  sourceUrl: string
): Promise<{
  contacts: WebSearchResult["foundContacts"];
  insights: WebSearchResult["businessInsights"];
  tokens: number;
} | null> {
  const truncated = pageContent.substring(0, 4000);

  const prompt = `Analyze this web page content to find decision-makers for roofing work at a commercial property:

Target Property Owner: "${lead.ownerName || lead.owner_name}"
Property Address: ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX
Source URL: ${sourceUrl}

Page content (truncated):
---
${truncated}
---

Extract ONLY information that is explicitly present in the text above. Do NOT guess or fabricate any contact details.

Return JSON:
{
  "foundContacts": [
    {
      "name": "person name or null",
      "title": "their title or null",
      "phone": "phone number found or null",
      "email": "email found or null",
      "source": "${sourceUrl}",
      "confidence": 0.0-1.0,
      "reasoning": "why this person is relevant for roofing decisions"
    }
  ],
  "businessInsights": {
    "businessType": "what this business does or null",
    "website": "official website if found or null",
    "managementCompany": "management company name if different from owner or null",
    "relatedEntities": ["any related companies, parent orgs, etc."]
  }
}`;

  try {
    const { data, tokens } = await askClaudeJson<{
      foundContacts: WebSearchResult["foundContacts"];
      businessInsights: WebSearchResult["businessInsights"];
    }>(prompt, SYSTEM_PROMPT);
    return { contacts: data.foundContacts || [], insights: data.businessInsights, tokens };
  } catch (error: any) {
    console.error("[ai-web-search] Error analyzing content:", error.message);
    return null;
  }
}

export async function analyzeConnections(
  ownerName: string,
  relatedLeads: any[]
): Promise<{
  findings: any;
  tokens: number;
} | null> {
  if (relatedLeads.length < 2) return null;

  const leadSummaries = relatedLeads.slice(0, 10).map((l: any) => ({
    address: l.address,
    owner: l.ownerName || l.owner_name,
    managingMember: l.managingMember || l.managing_member,
    businessName: l.businessName || l.business_name,
    value: l.totalValue || l.total_value,
  }));

  const prompt = `Analyze these properties that share an owner/entity name to find connections:

Entity: "${ownerName}"
Properties (${relatedLeads.length} total, showing up to 10):
${JSON.stringify(leadSummaries, null, 2)}

Return JSON:
{
  "connectionType": "portfolio_owner / management_company / franchise / government / other",
  "portfolioSize": ${relatedLeads.length},
  "likelyStructure": "description of ownership structure",
  "centralContactStrategy": "how to find the central decision-maker for all these properties",
  "confidence": 0.0-1.0
}`;

  try {
    const { data, tokens } = await askClaudeJson(prompt, SYSTEM_PROMPT);
    return { findings: data, tokens };
  } catch (error: any) {
    console.error("[ai-web-search] Error analyzing connections:", error.message);
    return null;
  }
}

async function fetchSerperResults(query: string): Promise<any[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.organic || []).slice(0, 5);
  } catch {
    return [];
  }
}

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RoofIntel/1.0)",
      },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 6000);
  } catch {
    return null;
  }
}

export async function runAiWebSearch(batchSize: number = 25): Promise<void> {
  if (auditProgress.running) {
    throw new Error("Agent already running");
  }

  const hasSerperKey = !!process.env.SERPER_API_KEY;

  Object.assign(auditProgress, {
    running: true,
    mode: "search" as const,
    processed: 0,
    total: 0,
    tokensUsed: 0,
    estimatedCost: 0,
    findingsCount: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  });

  try {
    const targetLeads = await db.execute(sql`
      SELECT l.id, l.owner_name, l.address, l.city, l.zoning,
             l.improvement_value, l.total_value, l.sqft,
             l.ownership_structure, l.managing_member, l.business_name,
             l.contact_name, l.contact_phone, l.contact_email,
             l.business_website
      FROM leads l
      LEFT JOIN ai_audit_results a ON l.id = a.lead_id AND a.audit_type = 'web_search'
      WHERE l.owner_name IS NOT NULL
        AND (l.contact_name IS NULL OR l.contact_name = '')
        AND a.id IS NULL
      ORDER BY l.total_value DESC NULLS LAST
      LIMIT ${batchSize}
    `);

    const rows = (targetLeads as any).rows;
    auditProgress.total = rows.length;

    if (rows.length === 0) {
      auditProgress.running = false;
      auditProgress.completedAt = new Date().toISOString();
      return;
    }

    console.log(`[ai-web-search] Starting AI web search for ${rows.length} leads (Serper: ${hasSerperKey ? "available" : "not configured"})`);

    for (const lead of rows) {
      if (!auditProgress.running) break;

      try {
        const searchResult: WebSearchResult = {
          queries: [],
          foundContacts: [],
          businessInsights: {
            businessType: null,
            website: null,
            managementCompany: null,
            relatedEntities: [],
          },
          overallConfidence: 0,
        };

        let leadTokens = 0;

        const queryResult = await generateSearchQueries(lead);
        if (queryResult) {
          searchResult.queries = queryResult.queries;
          leadTokens += queryResult.tokens;
          auditProgress.tokensUsed += queryResult.tokens;
        }

        if (hasSerperKey && searchResult.queries.length > 0) {
          for (const query of searchResult.queries.slice(0, 3)) {
            const results = await fetchSerperResults(query);
            for (const result of results.slice(0, 2)) {
              const pageText = await fetchPageText(result.link);
              if (pageText && pageText.length > 100) {
                const analysis = await analyzeWebContent(lead, pageText, result.link);
                if (analysis) {
                  leadTokens += analysis.tokens;
                  auditProgress.tokensUsed += analysis.tokens;
                  for (const contact of analysis.contacts) {
                    if (contact.name && isPersonName(contact.name)) {
                      if (contact.phone) {
                        const normalized = normalizePhoneE164(contact.phone);
                        contact.phone = normalized;
                      }
                      if (contact.email) {
                        const emailCheck = validateEmailSyntax(contact.email);
                        if (!emailCheck.valid) contact.email = null;
                      }
                      searchResult.foundContacts.push(contact);
                    }
                  }
                  if (analysis.insights) {
                    if (analysis.insights.businessType) searchResult.businessInsights.businessType = analysis.insights.businessType;
                    if (analysis.insights.website) searchResult.businessInsights.website = analysis.insights.website;
                    if (analysis.insights.managementCompany) searchResult.businessInsights.managementCompany = analysis.insights.managementCompany;
                    if (analysis.insights.relatedEntities?.length) {
                      searchResult.businessInsights.relatedEntities.push(...analysis.insights.relatedEntities);
                    }
                  }
                }
              }
            }
          }
        }

        const relatedRows = await db.execute(sql`
          SELECT id, owner_name, address, managing_member, business_name, total_value
          FROM leads
          WHERE owner_name = ${lead.owner_name}
            AND id != ${lead.id}
          LIMIT 10
        `);

        if ((relatedRows as any).rows.length >= 2) {
          const connResult = await analyzeConnections(
            lead.owner_name,
            [lead, ...(relatedRows as any).rows]
          );
          if (connResult) {
            auditProgress.tokensUsed += connResult.tokens;
            await db.insert(aiAuditResults).values({
              leadId: lead.id,
              auditType: "connection_discovery",
              findings: connResult.findings as any,
              confidence: connResult.findings.confidence || 0,
              tokensUsed: connResult.tokens,
              status: "pending",
            });
            auditProgress.findingsCount++;
          }
        }

        searchResult.overallConfidence = searchResult.foundContacts.length > 0
          ? Math.max(...searchResult.foundContacts.map(c => c.confidence))
          : 0;

        await db.insert(aiAuditResults).values({
          leadId: lead.id,
          auditType: "web_search",
          findings: searchResult as any,
          confidence: searchResult.overallConfidence,
          tokensUsed: leadTokens,
          status: searchResult.foundContacts.length > 0 ? "pending" : "no_results",
        });
        auditProgress.findingsCount++;
      } catch (error: any) {
        console.error(`[ai-web-search] Error processing lead ${lead.id}:`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
    }

    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    console.log(`[ai-web-search] Search complete: ${auditProgress.findingsCount} findings, ${auditProgress.tokensUsed} tokens, ~$${auditProgress.estimatedCost.toFixed(4)}`);
  } catch (error: any) {
    console.error("[ai-web-search] Fatal error:", error.message);
    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    auditProgress.errors++;
  }
}
