import { storage } from "./storage";
import { enrichLeadContacts } from "./contact-enrichment";
import { enrichLeadPhones } from "./phone-enrichment";
import { runWebResearch } from "./web-research-agent";

export interface PipelineStats {
  total: number;
  withOwner: number;
  withTxFilingData: number;
  withPhone: number;
  withBusinessWebsite: number;
  withContactPerson: number;
  withEmail: number;
  fullyEnriched: number;
  contactConfidence: {
    high: number;
    medium: number;
    low: number;
    none: number;
  };
}

export function calculateContactConfidence(lead: {
  ownerName: string | null;
  ownerPhone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  businessWebsite: string | null;
  sosFileNumber: string | null;
  taxpayerId: string | null;
}): { score: number; level: "high" | "medium" | "low" | "none"; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  if (lead.ownerName) { score += 10; factors.push("Owner identified"); }
  if (lead.sosFileNumber || lead.taxpayerId) { score += 15; factors.push("TX filing verified"); }
  if (lead.ownerPhone) { score += 20; factors.push("Phone number found"); }
  if (lead.businessWebsite) { score += 10; factors.push("Business website found"); }
  if (lead.contactName) { score += 20; factors.push("Decision-maker identified"); }
  if (lead.contactPhone) { score += 15; factors.push("Direct phone found"); }
  if (lead.contactEmail) { score += 10; factors.push("Email found"); }

  const level = score >= 60 ? "high" : score >= 30 ? "medium" : score > 0 ? "low" : "none";
  return { score, level, factors };
}

export async function getPipelineStats(marketId?: string): Promise<PipelineStats> {
  const { leads } = await storage.getLeads(marketId ? { marketId } : undefined);

  const stats: PipelineStats = {
    total: leads.length,
    withOwner: 0,
    withTxFilingData: 0,
    withPhone: 0,
    withBusinessWebsite: 0,
    withContactPerson: 0,
    withEmail: 0,
    fullyEnriched: 0,
    contactConfidence: { high: 0, medium: 0, low: 0, none: 0 },
  };

  for (const lead of leads) {
    if (lead.ownerName) stats.withOwner++;
    if (lead.sosFileNumber || lead.taxpayerId) stats.withTxFilingData++;
    if (lead.ownerPhone || lead.contactPhone) stats.withPhone++;
    if (lead.businessWebsite) stats.withBusinessWebsite++;
    if (lead.contactName) stats.withContactPerson++;
    if (lead.contactEmail) stats.withEmail++;

    const hasPhone = !!(lead.ownerPhone || lead.contactPhone);
    const hasContact = !!lead.contactName;
    const hasFiling = !!(lead.sosFileNumber || lead.taxpayerId);
    if (hasPhone && hasContact && hasFiling) stats.fullyEnriched++;

    const { level } = calculateContactConfidence(lead);
    stats.contactConfidence[level]++;
  }

  return stats;
}

export interface PipelineRunResult {
  stage: string;
  status: "completed" | "skipped" | "error";
  detail: string;
}

export async function runFullPipeline(
  marketId?: string,
  options: { batchSize?: number } = {}
): Promise<PipelineRunResult[]> {
  const results: PipelineRunResult[] = [];
  const batchSize = options.batchSize || 25;

  console.log(`[Pipeline] Starting full enrichment pipeline (batch: ${batchSize})`);

  try {
    console.log("[Pipeline] Stage 1: TX Open Data contact enrichment");
    const contactResult = await enrichLeadContacts(marketId, { batchSize });
    results.push({
      stage: "TX Filing Lookup",
      status: "completed",
      detail: `${contactResult.enriched} enriched, ${contactResult.skipped} skipped`,
    });
  } catch (err: any) {
    console.error("[Pipeline] Stage 1 error:", err.message);
    results.push({ stage: "TX Filing Lookup", status: "error", detail: err.message });
  }

  try {
    console.log("[Pipeline] Stage 2: Phone number enrichment");
    const phoneResult = await enrichLeadPhones(marketId, { batchSize });
    results.push({
      stage: "Phone Lookup",
      status: "completed",
      detail: `${phoneResult.enriched} found, ${phoneResult.skipped} no phone`,
    });
  } catch (err: any) {
    console.error("[Pipeline] Stage 2 error:", err.message);
    results.push({ stage: "Phone Lookup", status: "error", detail: err.message });
  }

  try {
    console.log("[Pipeline] Stage 3: Web research for decision-makers");
    const webResult = await runWebResearch(marketId, { batchSize });
    results.push({
      stage: "Web Research",
      status: "completed",
      detail: `${webResult.found} contacts found, ${webResult.skipped} skipped`,
    });
  } catch (err: any) {
    console.error("[Pipeline] Stage 3 error:", err.message);
    results.push({ stage: "Web Research", status: "error", detail: err.message });
  }

  console.log("[Pipeline] Full enrichment pipeline complete");
  return results;
}
