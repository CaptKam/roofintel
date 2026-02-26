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

  const managingMember = lead.managingMember || lead.managing_member || "";
  const businessName = lead.businessName || lead.business_name || "";
  const website = lead.businessWebsite || lead.business_website || "";
  const contactName = lead.contactName || lead.contact_name || "";

  const prompt = `Generate 5-7 targeted Google search queries to find the DECISION-MAKER for roofing work at this commercial property. Use these investigation tricks:

Property Data:
- Owner/Entity: "${ownerName}"
- Address: ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX
- Zoning: ${lead.zoning || "N/A"}
${managingMember ? `- Managing Member (from TX SOS): ${managingMember}` : ""}
${businessName ? `- Business Name: ${businessName}` : ""}
${website ? `- Website: ${website}` : ""}
${contactName ? `- Existing Contact: ${contactName}` : ""}

INVESTIGATION STRATEGIES (pick the best ones for this lead):
1. LINKEDIN VIA GOOGLE: site:linkedin.com "facility manager" OR "property manager" "[company or building name]" Dallas
2. MANAGEMENT COMPANY HUNT: "[address]" "managed by" OR "property management" OR "leasing office"
3. PERSON LOOKUP: If we have a managing member name, search "[person name]" "[company]" phone OR email OR contact
4. BBB/DIRECTORY: "[company name]" site:bbb.org OR site:yelp.com to find published business phone numbers
5. LOOPNET/COSTAR BREADCRUMBS: "[address]" site:loopnet.com OR "for lease" contact — listing agents know who manages the property
6. REVERSE LLC: "[managing member name]" Dallas property OR "real estate" to find their direct info
7. CORPORATE FACILITY ROLES: "[company]" "director of facilities" OR "facility manager" OR "maintenance director" Dallas
8. NEWS/PRESS: "[address]" OR "[owner name]" renovation OR construction OR roof OR "property manager"
9. GOOGLE MAPS REVIEW MINING: "[building name or address]" reviews — sometimes mention management staff
10. TENANT HUNT: If multi-tenant, search "[address]" tenants OR directory to understand who occupies the building

RULES:
- Use exact quotes strategically to narrow results
- Include city/state to avoid wrong matches
- Prioritize queries most likely to find a PHONE NUMBER or EMAIL
- If we already have a managing member, lead with queries about that specific person

Return JSON:
{
  "queries": ["query1", "query2", "query3", "query4", "query5"],
  "strategy": "brief explanation of which investigation approach you chose and why"
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

  const managingMember = lead.managingMember || lead.managing_member || "";

  const prompt = `You are investigating a commercial property to find the RIGHT PERSON a roofing contractor should call. Analyze this web page and extract every useful piece of contact information.

Target Property:
- Owner: "${lead.ownerName || lead.owner_name}"
- Address: ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX
${managingMember ? `- Known Managing Member: ${managingMember}` : ""}
Source URL: ${sourceUrl}

Page content:
---
${truncated}
---

EXTRACTION PRIORITIES (in order):
1. PHONE NUMBERS — Look for any phone number on the page. Even a main office line is valuable. Format: (XXX) XXX-XXXX
2. PEOPLE WITH TITLES — Look for names paired with roles like: facility manager, property manager, maintenance director, building engineer, operations manager, asset manager, VP of real estate, director of construction
3. EMAIL ADDRESSES — Any email, even info@ or leasing@ gives us a way in
4. MANAGEMENT COMPANY — If a different company manages this property, that's who we really need
5. LINKEDIN PROFILES — If this is a LinkedIn page, extract the person's name, title, company, and location
6. BREADCRUMBS — Even partial info helps: "managed by XYZ" or "contact our facilities team" tells us who to look for next

CRITICAL: Extract ONLY what is explicitly written on this page. NEVER fabricate or guess. If a phone number is on the page, include it. If not, return null.

Return JSON:
{
  "foundContacts": [
    {
      "name": "person name or null",
      "title": "their job title or null",
      "phone": "phone number exactly as shown or null",
      "email": "email exactly as shown or null",
      "source": "${sourceUrl}",
      "confidence": 0.0-1.0,
      "reasoning": "why this person can help with roofing decisions"
    }
  ],
  "businessInsights": {
    "businessType": "what this business does or null",
    "website": "official company website if found or null",
    "managementCompany": "property management company name if different from owner, or null",
    "relatedEntities": ["parent companies, sister companies, property mgmt firms mentioned"]
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
    entityResolution: null,
  });

  try {
    const targetLeads = await db.execute(sql`
      SELECT l.id, l.owner_name, l.address, l.city, l.zoning,
             l.improvement_value, l.total_value, l.sqft,
             l.ownership_structure, l.managing_member, l.business_name,
             l.contact_name, l.contact_phone, l.contact_email,
             l.business_website, l.last_enriched_at, l.enrichment_status
      FROM leads l
      LEFT JOIN ai_audit_results a ON l.id = a.lead_id AND a.audit_type = 'web_search'
      WHERE l.owner_name IS NOT NULL
        AND (l.contact_name IS NULL OR l.contact_name = '')
        AND a.id IS NULL
      ORDER BY
        CASE
          WHEN l.managing_member IS NOT NULL AND l.managing_member != '' THEN 0
          WHEN l.business_website IS NOT NULL AND l.business_website != '' THEN 1
          WHEN l.business_name IS NOT NULL AND l.business_name != '' THEN 2
          WHEN l.ownership_structure = 'small_private' THEN 3
          WHEN l.ownership_structure = 'investment_firm' THEN 4
          WHEN l.ownership_structure = 'third_party_managed' THEN 5
          ELSE 6
        END,
        l.improvement_value DESC NULLS LAST
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

        const processPage = async (url: string, text: string) => {
          const analysis = await analyzeWebContent(lead, text, url);
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
                const isDupe = searchResult.foundContacts.some(
                  (c) => c.name?.toLowerCase() === contact.name?.toLowerCase()
                );
                if (!isDupe) searchResult.foundContacts.push(contact);
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
        };

        const knownWebsite = lead.business_website || lead.businessWebsite || "";
        if (knownWebsite) {
          const contactPages = [
            knownWebsite,
            knownWebsite.replace(/\/$/, "") + "/contact",
            knownWebsite.replace(/\/$/, "") + "/about",
            knownWebsite.replace(/\/$/, "") + "/team",
          ];
          for (const url of contactPages) {
            const pageText = await fetchPageText(url);
            if (pageText && pageText.length > 100) {
              await processPage(url, pageText);
            }
          }
        }

        if (hasSerperKey && searchResult.queries.length > 0) {
          const seenUrls = new Set<string>();
          for (const query of searchResult.queries.slice(0, 5)) {
            if (!auditProgress.running) break;
            const results = await fetchSerperResults(query);
            for (const result of results.slice(0, 3)) {
              const domain = new URL(result.link).hostname;
              if (seenUrls.has(result.link)) continue;
              seenUrls.add(result.link);
              if (domain.includes("facebook.com") || domain.includes("twitter.com") || domain.includes("instagram.com")) continue;

              const pageText = await fetchPageText(result.link);
              if (pageText && pageText.length > 100) {
                await processPage(result.link, pageText);
              }
            }
            if (searchResult.foundContacts.length >= 3) break;
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

        const needsEnrichment = !lead.last_enriched_at || lead.enrichment_status !== "complete";
        if (needsEnrichment) {
          try {
            const { enrichLead } = await import("./lead-enrichment-orchestrator");
            console.log(`[ai-web-search] Triggering free enrichment for lead ${lead.id} (${lead.owner_name})`);
            await enrichLead(lead.id, { skipPaidApis: true });
          } catch (enrichErr: any) {
            console.error(`[ai-web-search] Enrichment error for ${lead.id}:`, enrichErr.message);
          }
        }
      } catch (error: any) {
        console.error(`[ai-web-search] Error processing lead ${lead.id}:`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
    }

    try {
      const { runEntityResolutionScan } = await import("./entity-resolution");
      console.log(`[ai-web-search] Running entity resolution scan after search...`);
      const entityResult = await runEntityResolutionScan();
      auditProgress.entityResolution = {
        clustersFound: entityResult.clustersFound,
        totalDuplicateLeads: entityResult.totalDuplicateLeads,
        deterministic: entityResult.byMatchType.deterministic,
        probabilistic: entityResult.byMatchType.probabilistic,
        durationMs: entityResult.scanDurationMs,
      };
      console.log(`[ai-web-search] Entity resolution: ${entityResult.clustersFound} clusters found, ${entityResult.totalDuplicateLeads} duplicate leads (${entityResult.byMatchType.deterministic} deterministic, ${entityResult.byMatchType.probabilistic} probabilistic) in ${entityResult.scanDurationMs}ms`);
    } catch (entityErr: any) {
      console.error(`[ai-web-search] Entity resolution error (non-fatal):`, entityErr.message);
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
