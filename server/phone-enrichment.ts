import { storage } from "./storage";
import type { Lead } from "@shared/schema";

export interface PhoneResult {
  phone: string;
  source: string;
}

interface PhoneProvider {
  name: string;
  isAvailable: () => boolean;
  search: (lead: Lead) => Promise<PhoneResult | null>;
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

function extractPhoneNumbers(text: string): string[] {
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
  const matches: string[] = [];
  let match;
  while ((match = phoneRegex.exec(text)) !== null) {
    const formatted = `(${match[1]}) ${match[2]}-${match[3]}`;
    if (!matches.includes(formatted)) {
      matches.push(formatted);
    }
  }
  return matches;
}

function isValidBusinessPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return false;
  const last10 = digits.slice(-10);
  if (last10.startsWith("800") || last10.startsWith("888") || last10.startsWith("877") ||
      last10.startsWith("866") || last10.startsWith("855") || last10.startsWith("844")) {
    return true;
  }
  if (last10 === "0000000000" || last10 === "1111111111" || last10 === "1234567890") {
    return false;
  }
  return true;
}

function placesNameMatches(searchName: string, placeName: string): boolean {
  const normSearch = normalizeForSearch(cleanCompanyName(searchName));
  const normPlace = normalizeForSearch(cleanCompanyName(placeName));
  if (!normSearch || !normPlace) return false;
  if (normPlace.includes(normSearch) || normSearch.includes(normPlace)) return true;
  const searchWords = normSearch.split(" ").filter(w => w.length > 2);
  const placeWords = normPlace.split(" ").filter(w => w.length > 2);
  if (searchWords.length === 0) return false;
  const matching = searchWords.filter(w => placeWords.includes(w));
  return matching.length >= Math.ceil(searchWords.length * 0.5);
}

async function googlePlacesSearch(query: string, ownerName: string, apiKey: string): Promise<PhoneResult | null> {
  const { trackedGooglePlacesFetch } = await import("./google-places-tracker");
  const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&key=${apiKey}`;
  const searchRes = await trackedGooglePlacesFetch(searchUrl, "phone-enrichment");
  if (!searchRes || !searchRes.ok) return null;
  const searchData = await searchRes.json();

  if (searchData.status !== "OK" || !searchData.candidates || searchData.candidates.length === 0) return null;

  const candidate = searchData.candidates[0];
  const candidateName = candidate.name || "";

  if (candidateName && !placesNameMatches(ownerName, candidateName)) {
    console.log(`[Phone Enrichment] Google Places name mismatch: searched "${ownerName}", got "${candidateName}" — skipping`);
    return null;
  }

  const placeId = candidate.place_id;

  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,name&key=${apiKey}`;
  const detailRes = await trackedGooglePlacesFetch(detailUrl, "phone-enrichment");
  if (!detailRes || !detailRes.ok) return null;
  const detailData = await detailRes.json();

  if (detailData.result?.formatted_phone_number) {
    const phone = detailData.result.formatted_phone_number;
    if (isValidBusinessPhone(phone)) return { phone, source: "Google Places" };
  }

  return null;
}

const googlePlacesProvider: PhoneProvider = {
  name: "Google Places",
  isAvailable: () => !!process.env.GOOGLE_PLACES_API_KEY,
  search: async (lead: Lead): Promise<PhoneResult | null> => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return null;

    try {
      const companyName = cleanCompanyName(lead.ownerName);
      const city = (lead.city || "").trim();
      const state = lead.state || "TX";
      const address = (lead.address || "").trim();

      const result = await googlePlacesSearch(`${companyName} ${city} ${state}`, lead.ownerName, apiKey);
      if (result) return result;

      if (address && city) {
        const addressResult = await googlePlacesSearch(`${address} ${city} ${state}`, lead.ownerName, apiKey);
        if (addressResult) return addressResult;
      }

      return null;
    } catch (err: any) {
      console.error(`[Phone Enrichment] Google Places error for "${lead.ownerName}":`, err.message);
      return null;
    }
  },
};

const openCorporatesProvider: PhoneProvider = {
  name: "OpenCorporates",
  isAvailable: () => true,
  search: async (lead: Lead): Promise<PhoneResult | null> => {
    try {
      const companyName = cleanCompanyName(lead.ownerName);
      const searchUrl = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(companyName)}&jurisdiction_code=us_tx&per_page=5`;

      const res = await fetch(searchUrl);
      if (!res.ok) return null;
      const data = await res.json();

      const companies = data?.results?.companies;
      if (!companies || companies.length === 0) return null;

      const normalizedOwner = normalizeForSearch(lead.ownerName);
      let bestMatch = null;

      for (const c of companies) {
        const normalizedResult = normalizeForSearch(c.company.name || "");
        if (normalizedResult === normalizedOwner || normalizedResult.includes(normalizedOwner) || normalizedOwner.includes(normalizedResult)) {
          bestMatch = c.company;
          break;
        }
      }

      if (!bestMatch) return null;

      if (bestMatch.registered_address?.phone) {
        const phone = bestMatch.registered_address.phone;
        if (isValidBusinessPhone(phone)) {
          return { phone, source: "OpenCorporates" };
        }
      }

      if (bestMatch.agent_address?.phone) {
        const phone = bestMatch.agent_address.phone;
        if (isValidBusinessPhone(phone)) {
          return { phone, source: "OpenCorporates (Agent)" };
        }
      }

      return null;
    } catch (err: any) {
      if (err.message?.includes("429")) {
        console.log("[Phone Enrichment] OpenCorporates rate limited, skipping...");
      }
      return null;
    }
  },
};

const serperProvider: PhoneProvider = {
  name: "Web Search (Serper)",
  isAvailable: () => !!process.env.SERPER_API_KEY,
  search: async (lead: Lead): Promise<PhoneResult | null> => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return null;

    try {
      const companyName = cleanCompanyName(lead.ownerName);
      const city = (lead.city || "").trim();
      const state = lead.state || "TX";
      const query = `"${companyName}" ${city} ${state} phone number contact`;

      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!res.ok) return null;
      const data = await res.json();

      if (data.knowledgeGraph?.phoneNumber) {
        const phone = data.knowledgeGraph.phoneNumber;
        if (isValidBusinessPhone(phone)) {
          return { phone, source: "Web Search (Knowledge Graph)" };
        }
      }

      const allText: string[] = [];
      if (data.organic) {
        for (const result of data.organic) {
          if (result.snippet) allText.push(result.snippet);
          if (result.title) allText.push(result.title);
        }
      }
      if (data.answerBox?.snippet) allText.push(data.answerBox.snippet);
      if (data.answerBox?.answer) allText.push(data.answerBox.answer);

      const combined = allText.join(" ");
      const phones = extractPhoneNumbers(combined);

      if (phones.length > 0) {
        const validPhone = phones.find(isValidBusinessPhone);
        if (validPhone) {
          return { phone: validPhone, source: "Web Search" };
        }
      }

      return null;
    } catch (err: any) {
      console.error(`[Phone Enrichment] Serper error for "${lead.ownerName}":`, err.message);
      return null;
    }
  },
};

const officerNameReverseProvider: PhoneProvider = {
  name: "Officer Name Reverse Search",
  isAvailable: () => true,
  search: async (lead: Lead): Promise<PhoneResult | null> => {
    try {
      const officerNames: string[] = [];
      if (lead.managingMember) officerNames.push(lead.managingMember);
      if (lead.contactName && lead.contactName !== lead.managingMember) officerNames.push(lead.contactName);

      const dossier = lead.ownerIntelligence as any;
      if (dossier?.realPeople) {
        for (const p of dossier.realPeople) {
          if (p.name && p.confidence >= 75 && !officerNames.includes(p.name)) {
            const words = p.name.split(/\s+/);
            if (words.length >= 2 && words.every((w: string) => /^[A-Za-z'-]+$/.test(w))) {
              officerNames.push(p.name);
            }
          }
        }
      }
      if (dossier?.llcChain) {
        for (const llc of dossier.llcChain) {
          if (llc.officers) {
            for (const o of llc.officers) {
              if (o.name && !officerNames.includes(o.name)) {
                const words = o.name.split(/\s+/);
                if (words.length >= 2 && words.every((w: string) => /^[A-Za-z'-]+$/.test(w))) {
                  officerNames.push(o.name);
                }
              }
            }
          }
        }
      }

      if (officerNames.length === 0) {
        console.log(`[Phone Enrichment] Officer reverse: no person names found for "${lead.ownerName}"`);
        return null;
      }

      console.log(`[Phone Enrichment] Officer reverse: searching ${officerNames.length} names for "${lead.ownerName}": ${officerNames.join(", ")}`);
      for (const personName of officerNames.slice(0, 3)) {
        const trecPhone = await searchTrecByName(personName);
        if (trecPhone) return { phone: trecPhone, source: `TREC License (${personName})` };

        const tdlrPhone = await searchTdlrByName(personName);
        if (tdlrPhone) return { phone: tdlrPhone, source: `TDLR License (${personName})` };

        const salesTaxPhone = await searchSalesTaxByPersonName(personName);
        if (salesTaxPhone) return { phone: salesTaxPhone, source: `TX Sales Tax (${personName})` };

        console.log(`[Phone Enrichment] Officer reverse: no phone found for "${personName}" in TREC/TDLR/SalesTax`);
      }

      return null;
    } catch (err: any) {
      console.error(`[Phone Enrichment] Officer reverse search error:`, err.message);
      return null;
    }
  },
};

async function searchTrecByName(name: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(name);
    const url = `https://data.texas.gov/resource/7gyn-ej3r.json?$where=license_holder_name like '%25${encoded}%25'&$limit=3&$select=license_holder_name,phone_number`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const records = await res.json();
    if (!Array.isArray(records) || records.length === 0) return null;

    const normalizedName = normalizeForSearch(name);
    for (const r of records) {
      const rName = normalizeForSearch(r.license_holder_name || "");
      const nameWords = normalizedName.split(" ").filter((w: string) => w.length > 2);
      const rWords = rName.split(" ").filter((w: string) => w.length > 2);
      const matching = nameWords.filter((w: string) => rWords.includes(w));
      if (matching.length >= Math.ceil(nameWords.length * 0.6) && r.phone_number) {
        if (isValidBusinessPhone(r.phone_number)) return r.phone_number;
      }
    }
    return null;
  } catch { return null; }
}

async function searchTdlrByName(name: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(name);
    const url = `https://data.texas.gov/resource/7fy3-iers.json?$where=license_holder_name like '%25${encoded}%25'&$limit=3&$select=license_holder_name,phone`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const records = await res.json();
    if (!Array.isArray(records) || records.length === 0) return null;

    const normalizedName = normalizeForSearch(name);
    for (const r of records) {
      const rName = normalizeForSearch(r.license_holder_name || "");
      const nameWords = normalizedName.split(" ").filter((w: string) => w.length > 2);
      const rWords = rName.split(" ").filter((w: string) => w.length > 2);
      const matching = nameWords.filter((w: string) => rWords.includes(w));
      if (matching.length >= Math.ceil(nameWords.length * 0.6) && r.phone) {
        if (isValidBusinessPhone(r.phone)) return r.phone;
      }
    }
    return null;
  } catch { return null; }
}

async function searchSalesTaxByPersonName(name: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(`taxpayer_name like '%${name.replace(/'/g, "''")}%'`);
    const url = `https://data.texas.gov/resource/9cir-efmm.json?$where=${encoded}&$limit=5&$select=taxpayer_name,outlet_phone`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const records = await res.json();
    if (!Array.isArray(records) || records.length === 0) return null;

    const normalizedName = normalizeForSearch(name);
    for (const r of records) {
      const rName = normalizeForSearch(r.taxpayer_name || "");
      if (rName.includes(normalizedName) || normalizedName.includes(rName)) {
        if (r.outlet_phone && isValidBusinessPhone(r.outlet_phone)) return r.outlet_phone;
      }
    }
    return null;
  } catch { return null; }
}

const txSalesTaxProvider: PhoneProvider = {
  name: "TX Sales Tax Permit",
  isAvailable: () => true,
  search: async (lead: Lead): Promise<PhoneResult | null> => {
    try {
      const companyName = cleanCompanyName(lead.ownerName);
      if (!companyName || companyName.length < 3) return null;

      const searchName = companyName.substring(0, 50);
      const encodedSearch = encodeURIComponent(`taxpayer_name like '%${searchName.replace(/'/g, "''")}%'`);
      const url = `https://data.texas.gov/resource/9cir-efmm.json?$where=${encodedSearch}&$limit=5&$select=taxpayer_name,outlet_phone,outlet_address,outlet_city`;
      const res = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (!res.ok) return null;
      const records = await res.json();
      if (!Array.isArray(records) || records.length === 0) return null;

      const normalizedOwner = normalizeForSearch(lead.ownerName);
      const cleanedOwner = normalizeForSearch(companyName);

      for (const record of records) {
        const rClean = normalizeForSearch(cleanCompanyName(record.taxpayer_name || ""));
        if (rClean === normalizedOwner || rClean === cleanedOwner || rClean.includes(cleanedOwner) || cleanedOwner.includes(rClean)) {
          const phone = record.outlet_phone;
          if (phone && isValidBusinessPhone(phone)) {
            return { phone, source: "TX Sales Tax Permit" };
          }
        }
      }

      return null;
    } catch (err: any) {
      if (!err.message?.includes("429")) {
        console.error(`[Phone Enrichment] TX Sales Tax error for "${lead.ownerName}":`, err.message);
      }
      return null;
    }
  },
};

function getProviders(): PhoneProvider[] {
  return [
    txSalesTaxProvider,
    officerNameReverseProvider,
    googlePlacesProvider,
    openCorporatesProvider,
    serperProvider,
  ].filter(p => p.isAvailable());
}

export function getPhoneEnrichmentStatus(): {
  providers: { name: string; available: boolean }[];
  totalAvailable: number;
} {
  const allProviders = [
    { name: "TX Sales Tax Permit", available: txSalesTaxProvider.isAvailable() },
    { name: "Officer Name Reverse Search", available: officerNameReverseProvider.isAvailable() },
    { name: "Google Places", available: googlePlacesProvider.isAvailable() },
    { name: "OpenCorporates", available: openCorporatesProvider.isAvailable() },
    { name: "Web Search (Serper)", available: serperProvider.isAvailable() },
  ];

  return {
    providers: allProviders,
    totalAvailable: allProviders.filter(p => p.available).length,
  };
}

export async function enrichSingleLeadPhone(lead: Lead): Promise<PhoneResult | null> {
  if (!lead.ownerName) return null;

  const providers = getProviders();
  if (providers.length === 0) return null;

  for (const provider of providers) {
    try {
      const result = await provider.search(lead);
      if (result) return result;
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      console.error(`[Phone Enrichment] ${provider.name} error for "${lead.ownerName}":`, err.message);
    }
  }
  return null;
}

export async function enrichLeadPhones(
  marketId?: string,
  options: { batchSize?: number; delayMs?: number } = {}
): Promise<{ enriched: number; skipped: number; errors: number; total: number }> {
  const { leads: allLeads } = await storage.getLeads(marketId ? { marketId } : undefined);
  const eligibleLeads = allLeads.filter(lead =>
    !lead.ownerPhone &&
    !lead.phoneEnrichedAt &&
    lead.ownerName
  );

  if (eligibleLeads.length === 0) {
    return { enriched: 0, skipped: allLeads.length, errors: 0, total: allLeads.length };
  }

  const providers = getProviders();

  if (providers.length === 0) {
    console.log("[Phone Enrichment] No providers available. Configure GOOGLE_PLACES_API_KEY or SERPER_API_KEY.");
    return { enriched: 0, skipped: eligibleLeads.length, errors: 0, total: eligibleLeads.length };
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

  console.log(`[Phone Enrichment] Processing ${batch.length} unique owners (${eligibleLeads.length} eligible leads)`);
  console.log(`[Phone Enrichment] Active providers: ${providers.map(p => p.name).join(", ")}`);

  const importRun = await storage.createImportRun({
    type: "phone_enrichment",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: {
      source: "cascading_phone",
      providers: providers.map(p => p.name),
      totalOwners: batch.length,
      totalLeads: eligibleLeads.length,
    },
  });

  for (let i = 0; i < batch.length; i++) {
    const [, ownerLeads] = batch[i];
    const sampleLead = ownerLeads[0];

    try {
      let result: PhoneResult | null = null;

      for (const provider of providers) {
        result = await provider.search(sampleLead);
        if (result) break;
        await new Promise(r => setTimeout(r, 200));
      }

      if (result) {
        for (const lead of ownerLeads) {
          await storage.updateLead(lead.id, {
            ownerPhone: result.phone,
            phoneSource: result.source,
            phoneEnrichedAt: new Date(),
          } as any);
        }
        enriched += ownerLeads.length;
      } else {
        for (const lead of ownerLeads) {
          await storage.updateLead(lead.id, {
            phoneEnrichedAt: new Date(),
          } as any);
        }
        skipped += ownerLeads.length;
      }

      if ((i + 1) % 10 === 0 || i === batch.length - 1) {
        console.log(`[Phone Enrichment] Progress: ${i + 1}/${batch.length} owners processed (${enriched} found, ${skipped} no phone)`);
      }

      await new Promise(r => setTimeout(r, delayMs));

    } catch (err: any) {
      console.error(`[Phone Enrichment] Error for "${sampleLead.ownerName}":`, err.message);
      errors += ownerLeads.length;

      if (err.message?.includes("429") || err.message?.includes("rate")) {
        console.log("[Phone Enrichment] Rate limited, pausing for 5s...");
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

  console.log(`[Phone Enrichment] Complete: ${enriched} phones found, ${skipped} skipped, ${errors} errors`);
  return { enriched, skipped, errors, total: eligibleLeads.length };
}
