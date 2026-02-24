import { db } from "./storage";
import { leads as leadsTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { recordEvidence } from "./evidence-recorder";

const USER_AGENT = "RoofIntel/1.0 (admin@roofintel.com)";
const BASE_URL = "https://data.sec.gov";
const SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";

interface EdgarCompany {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  ein: string;
  stateOfIncorporation: string;
  phone: string;
  website: string;
  addresses: {
    mailing: { street1: string; city: string; stateOrCountry: string; zipCode: string };
    business: { street1: string; city: string; stateOrCountry: string; zipCode: string };
  };
  filings: { recent: { form: string[]; filingDate: string[]; primaryDocument: string[] } };
}

export interface EdgarResult {
  success: boolean;
  company?: {
    name: string;
    cik: string;
    ein: string;
    phone: string;
    sic: string;
    sicDescription: string;
    state: string;
    website: string;
    mailingAddress: string;
    businessAddress: string;
  };
  error?: string;
}

async function fetchEdgar(url: string): Promise<any | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function padCik(cik: string): string {
  return cik.replace(/^0+/, "").padStart(10, "0");
}

function formatAddress(addr: any): string {
  if (!addr) return "";
  return [addr.street1, addr.street2, addr.city, addr.stateOrCountry, addr.zipCode]
    .filter(Boolean)
    .join(", ");
}

export async function searchEdgarCompany(companyName: string): Promise<{ cik: string; name: string }[]> {
  const data = await fetchEdgar(
    `${SEARCH_URL}?company=${encodeURIComponent(companyName)}&forms=10-K,10-Q,DEF+14A&dateRange=custom&startdt=2020-01-01&enddt=2030-01-01`
  );
  if (!data?.hits?.hits) return [];

  const seen = new Set<string>();
  const results: { cik: string; name: string }[] = [];

  for (const hit of data.hits.hits) {
    const src = hit._source;
    const cik = src.ciks?.[0];
    const name = src.display_names?.[0] || "";
    if (cik && !seen.has(cik)) {
      seen.add(cik);
      results.push({ cik: padCik(cik), name });
    }
  }
  return results;
}

export async function getEdgarCompanyDetails(cik: string): Promise<EdgarResult> {
  const paddedCik = padCik(cik);
  const data = await fetchEdgar(`${BASE_URL}/submissions/CIK${paddedCik}.json`);
  if (!data) return { success: false, error: "Company not found in EDGAR" };

  return {
    success: true,
    company: {
      name: data.name || "",
      cik: paddedCik,
      ein: data.ein || "",
      phone: data.phone || "",
      sic: data.sic || "",
      sicDescription: data.sicDescription || "",
      state: data.stateOfIncorporation || "",
      website: data.website || data.investorWebsite || "",
      mailingAddress: formatAddress(data.addresses?.mailing),
      businessAddress: formatAddress(data.addresses?.business),
    },
  };
}

export async function enrichLeadFromEdgar(
  leadId: string,
  companyName: string
): Promise<EdgarResult> {
  const candidates = await searchEdgarCompany(companyName);
  if (candidates.length === 0) {
    return { success: true, error: "No SEC filings found for this entity" };
  }

  const details = await getEdgarCompanyDetails(candidates[0].cik);
  if (!details.success || !details.company) return details;

  const company = details.company;

  if (company.phone) {
    await recordEvidence({
      leadId,
      contactType: "PHONE",
      contactValue: company.phone,
      sourceName: "SEC EDGAR",
      sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}`,
      sourceType: "GOV_DB",
      extractorMethod: "EDGAR_SUBMISSION",
      confidence: 80,
      rawSnippet: `${company.name} - SEC registered entity (SIC: ${company.sicDescription})`,
    });
  }

  const updates: Record<string, any> = {};
  if (company.phone && !updates.ownerPhone) {
    updates.ownerPhone = company.phone;
    updates.phoneSource = "SEC EDGAR";
    updates.phoneEnrichedAt = new Date();
  }
  if (company.website) {
    updates.businessWebsite = company.website;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(leadsTable).set(updates).where(eq(leadsTable.id, leadId));
  }

  return details;
}
