import { storage } from "./storage";
import type { Lead } from "@shared/schema";

const TX_COMPTROLLER_API = "https://api.comptroller.texas.gov/public-data/v1/public";

interface FranchiseTaxRecord {
  taxpayerId: string;
  name: string;
  fileNumber: string;
}

interface FranchiseTaxDetail {
  taxpayerId: string;
  feiNumber?: string;
  name: string;
  dbaName?: string;
  mailingAddressStreet?: string;
  mailingAddressCity?: string;
  mailingAddressState?: string;
  mailingAddressZip?: string;
  sosFileNumber?: string;
  registeredAgentName?: string;
  registeredOfficeAddressStreet?: string;
  registeredOfficeAddressCity?: string;
  registeredOfficeAddressState?: string;
  registeredOfficeAddressZip?: string;
  officerInfo?: Array<{
    AGNT_NM: string;
    AGNT_TITL_TX: string;
    AGNT_ACTV_YR: string;
    AD_STR_POB_TX?: string;
    CITY_NM?: string;
    ST_CD?: string;
    AD_ZP?: string;
    SOURCE?: string;
  }>;
}

function cleanCompanyName(name: string): string {
  return name
    .replace(/\s+(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LP|L\.P\.|LTD|LIMITED)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchFranchiseTax(name: string, apiKey: string): Promise<FranchiseTaxRecord[]> {
  const searchName = name.substring(0, 50);
  const url = `${TX_COMPTROLLER_API}/franchise-tax-list?name=${encodeURIComponent(searchName)}`;

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("TX Comptroller API rate limit exceeded. Try again later.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid TX Comptroller API key. Register at https://data-secure.comptroller.texas.gov");
    }
    throw new Error(`TX Comptroller API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.success || !data.data) return [];
  return data.data;
}

async function getFranchiseTaxDetail(taxpayerId: string, apiKey: string): Promise<FranchiseTaxDetail | null> {
  const url = `${TX_COMPTROLLER_API}/franchise-tax/${taxpayerId}`;

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    if (response.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      const retry = await fetch(url, { headers: { "x-api-key": apiKey } });
      if (!retry.ok) return null;
      const retryData = await retry.json();
      return retryData.success ? retryData.data : null;
    }
    return null;
  }

  const data = await response.json();
  return data.success ? data.data : null;
}

function findBestMatch(ownerName: string, records: FranchiseTaxRecord[]): FranchiseTaxRecord | null {
  if (records.length === 0) return null;
  if (records.length === 1) return records[0];

  const normalized = normalizeForSearch(ownerName);
  const exact = records.find(r => normalizeForSearch(r.name) === normalized);
  if (exact) return exact;

  const cleaned = normalizeForSearch(cleanCompanyName(ownerName));
  const partial = records.find(r => {
    const rClean = normalizeForSearch(cleanCompanyName(r.name));
    return rClean === cleaned || rClean.includes(cleaned) || cleaned.includes(rClean);
  });
  if (partial) return partial;

  return records[0];
}

export async function enrichLeadContacts(
  marketId?: string,
  options: { batchSize?: number; delayMs?: number } = {}
): Promise<{ enriched: number; skipped: number; errors: number; noApiKey?: boolean }> {
  const apiKey = process.env.TX_COMPTROLLER_API_KEY;
  if (!apiKey) {
    return { enriched: 0, skipped: 0, errors: 0, noApiKey: true };
  }

  const allLeads = await storage.getLeads(marketId ? { marketId } : undefined);
  const eligibleLeads = allLeads.filter(lead =>
    !lead.contactEnrichedAt &&
    (lead.ownerType === "LLC" || lead.ownerType === "Corporation" || lead.ownerType === "LP") &&
    lead.ownerName
  );

  if (eligibleLeads.length === 0) {
    return { enriched: 0, skipped: allLeads.length, errors: 0 };
  }

  const batchSize = options.batchSize || 50;
  const delayMs = options.delayMs || 500;
  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  const ownerGroups = new Map<string, Lead[]>();
  for (const lead of eligibleLeads) {
    const key = normalizeForSearch(lead.ownerName);
    if (!ownerGroups.has(key)) ownerGroups.set(key, []);
    ownerGroups.get(key)!.push(lead);
  }

  const uniqueOwners = Array.from(ownerGroups.entries());
  const batch = uniqueOwners.slice(0, batchSize);

  console.log(`[Contact Enrichment] Processing ${batch.length} unique owners (${eligibleLeads.length} leads) via TX Comptroller API`);

  const importRun = await storage.createImportRun({
    type: "contact_enrichment",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "tx_comptroller", totalOwners: batch.length, totalLeads: eligibleLeads.length },
  });

  for (let i = 0; i < batch.length; i++) {
    const [ownerKey, ownerLeads] = batch[i];
    const ownerName = ownerLeads[0].ownerName;

    try {
      const records = await searchFranchiseTax(ownerName, apiKey);

      if (records.length === 0) {
        for (const lead of ownerLeads) {
          await storage.updateLead(lead.id, { contactEnrichedAt: new Date() } as any);
        }
        skipped += ownerLeads.length;
        continue;
      }

      const match = findBestMatch(ownerName, records);
      if (!match) {
        skipped += ownerLeads.length;
        continue;
      }

      await new Promise(r => setTimeout(r, delayMs));

      const detail = await getFranchiseTaxDetail(match.taxpayerId, apiKey);
      if (!detail) {
        skipped += ownerLeads.length;
        continue;
      }

      const primaryOfficer = detail.officerInfo?.[0];

      const updates: Partial<Lead> = {
        taxpayerId: match.taxpayerId,
        sosFileNumber: detail.sosFileNumber || null,
        contactEnrichedAt: new Date(),
      } as any;

      if (detail.registeredAgentName) {
        updates.registeredAgent = detail.registeredAgentName;
      }

      if (primaryOfficer) {
        updates.officerName = primaryOfficer.AGNT_NM;
        updates.officerTitle = primaryOfficer.AGNT_TITL_TX;
      }

      if (detail.registeredOfficeAddressStreet && !updates.ownerAddress) {
        const agentAddr = [
          detail.registeredOfficeAddressStreet,
          detail.registeredOfficeAddressCity,
          detail.registeredOfficeAddressState,
          detail.registeredOfficeAddressZip,
        ].filter(Boolean).join(", ");
        if (agentAddr) {
          updates.ownerAddress = agentAddr;
        }
      }

      for (const lead of ownerLeads) {
        await storage.updateLead(lead.id, updates);
      }
      enriched += ownerLeads.length;

      if (i % 10 === 0) {
        console.log(`[Contact Enrichment] Progress: ${i + 1}/${batch.length} owners processed (${enriched} enriched, ${skipped} skipped)`);
      }

      await new Promise(r => setTimeout(r, delayMs));

    } catch (err: any) {
      console.error(`[Contact Enrichment] Error enriching owner "${ownerName}":`, err.message);
      errors += ownerLeads.length;

      if (err.message.includes("rate limit")) {
        console.log("[Contact Enrichment] Rate limited, pausing for 10s...");
        await new Promise(r => setTimeout(r, 10000));
      }
      if (err.message.includes("Invalid") && err.message.includes("API key")) {
        break;
      }
    }
  }

  await storage.updateImportRun(importRun.id, {
    status: "completed",
    completedAt: new Date(),
    recordsProcessed: batch.length,
    recordsImported: enriched,
    recordsSkipped: skipped,
    errors: errors > 0 ? `${errors} leads failed enrichment` : null,
  });

  console.log(`[Contact Enrichment] Complete: ${enriched} enriched, ${skipped} skipped, ${errors} errors`);
  return { enriched, skipped, errors };
}

export function getEnrichmentStatus(): { configured: boolean; apiKeySet: boolean } {
  return {
    configured: true,
    apiKeySet: !!process.env.TX_COMPTROLLER_API_KEY,
  };
}
