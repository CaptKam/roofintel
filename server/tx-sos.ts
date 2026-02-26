import { db } from "./storage";
import { leads as leadsTable } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { recordEvidence } from "./evidence-recorder";
import { isPersonName } from "./contact-validation";

const COMPTROLLER_SEARCH = "https://mycpa.cpa.state.tx.us/coa/coaSearchBtn";
const COMPTROLLER_DETAIL = "https://mycpa.cpa.state.tx.us/coa/coaSearchFn";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const MAX_LLC_CHAIN_DEPTH = 3;

export interface SOSEntityResult {
  success: boolean;
  entity?: {
    name: string;
    sosFileNumber: string;
    taxpayerId: string;
    status: string;
    officers: Array<{ name: string; title: string }>;
    registeredAgent: string | null;
    formationDate: string | null;
    entityType: string | null;
    address: string | null;
  };
  error?: string;
}

export interface BatchSOSStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  officersFound: number;
  companiesSkippedAsOfficers: number;
  startedAt: string;
  completedAt?: string;
  inProgress: boolean;
}

let currentBatchStats: BatchSOSStats | null = null;

export function getSOSBatchStatus(): BatchSOSStats | null {
  return currentBatchStats;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (resp.status === 429 || resp.status >= 500) {
        const delayMs = RETRY_DELAY_MS * attempt;
        console.log(`[TX SOS] HTTP ${resp.status} on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        continue;
      }

      return resp;
    } catch (err: any) {
      clearTimeout(timer);
      const isLastAttempt = attempt === MAX_RETRIES;
      const reason = err.name === "AbortError" ? "timeout" : err.message;
      if (isLastAttempt) {
        console.log(`[TX SOS] Fetch failed after ${MAX_RETRIES} attempts (${reason}): ${url}`);
        return null;
      }
      const delayMs = RETRY_DELAY_MS * attempt;
      console.log(`[TX SOS] Fetch error on attempt ${attempt}/${MAX_RETRIES} (${reason}), retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  return null;
}

export async function searchComptrollerByName(name: string): Promise<any[]> {
  try {
    const cleanName = name
      .replace(/\b(LLC|L\.L\.C|LP|L\.P|INC|CORP|LTD|CO|COMPANY)\b\.?/gi, "")
      .trim();

    if (!cleanName || cleanName.length < 2) {
      console.log(`[TX SOS] Skipping search — cleaned name too short: "${name}" -> "${cleanName}"`);
      return [];
    }

    const resp = await fetchWithRetry(
      `${COMPTROLLER_DETAIL}?pTaxpayerName=${encodeURIComponent(cleanName)}`,
      { headers: { Accept: "text/html" } }
    );
    if (!resp) {
      console.log(`[TX SOS] Comptroller name search returned no response for: "${cleanName}"`);
      return [];
    }
    if (!resp.ok) {
      console.log(`[TX SOS] Comptroller name search HTTP ${resp.status} for: "${cleanName}"`);
      return [];
    }

    const html = await resp.text();
    if (!html || html.length < 100) {
      console.log(`[TX SOS] Comptroller name search returned empty/short HTML for: "${cleanName}"`);
      return [];
    }
    const results = parseComptrollerSearchResults(html);
    console.log(`[TX SOS] Comptroller name search for "${cleanName}": ${results.length} result(s)`);
    return results;
  } catch (err: any) {
    console.log(`[TX SOS] Comptroller name search exception for "${name}": ${err.message}`);
    return [];
  }
}

export async function searchComptrollerByFileNumber(fileNumber: string): Promise<any> {
  try {
    const resp = await fetchWithRetry(
      `${COMPTROLLER_DETAIL}?pTaxpayerNumber=${encodeURIComponent(fileNumber)}`,
      { headers: { Accept: "text/html" } }
    );
    if (!resp) {
      console.log(`[TX SOS] Comptroller file number lookup returned no response for: ${fileNumber}`);
      return null;
    }
    if (!resp.ok) {
      console.log(`[TX SOS] Comptroller file number lookup HTTP ${resp.status} for: ${fileNumber}`);
      return null;
    }

    const html = await resp.text();
    if (!html || html.length < 100) {
      console.log(`[TX SOS] Comptroller file number lookup returned empty/short HTML for: ${fileNumber}`);
      return null;
    }
    return parseComptrollerDetail(html);
  } catch (err: any) {
    console.log(`[TX SOS] Comptroller file number lookup exception for ${fileNumber}: ${err.message}`);
    return null;
  }
}

function parseComptrollerSearchResults(html: string): any[] {
  const results: any[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length >= 3) {
      const getText = (cell: string) => cell.replace(/<[^>]+>/g, "").trim();
      const taxpayerNumber = getText(cells[0]!);
      const taxpayerName = getText(cells[1]);
      const sosFileNumber = cells.length > 2 ? getText(cells[2]) : null;
      if (taxpayerNumber || taxpayerName) {
        results.push({ taxpayerNumber, taxpayerName, sosFileNumber });
      }
    }
  }
  return results;
}

function parseComptrollerDetail(html: string): any {
  const get = (label: string): string | null => {
    const regex = new RegExp(`${label}[\\s:]*</?(td|th|label)[^>]*>\\s*<?(td|span)[^>]*>([^<]+)`, "i");
    const m = html.match(regex);
    return m ? m[3].trim() : null;
  };

  const result = {
    taxpayerName: get("Taxpayer Name") || get("Name"),
    taxpayerNumber: get("Taxpayer Number") || get("Taxpayer ID"),
    sosFileNumber: get("SOS File Number") || get("Secretary of State"),
    status: get("Right to Transact") || get("Status"),
    address: get("Mailing Address") || get("Address"),
    stateOfFormation: get("State of Formation"),
    entityType: get("Entity Type"),
  };

  if (!result.taxpayerName && !result.taxpayerNumber) {
    console.log("[TX SOS] Comptroller detail parse returned no taxpayer name or number");
    return null;
  }

  return result;
}

function isLLCOrCompanyName(name: string): boolean {
  if (!name) return false;
  const llcPattern = /\b(LLC|L\.L\.C|LP|L\.P|INC|CORP|CORPORATION|LTD|LIMITED|COMPANY|CO|PARTNERS|PARTNERSHIP|TRUST|HOLDINGS|VENTURES|PROPERTIES|MANAGEMENT|GROUP|ASSOCIATES|ENTERPRISES|CAPITAL|INVESTMENTS|REALTY|DEVELOPMENT)\b/i;
  return llcPattern.test(name);
}

async function traverseLLCChain(
  initialName: string,
  depth: number = 0
): Promise<SOSEntityResult> {
  if (depth >= MAX_LLC_CHAIN_DEPTH) {
    console.log(`[TX SOS] LLC chain traversal reached max depth (${MAX_LLC_CHAIN_DEPTH}) for: "${initialName}"`);
    return { success: false, error: `LLC chain traversal exceeded max depth of ${MAX_LLC_CHAIN_DEPTH}` };
  }

  const searchResults = await searchComptrollerByName(initialName);
  if (searchResults.length === 0 || !searchResults[0].sosFileNumber) {
    return { success: false, error: `No SOS results found for: "${initialName}"` };
  }

  const result = await fetchSOSEntityOfficers(searchResults[0].sosFileNumber);
  if (!result.success || !result.entity) return result;

  const hasPersonOfficers = result.entity.officers.some(
    (o) => o.name && isPersonName(o.name)
  );

  if (hasPersonOfficers) {
    return result;
  }

  for (const officer of result.entity.officers) {
    if (officer.name && isLLCOrCompanyName(officer.name) && officer.name.toLowerCase() !== initialName.toLowerCase()) {
      console.log(`[TX SOS] LLC chain: "${initialName}" -> officer is company "${officer.name}", following chain (depth ${depth + 1})`);
      const parentResult = await traverseLLCChain(officer.name, depth + 1);
      if (parentResult.success && parentResult.entity && parentResult.entity.officers.some(o => o.name && isPersonName(o.name))) {
        return parentResult;
      }
    }
  }

  if (result.entity.registeredAgent && isLLCOrCompanyName(result.entity.registeredAgent) &&
      result.entity.registeredAgent.toLowerCase() !== initialName.toLowerCase()) {
    console.log(`[TX SOS] LLC chain: "${initialName}" -> registered agent is company "${result.entity.registeredAgent}", following chain (depth ${depth + 1})`);
    const agentResult = await traverseLLCChain(result.entity.registeredAgent, depth + 1);
    if (agentResult.success && agentResult.entity && agentResult.entity.officers.some(o => o.name && isPersonName(o.name))) {
      return agentResult;
    }
  }

  return result;
}

export async function fetchSOSEntityOfficers(
  sosFileNumber: string,
  apiKey?: string
): Promise<SOSEntityResult> {
  if (!apiKey) apiKey = process.env.TX_COMPTROLLER_API_KEY;

  if (apiKey) {
    try {
      const resp = await fetchWithRetry(
        `https://data.texas.gov/resource/jnfd-kphy.json?$where=secretary_of_state_sos_or_coa_file_number='${sosFileNumber}'`,
        {
          headers: {
            "X-App-Token": apiKey,
            Accept: "application/json",
          },
        }
      );

      if (resp && resp.ok) {
        const data = (await resp.json()) as any[];
        if (data.length > 0) {
          const entity = data[0];

          const officers: Array<{ name: string; title: string }> = [];

          if (entity.officer_director_or_manager_name) {
            officers.push({
              name: formatName(entity.officer_director_or_manager_name),
              title: entity.officer_director_or_manager_title || "Officer",
            });
          }
          if (entity.additional_officer_director_or_manager) {
            officers.push({
              name: formatName(entity.additional_officer_director_or_manager),
              title: entity.additional_officer_title || "Director",
            });
          }

          console.log(`[TX SOS] API lookup for SOS#${sosFileNumber}: found "${entity.taxpayer_name}", ${officers.length} officer(s)`);

          return {
            success: true,
            entity: {
              name: entity.taxpayer_name || "",
              sosFileNumber: entity.secretary_of_state_sos_or_coa_file_number || sosFileNumber,
              taxpayerId: entity.taxpayer_number || "",
              status: entity.right_to_transact_business_in_texas || "",
              officers,
              registeredAgent: entity.registered_agent_name
                ? formatName(entity.registered_agent_name)
                : null,
              formationDate: entity.beginning_date || null,
              entityType: entity.entity_type_description || null,
              address: [entity.mailing_address, entity.mailing_city, entity.mailing_state, entity.mailing_zip]
                .filter(Boolean)
                .join(", ") || null,
            },
          };
        } else {
          console.log(`[TX SOS] API lookup for SOS#${sosFileNumber}: no results found`);
        }
      } else if (resp) {
        console.log(`[TX SOS] API lookup for SOS#${sosFileNumber}: HTTP ${resp.status}`);
      } else {
        console.log(`[TX SOS] API lookup for SOS#${sosFileNumber}: no response (network failure)`);
      }
    } catch (err: any) {
      console.log(`[TX SOS] Comptroller API lookup failed for SOS#${sosFileNumber}: ${err.message}`);
    }
  }

  console.log(`[TX SOS] Falling back to HTML scrape for SOS#${sosFileNumber}`);
  const comptrollerResult = await searchComptrollerByFileNumber(sosFileNumber);
  if (comptrollerResult) {
    console.log(`[TX SOS] HTML scrape for SOS#${sosFileNumber}: found "${comptrollerResult.taxpayerName}"`);
    return {
      success: true,
      entity: {
        name: comptrollerResult.taxpayerName || "",
        sosFileNumber,
        taxpayerId: comptrollerResult.taxpayerNumber || "",
        status: comptrollerResult.status || "",
        officers: [],
        registeredAgent: null,
        formationDate: null,
        entityType: comptrollerResult.entityType || null,
        address: comptrollerResult.address || null,
      },
    };
  }

  console.log(`[TX SOS] Entity not found via API or HTML scrape for SOS#${sosFileNumber}`);
  return { success: false, error: "Entity not found in TX SOS/Comptroller records" };
}

function formatName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function enrichLeadFromTXSOS(leadId: string): Promise<SOSEntityResult> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) return { success: false, error: "Lead not found" };

  let result: SOSEntityResult = { success: false, error: "No SOS file number or LLC name available" };

  if (lead.sosFileNumber) {
    result = await fetchSOSEntityOfficers(lead.sosFileNumber);

    if (result.success && result.entity) {
      const hasPersonOfficers = result.entity.officers.some(
        (o) => o.name && isPersonName(o.name)
      );
      if (!hasPersonOfficers && result.entity.name && isLLCOrCompanyName(result.entity.name)) {
        console.log(`[TX SOS] Lead ${leadId}: No person officers found, attempting LLC chain traversal for "${result.entity.name}"`);
        const chainResult = await traverseLLCChain(result.entity.name, 0);
        if (chainResult.success && chainResult.entity &&
            chainResult.entity.officers.some(o => o.name && isPersonName(o.name))) {
          result = chainResult;
        }
      }
    }
  } else if (lead.llcName || (lead.ownerName && !isPersonName(lead.ownerName))) {
    const searchName = lead.llcName || lead.ownerName;
    if (searchName) {
      result = await traverseLLCChain(searchName, 0);
    }
  }

  if (!result.success || !result.entity) return result;

  const entity = result.entity;
  let officersRecorded = 0;
  let companiesSkipped = 0;

  for (const officer of entity.officers) {
    if (!officer.name) continue;
    if (isPersonName(officer.name)) {
      await recordEvidence({
        leadId,
        contactType: "PERSON",
        contactValue: officer.name,
        sourceName: "TX Secretary of State",
        sourceUrl: `https://mycpa.cpa.state.tx.us/coa/Index.html`,
        sourceType: "GOV_DB",
        extractorMethod: "TX_SOS_OFFICER",
        confidence: 90,
        rawSnippet: `${officer.title} of ${entity.name}`,
      });
      officersRecorded++;
    } else {
      console.log(`[TX SOS] Lead ${leadId}: Skipped non-person officer "${officer.name}" (company name)`);
      companiesSkipped++;
    }
  }

  if (entity.registeredAgent) {
    if (isPersonName(entity.registeredAgent)) {
      await recordEvidence({
        leadId,
        contactType: "PERSON",
        contactValue: entity.registeredAgent,
        sourceName: "TX Secretary of State",
        sourceType: "GOV_DB",
        extractorMethod: "TX_SOS_REG_AGENT",
        confidence: 85,
        rawSnippet: `Registered Agent for ${entity.name}`,
      });
      officersRecorded++;
    } else {
      console.log(`[TX SOS] Lead ${leadId}: Skipped non-person registered agent "${entity.registeredAgent}"`);
      companiesSkipped++;
    }
  }

  if (officersRecorded > 0 || companiesSkipped > 0) {
    console.log(`[TX SOS] Lead ${leadId}: Recorded ${officersRecorded} person(s), skipped ${companiesSkipped} company name(s)`);
  }

  const updates: Record<string, any> = {};
  if (!lead.sosFileNumber && entity.sosFileNumber) updates.sosFileNumber = entity.sosFileNumber;
  if (!lead.taxpayerId && entity.taxpayerId) updates.taxpayerId = entity.taxpayerId;
  if (!lead.registeredAgent && entity.registeredAgent && isPersonName(entity.registeredAgent)) {
    updates.registeredAgent = entity.registeredAgent;
  }

  if (entity.officers.length > 0) {
    const personOfficer = entity.officers.find(o => o.name && isPersonName(o.name));
    if (personOfficer) {
      if (!lead.officerName) updates.officerName = personOfficer.name;
      if (!lead.officerTitle) updates.officerTitle = personOfficer.title;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(leadsTable).set(updates).where(eq(leadsTable.id, leadId));
  }

  return result;
}

export async function batchEnrichFromTXSOS(limit: number = 500): Promise<BatchSOSStats> {
  if (currentBatchStats?.inProgress) {
    console.log("[TX SOS Batch] Batch already in progress, skipping");
    return currentBatchStats;
  }

  currentBatchStats = {
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    officersFound: 0,
    companiesSkippedAsOfficers: 0,
    startedAt: new Date().toISOString(),
    inProgress: true,
  };

  try {
    const leadsToProcess = await db
      .select({ id: leadsTable.id, ownerName: leadsTable.ownerName, llcName: leadsTable.llcName, sosFileNumber: leadsTable.sosFileNumber })
      .from(leadsTable)
      .where(
        and(
          isNull(leadsTable.officerName),
          sql`(${leadsTable.sosFileNumber} IS NOT NULL OR ${leadsTable.llcName} IS NOT NULL OR (${leadsTable.ownerName} IS NOT NULL AND ${leadsTable.ownerName} != ''))`
        )
      )
      .limit(limit);

    currentBatchStats.total = leadsToProcess.length;
    console.log(`[TX SOS Batch] Starting batch enrichment for ${leadsToProcess.length} leads`);

    for (const lead of leadsToProcess) {
      try {
        if (!lead.sosFileNumber && !lead.llcName && (!lead.ownerName || isPersonName(lead.ownerName))) {
          currentBatchStats.skipped++;
          currentBatchStats.processed++;
          continue;
        }

        const result = await enrichLeadFromTXSOS(lead.id);

        if (result.success && result.entity) {
          currentBatchStats.success++;
          const personOfficers = result.entity.officers.filter(o => o.name && isPersonName(o.name));
          currentBatchStats.officersFound += personOfficers.length;
          const companyOfficers = result.entity.officers.filter(o => o.name && !isPersonName(o.name));
          currentBatchStats.companiesSkippedAsOfficers += companyOfficers.length;
        } else {
          currentBatchStats.failed++;
        }
      } catch (err: any) {
        console.log(`[TX SOS Batch] Error processing lead ${lead.id}: ${err.message}`);
        currentBatchStats.failed++;
      }

      currentBatchStats.processed++;

      if (currentBatchStats.processed % 50 === 0) {
        console.log(
          `[TX SOS Batch] Progress: ${currentBatchStats.processed}/${currentBatchStats.total} | ` +
          `Success: ${currentBatchStats.success} | Failed: ${currentBatchStats.failed} | ` +
          `Skipped: ${currentBatchStats.skipped} | Officers found: ${currentBatchStats.officersFound} | ` +
          `Companies skipped: ${currentBatchStats.companiesSkippedAsOfficers}`
        );
      }

      await sleep(200);
    }
  } catch (err: any) {
    console.log(`[TX SOS Batch] Fatal batch error: ${err.message}`);
  }

  currentBatchStats.inProgress = false;
  currentBatchStats.completedAt = new Date().toISOString();

  console.log(
    `[TX SOS Batch] Completed | Total: ${currentBatchStats.total} | ` +
    `Success: ${currentBatchStats.success} | Failed: ${currentBatchStats.failed} | ` +
    `Skipped: ${currentBatchStats.skipped} | Officers found: ${currentBatchStats.officersFound} | ` +
    `Companies skipped as officers: ${currentBatchStats.companiesSkippedAsOfficers}`
  );

  return currentBatchStats;
}
