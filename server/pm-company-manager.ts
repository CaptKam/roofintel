import { db } from "./storage";
import { pmCompanies } from "@shared/schema";
import { eq, sql, ilike } from "drizzle-orm";

const DFW_PM_COMPANIES = [
  { companyName: "Lincoln Property Company", city: "Dallas", phone: "(214) 740-3300", website: "lpsi.com" },
  { companyName: "JLL (Jones Lang LaSalle)", city: "Dallas", phone: "(214) 438-6100", website: "jll.com" },
  { companyName: "CBRE Group", city: "Dallas", phone: "(214) 979-6100", website: "cbre.com" },
  { companyName: "Cushman & Wakefield", city: "Dallas", phone: "(214) 954-0100", website: "cushmanwakefield.com" },
  { companyName: "Stream Realty Partners", city: "Dallas", phone: "(214) 267-0400", website: "streamrealty.com" },
  { companyName: "Hillwood Properties", city: "Dallas", phone: "(214) 777-6000", website: "hillwood.com" },
  { companyName: "Billingsley Company", city: "Dallas", phone: "(214) 777-4800", website: "billingsleyco.com" },
  { companyName: "Granite Properties", city: "Plano", phone: "(972) 731-2200", website: "graniteproperties.com" },
  { companyName: "KBS Real Estate Investment Trust", city: "Dallas", phone: "(214) 260-1600", website: "kbs.com" },
  { companyName: "Transwestern", city: "Dallas", phone: "(214) 210-2600", website: "transwestern.com" },
  { companyName: "Younger Partners", city: "Dallas", phone: "(214) 522-2010", website: "youngerpartners.com" },
  { companyName: "Holt Lunsford Commercial", city: "Dallas", phone: "(214) 466-2700", website: "holtlunsford.com" },
  { companyName: "Paladin Partners", city: "Dallas", phone: "(214) 361-0098", website: "paladinpartners.com" },
  { companyName: "Bradford Companies", city: "Dallas", phone: "(972) 233-3800", website: "bradfordcompanies.com" },
  { companyName: "Centurion American", city: "Dallas", phone: "(214) 706-8000", website: "centurionamerican.com" },
  { companyName: "Greystar", city: "Dallas", phone: "(214) 217-7200", website: "greystar.com" },
  { companyName: "Camden Property Trust", city: "Dallas", phone: "(972) 404-5000", website: "camdenliving.com" },
  { companyName: "RPM Living", city: "Dallas", phone: "(214) 888-3992", website: "rpmliving.com" },
  { companyName: "Venterra Realty", city: "Dallas", phone: "(713) 341-8500", website: "venterra.com" },
  { companyName: "ZRS Management", city: "Dallas", phone: "(214) 272-8680", website: "zrsmanagement.com" },
  { companyName: "Allied Orion Group", city: "Dallas", phone: "(713) 839-8899", website: "alliedor.com" },
  { companyName: "Westdale Real Estate", city: "Dallas", phone: "(214) 880-5700", website: "westdale.com" },
  { companyName: "Trammell Crow Company", city: "Dallas", phone: "(214) 863-4600", website: "trammellcrow.com" },
  { companyName: "Simmons Vedder", city: "Fort Worth", phone: "(817) 870-2200", website: "simmonsvedder.com" },
  { companyName: "Madera Residential", city: "Dallas", phone: "(469) 364-2000", website: "maderaresidential.com" },
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

export async function seedPmCompanies(): Promise<number> {
  let added = 0;
  for (const company of DFW_PM_COMPANIES) {
    const normalized = normalizeName(company.companyName);
    const existing = await db
      .select()
      .from(pmCompanies)
      .where(eq(pmCompanies.normalizedName, normalized));

    if (existing.length === 0) {
      await db.insert(pmCompanies).values({
        companyName: company.companyName,
        normalizedName: normalized,
        phone: company.phone,
        website: company.website,
        city: company.city,
        state: "TX",
        source: "seed_data",
        confidence: 90,
      });
      added++;
    }
  }
  console.log(`[PM Companies] Seeded ${added} new DFW property management companies`);
  return added;
}

export async function findPmCompany(name: string): Promise<any | null> {
  const normalized = normalizeName(name);
  const exact = await db
    .select()
    .from(pmCompanies)
    .where(eq(pmCompanies.normalizedName, normalized));

  if (exact.length > 0) return exact[0];

  const partial = await db
    .select()
    .from(pmCompanies)
    .where(ilike(pmCompanies.companyName, `%${name}%`));

  return partial.length > 0 ? partial[0] : null;
}

export async function addPmCompany(data: {
  companyName: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  contactPerson?: string;
  contactTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
  source?: string;
}): Promise<string> {
  const normalized = normalizeName(data.companyName);
  const existing = await db
    .select()
    .from(pmCompanies)
    .where(eq(pmCompanies.normalizedName, normalized));

  if (existing.length > 0) {
    await db
      .update(pmCompanies)
      .set({
        phone: data.phone || existing[0].phone,
        email: data.email || existing[0].email,
        website: data.website || existing[0].website,
        contactPerson: data.contactPerson || existing[0].contactPerson,
        contactTitle: data.contactTitle || existing[0].contactTitle,
        contactPhone: data.contactPhone || existing[0].contactPhone,
        contactEmail: data.contactEmail || existing[0].contactEmail,
        propertiesManaged: (existing[0].propertiesManaged || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(pmCompanies.id, existing[0].id));
    return existing[0].id;
  }

  const [row] = await db
    .insert(pmCompanies)
    .values({
      companyName: data.companyName,
      normalizedName: normalized,
      phone: data.phone,
      email: data.email,
      website: data.website,
      address: data.address,
      city: data.city,
      state: "TX",
      contactPerson: data.contactPerson,
      contactTitle: data.contactTitle,
      contactPhone: data.contactPhone,
      contactEmail: data.contactEmail,
      source: data.source || "auto_detected",
      confidence: 70,
    })
    .returning({ id: pmCompanies.id });

  return row.id;
}

export async function getAllPmCompanies(): Promise<any[]> {
  return db.select().from(pmCompanies).where(eq(pmCompanies.isActive, true));
}

export async function linkLeadToPmCompany(
  leadId: string,
  pmCompanyName: string,
  source: string
): Promise<{ pmCompany: any; isNew: boolean }> {
  let company = await findPmCompany(pmCompanyName);
  const isNew = !company;
  if (!company) {
    const id = await addPmCompany({ companyName: pmCompanyName, source });
    company = await db.select().from(pmCompanies).where(eq(pmCompanies.id, id)).then(r => r[0]);
  } else {
    await db
      .update(pmCompanies)
      .set({ propertiesManaged: (company.propertiesManaged || 0) + 1, updatedAt: new Date() })
      .where(eq(pmCompanies.id, company.id));
  }
  return { pmCompany: company, isNew };
}
