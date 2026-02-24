import { storage } from "./storage";
import type { Lead } from "@shared/schema";
import * as cheerio from "cheerio";

interface ContactResult {
  businessName?: string;
  businessWebsite?: string;
  contactName?: string;
  contactTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactSource: string;
}

interface WebResearchProgress {
  processed: number;
  found: number;
  skipped: number;
  errors: number;
  total: number;
}

const RELEVANT_TITLES = [
  "facility manager", "facilities manager", "facility director",
  "property manager", "building manager", "maintenance manager",
  "maintenance director", "operations manager", "operations director",
  "general manager", "office manager", "regional manager",
  "asset manager", "chief operating officer", "coo",
  "vice president of operations", "vp operations", "vp of operations",
  "director of operations", "director of facilities",
  "superintendent", "building superintendent",
  "chief engineer", "plant manager",
  "owner", "president", "ceo", "managing partner",
  "principal", "managing director", "managing member",
];

function isRelevantTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return RELEVANT_TITLES.some(t => lower.includes(t));
}

function scoreTitle(title: string): number {
  const lower = title.toLowerCase();
  if (lower.includes("facility") || lower.includes("facilities")) return 100;
  if (lower.includes("property manager")) return 95;
  if (lower.includes("building manager")) return 90;
  if (lower.includes("maintenance")) return 85;
  if (lower.includes("operations")) return 75;
  if (lower.includes("general manager")) return 70;
  if (lower.includes("office manager")) return 65;
  if (lower.includes("superintendent")) return 60;
  if (lower.includes("chief engineer") || lower.includes("plant manager")) return 55;
  if (lower.includes("owner") || lower.includes("president") || lower.includes("ceo")) return 50;
  if (lower.includes("managing")) return 45;
  if (lower.includes("principal")) return 40;
  if (lower.includes("director")) return 35;
  if (lower.includes("vp") || lower.includes("vice president")) return 30;
  return 10;
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
           !lower.includes("cloudflare") && !lower.includes("googleapis");
  });
}

function extractPhones(text: string): string[] {
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

interface StaffMember {
  name: string;
  title: string;
  email?: string;
  phone?: string;
  score: number;
}

function extractStaffFromHtml($: cheerio.CheerioAPI): StaffMember[] {
  const staff: StaffMember[] = [];
  const seen = new Set<string>();

  const titlePatterns = RELEVANT_TITLES.map(t => t.replace(/\s+/g, "\\s+"));
  const titleRegex = new RegExp(`(${titlePatterns.join("|")})`, "i");

  $("*").each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text || text.length > 500 || text.length < 5) return;

    if (titleRegex.test(text)) {
      const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0 && l.length < 100);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (titleRegex.test(line)) {
          const titleLine = line;
          let name = "";

          if (i > 0 && lines[i - 1].length < 60 && !titleRegex.test(lines[i - 1])) {
            name = lines[i - 1];
          } else if (i < lines.length - 1 && lines[i + 1].length < 60 && !titleRegex.test(lines[i + 1])) {
            name = lines[i + 1];
          }

          const titleMatch = titleLine.match(titleRegex);
          if (titleMatch && name && !seen.has(name.toLowerCase())) {
            const nameParts = name.split(/\s+/);
            if (nameParts.length >= 2 && nameParts.length <= 5 && /^[A-Z]/.test(name)) {
              seen.add(name.toLowerCase());
              const emails = extractEmails(text);
              const phones = extractPhones(text);
              staff.push({
                name: name.replace(/[,.\-]+$/, "").trim(),
                title: titleMatch[0].trim(),
                email: emails[0],
                phone: phones[0],
                score: scoreTitle(titleMatch[0]),
              });
            }
          }
        }
      }
    }
  });

  $('[class*="team"], [class*="staff"], [class*="leadership"], [class*="about"], [class*="management"], [id*="team"], [id*="staff"], [id*="leadership"]').each((_, section) => {
    const $section = $(section);
    $section.find('[class*="member"], [class*="person"], [class*="card"], [class*="bio"], li, article').each((_, item) => {
      const $item = $(item);
      const itemText = $item.text().trim();
      if (itemText.length > 500) return;

      const h3Name = $item.find("h2, h3, h4, strong, b").first().text().trim();
      const subtitle = $item.find('[class*="title"], [class*="position"], [class*="role"], p, span').first().text().trim();

      if (h3Name && subtitle && h3Name !== subtitle && isRelevantTitle(subtitle)) {
        const key = h3Name.toLowerCase();
        if (!seen.has(key) && h3Name.split(/\s+/).length <= 5 && /^[A-Z]/.test(h3Name)) {
          seen.add(key);
          const emails = extractEmails(itemText);
          const phones = extractPhones(itemText);
          staff.push({
            name: h3Name.replace(/[,.\-]+$/, "").trim(),
            title: subtitle.replace(/[,.\-]+$/, "").trim(),
            email: emails[0],
            phone: phones[0],
            score: scoreTitle(subtitle),
          });
        }
      }
    });
  });

  return staff.sort((a, b) => b.score - a.score);
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timer);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;

    return await res.text();
  } catch {
    return null;
  }
}

function findContactPages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const pages: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    /contact/i, /about/i, /team/i, /staff/i, /leadership/i,
    /management/i, /people/i, /our-team/i, /meet/i, /directory/i,
  ];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().toLowerCase().trim();
    if (!href) return;

    const matchesPattern = patterns.some(p => p.test(href) || p.test(text));
    if (!matchesPattern) return;

    try {
      let fullUrl: string;
      if (href.startsWith("http")) {
        fullUrl = href;
      } else if (href.startsWith("/")) {
        const base = new URL(baseUrl);
        fullUrl = `${base.protocol}//${base.host}${href}`;
      } else {
        fullUrl = `${baseUrl.replace(/\/$/, "")}/${href}`;
      }

      fullUrl = fullUrl.split("#")[0].split("?")[0];
      if (!seen.has(fullUrl) && !fullUrl.includes("mailto:") && !fullUrl.includes("tel:")) {
        seen.add(fullUrl);
        pages.push(fullUrl);
      }
    } catch {}
  });

  return pages.slice(0, 5);
}

function webResearchNameMatches(ownerName: string, placeName: string): boolean {
  const normalize = (n: string) => n.toUpperCase()
    .replace(/[.,'"&]/g, "").replace(/&amp;/g, "")
    .replace(/\b(LLC|LP|INC|CORP|LTD|CO|COMPANY|PARTNERS|HOLDINGS|GROUP|THE)\b/g, "")
    .replace(/\s+/g, " ").trim();
  const normOwner = normalize(ownerName);
  const normPlace = normalize(placeName);
  if (!normOwner || !normPlace) return false;
  if (normPlace.includes(normOwner) || normOwner.includes(normPlace)) return true;
  const ownerWords = normOwner.split(" ").filter(w => w.length > 2);
  const placeWords = normPlace.split(" ").filter(w => w.length > 2);
  if (ownerWords.length === 0) return false;
  const matching = ownerWords.filter(w => placeWords.includes(w));
  return matching.length >= Math.ceil(ownerWords.length * 0.5);
}

async function findBusinessWebsite(lead: Lead): Promise<{ name?: string; website?: string } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const address = (lead.address || "").trim();
  const city = (lead.city || "").trim();
  const state = lead.state || "TX";
  const ownerName = lead.ownerName || "";

  const queries = [
    ownerName ? `${ownerName.replace(/\s+(LLC|INC|CORP|LP|LTD)\.?\s*$/i, "")} ${city} ${state}` : "",
    address ? `${address} ${city} ${state}` : "",
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();

      if (searchData.status !== "OK" || !searchData.candidates?.length) continue;

      const candidate = searchData.candidates[0];
      const candidateName = candidate.name || "";

      if (ownerName && candidateName && !webResearchNameMatches(ownerName, candidateName)) {
        console.log(`[Web Research] Google Places name mismatch: searched "${ownerName}", got "${candidateName}" — skipping`);
        continue;
      }

      const placeId = candidate.place_id;
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number&key=${apiKey}`;
      const detailRes = await fetch(detailUrl);
      if (!detailRes.ok) continue;
      const detailData = await detailRes.json();

      return {
        name: detailData.result?.name,
        website: detailData.result?.website,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function searchForStaffContact(staffName: string, companyName: string, city: string): Promise<{ email?: string; phone?: string; source: string } | null> {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) return null;

  try {
    const query = `"${staffName}" "${companyName}" ${city} email phone contact`;
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });

    if (!res.ok) return null;
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

    const combined = allText.join(" ");
    const emails = extractEmails(combined);
    const phones = extractPhones(combined);

    if (emails.length > 0 || phones.length > 0) {
      return {
        email: emails[0],
        phone: phones[0],
        source: "Web Search",
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function researchLead(lead: Lead): Promise<ContactResult | null> {
  const business = await findBusinessWebsite(lead);
  if (!business) return null;

  const result: ContactResult = {
    businessName: business.name,
    businessWebsite: business.website,
    contactSource: "Web Research",
  };

  if (!business.website) {
    return result.businessName ? result : null;
  }

  const homepageHtml = await fetchPage(business.website);
  if (!homepageHtml) return result;

  const $home = cheerio.load(homepageHtml);

  const homeEmails = extractEmails($home.text());
  const homePhones = extractPhones($home.text());

  let allStaff: StaffMember[] = extractStaffFromHtml($home);

  const contactPages = findContactPages(homepageHtml, business.website);
  for (const pageUrl of contactPages) {
    const pageHtml = await fetchPage(pageUrl);
    if (!pageHtml) continue;

    const $page = cheerio.load(pageHtml);
    const pageStaff = extractStaffFromHtml($page);
    allStaff.push(...pageStaff);

    const pageEmails = extractEmails($page.text());
    const pagePhones = extractPhones($page.text());
    homeEmails.push(...pageEmails);
    homePhones.push(...pagePhones);

    await new Promise(r => setTimeout(r, 300));
  }

  const uniqueEmails = Array.from(new Set(homeEmails));
  const uniquePhones = Array.from(new Set(homePhones));

  const seen = new Set<string>();
  allStaff = allStaff.filter(s => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.score - a.score);

  if (allStaff.length > 0) {
    const best = allStaff[0];
    result.contactName = best.name;
    result.contactTitle = best.title;
    result.contactEmail = best.email;
    result.contactPhone = best.phone;
    result.contactSource = "Website Staff Page";

    if (!best.email && !best.phone) {
      const searchResult = await searchForStaffContact(
        best.name,
        business.name || lead.ownerName,
        lead.city
      );
      if (searchResult) {
        result.contactEmail = result.contactEmail || searchResult.email;
        result.contactPhone = result.contactPhone || searchResult.phone;
        if (searchResult.email || searchResult.phone) {
          result.contactSource = "Website + Web Search";
        }
      }
    }
  } else {
    if (uniqueEmails.length > 0) {
      result.contactEmail = uniqueEmails[0];
      result.contactSource = "Website Contact Page";
    }
    if (uniquePhones.length > 0 && !lead.ownerPhone) {
      result.contactPhone = uniquePhones[0];
    }
  }

  return result;
}

export function getWebResearchStatus(): {
  googlePlacesAvailable: boolean;
  serperAvailable: boolean;
  capabilities: string[];
} {
  const googlePlaces = !!process.env.GOOGLE_PLACES_API_KEY;
  const serper = !!process.env.SERPER_API_KEY;

  const capabilities: string[] = [];
  if (googlePlaces) capabilities.push("Find business websites via Google Places");
  if (true) capabilities.push("Scan websites for staff directories and contact pages");
  if (true) capabilities.push("Extract emails and phone numbers from web pages");
  if (serper) capabilities.push("Web search for staff contact details");

  return { googlePlacesAvailable: googlePlaces, serperAvailable: serper, capabilities };
}

export async function runWebResearch(
  marketId?: string,
  options: { batchSize?: number; delayMs?: number } = {}
): Promise<WebResearchProgress> {
  const { leads: allLeads } = await storage.getLeads(marketId ? { marketId } : undefined);
  const eligibleLeads = allLeads.filter(lead =>
    !lead.webResearchedAt &&
    lead.ownerName
  );

  if (eligibleLeads.length === 0) {
    return { processed: 0, found: 0, skipped: allLeads.length, errors: 0, total: allLeads.length };
  }

  const batchSize = options.batchSize || 25;
  const delayMs = options.delayMs || 1000;
  const batch = eligibleLeads.slice(0, batchSize);
  let found = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`[Web Research] Starting research on ${batch.length} leads (${eligibleLeads.length} eligible)`);

  const importRun = await storage.createImportRun({
    type: "web_research",
    status: "running",
    startedAt: new Date(),
    recordsProcessed: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    metadata: {
      source: "web_research_agent",
      batchSize: batch.length,
      totalEligible: eligibleLeads.length,
    },
  });

  for (let i = 0; i < batch.length; i++) {
    const lead = batch[i];

    try {
      const result = await researchLead(lead);

      if (result && (result.contactName || result.contactEmail || result.businessWebsite)) {
        const updates: Record<string, any> = {
          webResearchedAt: new Date(),
        };

        if (result.businessName) updates.businessName = result.businessName;
        if (result.businessWebsite) updates.businessWebsite = result.businessWebsite;
        if (result.contactName) updates.contactName = result.contactName;
        if (result.contactTitle) updates.contactTitle = result.contactTitle;
        if (result.contactPhone) updates.contactPhone = result.contactPhone;
        if (result.contactEmail) updates.contactEmail = result.contactEmail;
        if (result.contactSource) updates.contactSource = result.contactSource;

        await storage.updateLead(lead.id, updates as any);
        found++;
        console.log(`[Web Research] Found: ${result.businessName || lead.address} - ${result.contactName || "no staff"} (${result.contactSource})`);
      } else {
        await storage.updateLead(lead.id, { webResearchedAt: new Date() } as any);
        skipped++;
      }

      if ((i + 1) % 5 === 0 || i === batch.length - 1) {
        console.log(`[Web Research] Progress: ${i + 1}/${batch.length} (${found} found, ${skipped} skipped, ${errors} errors)`);
      }

      await new Promise(r => setTimeout(r, delayMs));

    } catch (err: any) {
      console.error(`[Web Research] Error for "${lead.address}":`, err.message);
      await storage.updateLead(lead.id, { webResearchedAt: new Date() } as any);
      errors++;

      if (err.message?.includes("429") || err.message?.includes("rate")) {
        console.log("[Web Research] Rate limited, pausing for 5s...");
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  await storage.updateImportRun(importRun.id, {
    status: "completed",
    completedAt: new Date(),
    recordsProcessed: batch.length,
    recordsImported: found,
    recordsSkipped: skipped,
    errors: errors > 0 ? `${errors} leads failed research` : null,
  });

  console.log(`[Web Research] Complete: ${found} contacts found, ${skipped} skipped, ${errors} errors`);
  return { processed: batch.length, found, skipped, errors, total: eligibleLeads.length };
}
