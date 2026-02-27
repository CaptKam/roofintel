import { storage } from "./storage";
import { dualWriteUpdate } from "./dual-write";
import type { Lead } from "@shared/schema";
import { recordEvidence } from "./evidence-recorder";

const TX_OPEN_DATA_API = "https://data.texas.gov/resource/9cir-efmm.json";

interface TxOpenDataRecord {
  taxpayer_number: string;
  taxpayer_name: string;
  taxpayer_address: string;
  taxpayer_city: string;
  taxpayer_state: string;
  taxpayer_zip: string;
  taxpayer_county_code: string;
  taxpayer_organizational_type: string;
  record_type_code: string;
  responsibility_beginning_date: string;
  secretary_of_state_sos_or_coa_file_number: string;
  sos_charter_date: string;
  sos_status_date: string;
  sos_status_code: string;
  right_to_transact_business_code: string;
  outlet_address?: string;
  outlet_city?: string;
  outlet_state?: string;
  outlet_zip?: string;
  outlet_phone?: string;
}

function cleanCompanyName(name: string): string {
  return name
    .replace(/&amp;/g, "&")
    .replace(/\s+(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LP|L\.P\.|LTD|LIMITED|LLP|L\.L\.P\.)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(name: string): string {
  return name
    .toUpperCase()
    .replace(/&amp;/g, "&")
    .replace(/[.,'"&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchName(ownerName: string): string {
  let cleaned = ownerName.replace(/&amp;/g, "&");
  cleaned = cleanCompanyName(cleaned);
  cleaned = cleaned.replace(/['"]/g, "").replace(/&/g, " ");
  return cleaned.substring(0, 50).trim();
}

async function searchTexasOpenData(name: string): Promise<TxOpenDataRecord[]> {
  const searchName = buildSearchName(name);
  const encodedSearch = encodeURIComponent(`taxpayer_name like '%${searchName.replace(/'/g, "''")}%'`);
  const url = `${TX_OPEN_DATA_API}?$where=${encodedSearch}&$limit=10`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Texas Open Data rate limit. Try again later.");
    }
    throw new Error(`Texas Open Data error: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function findBestMatch(ownerName: string, records: TxOpenDataRecord[]): TxOpenDataRecord | null {
  if (records.length === 0) return null;

  const normalized = normalizeForSearch(ownerName);
  const cleaned = normalizeForSearch(cleanCompanyName(ownerName));

  const exact = records.find(r => normalizeForSearch(r.taxpayer_name) === normalized);
  if (exact) return exact;

  const partial = records.find(r => {
    const rClean = normalizeForSearch(cleanCompanyName(r.taxpayer_name));
    return rClean === cleaned || rClean.includes(cleaned) || cleaned.includes(rClean);
  });
  if (partial) return partial;

  return null;
}

function formatOrgType(code: string): string {
  const types: Record<string, string> = {
    "CL": "Limited Liability Company",
    "CI": "Limited Liability Company (Interstate)",
    "CT": "Corporation (Texas)",
    "CF": "Corporation (Foreign)",
    "CP": "Professional Corporation",
    "LP": "Limited Partnership",
    "PA": "Professional Association",
    "NP": "Nonprofit Corporation",
  };
  return types[code] || code;
}

function normalizeOutletPhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (last10 === "0000000000" || last10 === "1111111111" || last10 === "1234567890") return null;
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
}

export async function enrichLeadContacts(
  marketId?: string,
  options: { batchSize?: number; delayMs?: number } = {}
): Promise<{ enriched: number; skipped: number; errors: number; total: number }> {
  const { leads: allLeads } = await storage.getLeads(marketId ? { marketId } : undefined);
  const eligibleLeads = allLeads.filter(lead =>
    !lead.contactEnrichedAt &&
    (lead.ownerType === "LLC" || lead.ownerType === "Corporation" || lead.ownerType === "LP") &&
    lead.ownerName
  );

  if (eligibleLeads.length === 0) {
    return { enriched: 0, skipped: allLeads.length, errors: 0, total: allLeads.length };
  }

  const batchSize = options.batchSize || 50;
  const delayMs = options.delayMs || 300;
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

  console.log(`[Contact Enrichment] Processing ${batch.length} unique owners (${eligibleLeads.length} eligible leads) via Texas Open Data Portal (with outlet phone/address extraction)`);

  const importRun = await storage.createImportRun({
    type: "contact_enrichment",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "tx_open_data", totalOwners: batch.length, totalLeads: eligibleLeads.length },
  });

  for (let i = 0; i < batch.length; i++) {
    const [ownerKey, ownerLeads] = batch[i];
    const ownerName = ownerLeads[0].ownerName;

    try {
      const records = await searchTexasOpenData(ownerName);

      if (records.length === 0) {
        for (const lead of ownerLeads) {
          await dualWriteUpdate(lead.id, { contactEnrichedAt: new Date() } as any, "contact_enrichment");
        }
        skipped += ownerLeads.length;
        continue;
      }

      const match = findBestMatch(ownerName, records);
      if (!match) {
        skipped += ownerLeads.length;
        continue;
      }

      const sosFileNum = match.secretary_of_state_sos_or_coa_file_number;
      const taxpayerAddr = [
        match.taxpayer_address,
        match.taxpayer_city,
        match.taxpayer_state,
        match.taxpayer_zip,
      ].filter(Boolean).join(", ");

      const outletPhone = normalizeOutletPhone(match.outlet_phone);
      const outletAddr = [
        match.outlet_address,
        match.outlet_city,
        match.outlet_state,
        match.outlet_zip,
      ].filter(Boolean).join(", ");

      const updates: Partial<Lead> = {
        taxpayerId: match.taxpayer_number,
        sosFileNumber: sosFileNum || null,
        registeredAgent: formatOrgType(match.taxpayer_organizational_type),
        contactEnrichedAt: new Date(),
      } as any;

      if (taxpayerAddr && taxpayerAddr.length > 5) {
        const officerLine = `TX Filing: ${match.taxpayer_name}`;
        updates.officerName = officerLine;
        updates.officerTitle = match.right_to_transact_business_code === "A" ? "Active" : "Inactive";
      }

      if (outletPhone) {
        (updates as any).ownerPhone = (updates as any).ownerPhone || outletPhone;
        (updates as any).phoneSource = (updates as any).phoneSource || "TX Sales Tax Outlet";
      }

      for (const lead of ownerLeads) {
        const leadUpdates = { ...updates } as any;
        if (outletPhone && lead.ownerPhone) {
          delete leadUpdates.ownerPhone;
          delete leadUpdates.phoneSource;
        }
        await dualWriteUpdate(lead.id, leadUpdates, "contact_enrichment");

        if (outletPhone) {
          try {
            await recordEvidence({
              leadId: lead.id,
              entityType: "LEAD",
              entityId: lead.id,
              contactType: "phone",
              contactValue: outletPhone,
              normalizedValue: outletPhone.replace(/\D/g, ""),
              isPublicBusiness: true,
              sourceName: "TX Comptroller Sales Tax",
              sourceUrl: `https://data.texas.gov/resource/9cir-efmm.json?taxpayer_number=${match.taxpayer_number}`,
              sourceType: "API",
              extractorMethod: "RULE",
              rawSnippet: `Outlet phone for ${match.taxpayer_name}: ${outletPhone}` +
                (outletAddr ? ` at ${outletAddr}` : ""),
              confidence: 85,
            });
          } catch (evErr: any) {
            console.error(`[Contact Enrichment] Failed to record outlet phone evidence for lead ${lead.id}:`, evErr.message);
          }
        }

        if (outletAddr && outletAddr.length > 5) {
          try {
            await recordEvidence({
              leadId: lead.id,
              entityType: "LEAD",
              entityId: lead.id,
              contactType: "address",
              contactValue: outletAddr,
              normalizedValue: outletAddr.toUpperCase(),
              isPublicBusiness: true,
              sourceName: "TX Comptroller Sales Tax",
              sourceUrl: `https://data.texas.gov/resource/9cir-efmm.json?taxpayer_number=${match.taxpayer_number}`,
              sourceType: "API",
              extractorMethod: "RULE",
              rawSnippet: `Outlet address for ${match.taxpayer_name}: ${outletAddr}`,
              confidence: 85,
            });
          } catch (evErr: any) {
            console.error(`[Contact Enrichment] Failed to record outlet address evidence for lead ${lead.id}:`, evErr.message);
          }
        }
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
        console.log("[Contact Enrichment] Rate limited, pausing for 5s...");
        await new Promise(r => setTimeout(r, 5000));
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
  return { enriched, skipped, errors, total: eligibleLeads.length };
}

export function getEnrichmentStatus(): { configured: boolean; apiKeySet: boolean } {
  return {
    configured: true,
    apiKeySet: true,
  };
}
