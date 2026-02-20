import { storage } from "./storage";
import type { Lead, InsertIntelligenceClaim } from "@shared/schema";
import * as cheerio from "cheerio";
import { runSkipTraceAgent } from "./skip-trace-agent";

// ============================================================
// TYPES
// ============================================================

export interface PersonRecord {
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  address?: string;
  source: string;
  confidence: number;
}

export interface LlcChainLink {
  entityName: string;
  entityType: string;
  sosFileNumber?: string;
  status?: string;
  officers: PersonRecord[];
  registeredAgent?: string;
  registeredAgentAddress?: string;
  source: string;
}

export interface BuildingContact {
  name: string;
  role: string;
  company?: string;
  phone?: string;
  email?: string;
  source: string;
  confidence: number;
}

export interface SkipTraceHit {
  fieldName: string;
  fieldValue: string;
  source: string;
  sourceUrl?: string;
  confidence: number;
  parsingMethod: string;
  retrievedAt: string;
}

export interface OwnerDossier {
  realPeople: PersonRecord[];
  buildingContacts: BuildingContact[];
  llcChain: LlcChainLink[];
  businessProfiles: Array<{
    source: string;
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    officers?: string[];
  }>;
  courtRecords: Array<{
    source: string;
    caseType?: string;
    parties?: string[];
    description?: string;
    date?: string;
  }>;
  emails: Array<{ email: string; source: string; verified: boolean }>;
  phones: Array<{ phone: string; source: string; type: string }>;
  skipTraceHits: SkipTraceHit[];
  agentResults: Array<{ agent: string; status: string; found: number; detail?: string }>;
  generatedAt: string;
}

export interface IntelligenceResult {
  managingMember: string | null;
  managingMemberTitle: string | null;
  managingMemberPhone: string | null;
  managingMemberEmail: string | null;
  llcChain: LlcChainLink[];
  dossier: OwnerDossier;
  score: number;
  sources: string[];
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function cleanCompanyName(name: string): string {
  return name
    .replace(/&amp;/g, "&")
    .replace(/\s+(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LP|L\.P\.|LTD|LIMITED|LLP|L\.L\.P\.)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(name: string): string {
  return name.toUpperCase().replace(/&amp;/g, "&").replace(/[.,'"&]/g, "").replace(/\s+/g, " ").trim();
}

function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return Array.from(new Set(matches)).filter(email => {
    const lower = email.toLowerCase();
    return !lower.endsWith(".png") && !lower.endsWith(".jpg") &&
           !lower.endsWith(".gif") && !lower.endsWith(".svg") &&
           !lower.includes("example.com") && !lower.includes("sentry") &&
           !lower.includes("wixpress") && !lower.includes("webpack") &&
           !lower.includes("cloudflare") && !lower.includes("googleapis") &&
           !lower.includes("noreply") && !lower.includes("no-reply");
  });
}

function extractPhones(text: string): string[] {
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
  const matches: string[] = [];
  let match;
  while ((match = phoneRegex.exec(text)) !== null) {
    const formatted = `(${match[1]}) ${match[2]}-${match[3]}`;
    if (!matches.includes(formatted)) matches.push(formatted);
  }
  return matches;
}

function isPersonName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  const cleaned = name.replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (cleaned.length < 3) return false;
  const upper = cleaned.toUpperCase();
  const llcWords = ["LLC", "INC", "CORP", "LP", "LTD", "TRUST", "HOLDING", "PROPERTIES", "INVESTMENTS", "MANAGEMENT", "VENTURES", "PARTNERS", "CAPITAL", "FUND", "ENTERPRISES", "ASSOCIATES", "GROUP", "DEVELOPMENT"];
  if (llcWords.some(w => upper.includes(w))) return false;
  const junkPatterns = [
    /statewide/i, /links/i, /navigation/i, /menu/i, /footer/i, /header/i,
    /click here/i, /read more/i, /learn more/i, /sign in/i, /log in/i, /sign up/i,
    /contact us/i, /about us/i, /home page/i, /skip to/i, /toggle/i,
    /cookie/i, /privacy/i, /terms of/i, /copyright/i, /all rights/i,
    /subscribe/i, /follow us/i, /powered by/i, /page \d/i,
    /^\s*us\s/i, /^the\s/i, /^a\s/i, /^an\s/i,
  ];
  if (junkPatterns.some(p => p.test(cleaned))) return false;
  if (/[<>{}|\\]/.test(cleaned)) return false;
  if ((cleaned.match(/[^a-zA-Z\s.\-']/g) || []).length > 2) return false;
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2 || parts.length > 5) return false;
  if (!parts.every(p => /^[A-Z]/i.test(p) && p.length >= 2)) return false;
  return true;
}

function deduplicatePeople(people: PersonRecord[]): PersonRecord[] {
  const seen = new Map<string, PersonRecord>();
  for (const p of people) {
    const key = p.name.toUpperCase().replace(/\s+/g, " ").trim();
    const existing = seen.get(key);
    if (!existing || p.confidence > existing.confidence) {
      if (existing) {
        p.phone = p.phone || existing.phone;
        p.email = p.email || existing.email;
        p.address = p.address || existing.address;
        p.title = p.title || existing.title;
      }
      seen.set(key, p);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    }, timeoutMs);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ============================================================
// AGENT 1: TX SOS Deep Agent
// ============================================================

async function txSosDeepAgent(lead: Lead): Promise<{ officers: PersonRecord[]; chain: LlcChainLink[]; agentDetail: string }> {
  const officers: PersonRecord[] = [];
  const chain: LlcChainLink[] = [];

  if (!lead.ownerName || (lead.ownerType !== "LLC" && lead.ownerType !== "Corporation" && lead.ownerType !== "LP")) {
    return { officers, chain, agentDetail: "Not an LLC/Corp entity" };
  }

  const entityName = lead.ownerName.replace(/&amp;/g, "&");

  try {
    const searchName = cleanCompanyName(entityName).substring(0, 50);
    const encodedSearch = encodeURIComponent(`taxpayer_name like '%${searchName.replace(/'/g, "''")}%'`);
    const url = `https://data.texas.gov/resource/9cir-efmm.json?$where=${encodedSearch}&$limit=20`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return { officers, chain, agentDetail: "TX SOS API error" };
    const records = await res.json();

    if (!Array.isArray(records) || records.length === 0) {
      return { officers, chain, agentDetail: "No TX filing records found" };
    }

    const normalized = normalizeForSearch(entityName);
    const sortedRecords = records.sort((a: any, b: any) => {
      const aN = normalizeForSearch(a.taxpayer_name || "");
      const bN = normalizeForSearch(b.taxpayer_name || "");
      const aMatch = aN === normalized ? 3 : aN.includes(normalized) ? 2 : normalized.includes(aN) ? 1 : 0;
      const bMatch = bN === normalized ? 3 : bN.includes(normalized) ? 2 : normalized.includes(bN) ? 1 : 0;
      return bMatch - aMatch;
    });

    const processedNames = new Set<string>();

    for (const record of sortedRecords.slice(0, 5)) {
      const tName = record.taxpayer_name || "";
      const normName = normalizeForSearch(tName);
      if (processedNames.has(normName)) continue;
      processedNames.add(normName);

      const link: LlcChainLink = {
        entityName: tName,
        entityType: record.taxpayer_organizational_type || "Unknown",
        sosFileNumber: record.secretary_of_state_sos_or_coa_file_number,
        status: record.right_to_transact_business_code === "A" ? "Active" : "Inactive",
        officers: [],
        registeredAgent: undefined,
        source: "TX Open Data Portal",
      };

      const addr = [record.taxpayer_address, record.taxpayer_city, record.taxpayer_state, record.taxpayer_zip].filter(Boolean).join(", ");
      if (addr.length > 5) link.registeredAgentAddress = addr;

      if (isPersonName(tName)) {
        const person: PersonRecord = {
          name: tName.split(",").reverse().join(" ").trim(),
          title: "Taxpayer / Registered Principal",
          source: "TX SOS Filing",
          confidence: 75,
          address: addr || undefined,
        };
        officers.push(person);
        link.officers.push(person);
      }

      chain.push(link);
    }

    if (lead.sosFileNumber) {
      await enrichFromSosFileNumber(lead.sosFileNumber, officers, chain);
    }

    return {
      officers,
      chain,
      agentDetail: `Found ${chain.length} filings, ${officers.length} people`,
    };

  } catch (err: any) {
    return { officers, chain, agentDetail: `Error: ${err.message}` };
  }
}

async function enrichFromSosFileNumber(sosFileNum: string, officers: PersonRecord[], chain: LlcChainLink[]): Promise<void> {
  try {
    const url = `https://data.texas.gov/resource/9cir-efmm.json?secretary_of_state_sos_or_coa_file_number=${sosFileNum}&$limit=10`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return;
    const records = await res.json();

    for (const r of records) {
      const name = r.taxpayer_name || "";
      if (isPersonName(name)) {
        const addr = [r.taxpayer_address, r.taxpayer_city, r.taxpayer_state, r.taxpayer_zip].filter(Boolean).join(", ");
        officers.push({
          name: name.split(",").reverse().join(" ").trim(),
          title: "SOS Filing Principal",
          source: "TX SOS Cross-Reference",
          confidence: 70,
          address: addr || undefined,
        });
      }
    }
  } catch {}
}

// ============================================================
// AGENT 2: LLC Chain Agent
// ============================================================

async function llcChainAgent(lead: Lead, existingChain: LlcChainLink[]): Promise<{ people: PersonRecord[]; chain: LlcChainLink[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const chain = [...existingChain];
  const seen = new Set(chain.map(c => normalizeForSearch(c.entityName)));
  let depth = 0;
  const maxDepth = 3;

  const entityNames = chain
    .filter(c => !isPersonName(c.entityName))
    .map(c => c.entityName);

  for (const entityName of entityNames) {
    if (depth >= maxDepth) break;

    try {
      const cleaned = cleanCompanyName(entityName).substring(0, 40);
      const parts = cleaned.split(/\s+/).filter(p => p.length > 2);
      if (parts.length === 0) continue;

      const searchTerm = parts.slice(0, 3).join(" ");
      const encodedSearch = encodeURIComponent(`taxpayer_name like '%${searchTerm.replace(/'/g, "''")}%'`);
      const url = `https://data.texas.gov/resource/9cir-efmm.json?$where=${encodedSearch}&$limit=15`;
      const res = await fetchWithTimeout(url);
      if (!res || !res.ok) continue;
      const records = await res.json();
      if (!Array.isArray(records)) continue;

      for (const record of records) {
        const tName = (record.taxpayer_name || "").trim();
        const normName = normalizeForSearch(tName);
        if (seen.has(normName)) continue;
        seen.add(normName);

        if (isPersonName(tName)) {
          const addr = [record.taxpayer_address, record.taxpayer_city, record.taxpayer_state, record.taxpayer_zip].filter(Boolean).join(", ");
          people.push({
            name: tName.split(",").reverse().join(" ").trim(),
            title: "LLC Chain - Managing Member",
            source: `LLC Chain (depth ${depth + 1})`,
            confidence: Math.max(50, 80 - depth * 10),
            address: addr || undefined,
          });
        } else {
          const parentLink: LlcChainLink = {
            entityName: tName,
            entityType: record.taxpayer_organizational_type || "Unknown",
            sosFileNumber: record.secretary_of_state_sos_or_coa_file_number,
            status: record.right_to_transact_business_code === "A" ? "Active" : "Inactive",
            officers: [],
            source: `LLC Chain (depth ${depth + 1})`,
          };
          chain.push(parentLink);
        }
      }

      depth++;
      await new Promise(r => setTimeout(r, 300));

    } catch {}
  }

  return {
    people,
    chain,
    agentDetail: `Traced ${depth} levels, found ${people.length} people`,
  };
}

// ============================================================
// AGENT 3: TX Comptroller Agent
// ============================================================

async function txComptrollerAgent(lead: Lead): Promise<{ people: PersonRecord[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const apiKey = process.env.TX_COMPTROLLER_API_KEY;

  if (!lead.taxpayerId && !lead.sosFileNumber) {
    return { people, agentDetail: "No taxpayer ID or SOS number" };
  }

  try {
    if (lead.taxpayerId) {
      const url = `https://data.texas.gov/resource/9cir-efmm.json?taxpayer_number=${lead.taxpayerId}&$limit=10`;
      const res = await fetchWithTimeout(url);
      if (res && res.ok) {
        const records = await res.json();
        for (const r of records) {
          const name = r.taxpayer_name || "";
          if (isPersonName(name)) {
            const addr = [r.taxpayer_address, r.taxpayer_city, r.taxpayer_state, r.taxpayer_zip].filter(Boolean).join(", ");
            people.push({
              name: name.split(",").reverse().join(" ").trim(),
              title: "TX Comptroller - Responsible Party",
              source: "TX Comptroller",
              confidence: 80,
              address: addr || undefined,
            });
          }
        }
      }
    }

    if (apiKey && lead.ownerName) {
      const companyName = cleanCompanyName(lead.ownerName).substring(0, 40);
      const url = `https://data.texas.gov/resource/9cir-efmm.json?$where=taxpayer_name like '%${encodeURIComponent(companyName)}%'&$limit=5&$$app_token=${apiKey}`;
      const res = await fetchWithTimeout(url);
      if (res && res.ok) {
        const records = await res.json();
        const typeCodes = new Set(records.map((r: any) => r.record_type_code));
        if (typeCodes.has("RP") || typeCodes.has("RO")) {
          for (const r of records.filter((r: any) => r.record_type_code === "RP" || r.record_type_code === "RO")) {
            const name = r.taxpayer_name || "";
            if (isPersonName(name)) {
              people.push({
                name: name.split(",").reverse().join(" ").trim(),
                title: r.record_type_code === "RP" ? "Responsible Party" : "Registered Officer",
                source: "TX Comptroller (Franchise Tax)",
                confidence: 85,
              });
            }
          }
        }
      }
    }

    return {
      people,
      agentDetail: `Found ${people.length} responsible parties`,
    };
  } catch (err: any) {
    return { people, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT 4: Property Tax Records Agent
// ============================================================

async function propertyTaxAgent(lead: Lead): Promise<{ people: PersonRecord[]; agentDetail: string }> {
  const people: PersonRecord[] = [];

  if (lead.ownerAddress && lead.ownerName) {
    const addr = lead.ownerAddress;
    const nameParts = lead.ownerName.split(/\s+ATTN:\s*/i);
    if (nameParts.length > 1) {
      const attnName = nameParts[1].replace(/[,]+$/, "").trim();
      if (isPersonName(attnName)) {
        people.push({
          name: attnName,
          title: "Property Tax - Attention Contact",
          source: "Property Tax Records (ATTN)",
          confidence: 70,
          address: addr,
        });
      }
    }

    const careOfMatch = addr.match(/C\/O\s+([A-Z][A-Z\s]+?)(?:\s*,|\s+\d)/i);
    if (careOfMatch && isPersonName(careOfMatch[1].trim())) {
      people.push({
        name: careOfMatch[1].trim(),
        title: "Property Tax - Care Of Contact",
        source: "Property Tax Records (C/O)",
        confidence: 65,
      });
    }
  }

  if (lead.sourceId && lead.sourceType === "dcad_api") {
    try {
      const url = `https://maps.dcad.org/prdwa/rest/services/Property/MapServer/0/query?where=ACCT%3D%27${lead.sourceId}%27&outFields=*&f=json`;
      const res = await fetchWithTimeout(url, {}, 8000);
      if (res && res.ok) {
        const data = await res.json();
        const features = data.features || [];
        if (features.length > 0) {
          const attrs = features[0].attributes;
          const ownerNameFromDcad = attrs?.OWNER_NAME || attrs?.owner_name;
          if (ownerNameFromDcad && ownerNameFromDcad !== lead.ownerName) {
            if (isPersonName(ownerNameFromDcad)) {
              people.push({
                name: ownerNameFromDcad,
                title: "Property Record Owner",
                source: "DCAD Property Records",
                confidence: 75,
              });
            }
          }

          const mailingName = attrs?.MAILING_NAME || attrs?.mailing_name;
          if (mailingName && isPersonName(mailingName)) {
            people.push({
              name: mailingName,
              title: "Property Record Mailing Contact",
              source: "DCAD Mailing Records",
              confidence: 65,
            });
          }
        }
      }
    } catch {}
  }

  return {
    people,
    agentDetail: `Found ${people.length} contacts from property records`,
  };
}

// ============================================================
// AGENT 5: People Search Agent
// ============================================================

async function peopleSearchAgent(lead: Lead, knownPeople: PersonRecord[]): Promise<{ enriched: PersonRecord[]; agentDetail: string }> {
  const enriched: PersonRecord[] = [];
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) return { enriched, agentDetail: "No Serper API key" };

  const peopleToSearch = knownPeople.filter(p => p.confidence >= 50 && (!p.phone || !p.email)).slice(0, 3);

  for (const person of peopleToSearch) {
    try {
      const city = (lead.city || "").trim();
      const state = lead.state || "TX";
      const query = `"${person.name}" ${city} ${state} phone email contact`;

      const res = await fetchWithTimeout("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!res || !res.ok) continue;
      const data = await res.json();

      const allText: string[] = [];
      if (data.organic) {
        for (const result of data.organic) {
          if (result.snippet) allText.push(result.snippet);
          if (result.title) allText.push(result.title);
        }
      }
      if (data.answerBox?.snippet) allText.push(data.answerBox.snippet);
      if (data.knowledgeGraph?.description) allText.push(data.knowledgeGraph.description);

      if (data.knowledgeGraph?.phoneNumber) {
        person.phone = person.phone || data.knowledgeGraph.phoneNumber;
      }

      const combined = allText.join(" ");
      const foundEmails = extractEmails(combined);
      const foundPhones = extractPhones(combined);

      if (!person.phone && foundPhones.length > 0) person.phone = foundPhones[0];
      if (!person.email && foundEmails.length > 0) person.email = foundEmails[0];

      if (person.phone || person.email) {
        enriched.push({ ...person, source: `${person.source} + People Search`, confidence: Math.min(100, person.confidence + 10) });
      }

      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }

  return {
    enriched,
    agentDetail: `Enriched ${enriched.length} of ${peopleToSearch.length} people`,
  };
}

// ============================================================
// AGENT 6: Email Discovery Agent
// ============================================================

async function emailDiscoveryAgent(lead: Lead, knownPeople: PersonRecord[]): Promise<{ emails: Array<{ email: string; source: string; verified: boolean }>; agentDetail: string }> {
  const emails: Array<{ email: string; source: string; verified: boolean }> = [];

  const domain = lead.businessWebsite
    ? new URL(lead.businessWebsite.startsWith("http") ? lead.businessWebsite : `https://${lead.businessWebsite}`).hostname.replace(/^www\./, "")
    : null;

  if (!domain) return { emails, agentDetail: "No business website/domain" };

  for (const person of knownPeople.filter(p => !p.email).slice(0, 3)) {
    const nameParts = person.name.split(/\s+/);
    if (nameParts.length < 2) continue;

    const first = nameParts[0].toLowerCase();
    const last = nameParts[nameParts.length - 1].toLowerCase();
    const firstInitial = first[0];

    const patterns = [
      `${first}.${last}@${domain}`,
      `${first}${last}@${domain}`,
      `${firstInitial}${last}@${domain}`,
      `${first}@${domain}`,
      `${last}@${domain}`,
      `${first}_${last}@${domain}`,
    ];

    for (const pattern of patterns) {
      emails.push({ email: pattern, source: `Email Pattern (${person.name})`, verified: false });
    }
  }

  const genericPatterns = [
    `info@${domain}`,
    `contact@${domain}`,
    `admin@${domain}`,
    `office@${domain}`,
    `management@${domain}`,
    `leasing@${domain}`,
  ];

  for (const email of genericPatterns) {
    emails.push({ email, source: "Generic Email Pattern", verified: false });
  }

  if (lead.businessWebsite) {
    try {
      const html = await fetchPage(lead.businessWebsite);
      if (html) {
        const foundEmails = extractEmails(html);
        for (const email of foundEmails) {
          if (email.includes(domain)) {
            emails.push({ email, source: "Website Scrape", verified: true });
          }
        }
      }
    } catch {}
  }

  const unique = Array.from(new Map(emails.map(e => [e.email.toLowerCase(), e])).values());
  const verified = unique.filter(e => e.verified);
  const unverified = unique.filter(e => !e.verified);

  return {
    emails: [...verified, ...unverified.slice(0, 6)],
    agentDetail: `Generated ${unique.length} emails (${verified.length} verified from website)`,
  };
}

// ============================================================
// AGENT 7: Enhanced Google Business Agent
// ============================================================

async function googleBusinessAgent(lead: Lead): Promise<{ people: PersonRecord[]; profile: any; agentDetail: string }> {
  const people: PersonRecord[] = [];
  let profile: any = null;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) return { people, profile, agentDetail: "No Google Places API key" };

  try {
    const address = (lead.address || "").trim();
    const city = (lead.city || "").trim();
    const state = lead.state || "TX";
    const queries = [
      `${address} ${city} ${state}`,
      `${cleanCompanyName(lead.ownerName)} ${city} ${state}`,
    ];

    for (const query of queries) {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&key=${apiKey}`;
      const searchRes = await fetchWithTimeout(searchUrl);
      if (!searchRes || !searchRes.ok) continue;
      const searchData = await searchRes.json();
      if (searchData.status !== "OK" || !searchData.candidates?.length) continue;

      const placeId = searchData.candidates[0].place_id;
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,formatted_address,types,opening_hours,business_status,editorial_summary,reviews&key=${apiKey}`;
      const detailRes = await fetchWithTimeout(detailUrl);
      if (!detailRes || !detailRes.ok) continue;
      const detailData = await detailRes.json();
      const result = detailData.result;

      if (result) {
        profile = {
          source: "Google Places",
          name: result.name,
          phone: result.formatted_phone_number,
          website: result.website,
          address: result.formatted_address,
          businessStatus: result.business_status,
        };

        if (result.reviews) {
          for (const review of result.reviews) {
            const authorName = review.author_name;
            const text = (review.text || "").toLowerCase();
            const isOwnerResponse = text.includes("thank") && (text.includes("owner") || text.includes("manager") || text.includes("team"));

            if (review.author_name && isOwnerResponse && isPersonName(authorName)) {
              people.push({
                name: authorName,
                title: "Business Owner/Manager (from reviews)",
                source: "Google Reviews",
                confidence: 40,
              });
            }
          }
        }

        break;
      }
    }

    return {
      people,
      profile,
      agentDetail: profile ? `Found business: ${profile.name}` : "No business profile found",
    };
  } catch (err: any) {
    return { people, profile, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT 8: Court Records & Permits Agent
// ============================================================

async function courtRecordsAgent(lead: Lead): Promise<{ people: PersonRecord[]; records: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const records: any[] = [];
  const serperKey = process.env.SERPER_API_KEY;

  if (!serperKey) return { people, records, agentDetail: "No Serper API key for court search" };

  try {
    const ownerClean = cleanCompanyName(lead.ownerName);
    const city = (lead.city || "").trim();
    const address = (lead.address || "").trim();
    const queries = [
      `"${ownerClean}" Dallas County court records property`,
      `"${address}" ${city} TX building permit contractor`,
    ];

    for (const query of queries) {
      const res = await fetchWithTimeout("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!res || !res.ok) continue;
      const data = await res.json();

      if (data.organic) {
        for (const result of data.organic) {
          const snippet = result.snippet || "";
          const title = result.title || "";
          const combined = `${title} ${snippet}`;

          const nameMatches = combined.match(/(?:vs?\.\s*|plaintiff:\s*|defendant:\s*|filed by:\s*|contractor:\s*|permit holder:\s*)([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi);
          if (nameMatches) {
            for (const rawMatch of nameMatches) {
              const nameOnly = rawMatch.replace(/^(?:vs?\.\s*|plaintiff:\s*|defendant:\s*|filed by:\s*|contractor:\s*|permit holder:\s*)/i, "").trim();
              if (isPersonName(nameOnly)) {
                people.push({
                  name: nameOnly,
                  title: "Court/Permit Record Contact",
                  source: "Public Court Records",
                  confidence: 35,
                });
              }
            }
          }

          if (combined.toLowerCase().includes("permit") || combined.toLowerCase().includes("court") || combined.toLowerCase().includes("lien")) {
            records.push({
              source: result.link || "Web Search",
              caseType: combined.toLowerCase().includes("permit") ? "Building Permit" : combined.toLowerCase().includes("lien") ? "Lien" : "Court Filing",
              description: snippet.substring(0, 200),
              date: null,
            });
          }
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return {
      people,
      records,
      agentDetail: `Found ${people.length} names, ${records.length} records`,
    };
  } catch (err: any) {
    return { people, records, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT 9: Social Intelligence Agent
// ============================================================

async function socialIntelAgent(lead: Lead, knownPeople: PersonRecord[]): Promise<{ people: PersonRecord[]; profiles: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const profiles: any[] = [];
  const serperKey = process.env.SERPER_API_KEY;

  if (!serperKey) return { people, profiles, agentDetail: "No Serper API key" };

  try {
    const ownerClean = cleanCompanyName(lead.ownerName);
    const city = (lead.city || "").trim();

    const queries = [
      `"${ownerClean}" site:bbb.org`,
      `"${ownerClean}" ${city} TX site:linkedin.com/company`,
      `"${ownerClean}" ${city} TX principal officer owner manager`,
    ];

    for (const query of queries) {
      const res = await fetchWithTimeout("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 3 }),
      });

      if (!res || !res.ok) continue;
      const data = await res.json();

      if (data.organic) {
        for (const result of data.organic) {
          const url = result.link || "";
          const snippet = result.snippet || "";
          const title = result.title || "";

          if (url.includes("bbb.org")) {
            profiles.push({
              source: "BBB",
              name: title.replace(/\|.*$/, "").trim(),
              website: url,
            });

            const principalMatch = snippet.match(/(?:principal|owner|contact):\s*([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
            if (principalMatch && isPersonName(principalMatch[1])) {
              people.push({
                name: principalMatch[1],
                title: "BBB Principal/Owner",
                source: "BBB Profile",
                confidence: 60,
              });
            }

            const bbbPhones = extractPhones(snippet);
            if (bbbPhones.length > 0 && people.length > 0) {
              people[people.length - 1].phone = bbbPhones[0];
            }
          }

          if (url.includes("linkedin.com/company")) {
            profiles.push({
              source: "LinkedIn Company",
              name: title.replace(/\|.*$/, "").replace(/- LinkedIn$/, "").trim(),
              website: url,
            });
          }

          const namePatterns = snippet.match(/(?:owner|principal|president|ceo|manager|director|partner|member)(?:\s*[:,-]\s*)([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi);
          if (namePatterns) {
            for (const raw of namePatterns) {
              const nameOnly = raw.replace(/^(?:owner|principal|president|ceo|manager|director|partner|member)(?:\s*[:,-]\s*)/i, "").trim();
              if (isPersonName(nameOnly)) {
                people.push({
                  name: nameOnly,
                  title: raw.split(/[:,-]/)[0].trim(),
                  source: url.includes("bbb.org") ? "BBB" : url.includes("linkedin") ? "LinkedIn" : "Social Web Search",
                  confidence: 50,
                });
              }
            }
          }
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return {
      people,
      profiles,
      agentDetail: `Found ${people.length} people, ${profiles.length} business profiles`,
    };
  } catch (err: any) {
    return { people, profiles, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT 10: Building Contacts Agent
// ============================================================

async function buildingContactsAgent(lead: Lead): Promise<{ contacts: BuildingContact[]; agentDetail: string }> {
  const contacts: BuildingContact[] = [];
  const serperKey = process.env.SERPER_API_KEY;
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;

  const address = (lead.address || "").trim();
  const city = (lead.city || "").trim();
  const state = lead.state || "TX";
  const fullAddress = `${address}, ${city}, ${state}`;

  // Strategy 1: Google Places - find businesses AT this address (tenants, management companies)
  if (googleKey) {
    try {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(fullAddress)}&key=${googleKey}`;
      const searchRes = await fetchWithTimeout(searchUrl);
      if (searchRes && searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results) {
          for (const place of searchData.results.slice(0, 5)) {
            const placeTypes = place.types || [];
            const isRelevant = !placeTypes.includes("locality") && !placeTypes.includes("sublocality") && !placeTypes.includes("route");
            if (!isRelevant) continue;

            const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,types,business_status&key=${googleKey}`;
            const detailRes = await fetchWithTimeout(detailUrl);
            if (!detailRes || !detailRes.ok) continue;
            const detail = (await detailRes.json()).result;
            if (!detail || detail.business_status === "CLOSED_PERMANENTLY") continue;

            const role = placeTypes.includes("real_estate_agency") ? "Property Manager" :
                         placeTypes.includes("general_contractor") ? "Contractor" :
                         "Tenant / Occupant";

            contacts.push({
              name: detail.name || place.name,
              role,
              phone: detail.formatted_phone_number,
              source: "Google Places (at address)",
              confidence: 55,
            });

            if (detail.website) {
              const html = await fetchPage(detail.website);
              if (html) {
                const $ = cheerio.load(html);
                const pageText = $.text();
                const pageEmails = extractEmails(pageText);
                const pagePhones = extractPhones(pageText);

                const managerPattern = /(?:property\s*manager|facility\s*manager|building\s*manager|maintenance\s*(?:manager|director|supervisor)|leasing\s*(?:agent|manager|director))[\s:,\-–]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
                let match;
                while ((match = managerPattern.exec(pageText)) !== null) {
                  if (isPersonName(match[1])) {
                    const roleFromMatch = match[0].split(/[\s:,\-–]+/)[0].replace(/\s+/g, " ").trim();
                    contacts.push({
                      name: match[1].trim(),
                      role: roleFromMatch,
                      company: detail.name,
                      email: pageEmails[0],
                      phone: pagePhones[0],
                      source: "Business Website (at address)",
                      confidence: 65,
                    });
                  }
                }

                if (pageEmails.length > 0) {
                  const lastContact = contacts[contacts.length - 1];
                  if (lastContact && !lastContact.email) lastContact.email = pageEmails[0];
                }
              }
            }
          }
        }
      }
    } catch {}
  }

  // Strategy 2: Web search for property managers, facility managers, tenants at this address
  if (serperKey) {
    try {
      const queries = [
        `"${address}" "${city}" property manager OR facility manager OR building manager`,
        `"${address}" "${city}" TX tenant OR occupant OR leasing`,
        `"${address}" "${city}" TX building permit OR contractor OR renovation`,
      ];

      for (const query of queries) {
        const res = await fetchWithTimeout("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 5 }),
        });
        if (!res || !res.ok) continue;
        const data = await res.json();

        if (data.organic) {
          for (const result of data.organic) {
            const snippet = result.snippet || "";
            const title = result.title || "";
            const combined = `${title} ${snippet}`;
            const url = result.link || "";

            const rolePatterns = [
              { pattern: /(?:property\s*manag(?:er|ement)|managed\s*by)[\s:,\-–]*([A-Z][a-zA-Z&\s]+?)(?:\.|,|\s{2}|$)/gi, role: "Property Manager" },
              { pattern: /(?:facility\s*manag(?:er|ement))[\s:,\-–]*([A-Z][a-zA-Z&\s]+?)(?:\.|,|\s{2}|$)/gi, role: "Facility Manager" },
              { pattern: /(?:leasing\s*(?:agent|contact|office|by))[\s:,\-–]*([A-Z][a-zA-Z&\s]+?)(?:\.|,|\s{2}|$)/gi, role: "Leasing Agent" },
              { pattern: /(?:tenant|occupied\s*by|leased\s*(?:to|by))[\s:,\-–]*([A-Z][a-zA-Z&\s]+?)(?:\.|,|\s{2}|$)/gi, role: "Tenant" },
              { pattern: /(?:contractor|permit(?:\s*holder)?|(?:filed|pulled)\s*(?:by|permit))[\s:,\-–]*([A-Z][a-zA-Z&\s]+?)(?:\.|,|\s{2}|$)/gi, role: "Contractor / Permit Filer" },
              { pattern: /(?:maintenance\s*(?:manager|director|supervisor|contact))[\s:,\-–]*([A-Z][a-zA-Z&\s]+?)(?:\.|,|\s{2}|$)/gi, role: "Maintenance Contact" },
            ];

            for (const { pattern, role } of rolePatterns) {
              let m;
              while ((m = pattern.exec(combined)) !== null) {
                const nameOrCompany = m[1].trim().substring(0, 60);
                if (nameOrCompany.length < 3) continue;
                const phones = extractPhones(snippet);
                const emails = extractEmails(snippet);

                contacts.push({
                  name: nameOrCompany,
                  role,
                  phone: phones[0],
                  email: emails[0],
                  source: url.includes("permit") ? "Building Permits" : "Web Search",
                  confidence: isPersonName(nameOrCompany) ? 55 : 45,
                });
              }
            }

            if (url.includes("permit") || combined.toLowerCase().includes("permit")) {
              const permitNames = combined.match(/(?:filed by|applicant|permit holder|contractor)[\s:,\-–]+([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi);
              if (permitNames) {
                for (const raw of permitNames) {
                  const nameOnly = raw.replace(/^(?:filed by|applicant|permit holder|contractor)[\s:,\-–]+/i, "").trim();
                  if (isPersonName(nameOnly)) {
                    contacts.push({
                      name: nameOnly,
                      role: "Permit Filer",
                      source: "Building Permits",
                      confidence: 50,
                    });
                  }
                }
              }
            }
          }
        }

        await new Promise(r => setTimeout(r, 500));
      }
    } catch {}
  }

  // Strategy 3: Search for property management company on the website (if business has one)
  if (lead.businessWebsite) {
    try {
      const contactPages = [
        lead.businessWebsite,
        `${lead.businessWebsite.replace(/\/$/, "")}/contact`,
        `${lead.businessWebsite.replace(/\/$/, "")}/about`,
        `${lead.businessWebsite.replace(/\/$/, "")}/management`,
        `${lead.businessWebsite.replace(/\/$/, "")}/team`,
      ];

      for (const pageUrl of contactPages) {
        const html = await fetchPage(pageUrl);
        if (!html) continue;

        const $ = cheerio.load(html);
        const pageText = $.text();

        const titlePatterns = [
          /(?:property\s*manager|facility\s*manager|building\s*manager|site\s*manager|maintenance\s*(?:manager|director|supervisor)|general\s*manager|leasing\s*(?:agent|manager|director|specialist)|building\s*superintendent|chief\s*engineer)[\s:,\-–]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
        ];

        for (const pattern of titlePatterns) {
          let match;
          while ((match = pattern.exec(pageText)) !== null) {
            if (isPersonName(match[1])) {
              const roleStr = match[0].split(/[\s:,\-–]+/).slice(0, -1).join(" ").replace(/\s+/g, " ").trim();
              const nearbyText = pageText.substring(Math.max(0, match.index - 100), match.index + match[0].length + 200);
              const nearbyEmails = extractEmails(nearbyText);
              const nearbyPhones = extractPhones(nearbyText);

              contacts.push({
                name: match[1].trim(),
                role: roleStr.charAt(0).toUpperCase() + roleStr.slice(1).toLowerCase(),
                phone: nearbyPhones[0],
                email: nearbyEmails[0],
                source: "Business Website",
                confidence: 70,
              });
            }
          }
        }

        const vcardBlocks = pageText.match(/(?:[A-Z][a-z]+ [A-Z][a-z]+)\s*\n?\s*(?:Property Manager|Facility Manager|Building Manager|Maintenance|Leasing|Site Manager)/gi);
        if (vcardBlocks) {
          for (const block of vcardBlocks) {
            const lines = block.split(/\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length >= 2 && isPersonName(lines[0])) {
              const nearbyText = pageText.substring(Math.max(0, pageText.indexOf(block) - 50), pageText.indexOf(block) + block.length + 200);
              contacts.push({
                name: lines[0],
                role: lines[1],
                phone: extractPhones(nearbyText)[0],
                email: extractEmails(nearbyText)[0],
                source: "Business Website",
                confidence: 65,
              });
            }
          }
        }
      }
    } catch {}
  }

  // Deduplicate building contacts
  const seen = new Map<string, BuildingContact>();
  for (const c of contacts) {
    const key = c.name.toUpperCase().replace(/\s+/g, " ").trim();
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      if (existing) {
        c.phone = c.phone || existing.phone;
        c.email = c.email || existing.email;
        c.company = c.company || existing.company;
      }
      seen.set(key, c);
    }
  }
  const dedupedContacts = Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 15);

  return {
    contacts: dedupedContacts,
    agentDetail: `Found ${dedupedContacts.length} building-connected contacts`,
  };
}

// ============================================================
// AGENT 11: Master Orchestrator
// ============================================================

function calculateIntelligenceScore(dossier: OwnerDossier): number {
  let score = 0;

  const realPeople = dossier.realPeople;
  if (realPeople.length > 0) score += 25;
  if (realPeople.length > 1) score += 5;

  const topPerson = realPeople[0];
  if (topPerson) {
    if (topPerson.phone) score += 20;
    if (topPerson.email) score += 15;
    if (topPerson.address) score += 5;
    if (topPerson.confidence >= 70) score += 10;
  }

  if (dossier.llcChain.length > 0) score += 5;
  if (dossier.llcChain.length > 1) score += 5;
  if (dossier.businessProfiles.length > 0) score += 5;
  if (dossier.emails.some(e => e.verified)) score += 5;

  if (dossier.buildingContacts && dossier.buildingContacts.length > 0) score += 5;
  if (dossier.buildingContacts && dossier.buildingContacts.some(c => c.phone || c.email)) score += 5;

  if (dossier.skipTraceHits && dossier.skipTraceHits.length > 0) score += 5;
  if (dossier.skipTraceHits && dossier.skipTraceHits.some(h => h.confidence >= 70)) score += 5;

  return Math.min(100, score);
}

export async function runOwnerIntelligence(lead: Lead): Promise<IntelligenceResult> {
  const agentResults: OwnerDossier["agentResults"] = [];
  let allPeople: PersonRecord[] = [];
  let buildingContacts: BuildingContact[] = [];
  let llcChain: LlcChainLink[] = [];
  let businessProfiles: any[] = [];
  let courtRecords: any[] = [];
  let discoveredEmails: Array<{ email: string; source: string; verified: boolean }> = [];
  let sources: string[] = [];

  console.log(`[Intelligence] Running 12-agent pipeline for: ${lead.ownerName} (${lead.address})`);

  // Stage 1: TX SOS Deep Agent
  const sosResult = await txSosDeepAgent(lead);
  allPeople.push(...sosResult.officers);
  llcChain = sosResult.chain;
  agentResults.push({ agent: "TX SOS Deep", status: sosResult.officers.length > 0 ? "found" : "empty", found: sosResult.officers.length, detail: sosResult.agentDetail });
  if (sosResult.officers.length > 0) sources.push("TX SOS");

  // Stage 2: LLC Chain Agent
  const chainResult = await llcChainAgent(lead, llcChain);
  allPeople.push(...chainResult.people);
  llcChain = chainResult.chain;
  agentResults.push({ agent: "LLC Chain", status: chainResult.people.length > 0 ? "found" : "empty", found: chainResult.people.length, detail: chainResult.agentDetail });
  if (chainResult.people.length > 0) sources.push("LLC Chain");

  // Stage 3: TX Comptroller Agent
  const comptrollerResult = await txComptrollerAgent(lead);
  allPeople.push(...comptrollerResult.people);
  agentResults.push({ agent: "TX Comptroller", status: comptrollerResult.people.length > 0 ? "found" : "empty", found: comptrollerResult.people.length, detail: comptrollerResult.agentDetail });
  if (comptrollerResult.people.length > 0) sources.push("TX Comptroller");

  // Stage 4: Property Tax Records Agent
  const taxResult = await propertyTaxAgent(lead);
  allPeople.push(...taxResult.people);
  agentResults.push({ agent: "Property Tax Records", status: taxResult.people.length > 0 ? "found" : "empty", found: taxResult.people.length, detail: taxResult.agentDetail });
  if (taxResult.people.length > 0) sources.push("Property Tax");

  // Stage 5: Google Business Agent
  const googleResult = await googleBusinessAgent(lead);
  allPeople.push(...googleResult.people);
  if (googleResult.profile) businessProfiles.push(googleResult.profile);
  agentResults.push({ agent: "Google Business", status: googleResult.profile ? "found" : "empty", found: googleResult.people.length, detail: googleResult.agentDetail });
  if (googleResult.profile) sources.push("Google Business");

  // Deduplicate before enrichment
  allPeople = deduplicatePeople(allPeople);

  // Stage 6: People Search Agent (enrich known people)
  const searchResult = await peopleSearchAgent(lead, allPeople);
  for (const enrichedPerson of searchResult.enriched) {
    const idx = allPeople.findIndex(p => normalizeForSearch(p.name) === normalizeForSearch(enrichedPerson.name));
    if (idx >= 0) {
      allPeople[idx].phone = allPeople[idx].phone || enrichedPerson.phone;
      allPeople[idx].email = allPeople[idx].email || enrichedPerson.email;
      allPeople[idx].confidence = Math.max(allPeople[idx].confidence, enrichedPerson.confidence);
    } else {
      allPeople.push(enrichedPerson);
    }
  }
  agentResults.push({ agent: "People Search", status: searchResult.enriched.length > 0 ? "found" : "empty", found: searchResult.enriched.length, detail: searchResult.agentDetail });
  if (searchResult.enriched.length > 0) sources.push("People Search");

  // Stage 7: Email Discovery Agent
  const emailResult = await emailDiscoveryAgent(lead, allPeople);
  discoveredEmails = emailResult.emails;
  agentResults.push({ agent: "Email Discovery", status: emailResult.emails.length > 0 ? "found" : "empty", found: emailResult.emails.length, detail: emailResult.agentDetail });
  if (emailResult.emails.some(e => e.verified)) sources.push("Email Discovery");

  // Stage 8: Court Records Agent
  const courtResult = await courtRecordsAgent(lead);
  allPeople.push(...courtResult.people);
  courtRecords = courtResult.records;
  agentResults.push({ agent: "Court Records", status: courtResult.people.length > 0 || courtResult.records.length > 0 ? "found" : "empty", found: courtResult.people.length, detail: courtResult.agentDetail });
  if (courtResult.people.length > 0) sources.push("Court Records");

  // Stage 9: Social Intelligence Agent
  const socialResult = await socialIntelAgent(lead, allPeople);
  allPeople.push(...socialResult.people);
  businessProfiles.push(...socialResult.profiles);
  agentResults.push({ agent: "Social Intelligence", status: socialResult.people.length > 0 || socialResult.profiles.length > 0 ? "found" : "empty", found: socialResult.people.length, detail: socialResult.agentDetail });
  if (socialResult.people.length > 0 || socialResult.profiles.length > 0) sources.push("Social Intel");

  // Stage 10: Building Contacts Agent
  const buildingResult = await buildingContactsAgent(lead);
  buildingContacts = buildingResult.contacts;
  agentResults.push({ agent: "Building Contacts", status: buildingResult.contacts.length > 0 ? "found" : "empty", found: buildingResult.contacts.length, detail: buildingResult.agentDetail });
  if (buildingResult.contacts.length > 0) sources.push("Building Contacts");

  // Stage 11: Skip Trace Agent (7 free official-records-first sources)
  const skipTraceResult = await runSkipTraceAgent(lead, allPeople);
  allPeople.push(...skipTraceResult.people);
  buildingContacts.push(...skipTraceResult.buildingContacts);
  agentResults.push({ agent: "Skip Trace", status: (skipTraceResult.people.length + skipTraceResult.buildingContacts.length) > 0 ? "found" : "empty", found: skipTraceResult.people.length + skipTraceResult.buildingContacts.length, detail: skipTraceResult.agentDetail });
  if (skipTraceResult.people.length > 0 || skipTraceResult.buildingContacts.length > 0) sources.push("Skip Trace");

  // Store provenance claims (always clear old ones, even if no new claims)
  try {
    await storage.deleteClaimsForLead(lead.id);
    if (skipTraceResult.claims.length > 0) {
      await storage.createIntelligenceClaims(skipTraceResult.claims);
    }
  } catch (err) {
    console.error(`[Intelligence] Failed to store claims for ${lead.id}:`, err);
  }

  // Final deduplication
  allPeople = deduplicatePeople(allPeople);

  // Apply discovered emails to top people if they don't have one
  const verifiedEmails = discoveredEmails.filter(e => e.verified);
  for (const person of allPeople.filter(p => !p.email)) {
    const matchingEmail = verifiedEmails.find(e => {
      const firstName = person.name.split(/\s+/)[0].toLowerCase();
      const lastName = person.name.split(/\s+/).pop()?.toLowerCase() || "";
      return e.email.toLowerCase().includes(firstName) || e.email.toLowerCase().includes(lastName);
    });
    if (matchingEmail) {
      person.email = matchingEmail.email;
      person.confidence = Math.min(100, person.confidence + 10);
    }
  }

  // Collect all phones
  const allPhones: Array<{ phone: string; source: string; type: string }> = [];
  for (const p of allPeople.filter(pp => pp.phone)) {
    allPhones.push({ phone: p.phone!, source: p.source, type: "direct" });
  }
  if (googleResult.profile?.phone) {
    allPhones.push({ phone: googleResult.profile.phone, source: "Google Business", type: "business" });
  }

  // Build skip trace hits for provenance display
  const skipTraceHits: SkipTraceHit[] = skipTraceResult.claims.map(c => ({
    fieldName: c.fieldName,
    fieldValue: c.fieldValue,
    source: c.agentName,
    sourceUrl: c.sourceUrl || undefined,
    confidence: c.confidence ?? 50,
    parsingMethod: c.parsingMethod ?? "unknown",
    retrievedAt: c.retrievedAt ? new Date(c.retrievedAt).toISOString() : new Date().toISOString(),
  }));

  // Deduplicate building contacts after merging skip trace results
  const seenBldgContacts = new Map<string, BuildingContact>();
  for (const c of buildingContacts) {
    const key = c.name.toUpperCase().replace(/\s+/g, " ").trim();
    const existing = seenBldgContacts.get(key);
    if (!existing || c.confidence > existing.confidence) {
      if (existing) {
        c.phone = c.phone || existing.phone;
        c.email = c.email || existing.email;
        c.company = c.company || existing.company;
      }
      seenBldgContacts.set(key, c);
    }
  }
  buildingContacts = Array.from(seenBldgContacts.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 20);

  // Build dossier
  const dossier: OwnerDossier = {
    realPeople: allPeople.slice(0, 10),
    buildingContacts,
    llcChain,
    businessProfiles,
    courtRecords,
    emails: discoveredEmails,
    phones: allPhones,
    skipTraceHits,
    agentResults,
    generatedAt: new Date().toISOString(),
  };

  agentResults.push({ agent: "Master Orchestrator", status: "completed", found: allPeople.length, detail: `${allPeople.length} people, ${sources.length} sources, score: ${calculateIntelligenceScore(dossier)}` });

  const topPerson = allPeople[0] || null;
  const score = calculateIntelligenceScore(dossier);

  console.log(`[Intelligence] Complete for ${lead.ownerName}: ${allPeople.length} people found, score: ${score}, sources: ${sources.join(", ")}`);

  return {
    managingMember: topPerson?.name || null,
    managingMemberTitle: topPerson?.title || null,
    managingMemberPhone: topPerson?.phone || null,
    managingMemberEmail: topPerson?.email || null,
    llcChain,
    dossier,
    score,
    sources: Array.from(new Set(sources)),
  };
}

// ============================================================
// BATCH RUNNER
// ============================================================

export async function runOwnerIntelligenceBatch(
  marketId?: string,
  options: { batchSize?: number; delayMs?: number } = {}
): Promise<{ processed: number; enriched: number; skipped: number; errors: number; total: number }> {
  const { leads: allLeads } = await storage.getLeads(marketId ? { marketId } : undefined);
  const eligibleLeads = allLeads.filter(lead =>
    !lead.intelligenceAt &&
    lead.ownerName &&
    (lead.ownerType === "LLC" || lead.ownerType === "Corporation" || lead.ownerType === "LP")
  );

  if (eligibleLeads.length === 0) {
    return { processed: 0, enriched: 0, skipped: allLeads.length, errors: 0, total: allLeads.length };
  }

  const batchSize = options.batchSize || 10;
  const delayMs = options.delayMs || 2000;
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

  console.log(`[Intelligence] Processing ${batch.length} unique owners (${eligibleLeads.length} eligible leads)`);

  const importRun = await storage.createImportRun({
    type: "owner_intelligence",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: { source: "12_agent_pipeline", totalOwners: batch.length, totalLeads: eligibleLeads.length },
  });

  for (let i = 0; i < batch.length; i++) {
    const [, ownerLeads] = batch[i];
    const sampleLead = ownerLeads[0];

    try {
      const result = await runOwnerIntelligence(sampleLead);

      if (result.managingMember || result.dossier.realPeople.length > 0) {
        for (const lead of ownerLeads) {
          await storage.updateLead(lead.id, {
            managingMember: result.managingMember,
            managingMemberTitle: result.managingMemberTitle,
            managingMemberPhone: result.managingMemberPhone,
            managingMemberEmail: result.managingMemberEmail,
            llcChain: result.llcChain,
            ownerIntelligence: result.dossier,
            buildingContacts: result.dossier.buildingContacts,
            intelligenceScore: result.score,
            intelligenceSources: result.sources,
            intelligenceAt: new Date(),
          } as any);
        }
        enriched += ownerLeads.length;
      } else {
        for (const lead of ownerLeads) {
          await storage.updateLead(lead.id, {
            ownerIntelligence: result.dossier,
            intelligenceScore: 0,
            intelligenceSources: [],
            intelligenceAt: new Date(),
          } as any);
        }
        skipped += ownerLeads.length;
      }

      if ((i + 1) % 3 === 0 || i === batch.length - 1) {
        console.log(`[Intelligence] Progress: ${i + 1}/${batch.length} owners processed (${enriched} enriched, ${skipped} skipped)`);
      }

      await new Promise(r => setTimeout(r, delayMs));

    } catch (err: any) {
      console.error(`[Intelligence] Error for "${sampleLead.ownerName}":`, err.message);
      for (const lead of ownerLeads) {
        await storage.updateLead(lead.id, { intelligenceAt: new Date() } as any);
      }
      errors += ownerLeads.length;
    }
  }

  await storage.updateImportRun(importRun.id, {
    status: "completed",
    completedAt: new Date(),
    recordsProcessed: batch.length,
    recordsImported: enriched,
    recordsSkipped: skipped,
    errors: errors > 0 ? `${errors} leads failed intelligence` : null,
  });

  console.log(`[Intelligence] Complete: ${enriched} enriched, ${skipped} skipped, ${errors} errors`);
  return { processed: batch.length, enriched, skipped, errors, total: eligibleLeads.length };
}

export function getIntelligenceStatus(): {
  agents: Array<{ name: string; available: boolean; description: string }>;
  totalAvailable: number;
} {
  const agents = [
    { name: "TX SOS Deep", available: true, description: "Searches TX Secretary of State filings for officers and registered agents" },
    { name: "LLC Chain", available: true, description: "Follows LLC ownership chains up to 3 levels to find real people" },
    { name: "TX Comptroller", available: true, description: "Queries franchise tax records for responsible parties" },
    { name: "Property Tax Records", available: true, description: "Extracts ATTN/C-O contacts from property tax mailing addresses" },
    { name: "People Search", available: !!process.env.SERPER_API_KEY, description: "Web search to find phone/email for identified people" },
    { name: "Email Discovery", available: true, description: "Generates and verifies email patterns from business domains" },
    { name: "Google Business", available: !!process.env.GOOGLE_PLACES_API_KEY, description: "Google Places business profile and owner info from reviews" },
    { name: "Court Records", available: !!process.env.SERPER_API_KEY, description: "Searches public court filings and building permits" },
    { name: "Social Intelligence", available: !!process.env.SERPER_API_KEY, description: "BBB profiles, LinkedIn companies, and business registrations" },
    { name: "Building Contacts", available: !!process.env.SERPER_API_KEY || !!process.env.GOOGLE_PLACES_API_KEY, description: "Finds property managers, tenants, contractors, and permit filers connected to the building" },
    { name: "Skip Trace", available: true, description: "7-source free lookup: DFW permits, TX sales tax, OpenCorporates officers, TCEQ contacts, WHOIS, email patterns, reverse address" },
    { name: "Master Orchestrator", available: true, description: "Chains all agents, deduplicates, scores confidence, and stores provenance claims" },
  ];

  return { agents, totalAvailable: agents.filter(a => a.available).length };
}
