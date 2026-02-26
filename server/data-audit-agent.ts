import { db } from "./storage";
import { aiAuditResults, contactEvidence } from "@shared/schema";
import { eq, sql, isNull, and, or, desc } from "drizzle-orm";
import { askClaudeJson, estimateCost } from "./ai-client";

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

interface AuditProgress {
  running: boolean;
  mode: "audit" | "search" | "both";
  processed: number;
  total: number;
  tokensUsed: number;
  estimatedCost: number;
  findingsCount: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
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
  };
}

interface OwnerAnalysis {
  entityType: string;
  isHoldingCompany: boolean;
  isManagementCompany: boolean;
  isActualUser: boolean;
  likelyBusinessType: string;
  decisionMakerHint: string;
  searchSuggestions: string[];
  confidence: number;
}

export async function auditOwnerName(lead: any): Promise<{
  findings: OwnerAnalysis;
  tokens: number;
} | null> {
  const ownerName = lead.ownerName || lead.owner_name;
  if (!ownerName) return null;

  const prompt = `Analyze this commercial property owner name and property data:

Owner Name: "${ownerName}"
Property Address: ${lead.address || "N/A"}, ${lead.city || "N/A"}, TX
Property Type/Zoning: ${lead.zoning || "N/A"}
Improvement Value: $${(lead.improvementValue || lead.improvement_value || 0).toLocaleString()}
Total Value: $${(lead.totalValue || lead.total_value || 0).toLocaleString()}
Sqft: ${(lead.sqft || 0).toLocaleString()}
${lead.ownershipStructure || lead.ownership_structure ? `Current Classification: ${lead.ownershipStructure || lead.ownership_structure}` : ""}
${lead.managingMember || lead.managing_member ? `Managing Member: ${lead.managingMember || lead.managing_member}` : ""}
${lead.businessName || lead.business_name ? `Business Name: ${lead.businessName || lead.business_name}` : ""}

Return JSON:
{
  "entityType": "one of: holding_company, management_company, individual_investor, corporate_tenant, government, religious_org, educational, healthcare, retail_chain, real_estate_fund, other",
  "isHoldingCompany": true/false,
  "isManagementCompany": true/false,
  "isActualUser": true/false,
  "likelyBusinessType": "brief description of what this entity likely does",
  "decisionMakerHint": "who would make roofing decisions for this type of entity (e.g., 'facility manager', 'property management company', 'owner directly')",
  "searchSuggestions": ["2-4 specific search queries to find the decision-maker"],
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
  };

  try {
    const targetLeads = await db.execute(sql`
      SELECT l.id, l.owner_name, l.address, l.city, l.zoning, 
             l.improvement_value, l.total_value, l.sqft,
             l.ownership_structure, l.managing_member, l.business_name,
             l.contact_name, l.contact_phone, l.contact_email,
             l.owner_phone, l.owner_email
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
      } catch (error: any) {
        console.error(`[data-audit] Error processing lead ${lead.id}:`, error.message);
        auditProgress.errors++;
      }

      auditProgress.processed++;
      auditProgress.estimatedCost = estimateCost(auditProgress.tokensUsed);
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
