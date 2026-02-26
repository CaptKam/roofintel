import { db } from "./storage";
import { aiAuditResults, contactEvidence, leads } from "@shared/schema";
import { eq, sql, isNull, and, or, desc } from "drizzle-orm";
import { askClaudeJson, estimateCost } from "./ai-client";
import { isPersonName, normalizePhoneE164, validateEmailSyntax } from "./contact-validation";

const SYSTEM_PROMPT = `You are a data quality auditor for a commercial roofing lead intelligence platform. You analyze property owner data to identify:
1. The type of entity (holding company, management company, actual building user, government, religious org, etc.)
2. Data quality issues (inconsistencies, conflicts, missing info)
3. Suggestions for finding the right decision-maker for roofing sales

CRITICAL RULES:
- NEVER fabricate or guess any data (emails, phones, names)
- Only report what you can determine from the data provided
- If uncertain, say so with a lower confidence score
- Focus on actionable insights for a roofing contractor trying to reach the right person

Respond ONLY with valid JSON.`;

interface EntityResolutionResult {
  clustersFound: number;
  totalDuplicateLeads: number;
  deterministic: number;
  probabilistic: number;
  durationMs: number;
}

export type AgentMode = "audit" | "search" | "both" | "contractor_scrub" | "website_extract" | "portfolio" | "stale_data";

interface AuditProgress {
  running: boolean;
  mode: AgentMode;
  processed: number;
  total: number;
  tokensUsed: number;
  estimatedCost: number;
  findingsCount: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
  entityResolution: EntityResolutionResult | null;
}

export let auditProgress: AuditProgress = {
  running: false,
  mode: "audit",
  processed: 0,
  total: 0,
  tokensUsed: 0,
  estimatedCost: 0,
  findingsCount: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
  entityResolution: null,
};

export function getAuditProgress(): AuditProgress {
  return { ...auditProgress };
}

export function resetAuditProgress(): void {
  auditProgress = {
    running: false,
    mode: "audit",
    processed: 0,
    total: 0,
    tokensUsed: 0,
    estimatedCost: 0,
    findingsCount: 0,
    errors: 0,
    startedAt: null,
    completedAt: null,
    entityResolution: null,
  };
}

interface OwnerAnalysis {
  entityType: string;
  isHoldingCompany: boolean;
  isManagementCompany: boolean;
  isActualUser: boolean;
  likelyBusinessType: string;
  decisionMakerHint: string;
  actionableNextStep: string;
  personToContact: string | null;
  personRole: string | null;
  searchSuggestions: string[];
  dataQualityNotes: {
    strengths: string[];
    concerns: string[];
  };
  confidence: number;
}

export async function auditOwnerName(lead: any): Promise<{
  findings: OwnerAnalysis;
  tokens: number;
} | null> {
  const ownerName = lead.ownerName || lead.owner_name;
  if (!ownerName) return null;

  const managingMember = lead.managingMember || lead.managing_member || "";
  const businessName = lead.businessName || lead.business_name || "";
  const contactName = lead.contactName || lead.contact_name || "";
  const contactPhone = lead.contactPhone || lead.contact_phone || "";
  const contactEmail = lead.contactEmail || lead.contact_email || "";
  const ownerPhone = lead.ownerPhone || lead.owner_phone || "";
  const ownerEmail = lead.ownerEmail || lead.owner_email || "";
  const website = lead.businessWebsite || lead.business_website || "";

  const prompt = `You are helping a roofing contractor find the RIGHT PERSON to contact about roof work at this commercial property. Focus on ACTIONABLE intelligence — not just classifying the entity.

Property Data:
- Owner Name: "${ownerName}"
- Address: ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX
- Zoning: ${lead.zoning || "N/A"}
- Sqft: ${(lead.sqft || 0).toLocaleString()}
- Value: $${(lead.totalValue || lead.total_value || 0).toLocaleString()}
${managingMember ? `- Managing Member (from TX SOS): ${managingMember}` : ""}
${businessName ? `- Business Name: ${businessName}` : ""}
${contactName ? `- Current Contact: ${contactName}` : ""}
${contactPhone ? `- Current Phone: ${contactPhone}` : ""}
${contactEmail ? `- Current Email: ${contactEmail}` : ""}
${ownerPhone ? `- Owner Phone: ${ownerPhone}` : ""}
${ownerEmail ? `- Owner Email: ${ownerEmail}` : ""}
${website ? `- Website: ${website}` : ""}

YOUR MAIN JOB: If we have a managing member name or business name, tell me if that person is likely the decision-maker for roofing. If we have partial data, tell me exactly what to search for next. Don't just say "it's a holding company" — tell me WHO to call.

Return JSON:
{
  "entityType": "holding_company / management_company / individual_investor / corporate_tenant / government / religious_org / educational / healthcare / retail_chain / real_estate_fund / other",
  "isHoldingCompany": true/false,
  "isManagementCompany": true/false,
  "isActualUser": true/false,
  "likelyBusinessType": "what this entity does (1 sentence)",
  "personToContact": "the specific person name from the data who should be contacted, or null if unknown",
  "personRole": "their likely role (e.g., 'Property Owner', 'Managing Member / likely decision-maker', 'Facility Manager') or null",
  "decisionMakerHint": "specific guidance on who to contact and how to reach them",
  "actionableNextStep": "the ONE most valuable thing to do next to get a roofing conversation started (be specific, e.g., 'Call John Smith at the number on file — he is the managing member and likely makes maintenance decisions' or 'Search Google for [specific query] to find the property management company')",
  "searchSuggestions": ["2-3 very specific Google search queries to find the decision-maker"],
  "dataQualityNotes": {
    "strengths": ["what data we already have that's useful"],
    "concerns": ["any data issues or gaps"]
  },
  "confidence": 0.0-1.0
}`;

  try {
    const { data, tokens } = await askClaudeJson<OwnerAnalysis>(prompt, SYSTEM_PROMPT);
    return { findings: data, tokens };
  } catch (error: any) {
    console.error(`[data-audit] Error analyzing owner "${ownerName}":`, error.message);
    return null;
  }
}

interface ConflictAnalysis {
  hasConflicts: boolean;
  conflicts: Array<{
    field: string;
    values: string[];
    recommendation: string;
  }>;
  dataQualityScore: number;
  suggestions: string[];
}

export async function auditDataConflicts(lead: any, evidence: any[]): Promise<{
  findings: ConflictAnalysis;
  tokens: number;
} | null> {
  if (!evidence || evidence.length === 0) return null;

  const evidenceSummary = evidence.slice(0, 20).map((e: any) => ({
    type: e.evidenceType || e.evidence_type,
    value: e.value,
    source: e.source,
    trust: e.trustScore || e.trust_score,
    status: e.validationStatus || e.validation_status,
  }));

  const prompt = `Review this property lead's evidence records for data conflicts:

Owner: "${lead.ownerName || lead.owner_name}"
Current Contact: ${lead.contactName || lead.contact_name || "none"}
Current Phone: ${lead.contactPhone || lead.contact_phone || "none"}
Current Email: ${lead.contactEmail || lead.contact_email || "none"}

Evidence records (${evidence.length} total, showing first 20):
${JSON.stringify(evidenceSummary, null, 2)}

Return JSON:
{
  "hasConflicts": true/false,
  "conflicts": [
    {
      "field": "phone/email/name/address",
      "values": ["value1", "value2"],
      "recommendation": "which value to trust and why"
    }
  ],
  "dataQualityScore": 0.0-1.0,
  "suggestions": ["actionable suggestions to improve this lead's data"]
}`;

  try {
    const { data, tokens } = await askClaudeJson<ConflictAnalysis>(prompt, SYSTEM_PROMPT);
    return { findings: data, tokens };
  } catch (error: any) {
    console.error(`[data-audit] Error checking conflicts:`, error.message);
    return null;
  }
}

export async function runDataAudit(batchSize: number = 50): Promise<void> {
  if (auditProgress.running) {
    throw new Error("Audit already running");
  }

  auditProgress = {
    running: true,
    mode: "audit",
    processed: 0,
    total: 0,
    tokensUsed: 0,
    estimatedCost: 0,
    findingsCount: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    entityResolution: null,
  };

  try {
    const targetLeads = await db.execute(sql`
      SELECT l.id, l.owner_name, l.address, l.city, l.zoning, 
             l.improvement_value, l.total_value, l.sqft,
             l.ownership_structure, l.managing_member, l.business_name,
             l.contact_name, l.contact_phone, l.contact_email,
             l.owner_phone, l.owner_email, l.business_website,
             l.last_enriched_at, l.enrichment_status
      FROM leads l
      LEFT JOIN ai_audit_results a ON l.id = a.lead_id AND a.audit_type = 'owner_analysis'
      WHERE l.owner_name IS NOT NULL
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

    console.log(`[data-audit] Starting audit of ${rows.length} leads`);

    for (const lead of rows) {
      if (!auditProgress.running) break;

      try {
        const ownerResult = await auditOwnerName(lead);

        if (ownerResult) {
          await db.insert(aiAuditResults).values({
            leadId: lead.id,
            auditType: "owner_analysis",
            findings: ownerResult.findings as any,
            confidence: ownerResult.findings.confidence || 0,
            tokensUsed: ownerResult.tokens,
            status: "pending",
          });
          auditProgress.tokensUsed += ownerResult.tokens;
          auditProgress.findingsCount++;
        }

        const evidenceRows = await db
          .select()
          .from(contactEvidence)
          .where(eq(contactEvidence.leadId, lead.id))
          .limit(20);

        if (evidenceRows.length >= 2) {
          const conflictResult = await auditDataConflicts(lead, evidenceRows);
          if (conflictResult && conflictResult.findings.hasConflicts) {
            await db.insert(aiAuditResults).values({
              leadId: lead.id,
              auditType: "conflict_detection",
              findings: conflictResult.findings as any,
              confidence: conflictResult.findings.dataQualityScore || 0,
              tokensUsed: conflictResult.tokens,
              status: "pending",
            });
            auditProgress.tokensUsed += conflictResult.tokens;
            auditProgress.findingsCount++;
          }
        }

        const needsEnrichment = !lead.last_enriched_at || lead.enrichment_status !== "complete";
        if (needsEnrichment) {
          try {
            const { enrichLead } = await import("./lead-enrichment-orchestrator");
            console.log(`[data-audit] Triggering free enrichment for lead ${lead.id} (${lead.owner_name})`);
            enrichLead(lead.id, { skipPaidApis: true });
          } catch (enrichErr: any) {
            console.error(`[data-audit] Enrichment error for ${lead.id}:`, enrichErr.message);
          }
        }
      } catch (error: any) {
        console.error(`[data-audit] Error processing lead ${lead.id}:`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
    }

    try {
      const { runEntityResolutionScan } = await import("./entity-resolution");
      console.log(`[data-audit] Running entity resolution scan after audit...`);
      const entityResult = await runEntityResolutionScan();
      auditProgress.entityResolution = {
        clustersFound: entityResult.clustersFound,
        totalDuplicateLeads: entityResult.totalDuplicateLeads,
        deterministic: entityResult.byMatchType.deterministic,
        probabilistic: entityResult.byMatchType.probabilistic,
        durationMs: entityResult.scanDurationMs,
      };
      console.log(`[data-audit] Entity resolution: ${entityResult.clustersFound} clusters found, ${entityResult.totalDuplicateLeads} duplicate leads (${entityResult.byMatchType.deterministic} deterministic, ${entityResult.byMatchType.probabilistic} probabilistic) in ${entityResult.scanDurationMs}ms`);
    } catch (entityErr: any) {
      console.error(`[data-audit] Entity resolution error (non-fatal):`, entityErr.message);
    }

    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    console.log(`[data-audit] Audit complete: ${auditProgress.findingsCount} findings, ${auditProgress.tokensUsed} tokens, ~$${auditProgress.estimatedCost.toFixed(4)}`);
  } catch (error: any) {
    console.error("[data-audit] Fatal error:", error.message);
    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    auditProgress.errors++;
  }
}

const CONTRACTOR_KEYWORDS = [
  "ROOFING", "ELECTRIC", "ELECTRICAL", "PLUMBING", "PLUMBER", "HVAC", "MECHANICAL",
  "AIR CONDITIONING", "HEATING", "COOLING", "CONSTRUCTION", "CONTRACTING", "CONTRACTOR",
  "PAINTING", "PAVING", "LANDSCAPING", "CLEANING", "JANITORIAL", "MAINTENANCE",
  "RESTORATION", "REMEDIATION", "INSULATION", "GLAZING", "FLOORING", "FENCE",
  "DEMOLITION", "EXCAVATION", "CONCRETE", "MASONRY", "WELDING", "FIRE PROTECTION",
  "SPRINKLER", "ELEVATOR", "GARAGE DOOR", "PEST CONTROL", "EXTERMINATING",
  "TREE SERVICE", "IRRIGATION", "SEPTIC", "SEWER", "WATERPROOFING",
  "SERVICES", "SOLUTIONS", "SYSTEMS", "ENTERPRISES",
];

function looksLikeContractor(name: string): boolean {
  if (!name) return false;
  const upper = name.toUpperCase();
  return CONTRACTOR_KEYWORDS.some(kw => upper.includes(kw));
}

export async function runContractorScrub(batchSize: number = 50): Promise<void> {
  if (auditProgress.running) throw new Error("Agent already running");

  auditProgress = {
    running: true, mode: "contractor_scrub", processed: 0, total: 0,
    tokensUsed: 0, estimatedCost: 0, findingsCount: 0, errors: 0,
    startedAt: new Date().toISOString(), completedAt: null, entityResolution: null,
  };

  try {
    const targetLeads = await db.execute(sql`
      SELECT l.id, l.owner_name, l.address, l.city, l.managing_member,
             l.officer_name, l.registered_agent, l.llc_chain, l.business_name,
             l.contact_name, l.total_value, l.improvement_value
      FROM leads l
      LEFT JOIN ai_audit_results a ON l.id = a.lead_id AND a.audit_type = 'contractor_scrub'
      WHERE l.managing_member IS NOT NULL
        AND l.managing_member != ''
        AND a.id IS NULL
      ORDER BY l.improvement_value DESC NULLS LAST
      LIMIT ${batchSize}
    `);

    const rows = (targetLeads as any).rows;
    auditProgress.total = rows.length;

    if (rows.length === 0) {
      auditProgress.running = false;
      auditProgress.completedAt = new Date().toISOString();
      return;
    }

    console.log(`[contractor-scrub] Scanning ${rows.length} leads for contractor names in managing_member`);

    for (const lead of rows) {
      if (!auditProgress.running) break;

      try {
        const mm = lead.managing_member || "";
        const isObviousContractor = looksLikeContractor(mm);

        if (isObviousContractor) {
          const altMember = lead.registered_agent || lead.officer_name || null;
          await db.insert(aiAuditResults).values({
            leadId: lead.id,
            auditType: "contractor_scrub",
            findings: {
              flaggedValue: mm,
              isContractor: true,
              reason: "Name matches contractor keyword pattern",
              suggestedReplacement: altMember,
              replacementSource: altMember ? "registered_agent/officer" : null,
              ownerName: lead.owner_name,
            } as any,
            confidence: 0.95,
            tokensUsed: 0,
            status: "pending",
          });
          auditProgress.findingsCount++;
        } else {
          const prompt = `Is this name a SERVICE CONTRACTOR (plumber, electrician, roofer, HVAC tech, etc.) or a PROPERTY DECISION-MAKER (owner, investor, manager, executive)?

Name to evaluate: "${mm}"
Context: This name is stored as "managing member" for property owned by "${lead.owner_name}" at ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX.
${lead.registered_agent ? `Registered Agent: ${lead.registered_agent}` : ""}
${lead.officer_name ? `Officer: ${lead.officer_name}` : ""}

Return JSON:
{
  "isContractor": true/false,
  "reasoning": "brief explanation",
  "suggestedReplacement": "alternative person name from the data if available, or null",
  "confidence": 0.0-1.0
}`;

          const { data, tokens } = await askClaudeJson<any>(prompt, SYSTEM_PROMPT);
          auditProgress.tokensUsed += tokens;

          if (data.isContractor) {
            const altMember = data.suggestedReplacement || lead.registered_agent || lead.officer_name || null;
            await db.insert(aiAuditResults).values({
              leadId: lead.id,
              auditType: "contractor_scrub",
              findings: {
                flaggedValue: mm,
                isContractor: true,
                reason: data.reasoning,
                suggestedReplacement: altMember,
                replacementSource: data.suggestedReplacement ? "ai_analysis" : (altMember ? "registered_agent/officer" : null),
                ownerName: lead.owner_name,
                confidence: data.confidence,
              } as any,
              confidence: data.confidence || 0.8,
              tokensUsed: tokens,
              status: "pending",
            });
            auditProgress.findingsCount++;
          } else {
            await db.insert(aiAuditResults).values({
              leadId: lead.id,
              auditType: "contractor_scrub",
              findings: {
                flaggedValue: mm,
                isContractor: false,
                reason: data.reasoning,
                ownerName: lead.owner_name,
              } as any,
              confidence: data.confidence || 0.8,
              tokensUsed: tokens,
              status: "dismissed",
            });
          }
        }
      } catch (error: any) {
        console.error(`[contractor-scrub] Error on lead ${lead.id}:`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
    }

    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    console.log(`[contractor-scrub] Complete: ${auditProgress.findingsCount} contractors found in ${rows.length} leads`);
  } catch (error: any) {
    console.error("[contractor-scrub] Fatal error:", error.message);
    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    auditProgress.errors++;
  }
}

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RoofIntel/1.0)" },
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

export async function runWebsiteExtract(batchSize: number = 50): Promise<void> {
  if (auditProgress.running) throw new Error("Agent already running");

  auditProgress = {
    running: true, mode: "website_extract", processed: 0, total: 0,
    tokensUsed: 0, estimatedCost: 0, findingsCount: 0, errors: 0,
    startedAt: new Date().toISOString(), completedAt: null, entityResolution: null,
  };

  try {
    const targetLeads = await db.execute(sql`
      SELECT l.id, l.owner_name, l.address, l.city, l.business_website,
             l.contact_name, l.contact_phone, l.contact_email, l.managing_member,
             l.total_value, l.improvement_value
      FROM leads l
      LEFT JOIN ai_audit_results a ON l.id = a.lead_id AND a.audit_type = 'website_extract'
      WHERE l.business_website IS NOT NULL
        AND l.business_website != ''
        AND (l.contact_phone IS NULL OR l.contact_phone = '')
        AND (l.contact_email IS NULL OR l.contact_email = '')
        AND a.id IS NULL
      ORDER BY l.improvement_value DESC NULLS LAST
      LIMIT ${batchSize}
    `);

    const rows = (targetLeads as any).rows;
    auditProgress.total = rows.length;

    if (rows.length === 0) {
      auditProgress.running = false;
      auditProgress.completedAt = new Date().toISOString();
      return;
    }

    console.log(`[website-extract] Extracting contacts from ${rows.length} lead websites`);

    for (const lead of rows) {
      if (!auditProgress.running) break;

      try {
        const baseUrl = (lead.business_website || "").replace(/\/$/, "");
        const pages = [baseUrl, baseUrl + "/contact", baseUrl + "/about", baseUrl + "/team"];
        let combinedText = "";

        for (const url of pages) {
          const text = await fetchPageText(url);
          if (text && text.length > 100) {
            combinedText += `\n--- PAGE: ${url} ---\n${text}`;
          }
        }

        if (combinedText.length < 200) {
          await db.insert(aiAuditResults).values({
            leadId: lead.id,
            auditType: "website_extract",
            findings: { noContent: true, website: baseUrl, reason: "Could not fetch website content" } as any,
            confidence: 0, tokensUsed: 0, status: "dismissed",
          });
          auditProgress.processed++;
          continue;
        }

        const prompt = `Extract contact information from this website content for a commercial property at ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX. The property is owned by "${lead.owner_name}".

Website: ${baseUrl}
${lead.managing_member ? `Known managing member: ${lead.managing_member}` : ""}

Website Content:
${combinedText.substring(0, 5000)}

Extract ALL contact information you can find. Focus on people who would make decisions about building maintenance/roofing: property managers, facility managers, owners, maintenance directors.

CRITICAL: Only extract information that is EXPLICITLY stated in the text above. Never guess or fabricate.

Return JSON:
{
  "contacts": [
    {
      "name": "person name or null",
      "title": "their job title or null",
      "phone": "phone number exactly as shown or null",
      "email": "email exactly as shown or null",
      "relevance": "why this person is relevant for roofing decisions"
    }
  ],
  "companyInfo": {
    "companyName": "business name if found",
    "businessType": "what the company does",
    "mainPhone": "main office phone if found",
    "mainEmail": "main contact email if found"
  },
  "confidence": 0.0-1.0
}`;

        const { data, tokens } = await askClaudeJson<any>(prompt, SYSTEM_PROMPT);
        auditProgress.tokensUsed += tokens;

        const validContacts: any[] = [];
        for (const c of (data.contacts || [])) {
          const contact: any = { relevance: c.relevance };
          if (c.name && isPersonName(c.name)) contact.name = c.name;
          if (c.title) contact.title = c.title;
          if (c.phone) {
            const norm = normalizePhoneE164(c.phone);
            if (norm) contact.phone = norm;
          }
          if (c.email) {
            const check = validateEmailSyntax(c.email);
            if (check.valid) contact.email = c.email;
          }
          if (contact.name || contact.phone || contact.email) {
            validContacts.push(contact);
          }
        }

        const companyInfo = data.companyInfo || {};
        if (companyInfo.mainPhone) {
          const norm = normalizePhoneE164(companyInfo.mainPhone);
          companyInfo.mainPhone = norm || null;
        }
        if (companyInfo.mainEmail) {
          const check = validateEmailSyntax(companyInfo.mainEmail);
          if (!check.valid) companyInfo.mainEmail = null;
        }

        const hasUsefulData = validContacts.length > 0 || companyInfo.mainPhone || companyInfo.mainEmail;

        await db.insert(aiAuditResults).values({
          leadId: lead.id,
          auditType: "website_extract",
          findings: {
            website: baseUrl,
            contacts: validContacts,
            companyInfo,
            ownerName: lead.owner_name,
          } as any,
          confidence: data.confidence || 0,
          tokensUsed: tokens,
          status: hasUsefulData ? "pending" : "dismissed",
        });

        if (hasUsefulData) auditProgress.findingsCount++;
      } catch (error: any) {
        console.error(`[website-extract] Error on lead ${lead.id}:`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
    }

    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    console.log(`[website-extract] Complete: ${auditProgress.findingsCount} leads with contacts from ${rows.length} websites`);
  } catch (error: any) {
    console.error("[website-extract] Fatal error:", error.message);
    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    auditProgress.errors++;
  }
}

export async function runPortfolioDetection(batchSize: number = 50): Promise<void> {
  if (auditProgress.running) throw new Error("Agent already running");

  auditProgress = {
    running: true, mode: "portfolio", processed: 0, total: 0,
    tokensUsed: 0, estimatedCost: 0, findingsCount: 0, errors: 0,
    startedAt: new Date().toISOString(), completedAt: null, entityResolution: null,
  };

  try {
    const portfolioOwners = await db.execute(sql`
      SELECT
        UPPER(TRIM(REGEXP_REPLACE(owner_name, '[,&]+$', ''))) as normalized_owner,
        COUNT(*) as property_count,
        SUM(COALESCE(total_value, 0)) as total_portfolio_value,
        ARRAY_AGG(id ORDER BY total_value DESC NULLS LAST) as lead_ids,
        ARRAY_AGG(DISTINCT city) as cities,
        ARRAY_AGG(address ORDER BY total_value DESC NULLS LAST) as addresses
      FROM leads
      WHERE owner_name IS NOT NULL
      GROUP BY UPPER(TRIM(REGEXP_REPLACE(owner_name, '[,&]+$', '')))
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
      LIMIT ${batchSize}
    `);

    const owners = (portfolioOwners as any).rows;
    auditProgress.total = owners.length;

    if (owners.length === 0) {
      auditProgress.running = false;
      auditProgress.completedAt = new Date().toISOString();
      return;
    }

    console.log(`[portfolio] Analyzing ${owners.length} portfolio owners`);

    const alreadyAnalyzed = await db.execute(sql`
      SELECT DISTINCT lead_id FROM ai_audit_results WHERE audit_type = 'portfolio_analysis'
    `);
    const analyzedSet = new Set((alreadyAnalyzed as any).rows.map((r: any) => r.lead_id));

    for (const owner of owners) {
      if (!auditProgress.running) break;

      const primaryLeadId = owner.lead_ids[0];
      if (analyzedSet.has(primaryLeadId)) {
        auditProgress.processed++;
        continue;
      }

      try {
        const prompt = `Analyze this portfolio owner who owns ${owner.property_count} commercial properties:

Owner Name: "${owner.normalized_owner}"
Properties: ${owner.property_count}
Total Portfolio Value: $${Number(owner.total_portfolio_value || 0).toLocaleString()}
Cities: ${(owner.cities || []).filter(Boolean).join(", ")}
Sample Addresses: ${(owner.addresses || []).slice(0, 5).join("; ")}

Based on the owner name and portfolio size, determine:

Return JSON:
{
  "ownerType": "individual_investor / investment_firm / reit / family_office / government / religious / institutional / management_company / other",
  "managementLikely": "self_managed / third_party_managed / mixed / unknown",
  "contactStrategy": "specific recommendation for how to approach this portfolio owner for roofing services (1-2 sentences)",
  "searchSuggestions": ["1-2 specific Google queries to find the right person"],
  "portfolioTier": "large (10+) / medium (5-9) / small (3-4)",
  "confidence": 0.0-1.0
}`;

        const { data, tokens } = await askClaudeJson<any>(prompt, SYSTEM_PROMPT);
        auditProgress.tokensUsed += tokens;

        await db.insert(aiAuditResults).values({
          leadId: primaryLeadId,
          auditType: "portfolio_analysis",
          findings: {
            ownerName: owner.normalized_owner,
            propertyCount: Number(owner.property_count),
            totalValue: Number(owner.total_portfolio_value || 0),
            cities: owner.cities?.filter(Boolean) || [],
            leadIds: owner.lead_ids,
            ownerType: data.ownerType,
            managementLikely: data.managementLikely,
            contactStrategy: data.contactStrategy,
            searchSuggestions: data.searchSuggestions,
            portfolioTier: data.portfolioTier,
          } as any,
          confidence: data.confidence || 0.5,
          tokensUsed: tokens,
          status: "pending",
        });
        auditProgress.findingsCount++;
      } catch (error: any) {
        console.error(`[portfolio] Error analyzing "${owner.normalized_owner}":`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
    }

    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    console.log(`[portfolio] Complete: ${auditProgress.findingsCount} portfolio owners analyzed`);
  } catch (error: any) {
    console.error("[portfolio] Fatal error:", error.message);
    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    auditProgress.errors++;
  }
}

export async function runStaleDataDetection(batchSize: number = 100): Promise<void> {
  if (auditProgress.running) throw new Error("Agent already running");

  auditProgress = {
    running: true, mode: "stale_data", processed: 0, total: 0,
    tokensUsed: 0, estimatedCost: 0, findingsCount: 0, errors: 0,
    startedAt: new Date().toISOString(), completedAt: null, entityResolution: null,
  };

  try {
    const sharedPhones = await db.execute(sql`
      SELECT contact_phone as phone, COUNT(*) as lead_count,
             (ARRAY_AGG(id ORDER BY total_value DESC NULLS LAST))[1:5] as sample_lead_ids,
             (ARRAY_AGG(owner_name ORDER BY total_value DESC NULLS LAST))[1:5] as sample_owners
      FROM leads
      WHERE contact_phone IS NOT NULL AND contact_phone != ''
      GROUP BY contact_phone
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);

    const sharedPhoneRows = (sharedPhones as any).rows;

    const absenteeOwners = await db.execute(sql`
      SELECT id, owner_name, address, city, owner_address, total_value, improvement_value
      FROM leads
      WHERE owner_address IS NOT NULL AND owner_address != ''
        AND address IS NOT NULL AND address != ''
        AND UPPER(TRIM(owner_address)) != UPPER(TRIM(address))
        AND NOT EXISTS (
          SELECT 1 FROM ai_audit_results a
          WHERE a.lead_id = leads.id AND a.audit_type = 'stale_data'
        )
      ORDER BY improvement_value DESC NULLS LAST
      LIMIT ${batchSize}
    `);

    const absenteeRows = (absenteeOwners as any).rows;

    const oldBuildings = await db.execute(sql`
      SELECT id, owner_name, address, city, year_built, roof_last_replaced,
             total_value, improvement_value
      FROM leads
      WHERE year_built IS NOT NULL AND year_built < 1990
        AND (roof_last_replaced IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM ai_audit_results a
          WHERE a.lead_id = leads.id AND a.audit_type = 'stale_data'
        )
      ORDER BY year_built ASC, improvement_value DESC NULLS LAST
      LIMIT ${batchSize}
    `);

    const oldBuildingRows = (oldBuildings as any).rows;

    const totalItems = sharedPhoneRows.length + absenteeRows.length + oldBuildingRows.length;
    auditProgress.total = totalItems;

    if (totalItems === 0) {
      auditProgress.running = false;
      auditProgress.completedAt = new Date().toISOString();
      return;
    }

    console.log(`[stale-data] Found ${sharedPhoneRows.length} shared phones, ${absenteeRows.length} absentee owners, ${oldBuildingRows.length} old buildings`);

    for (const row of sharedPhoneRows) {
      if (!auditProgress.running) break;
      try {
        const primaryLeadId = row.sample_lead_ids[0];
        const alreadyExists = await db.execute(sql`
          SELECT 1 FROM ai_audit_results WHERE lead_id = ${primaryLeadId} AND audit_type = 'stale_data'
          AND (findings->>'subType') = 'shared_phone' LIMIT 1
        `);
        if ((alreadyExists as any).rows.length > 0) {
          auditProgress.processed++;
          continue;
        }

        await db.insert(aiAuditResults).values({
          leadId: primaryLeadId,
          auditType: "stale_data",
          findings: {
            subType: "shared_phone",
            phone: row.phone,
            sharedByCount: Number(row.lead_count),
            sampleOwners: row.sample_owners?.filter(Boolean).slice(0, 5) || [],
            sampleLeadIds: row.sample_lead_ids?.slice(0, 5) || [],
            recommendation: `Phone ${row.phone} appears on ${row.lead_count} different leads — likely a contractor or service provider phone, not the property owner.`,
          } as any,
          confidence: 0.85,
          tokensUsed: 0,
          status: "pending",
        });
        auditProgress.findingsCount++;
      } catch (error: any) {
        auditProgress.errors++;
      }
      auditProgress.processed++;
    }

    for (const lead of absenteeRows) {
      if (!auditProgress.running) break;
      try {
        await db.insert(aiAuditResults).values({
          leadId: lead.id,
          auditType: "stale_data",
          findings: {
            subType: "absentee_owner",
            ownerName: lead.owner_name,
            propertyAddress: lead.address,
            ownerAddress: lead.owner_address,
            recommendation: "Owner mailing address differs from property address — absentee owner. May use a property management company. Higher priority for outreach since they likely need local contractors.",
          } as any,
          confidence: 0.9,
          tokensUsed: 0,
          status: "pending",
        });
        auditProgress.findingsCount++;
      } catch (error: any) {
        auditProgress.errors++;
      }
      auditProgress.processed++;
    }

    for (const lead of oldBuildingRows) {
      if (!auditProgress.running) break;
      try {
        const age = new Date().getFullYear() - (lead.year_built || 2000);
        await db.insert(aiAuditResults).values({
          leadId: lead.id,
          auditType: "stale_data",
          findings: {
            subType: "old_roof_unknown",
            ownerName: lead.owner_name,
            yearBuilt: lead.year_built,
            buildingAge: age,
            recommendation: `Building is ${age} years old (built ${lead.year_built}) with no roof replacement record. Roof has almost certainly been replaced at least once — data is incomplete. High-value inspection target.`,
          } as any,
          confidence: 0.75,
          tokensUsed: 0,
          status: "pending",
        });
        auditProgress.findingsCount++;
      } catch (error: any) {
        auditProgress.errors++;
      }
      auditProgress.processed++;
    }

    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    console.log(`[stale-data] Complete: ${auditProgress.findingsCount} stale data findings`);
  } catch (error: any) {
    console.error("[stale-data] Fatal error:", error.message);
    auditProgress.running = false;
    auditProgress.completedAt = new Date().toISOString();
    auditProgress.errors++;
  }
}
