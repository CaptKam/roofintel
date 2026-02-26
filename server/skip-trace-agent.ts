import { storage } from "./storage";
import type { Lead, InsertIntelligenceClaim } from "@shared/schema";
import type { PersonRecord, BuildingContact } from "./owner-intelligence";
import * as cheerio from "cheerio";
import { isPersonName } from "./contact-validation";

export interface SkipTraceResult {
  people: PersonRecord[];
  buildingContacts: BuildingContact[];
  claims: InsertIntelligenceClaim[];
  agentDetail: string;
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


function cleanCompanyName(name: string): string {
  return name
    .replace(/&amp;/g, "&")
    .replace(/\s+(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LP|L\.P\.|LTD|LIMITED|LLP|L\.L\.P\.)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
        "User-Agent": "RoofIntel/1.0 (Property Intelligence; contact@roofintel.com)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    }, timeoutMs);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/json")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function makeClaim(leadId: string, agentName: string, claimType: string, fieldName: string, fieldValue: string, sourceUrl: string | null, confidence: number, parsingMethod: string = "api"): InsertIntelligenceClaim {
  return {
    leadId,
    agentName,
    claimType,
    fieldName,
    fieldValue,
    sourceUrl,
    confidence,
    parsingMethod,
    licenseFlag: "public_record",
    retrievedAt: new Date(),
  };
}

function parseDallasContractorBlob(raw: string): { name: string; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null } {
  const phoneMatch = raw.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
  const phone = phoneMatch ? `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}` : null;

  let textWithoutPhone = phone ? raw.replace(/\(\d{3}\)\s*\d{3}-\d{4}/, "").trim() : raw;

  const stateZipMatch = textWithoutPhone.match(/,?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  const state = stateZipMatch ? stateZipMatch[1] : null;
  const zip = stateZipMatch ? stateZipMatch[2] : null;
  if (stateZipMatch) {
    textWithoutPhone = textWithoutPhone.replace(stateZipMatch[0], "").trim();
  }

  const cityMatch = textWithoutPhone.match(/,\s*([A-Za-z\s]+)\s*$/);
  const city = cityMatch ? cityMatch[1].trim() : null;
  if (cityMatch) {
    textWithoutPhone = textWithoutPhone.replace(cityMatch[0], "").trim();
  }

  const addressMatch = textWithoutPhone.match(/\s+(\d+\s+[A-Za-z0-9\s.,#]+)$/);
  let name = textWithoutPhone;
  let address: string | null = null;
  if (addressMatch) {
    address = addressMatch[1].trim().replace(/,\s*$/, "");
    name = textWithoutPhone.replace(addressMatch[0], "").trim();
  }

  name = name.replace(/\s+/g, " ").replace(/,\s*$/, "").trim();

  return { name, address, city, state, zip, phone };
}

// ============================================================
// LOOKUP 1: DFW City Building Permit Portals
// ============================================================

async function dallasPermitLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; contacts: BuildingContact[]; detail: string }> {
  const people: PersonRecord[] = [];
  const contacts: BuildingContact[] = [];

  const address = (lead.address || "").trim().toUpperCase();
  if (!address || lead.county?.toUpperCase() !== "DALLAS") {
    return { people, contacts, detail: "Not in Dallas County" };
  }

  try {
    const streetNum = address.match(/^(\d+)/)?.[1];
    const streetName = address.replace(/^\d+\s+/, "").split(/\s+(ST|AVE|BLVD|DR|RD|LN|CT|PL|WAY|CIR|PKWY|HWY)\b/i)[0].trim();
    if (!streetNum || !streetName) return { people, contacts, detail: "Could not parse address" };

    const searchParts = streetName.split(/\s+/).filter(p => p.length > 2).slice(0, 3);
    const whereClause = encodeURIComponent(
      `upper(street_address) like '%${streetNum}%${searchParts.join("%")}%'`
    );

    const url = `https://www.dallasopendata.com/resource/e7gq-4sah.json?$where=${whereClause}&$limit=20&$order=issued_date DESC`;
    const res = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json" },
    });

    if (!res || !res.ok) return { people, contacts, detail: "Dallas permit API unavailable" };

    const records = await res.json();
    if (records.error) return { people, contacts, detail: "Dallas permit API error" };

    for (const record of (records as any[]).slice(0, 15)) {
      const contractorRaw = record.contractor || "";
      if (contractorRaw && contractorRaw.length > 2) {
        const parsed = parseDallasContractorBlob(contractorRaw);
        const key = parsed.name.toUpperCase().trim();
        if (key.length > 2) {
          contacts.push({
            name: parsed.name,
            role: "Contractor / Permit Holder",
            phone: parsed.phone || undefined,
            source: "Dallas Open Data (Permits)",
            confidence: 70,
          });

          claims.push(makeClaim(
            lead.id, "Skip Trace", "building_contact", "contractor",
            parsed.name, `https://www.dallasopendata.com/resource/e7gq-4sah.json`, 70, "api_structured"
          ));

          if (parsed.phone) {
            claims.push(makeClaim(
              lead.id, "Skip Trace", "phone", "contractor_phone",
              parsed.phone, `https://www.dallasopendata.com/resource/e7gq-4sah.json`, 65, "api_structured"
            ));
          }

        }
      }
    }

    return { people, contacts, detail: `Found ${contacts.length} from Dallas permits` };
  } catch (err: any) {
    return { people, contacts, detail: `Dallas permits error: ${err.message}` };
  }
}

async function fortWorthPermitLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; contacts: BuildingContact[]; detail: string }> {
  const people: PersonRecord[] = [];
  const contacts: BuildingContact[] = [];

  const address = (lead.address || "").trim().toUpperCase();
  if (!address || (lead.county?.toUpperCase() !== "TARRANT" && lead.city?.toUpperCase() !== "FORT WORTH")) {
    return { people, contacts, detail: "Not in Fort Worth/Tarrant area" };
  }

  try {
    const streetNum = address.match(/^(\d+)/)?.[1];
    if (!streetNum) return { people, contacts, detail: "Could not parse address" };

    const streetParts = address.replace(/^\d+\s+/, "").split(/\s+/).filter(p => p.length > 2).slice(0, 2);
    const addressQuery = `${streetNum}%${streetParts.join("%")}`;

    const arcgisUrl = `https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query?where=upper(Full_Street_Address)+LIKE+'%25${encodeURIComponent(addressQuery)}%25'&outFields=Owner_Full_Name,Full_Street_Address,B1_WORK_DESC,Permit_Type,File_Date,JobValue&f=json&resultRecordCount=20&orderByFields=File_Date+DESC`;
    const res = await fetchWithTimeout(arcgisUrl, {
      headers: { "Accept": "application/json" },
    });

    if (!res || !res.ok) return { people, contacts, detail: "Fort Worth permit API unavailable" };
    const data = await res.json();

    if (!data.features || !Array.isArray(data.features)) {
      return { people, contacts, detail: "Fort Worth permit API returned no features" };
    }

    const seenNames = new Set<string>();
    for (const feature of data.features.slice(0, 15)) {
      const attrs = feature.attributes || {};
      const ownerName = (attrs.Owner_Full_Name || "").trim();
      if (ownerName && ownerName.length > 2) {
        const key = ownerName.toUpperCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          const permitType = attrs.Permit_Type || attrs.B1_WORK_DESC || "Building Permit";

          if (isPersonName(ownerName)) {
            people.push({
              name: ownerName,
              title: `Property Owner (${permitType.substring(0, 40)})`,
              source: "Fort Worth Building Permits",
              confidence: 75,
            });
          }

          contacts.push({
            name: ownerName,
            role: "Permit Applicant / Owner",
            source: "Fort Worth Building Permits",
            confidence: 70,
          });

          claims.push(makeClaim(
            lead.id, "Skip Trace", "building_contact", "permit_owner",
            ownerName, "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0",
            75, "api_structured"
          ));
        }
      }
    }

    return { people, contacts, detail: `Found ${people.length + contacts.length} from Fort Worth permits` };
  } catch (err: any) {
    return { people, contacts, detail: `Fort Worth permits error: ${err.message}` };
  }
}

function processPermitRecords(records: any[], lead: Lead, people: PersonRecord[], contacts: BuildingContact[], claims: InsertIntelligenceClaim[], source: string) {
  if (!Array.isArray(records)) return;

  const seenNames = new Set<string>();

  for (const record of records.slice(0, 15)) {
    const contractorName = record.contractor_name || record.contractorname || record.contractor || record.applicant_name || record.applicantname || "";
    const contractorPhone = record.contractor_phone || record.contractorphone || record.phone || "";
    const contractorLicense = record.contractor_license || record.license_number || "";
    const ownerOnPermit = record.owner_name || record.ownername || record.property_owner || "";
    const permitType = record.permit_type || record.permittype || record.work_description || record.description || "Building Permit";
    const issueDate = record.issue_date || record.issuedate || record.issueddate || "";

    if (contractorName && contractorName.length > 2) {
      const key = contractorName.toUpperCase().trim();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        const phones = contractorPhone ? extractPhones(contractorPhone) : [];

        contacts.push({
          name: contractorName.trim(),
          role: "Contractor / Permit Holder",
          phone: phones[0],
          source,
          confidence: 70,
        });

        claims.push(makeClaim(
          lead.id, "Skip Trace", "building_contact", "contractor",
          contractorName.trim(), source, 70, "api_structured"
        ));
      }
    }

    if (ownerOnPermit && ownerOnPermit.length > 2) {
      const key = ownerOnPermit.toUpperCase().trim();
      if (!seenNames.has(key)) {
        seenNames.add(key);

        if (isPersonName(ownerOnPermit.trim())) {
          people.push({
            name: ownerOnPermit.trim(),
            title: "Property Owner (Permit Record)",
            source,
            confidence: 75,
          });

          claims.push(makeClaim(
            lead.id, "Skip Trace", "person", "permit_owner",
            ownerOnPermit.trim(), source, 75, "api_structured"
          ));
        }
      }
    }
  }
}

// ============================================================
// LOOKUP 2: TX Comptroller Sales Tax Permits
// ============================================================

async function txSalesTaxLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; contacts: BuildingContact[]; detail: string }> {
  const people: PersonRecord[] = [];
  const contacts: BuildingContact[] = [];

  const address = (lead.address || "").trim();
  const city = (lead.city || "").trim();
  if (!address || !city) return { people, contacts, detail: "No address/city" };

  try {
    const streetNum = address.match(/^(\d+)/)?.[1] || "";
    const streetName = address.replace(/^\d+\s+/, "").split(/\s+(ST|AVE|BLVD|DR|RD|LN|CT|PL|WAY)\b/i)[0].trim();
    if (!streetNum || streetName.length < 3) return { people, contacts, detail: "Could not parse address" };

    const searchTerm = streetName.split(/\s+/).slice(0, 2).join(" ");
    const whereClause = encodeURIComponent(
      `upper(taxpayer_address) like '%${streetNum}%' AND upper(taxpayer_city) like '%${city.toUpperCase().substring(0, 15)}%'`
    );

    const url = `https://data.texas.gov/resource/9cir-efmm.json?$where=${whereClause}&$limit=20`;
    const res = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } });

    if (!res || !res.ok) return { people, contacts, detail: "TX Comptroller API unavailable" };
    const records = await res.json();

    if (!Array.isArray(records) || records.length === 0) {
      return { people, contacts, detail: "No sales tax permits at this address" };
    }

    const seenNames = new Set<string>();

    for (const record of records.slice(0, 10)) {
      const name = (record.taxpayer_name || "").trim();
      const addr = [record.taxpayer_address, record.taxpayer_city, record.taxpayer_state, record.taxpayer_zip].filter(Boolean).join(", ");
      const key = name.toUpperCase();

      if (!name || seenNames.has(key)) continue;
      seenNames.add(key);

      contacts.push({
        name,
        role: "Business at Address (Sales Tax)",
        phone: undefined,
        source: "TX Comptroller Sales Tax",
        confidence: 60,
      });

      claims.push(makeClaim(
        lead.id, "Skip Trace", "business_at_address", "sales_tax_permit",
        name, `https://data.texas.gov/resource/9cir-efmm.json`, 60, "api_structured"
      ));

      if (isPersonName(name)) {
        people.push({
          name: name.split(",").reverse().join(" ").trim(),
          title: "Sales Tax Permit Holder",
          address: addr || undefined,
          source: "TX Comptroller Sales Tax",
          confidence: 65,
        });
      }
    }

    return { people, contacts, detail: `Found ${records.length} sales tax permits at address` };
  } catch (err: any) {
    return { people, contacts, detail: `Sales tax lookup error: ${err.message}` };
  }
}

// ============================================================
// LOOKUP 3: OpenCorporates Officer/Director Expansion
// ============================================================

async function openCorporatesLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; detail: string }> {
  const people: PersonRecord[] = [];

  if (!lead.ownerName || (lead.ownerType !== "LLC" && lead.ownerType !== "Corporation" && lead.ownerType !== "LP")) {
    return { people, detail: "Not an entity" };
  }

  try {
    const companyName = cleanCompanyName(lead.ownerName).substring(0, 50);
    const encoded = encodeURIComponent(companyName);
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encoded}&jurisdiction_code=us_tx&per_page=5`;

    const res = await fetchWithTimeout(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "RoofIntel/1.0 (Property Intelligence Platform)",
      },
    }, 12000);

    if (!res || !res.ok) return { people, detail: "OpenCorporates API unavailable" };
    const data = await res.json();

    const companies = data?.results?.companies || [];
    if (companies.length === 0) return { people, detail: "No OpenCorporates results" };

    for (const entry of companies.slice(0, 3)) {
      const company = entry.company;
      if (!company) continue;

      const companyUrl = company.opencorporates_url;
      const officers = company.officers || [];

      for (const officerEntry of officers) {
        const officer = officerEntry.officer;
        if (!officer || !officer.name) continue;

        const name = officer.name.trim();
        if (!isPersonName(name)) continue;

        people.push({
          name,
          title: officer.position || "Officer/Director",
          source: "OpenCorporates",
          confidence: 70,
        });

        claims.push(makeClaim(
          lead.id, "Skip Trace", "person", "corporate_officer",
          name, companyUrl || "https://opencorporates.com", 70, "api_structured"
        ));
      }

      if (officers.length === 0 && companyUrl) {
        const pageHtml = await fetchPage(companyUrl);
        if (pageHtml) {
          const $ = cheerio.load(pageHtml);
          $(".officers .officer").each((_, el) => {
            const officerName = $(el).find(".officer_name").text().trim();
            const position = $(el).find(".officer_position").text().trim();
            if (officerName && isPersonName(officerName)) {
              people.push({
                name: officerName,
                title: position || "Officer/Director",
                source: "OpenCorporates (page)",
                confidence: 65,
              });
              claims.push(makeClaim(
                lead.id, "Skip Trace", "person", "corporate_officer",
                officerName, companyUrl, 65, "html_scrape"
              ));
            }
          });
        }
      }
    }

    return { people, detail: `Found ${people.length} officers via OpenCorporates` };
  } catch (err: any) {
    return { people, detail: `OpenCorporates error: ${err.message}` };
  }
}

// ============================================================
// LOOKUP 4: TCEQ Environmental Permit Contacts
// ============================================================

async function tceqPermitLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; contacts: BuildingContact[]; detail: string }> {
  const people: PersonRecord[] = [];
  const contacts: BuildingContact[] = [];

  const address = (lead.address || "").trim();
  const city = (lead.city || "").trim();
  if (!address || !city) return { people, contacts, detail: "No address" };

  try {
    const streetNum = address.match(/^(\d+)/)?.[1] || "";
    const streetParts = address.replace(/^\d+\s+/, "").split(/\s+/).filter(p => p.length > 2).slice(0, 2);

    const searchQuery = `${streetNum} ${streetParts.join(" ")} ${city}`;
    const url = `https://www2.tceq.texas.gov/oce/eer/index.cfm?fuession=search&searchType=facilityName&facilityName=${encodeURIComponent(searchQuery)}&output=json`;

    const res = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json, text/html" },
    }, 8000);

    if (!res || !res.ok) {
      const altUrl = `https://www15.tceq.texas.gov/crpub/index.cfm?fuession=iwr.search&searchType=ComplianceHistory&startRow=1&maxRows=10&facilityName=${encodeURIComponent(cleanCompanyName(lead.ownerName))}`;
      const altRes = await fetchWithTimeout(altUrl, {}, 8000);

      if (altRes && altRes.ok) {
        const html = await altRes.text();
        if (html.includes("text/html")) {
          const $ = cheerio.load(html);
          $("table tr").each((_, row) => {
            const cells = $(row).find("td");
            if (cells.length >= 3) {
              const facilityName = $(cells[0]).text().trim();
              const contactName = $(cells[2]).text().trim();
              if (contactName && isPersonName(contactName)) {
                contacts.push({
                  name: contactName,
                  role: "TCEQ Permit Contact",
                  company: facilityName,
                  source: "TCEQ Environmental Records",
                  confidence: 60,
                });
                claims.push(makeClaim(
                  lead.id, "Skip Trace", "building_contact", "tceq_contact",
                  contactName, "https://www.tceq.texas.gov", 60, "html_scrape"
                ));
              }
            }
          });
        }
      }

      return { people, contacts, detail: `Found ${contacts.length} TCEQ contacts` };
    }

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        for (const facility of data.slice(0, 5)) {
          const contactName = facility.responsible_party || facility.contact_name || facility.owner_name || "";
          if (contactName && isPersonName(contactName.trim())) {
            people.push({
              name: contactName.trim(),
              title: "TCEQ Facility Responsible Party",
              source: "TCEQ Environmental Records",
              confidence: 65,
            });
            claims.push(makeClaim(
              lead.id, "Skip Trace", "person", "tceq_responsible_party",
              contactName.trim(), "https://www.tceq.texas.gov", 65, "api_structured"
            ));
          }
        }
      }
    } catch {
      const $ = cheerio.load(text);
      $("nav, header, footer, script, style, .nav, .menu, .sidebar, .breadcrumb, #nav, #menu, #header, #footer").remove();
      const pageText = $.text().replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ");
      const namePatterns = pageText.match(/(?:responsible\s*party|contact|owner|operator)[\s:,\-]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi);
      if (namePatterns) {
        for (const raw of namePatterns.slice(0, 5)) {
          const nameOnly = raw.replace(/^(?:responsible\s*party|contact|owner|operator)[\s:,\-]+/i, "").trim();
          if (isPersonName(nameOnly)) {
            people.push({
              name: nameOnly,
              title: "TCEQ Contact",
              source: "TCEQ Environmental Records",
              confidence: 55,
            });
          }
        }
      }
    }

    return { people, contacts, detail: `Found ${people.length + contacts.length} from TCEQ` };
  } catch (err: any) {
    return { people, contacts, detail: `TCEQ error: ${err.message}` };
  }
}

// ============================================================
// LOOKUP 5: Domain WHOIS for Company Websites
// ============================================================

async function whoisLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; detail: string }> {
  const people: PersonRecord[] = [];

  const website = lead.businessWebsite;
  if (!website) return { people, detail: "No business website" };

  try {
    let domain: string;
    try {
      domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
    } catch {
      return { people, detail: "Invalid website URL" };
    }

    const url = `https://rdap.org/domain/${domain}`;
    const res = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json" },
    }, 8000);

    if (!res || !res.ok) return { people, detail: "RDAP lookup failed" };
    const data = await res.json();

    const entities = data.entities || [];
    for (const entity of entities) {
      const roles = entity.roles || [];
      if (!roles.includes("registrant") && !roles.includes("administrative") && !roles.includes("technical")) continue;

      const vcardArray = entity.vcardArray;
      if (!vcardArray || !Array.isArray(vcardArray) || vcardArray.length < 2) continue;

      const vcard = vcardArray[1];
      let name = "";
      let org = "";
      let email = "";
      let phone = "";

      for (const field of vcard) {
        if (!Array.isArray(field) || field.length < 4) continue;
        if (field[0] === "fn") name = field[3] || "";
        if (field[0] === "org") org = (Array.isArray(field[3]) ? field[3][0] : field[3]) || "";
        if (field[0] === "email") email = field[3] || "";
        if (field[0] === "tel") phone = field[3] || "";
      }

      if (name && name !== "REDACTED FOR PRIVACY" && !name.includes("REDACTED")) {
        if (isPersonName(name)) {
          people.push({
            name,
            title: `Domain ${roles[0]} (${domain})`,
            email: email && !email.includes("REDACTED") ? email : undefined,
            phone: phone && !phone.includes("REDACTED") ? phone : undefined,
            source: "WHOIS/RDAP",
            confidence: 55,
          });

          claims.push(makeClaim(
            lead.id, "Skip Trace", "person", "domain_registrant",
            name, `https://rdap.org/domain/${domain}`, 55, "api_structured"
          ));
        }
      }
    }

    return { people, detail: `Found ${people.length} from WHOIS` };
  } catch (err: any) {
    return { people, detail: `WHOIS error: ${err.message}` };
  }
}

// ============================================================
// LOOKUP 6: Enhanced Email Pattern Generation + MX Verification
// ============================================================

async function enhancedEmailLookup(lead: Lead, knownPeople: PersonRecord[], claims: InsertIntelligenceClaim[]): Promise<{ emails: Array<{ email: string; source: string; verified: boolean; person?: string }>; detail: string }> {
  const emails: Array<{ email: string; source: string; verified: boolean; person?: string }> = [];

  const website = lead.businessWebsite;
  if (!website) return { emails, detail: "No business website" };

  let domain: string;
  try {
    domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return { emails, detail: "Invalid website URL" };
  }

  const commonProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com"];
  if (commonProviders.includes(domain)) return { emails, detail: "Generic email provider" };

  let mxValid = false;
  try {
    const dnsRes = await fetchWithTimeout(`https://dns.google/resolve?name=${domain}&type=MX`, {}, 5000);
    if (dnsRes && dnsRes.ok) {
      const dnsData = await dnsRes.json();
      mxValid = dnsData.Answer && dnsData.Answer.length > 0;
    }
  } catch {}



  if (website) {
    try {
      const pages = [
        website,
        `${website.replace(/\/$/, "")}/contact`,
        `${website.replace(/\/$/, "")}/about`,
        `${website.replace(/\/$/, "")}/contact-us`,
      ];

      for (const pageUrl of pages.slice(0, 3)) {
        const html = await fetchPage(pageUrl);
        if (!html) continue;
        const foundEmails = extractEmails(html);
        for (const email of foundEmails) {
          if (email.includes(domain)) {
            emails.push({ email, source: "Website Scrape (verified)", verified: true });
            claims.push(makeClaim(
              lead.id, "Skip Trace", "contact", "email_verified",
              email, pageUrl, 80, "html_scrape"
            ));
          }
        }
      }
    } catch {}
  }

  const unique = Array.from(new Map(emails.map(e => [e.email.toLowerCase(), e])).values());
  const verified = unique.filter(e => e.verified);
  const unverified = unique.filter(e => !e.verified);

  return {
    emails: [...verified, ...unverified.slice(0, 15)],
    detail: `${unique.length} emails found (${verified.length} verified from website, MX: ${mxValid ? "valid" : "unknown"})`,
  };
}

// ============================================================
// LOOKUP 7: Reverse Address Cross-Reference via County Records
// ============================================================

async function reverseAddressLookup(lead: Lead, claims: InsertIntelligenceClaim[]): Promise<{ people: PersonRecord[]; contacts: BuildingContact[]; detail: string }> {
  const people: PersonRecord[] = [];
  const contacts: BuildingContact[] = [];

  const address = (lead.address || "").trim();
  const city = (lead.city || "").trim();
  if (!address) return { people, contacts, detail: "No address" };

  try {
    if (lead.sourceType === "dcad_api" || lead.county?.toUpperCase() === "DALLAS") {
      const streetNum = address.match(/^(\d+)/)?.[1] || "";
      const streetName = address.replace(/^\d+\s+/, "").split(/\s+(ST|AVE|BLVD|DR|RD|LN|CT|PL|WAY)\b/i)[0].trim().substring(0, 30);

      if (streetNum && streetName) {
        const whereClause = `SITE_ADDRESS like '%${streetNum}%${streetName.split(/\s+/).slice(0, 2).join("%")}%'`;
        const url = `https://maps.dcad.org/prdwa/rest/services/Property/MapServer/0/query?where=${encodeURIComponent(whereClause)}&outFields=OWNER_NAME,SITE_ADDRESS,MAILING_ADDRESS,OWNER_NAME2,ACCT&f=json&resultRecordCount=10`;
        const res = await fetchWithTimeout(url, {}, 8000);

        if (res && res.ok) {
          const data = await res.json();
          const features = data.features || [];
          const seenOwners = new Set<string>();
          const currentOwnerNorm = (lead.ownerName || "").toUpperCase().trim();

          for (const feature of features) {
            const attrs = feature.attributes;
            const ownerName = (attrs?.OWNER_NAME || "").trim();
            const ownerName2 = (attrs?.OWNER_NAME2 || "").trim();
            const siteAddr = (attrs?.SITE_ADDRESS || "").trim();

            for (const name of [ownerName, ownerName2]) {
              if (!name || name.toUpperCase() === currentOwnerNorm) continue;
              const key = name.toUpperCase();
              if (seenOwners.has(key)) continue;
              seenOwners.add(key);

              if (isPersonName(name)) {
                people.push({
                  name,
                  title: "Adjacent/Related Property Owner",
                  source: "DCAD Cross-Reference",
                  confidence: 45,
                  address: siteAddr,
                });
                claims.push(makeClaim(
                  lead.id, "Skip Trace", "person", "adjacent_owner",
                  name, "https://maps.dcad.org", 45, "api_structured"
                ));
              } else {
                contacts.push({
                  name,
                  role: "Adjacent Property Entity",
                  source: "DCAD Cross-Reference",
                  confidence: 40,
                });
              }
            }
          }
        }
      }
    }

    return { people, contacts, detail: `Found ${people.length + contacts.length} from reverse address lookup` };
  } catch (err: any) {
    return { people, contacts, detail: `Reverse address error: ${err.message}` };
  }
}

// ============================================================
// MASTER SKIP TRACE ORCHESTRATOR
// ============================================================

export async function runSkipTraceAgent(lead: Lead, existingPeople: PersonRecord[] = []): Promise<SkipTraceResult> {
  const allPeople: PersonRecord[] = [];
  const allContacts: BuildingContact[] = [];
  const allClaims: InsertIntelligenceClaim[] = [];
  const details: string[] = [];

  console.log(`[Skip Trace] Running 7-source lookup for: ${lead.ownerName} at ${lead.address}`);

  const [dallasResult, fortWorthResult, salesTaxResult, openCorpResult, tceqResult, whoisResult, reverseResult] = await Promise.all([
    dallasPermitLookup(lead, allClaims),
    fortWorthPermitLookup(lead, allClaims),
    txSalesTaxLookup(lead, allClaims),
    openCorporatesLookup(lead, allClaims),
    tceqPermitLookup(lead, allClaims),
    whoisLookup(lead, allClaims),
    reverseAddressLookup(lead, allClaims),
  ]);

  allPeople.push(...dallasResult.people, ...fortWorthResult.people);
  allContacts.push(...dallasResult.contacts, ...fortWorthResult.contacts);
  details.push(`Permits: ${dallasResult.detail} | ${fortWorthResult.detail}`);

  allPeople.push(...salesTaxResult.people);
  allContacts.push(...salesTaxResult.contacts);
  details.push(`Sales Tax: ${salesTaxResult.detail}`);

  allPeople.push(...openCorpResult.people);
  details.push(`OpenCorp: ${openCorpResult.detail}`);

  allPeople.push(...tceqResult.people);
  allContacts.push(...tceqResult.contacts);
  details.push(`TCEQ: ${tceqResult.detail}`);

  allPeople.push(...whoisResult.people);
  details.push(`WHOIS: ${whoisResult.detail}`);

  allPeople.push(...reverseResult.people);
  allContacts.push(...reverseResult.contacts);
  details.push(`Reverse: ${reverseResult.detail}`);

  const combinedPeople = [...existingPeople, ...allPeople];
  const emailResult = await enhancedEmailLookup(lead, combinedPeople, allClaims);
  details.push(`Email: ${emailResult.detail}`);

  for (const emailEntry of emailResult.emails.filter(e => e.verified)) {
    if (emailEntry.person) {
      const person = allPeople.find(p => p.name === emailEntry.person);
      if (person && !person.email) {
        person.email = emailEntry.email;
        person.confidence = Math.min(100, person.confidence + 10);
      }
    }
  }

  const seenPeople = new Map<string, PersonRecord>();
  for (const p of allPeople) {
    const key = p.name.toUpperCase().replace(/\s+/g, " ").trim();
    const existing = seenPeople.get(key);
    if (!existing || p.confidence > existing.confidence) {
      if (existing) {
        p.phone = p.phone || existing.phone;
        p.email = p.email || existing.email;
        p.address = p.address || existing.address;
        p.title = p.title || existing.title;
      }
      seenPeople.set(key, p);
    }
  }
  const dedupedPeople = Array.from(seenPeople.values()).sort((a, b) => b.confidence - a.confidence);

  const seenContacts = new Map<string, BuildingContact>();
  for (const c of allContacts) {
    const key = c.name.toUpperCase().replace(/\s+/g, " ").trim();
    const existing = seenContacts.get(key);
    if (!existing || c.confidence > existing.confidence) {
      if (existing) {
        c.phone = c.phone || existing.phone;
        c.email = c.email || existing.email;
        c.company = c.company || existing.company;
      }
      seenContacts.set(key, c);
    }
  }
  const dedupedContacts = Array.from(seenContacts.values()).sort((a, b) => b.confidence - a.confidence);

  const agentDetail = `Skip Trace: ${dedupedPeople.length} people, ${dedupedContacts.length} contacts from 7 sources. ${details.join(" | ")}`;
  console.log(`[Skip Trace] Complete: ${dedupedPeople.length} people, ${dedupedContacts.length} contacts, ${allClaims.length} claims`);

  return {
    people: dedupedPeople.slice(0, 15),
    buildingContacts: dedupedContacts.slice(0, 15),
    claims: allClaims,
    agentDetail,
  };
}

export function getSkipTraceStatus(): { sources: Array<{ name: string; available: boolean; description: string }>; totalAvailable: number } {
  const sources = [
    { name: "Dallas Building Permits", available: true, description: "Socrata open data API for Dallas permit applicants, contractors, architects" },
    { name: "Fort Worth Building Permits", available: true, description: "Fort Worth open data for permit records and contractors" },
    { name: "TX Sales Tax Permits", available: true, description: "TX Comptroller sales tax permit holders at the property address" },
    { name: "OpenCorporates", available: true, description: "Cross-jurisdiction corporate officer/director records (free tier)" },
    { name: "TCEQ Environmental", available: true, description: "TX Commission on Environmental Quality facility contacts and responsible parties" },
    { name: "Domain WHOIS/RDAP", available: true, description: "Domain registration records for business website owners" },
    { name: "Email Discovery (Website Scrape)", available: true, description: "Finds real emails from business websites via scraping contact/about pages" },
    { name: "Reverse Address (DCAD)", available: true, description: "Cross-reference DCAD property records for adjacent owners and entities" },
  ];

  return { sources, totalAvailable: sources.filter(s => s.available).length };
}
