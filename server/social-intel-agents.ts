import type { Lead } from "@shared/schema";
import * as cheerio from "cheerio";
import type { PersonRecord, BuildingContact } from "./owner-intelligence";

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 12000): Promise<Response | null> {
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

function cleanCompanyName(name: string): string {
  return name
    .replace(/&amp;/g, "&")
    .replace(/\s+(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LP|L\.P\.|LTD|LIMITED|LLP|L\.L\.P\.)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPersonName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  const cleaned = name.replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (cleaned.length < 3) return false;
  const upper = cleaned.toUpperCase();
  const llcWords = ["LLC", "INC", "CORP", "LP", "LTD", "TRUST", "HOLDING", "PROPERTIES", "INVESTMENTS", "MANAGEMENT", "VENTURES", "PARTNERS", "CAPITAL", "FUND", "ENTERPRISES", "ASSOCIATES", "GROUP", "DEVELOPMENT"];
  if (llcWords.some(w => upper.includes(w))) return false;
  if (/[<>{}|\\]/.test(cleaned)) return false;
  if ((cleaned.match(/[^a-zA-Z\s.\-']/g) || []).length > 2) return false;
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2 || parts.length > 5) return false;
  if (!parts.every(p => /^[A-Z]/i.test(p) && p.length >= 2)) return false;
  return true;
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

function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return Array.from(new Set(matches)).filter(email => {
    const lower = email.toLowerCase();
    return !lower.endsWith(".png") && !lower.endsWith(".jpg") &&
           !lower.endsWith(".gif") && !lower.endsWith(".svg") &&
           !lower.includes("example.com") && !lower.includes("sentry") &&
           !lower.includes("noreply") && !lower.includes("no-reply");
  });
}

// ============================================================
// AGENT: TREC (Texas Real Estate Commission) License Lookup
// ============================================================

export async function trecLicenseAgent(lead: Lead): Promise<{ people: PersonRecord[]; profiles: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const profiles: any[] = [];

  try {
    const ownerClean = cleanCompanyName(lead.ownerName);
    if (!ownerClean || ownerClean.length < 3) return { people, profiles, agentDetail: "Owner name too short" };

    const searchUrl = `https://www.trec.texas.gov/apps/license-holder-search/?name=${encodeURIComponent(ownerClean)}&lictype=&status=ACTIVE&city=&county=`;
    const res = await fetchWithTimeout(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RoofIntel/1.0)" },
    }, 15000);

    if (!res || !res.ok) {
      const apiUrl = `https://www.trec.texas.gov/api/license-holder-search?name=${encodeURIComponent(ownerClean)}&status=ACTIVE`;
      const apiRes = await fetchWithTimeout(apiUrl, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; RoofIntel/1.0)" },
      }, 15000);

      if (apiRes && apiRes.ok) {
        const contentType = apiRes.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const data = await apiRes.json();
          if (Array.isArray(data)) {
            for (const record of data.slice(0, 5)) {
              const name = record.name || record.licensee_name || "";
              if (isPersonName(name)) {
                people.push({
                  name,
                  title: `TREC License: ${record.license_type || "Real Estate"}`,
                  source: "TREC",
                  confidence: 65,
                });
              }
              profiles.push({
                source: "TREC",
                name: name || ownerClean,
                licenseType: record.license_type,
                licenseNumber: record.license_number,
                status: record.status || "Active",
              });
            }
          }
        }
      }

      if (profiles.length === 0) {
        const htmlRes = await fetchWithTimeout(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml",
          },
        }, 15000);

        if (htmlRes && htmlRes.ok) {
          const html = await htmlRes.text();
          const $ = cheerio.load(html);

          $("table tr, .views-row, .license-result").each((_, el) => {
            const text = $(el).text().replace(/\s+/g, " ").trim();

            const nameMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/);
            const licenseMatch = text.match(/(Broker|Sales Agent|Inspector|Appraiser|Property Manager)/i);
            const licNumMatch = text.match(/(\d{6,})/);

            if (nameMatch && isPersonName(nameMatch[1])) {
              people.push({
                name: nameMatch[1],
                title: `TREC ${licenseMatch ? licenseMatch[1] : "Licensee"}`,
                source: "TREC",
                confidence: 65,
              });
              profiles.push({
                source: "TREC",
                name: nameMatch[1],
                licenseType: licenseMatch ? licenseMatch[1] : "Real Estate",
                licenseNumber: licNumMatch ? licNumMatch[1] : undefined,
                status: "Active",
              });
            }
          });
        }
      }
    } else {
      const html = await res.text();
      const $ = cheerio.load(html);

      $("table tr, .views-row, .license-result").each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        const nameMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/);
        const licenseMatch = text.match(/(Broker|Sales Agent|Inspector|Appraiser|Property Manager)/i);
        const licNumMatch = text.match(/(\d{6,})/);

        if (nameMatch && isPersonName(nameMatch[1])) {
          people.push({
            name: nameMatch[1],
            title: `TREC ${licenseMatch ? licenseMatch[1] : "Licensee"}`,
            source: "TREC",
            confidence: 65,
          });
          profiles.push({
            source: "TREC",
            name: nameMatch[1],
            licenseType: licenseMatch ? licenseMatch[1] : "Real Estate",
            licenseNumber: licNumMatch ? licNumMatch[1] : undefined,
            status: "Active",
          });
        }
      });
    }

    return {
      people: people.slice(0, 5),
      profiles: profiles.slice(0, 5),
      agentDetail: people.length > 0 ? `Found ${people.length} TREC licensees` : "No TREC licenses found",
    };
  } catch (err: any) {
    return { people, profiles, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT: TDLR (Texas Dept of Licensing & Regulation)
// ============================================================

export async function tdlrLicenseAgent(lead: Lead): Promise<{ people: PersonRecord[]; profiles: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const profiles: any[] = [];

  try {
    const ownerClean = cleanCompanyName(lead.ownerName);
    if (!ownerClean || ownerClean.length < 3) return { people, profiles, agentDetail: "Owner name too short" };

    const searchUrl = `https://www.tdlr.texas.gov/LicenseSearch/SearchResults?name=${encodeURIComponent(ownerClean)}&licenseType=&city=${encodeURIComponent(lead.city || "")}&state=TX`;
    const res = await fetchWithTimeout(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    }, 15000);

    if (res && res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      $("table tbody tr, .search-result, .license-row").each((_, el) => {
        const cells = $(el).find("td");
        if (cells.length >= 2) {
          const name = $(cells[0]).text().trim();
          const licType = $(cells[1]).text().trim();
          const licNum = cells.length >= 3 ? $(cells[2]).text().trim() : undefined;
          const city = cells.length >= 4 ? $(cells[3]).text().trim() : undefined;

          if (isPersonName(name)) {
            people.push({
              name,
              title: `TDLR ${licType || "Licensed Professional"}`,
              source: "TDLR",
              confidence: 60,
            });
          }
          profiles.push({
            source: "TDLR",
            name,
            licenseType: licType,
            licenseNumber: licNum,
            city,
          });
        }
      });

      if (profiles.length === 0) {
        const textContent = $("body").text();
        const nameMatches = textContent.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/g) || [];
        const licTypeMatches = textContent.match(/(Property Manager|Community Association Manager|Air Conditioning|Electrician|Plumber)/gi) || [];

        for (let i = 0; i < Math.min(nameMatches.length, 5); i++) {
          if (isPersonName(nameMatches[i])) {
            people.push({
              name: nameMatches[i],
              title: `TDLR ${licTypeMatches[i] || "Licensee"}`,
              source: "TDLR",
              confidence: 55,
            });
          }
        }
      }
    }

    const pmSearchUrl = `https://www.tdlr.texas.gov/LicenseSearch/SearchResults?name=${encodeURIComponent(ownerClean)}&licenseType=Property+Manager&city=&state=TX`;
    const pmRes = await fetchWithTimeout(pmSearchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    }, 12000);

    if (pmRes && pmRes.ok) {
      const pmHtml = await pmRes.text();
      const $pm = cheerio.load(pmHtml);
      $pm("table tbody tr, .search-result").each((_, el) => {
        const cells = $pm(el).find("td");
        if (cells.length >= 2) {
          const name = $pm(cells[0]).text().trim();
          if (isPersonName(name) && !people.some(p => p.name.toUpperCase() === name.toUpperCase())) {
            people.push({
              name,
              title: "TDLR Property Manager",
              source: "TDLR",
              confidence: 65,
            });
          }
        }
      });
    }

    return {
      people: people.slice(0, 5),
      profiles: profiles.slice(0, 5),
      agentDetail: people.length > 0 ? `Found ${people.length} TDLR licensees` : "No TDLR licenses found",
    };
  } catch (err: any) {
    return { people, profiles, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT: HUD Multifamily Database
// ============================================================

export async function hudMultifamilyAgent(lead: Lead): Promise<{ people: PersonRecord[]; profiles: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const profiles: any[] = [];

  try {
    const city = (lead.city || "").trim();
    const state = (lead.state || "TX").trim();
    if (!city) return { people, profiles, agentDetail: "No city to search" };

    const hudUrl = `https://www.hud.gov/sites/dfiles/Housing/documents/MF_Properties_with_Assistance_and_Financing.xlsx`;
    const csvUrl = `https://data.hud.gov/Housing_Counselor/searchByState?state=${state}`;

    const address = (lead.address || "").toUpperCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
    const addressParts = address.split(/\s+/).slice(0, 3).join(" ");

    const searchUrl = `https://data.hud.gov/Housing_Counselor/searchByLocation?Ession=&Ession=&Addr=${encodeURIComponent(addressParts)}&City=${encodeURIComponent(city)}&State=${encodeURIComponent(state)}&Zip=&SvcList=`;
    const res = await fetchWithTimeout(searchUrl, {
      headers: { "Accept": "application/json" },
    }, 15000);

    if (res && res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        const data = await res.json();
        if (Array.isArray(data)) {
          for (const entry of data.slice(0, 3)) {
            const agencyName = entry.nme || entry.agcnme || "";
            const phone = entry.phone1 || "";
            const email = entry.email || "";
            const contactName = entry.counselor_name || entry.contact || "";

            profiles.push({
              source: "HUD",
              name: agencyName,
              phone: phone || undefined,
              email: email || undefined,
              address: `${entry.adr1 || ""} ${entry.city || ""} ${entry.statecd || ""}`.trim(),
            });

            if (contactName && isPersonName(contactName)) {
              people.push({
                name: contactName,
                title: "HUD Housing Counselor",
                phone: phone || undefined,
                email: email || undefined,
                source: "HUD Database",
                confidence: 55,
              });
            }
          }
        }
      }
    }

    const mfUrl = `https://data.hud.gov/api/mf_property.json?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`;
    const mfRes = await fetchWithTimeout(mfUrl, {
      headers: { "Accept": "application/json" },
    }, 15000);

    if (mfRes && mfRes.ok) {
      const contentType = mfRes.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        const mfData = await mfRes.json();
        if (Array.isArray(mfData)) {
          const normalizedLeadAddr = address.replace(/\s+/g, " ");
          for (const prop of mfData) {
            const propAddr = (prop.property_street || prop.address || "").toUpperCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();

            if (propAddr && normalizedLeadAddr.includes(propAddr.split(/\s+/).slice(0, 3).join(" "))) {
              const mgmtName = prop.mgmt_agent_org_name || prop.management_agent || "";
              const mgmtPhone = prop.mgmt_agent_phone || "";
              const mgmtEmail = prop.mgmt_agent_email || "";

              profiles.push({
                source: "HUD Multifamily",
                name: prop.property_name || propAddr,
                managementAgent: mgmtName,
                phone: mgmtPhone || undefined,
                email: mgmtEmail || undefined,
              });

              if (mgmtName && isPersonName(mgmtName)) {
                people.push({
                  name: mgmtName,
                  title: "HUD Management Agent",
                  phone: mgmtPhone || undefined,
                  email: mgmtEmail || undefined,
                  source: "HUD Multifamily",
                  confidence: 70,
                });
              }

              const execDir = prop.executive_director || "";
              if (execDir && isPersonName(execDir)) {
                people.push({
                  name: execDir,
                  title: "Executive Director",
                  source: "HUD Multifamily",
                  confidence: 75,
                });
              }
            }
          }
        }
      }
    }

    return {
      people: people.slice(0, 5),
      profiles: profiles.slice(0, 5),
      agentDetail: profiles.length > 0 ? `Found ${profiles.length} HUD records` : "No HUD multifamily records",
    };
  } catch (err: any) {
    return { people, profiles, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT: BBB Direct Search (no Serper needed)
// ============================================================

export async function bbbDirectAgent(lead: Lead): Promise<{ people: PersonRecord[]; profiles: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const profiles: any[] = [];

  try {
    const ownerClean = cleanCompanyName(lead.ownerName);
    if (!ownerClean || ownerClean.length < 3) return { people, profiles, agentDetail: "Owner name too short" };

    const city = (lead.city || "").trim();
    const state = (lead.state || "TX").trim();
    const searchTerms = encodeURIComponent(ownerClean);

    const bbbSearchUrl = `https://www.bbb.org/api/search?find_text=${searchTerms}&find_loc=${encodeURIComponent(`${city}, ${state}`)}&page=1&sort=relevance`;
    const bbbRes = await fetchWithTimeout(bbbSearchUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.bbb.org/",
      },
    }, 15000);

    if (bbbRes && bbbRes.ok) {
      const contentType = bbbRes.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        const bbbData = await bbbRes.json();
        const results = bbbData.results || bbbData.SearchResults || [];

        for (const result of (Array.isArray(results) ? results : []).slice(0, 3)) {
          const bizName = result.BusinessName || result.organizationName || result.name || "";
          const phone = result.Phone || result.phone || "";
          const rating = result.Rating || result.rating || "";
          const website = result.WebsiteURL || result.websiteUrl || result.url || "";
          const bbbUrl = result.ReportURL || result.reportUrl || "";
          const accredited = result.IsAccredited || result.isAccredited || false;

          profiles.push({
            source: "BBB",
            name: bizName,
            phone: phone || undefined,
            website: website || undefined,
            bbbUrl: bbbUrl || undefined,
            rating,
            accredited,
          });

          const principal = result.PrincipalName || result.principalName || result.ContactName || "";
          if (principal && isPersonName(principal)) {
            people.push({
              name: principal,
              title: "BBB Principal/Owner",
              phone: phone || undefined,
              source: "BBB",
              confidence: 65,
            });
          }
        }
      }
    }

    if (profiles.length === 0) {
      const htmlUrl = `https://www.bbb.org/search?find_text=${searchTerms}&find_loc=${encodeURIComponent(`${city}, ${state}`)}`;
      const htmlRes = await fetchWithTimeout(htmlUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml",
        },
      }, 15000);

      if (htmlRes && htmlRes.ok) {
        const html = await htmlRes.text();
        const $ = cheerio.load(html);

        $("script[type='application/ld+json']").each((_, el) => {
          try {
            const jsonText = $(el).html();
            if (!jsonText) return;
            const ld = JSON.parse(jsonText);

            if (ld["@type"] === "LocalBusiness" || ld["@type"] === "Organization") {
              profiles.push({
                source: "BBB",
                name: ld.name || ownerClean,
                phone: ld.telephone || undefined,
                website: ld.url || undefined,
                address: ld.address?.streetAddress || undefined,
              });

              if (ld.founder && isPersonName(ld.founder.name || ld.founder)) {
                people.push({
                  name: typeof ld.founder === "string" ? ld.founder : ld.founder.name,
                  title: "BBB Founder",
                  source: "BBB",
                  confidence: 60,
                });
              }
            }

            if (Array.isArray(ld)) {
              for (const item of ld) {
                if (item["@type"] === "LocalBusiness" || item["@type"] === "Organization") {
                  profiles.push({
                    source: "BBB",
                    name: item.name,
                    phone: item.telephone || undefined,
                  });
                }
              }
            }
          } catch {}
        });

        $(".result-item, .search-result, [data-testid='search-result']").each((_, el) => {
          const name = $(el).find("h3, .result-name, a").first().text().trim();
          const phone = $(el).find(".phone, .result-phone, [data-testid='phone']").text().trim();

          if (name && name.length > 2) {
            profiles.push({
              source: "BBB",
              name,
              phone: phone || undefined,
            });
          }
        });

        const bodyText = $("body").text();
        const principalMatch = bodyText.match(/(?:Principal|Owner|Contact|President)(?:\s*[:]\s*)([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        if (principalMatch && isPersonName(principalMatch[1])) {
          people.push({
            name: principalMatch[1],
            title: "BBB Principal/Owner",
            source: "BBB",
            confidence: 60,
          });
        }

        const phones = extractPhones(bodyText);
        if (phones.length > 0 && profiles.length > 0 && !profiles[0].phone) {
          profiles[0].phone = phones[0];
        }
      }
    }

    return {
      people: people.slice(0, 5),
      profiles: profiles.slice(0, 5),
      agentDetail: profiles.length > 0 ? `Found ${profiles.length} BBB profiles` : "No BBB profiles found",
    };
  } catch (err: any) {
    return { people, profiles, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// AGENT: Google Places Enhanced (reverse address + review mining)
// ============================================================

export async function googlePlacesEnhancedAgent(lead: Lead): Promise<{ people: PersonRecord[]; contacts: BuildingContact[]; profiles: any[]; agentDetail: string }> {
  const people: PersonRecord[] = [];
  const contacts: BuildingContact[] = [];
  const profiles: any[] = [];
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) return { people, contacts, profiles, agentDetail: "No Google Places API key" };

  try {
    const { trackedGooglePlacesFetch } = await import("./google-places-tracker");
    const address = (lead.address || "").trim();
    const city = (lead.city || "").trim();
    const state = lead.state || "TX";

    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lead.latitude},${lead.longitude}&radius=50&key=${apiKey}`;
    let nearbyRes: Response | null = null;

    if (lead.latitude && lead.longitude) {
      nearbyRes = await trackedGooglePlacesFetch(nearbyUrl, "google-places-enhanced", fetchWithTimeout);
    }

    if (!nearbyRes || !nearbyRes.ok) {
      const textQuery = `${address} ${city} ${state}`;
      const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(textQuery)}&key=${apiKey}`;
      nearbyRes = await trackedGooglePlacesFetch(textSearchUrl, "google-places-enhanced", fetchWithTimeout);
    }

    if (nearbyRes && nearbyRes.ok) {
      const nearbyData = await nearbyRes.json();
      const results = (nearbyData.results || []).slice(0, 5);

      for (const place of results) {
        const placeId = place.place_id;
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,formatted_address,types,reviews&key=${apiKey}`;
        const detailRes = await trackedGooglePlacesFetch(detailUrl, "google-places-enhanced", fetchWithTimeout);
        if (!detailRes || !detailRes.ok) continue;
        const detailData = await detailRes.json();
        const result = detailData.result;
        if (!result) continue;

        const types = result.types || [];
        const isPropertyMgmt = types.some((t: string) =>
          ["real_estate_agency", "property_management", "real_estate_agent"].includes(t)
        ) || (result.name || "").toLowerCase().match(/property|management|realty|leasing|real estate/);

        if (isPropertyMgmt) {
          contacts.push({
            name: result.name,
            role: "Property Management Company",
            phone: result.formatted_phone_number || undefined,
            source: "Google Places (at address)",
            confidence: 70,
          });
          profiles.push({
            source: "Google Places",
            name: result.name,
            phone: result.formatted_phone_number || undefined,
            website: result.website || undefined,
            type: "Property Management",
          });
        }

        if (result.reviews) {
          for (const review of result.reviews) {
            const authorName = review.author_name || "";
            const text = (review.text || "").toLowerCase();
            const isOwnerReply = text.includes("thank") || text.includes("appreciate") || text.includes("sorry");
            const isManagerContext = text.includes("manager") || text.includes("owner") || text.includes("management") || text.includes("property");

            if (authorName && isOwnerReply && isManagerContext && isPersonName(authorName)) {
              people.push({
                name: authorName,
                title: "Property Manager/Owner (review reply)",
                source: "Google Reviews",
                confidence: 45,
              });
            }
          }
        }

        await new Promise(r => setTimeout(r, 200));
      }
    }

    return {
      people: people.slice(0, 5),
      contacts: contacts.slice(0, 5),
      profiles: profiles.slice(0, 5),
      agentDetail: contacts.length > 0
        ? `Found ${contacts.length} businesses at address, ${people.length} people from reviews`
        : people.length > 0
          ? `Found ${people.length} people from reviews`
          : "No additional contacts found at address",
    };
  } catch (err: any) {
    return { people, contacts, profiles, agentDetail: `Error: ${err.message}` };
  }
}

// ============================================================
// COMBINED: Run all Social Intelligence sub-agents
// ============================================================

export async function runSocialIntelPipeline(lead: Lead, knownPeople: PersonRecord[], options?: { skipPaidApis?: boolean }): Promise<{
  people: PersonRecord[];
  contacts: BuildingContact[];
  profiles: any[];
  agentResults: Array<{ agent: string; status: string; found: number; detail?: string }>;
}> {
  const skipPaid = options?.skipPaidApis ?? false;
  const allPeople: PersonRecord[] = [];
  const allContacts: BuildingContact[] = [];
  const allProfiles: any[] = [];
  const agentResults: Array<{ agent: string; status: string; found: number; detail?: string }> = [];

  console.log(`[Social Intel] Running pipeline for ${lead.ownerName} (${skipPaid ? "free only" : "all agents"})`);

  const trecResult = await trecLicenseAgent(lead);
  allPeople.push(...trecResult.people);
  allProfiles.push(...trecResult.profiles);
  agentResults.push({ agent: "TREC License", status: trecResult.people.length > 0 ? "found" : "empty", found: trecResult.people.length, detail: trecResult.agentDetail });

  const tdlrResult = await tdlrLicenseAgent(lead);
  allPeople.push(...tdlrResult.people);
  allProfiles.push(...tdlrResult.profiles);
  agentResults.push({ agent: "TDLR License", status: tdlrResult.people.length > 0 ? "found" : "empty", found: tdlrResult.people.length, detail: tdlrResult.agentDetail });

  const hudResult = await hudMultifamilyAgent(lead);
  allPeople.push(...hudResult.people);
  allProfiles.push(...hudResult.profiles);
  agentResults.push({ agent: "HUD Multifamily", status: hudResult.people.length > 0 || hudResult.profiles.length > 0 ? "found" : "empty", found: hudResult.people.length, detail: hudResult.agentDetail });

  const bbbResult = await bbbDirectAgent(lead);
  allPeople.push(...bbbResult.people);
  allProfiles.push(...bbbResult.profiles);
  agentResults.push({ agent: "BBB Direct", status: bbbResult.people.length > 0 || bbbResult.profiles.length > 0 ? "found" : "empty", found: bbbResult.people.length, detail: bbbResult.agentDetail });

  if (skipPaid) {
    agentResults.push({ agent: "Google Places Enhanced", status: "skipped", found: 0, detail: "Skipped (paid API — use manual enrich)" });
  } else {
    const googleResult = await googlePlacesEnhancedAgent(lead);
    allPeople.push(...googleResult.people);
    allContacts.push(...googleResult.contacts);
    allProfiles.push(...googleResult.profiles);
    agentResults.push({ agent: "Google Places Enhanced", status: googleResult.contacts.length > 0 || googleResult.people.length > 0 ? "found" : "empty", found: googleResult.people.length + googleResult.contacts.length, detail: googleResult.agentDetail });
  }

  console.log(`[Social Intel] Pipeline complete: ${allPeople.length} people, ${allContacts.length} building contacts, ${allProfiles.length} profiles`);

  return { people: allPeople, contacts: allContacts, profiles: allProfiles, agentResults };
}
