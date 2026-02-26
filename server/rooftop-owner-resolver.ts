import { db } from "./storage";
import { leads, rooftopOwners } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { isPersonName } from "./contact-validation";

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&amp;/g, "&")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\b(LLC|INC|CORP|LTD|LP|LLP|PLLC|PC|PA|CO|COMPANY|CORPORATION|INCORPORATED|LIMITED|PARTNERSHIP|TRUST|ESTATE|ASSOCIATES|HOLDINGS|ENTERPRISES|GROUP|PROPERTIES|MANAGEMENT|INVESTMENTS|DEVELOPMENT|VENTURES|PARTNERS|CAPITAL|REALTY|REAL ESTATE)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPerson(name: string): boolean {
  return isPersonName(name);
}

interface ExtractedPerson {
  name: string;
  normalizedName: string;
  role: string;
  title: string | null;
  confidence: number;
  source: string;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export function extractPeopleFromLead(lead: any): ExtractedPerson[] {
  const people: ExtractedPerson[] = [];
  const seen = new Set<string>();

  function addPerson(p: ExtractedPerson) {
    const key = p.normalizedName;
    if (!key || key.length < 3 || seen.has(key)) return;
    seen.add(key);
    people.push(p);
  }

  if (lead.ownerName && isLikelyPerson(lead.ownerName)) {
    addPerson({
      name: lead.ownerName,
      normalizedName: normalizeName(lead.ownerName),
      role: "owner",
      title: "Property Owner",
      confidence: 90,
      source: "DCAD Record",
      address: lead.ownerAddress || null,
      phone: lead.ownerPhone || null,
      email: lead.ownerEmail || null,
    });
  }

  if (lead.managingMember && isLikelyPerson(lead.managingMember)) {
    addPerson({
      name: lead.managingMember,
      normalizedName: normalizeName(lead.managingMember),
      role: "managing_member",
      title: lead.managingMemberTitle || "Managing Member",
      confidence: 85,
      source: "TX SOS / Comptroller",
      address: null,
      phone: lead.managingMemberPhone || null,
      email: lead.managingMemberEmail || null,
    });
  }

  if (lead.officerName && isLikelyPerson(lead.officerName)) {
    addPerson({
      name: lead.officerName,
      normalizedName: normalizeName(lead.officerName),
      role: "officer",
      title: lead.officerTitle || "Corporate Officer",
      confidence: 80,
      source: "TX Comptroller",
      address: null,
      phone: null,
      email: null,
    });
  }

  if (lead.contactName && isLikelyPerson(lead.contactName)) {
    addPerson({
      name: lead.contactName,
      normalizedName: normalizeName(lead.contactName),
      role: "contact",
      title: lead.contactTitle || "Business Contact",
      confidence: 75,
      source: lead.contactSource || "Web Research",
      address: null,
      phone: lead.contactPhone || null,
      email: lead.contactEmail || null,
    });
  }

  if (lead.managementContact && isLikelyPerson(lead.managementContact)) {
    addPerson({
      name: lead.managementContact,
      normalizedName: normalizeName(lead.managementContact),
      role: "manager",
      title: "Property Manager",
      confidence: 70,
      source: "Management Attribution",
      address: null,
      phone: lead.managementPhone || null,
      email: lead.managementEmail || null,
    });
  }

  const intel = lead.ownerIntelligence as any;
  if (intel) {
    if (Array.isArray(intel.realPeople)) {
      for (const person of intel.realPeople) {
        if (person.name && isLikelyPerson(person.name)) {
          addPerson({
            name: person.name,
            normalizedName: normalizeName(person.name),
            role: "officer",
            title: person.title || "Officer",
            confidence: person.confidence || 75,
            source: person.source || "Owner Intelligence",
            address: person.address || null,
            phone: null,
            email: null,
          });
        }
      }
    }

    if (Array.isArray(intel.llcChain)) {
      for (const entity of intel.llcChain) {
        if (Array.isArray(entity.officers)) {
          for (const officer of entity.officers) {
            if (officer.name && isLikelyPerson(officer.name)) {
              addPerson({
                name: officer.name,
                normalizedName: normalizeName(officer.name),
                role: "officer",
                title: officer.title || "LLC Officer",
                confidence: officer.confidence || 75,
                source: officer.source || "LLC Chain",
                address: officer.address || null,
                phone: null,
                email: null,
              });
            }
          }
        }
        if (entity.registeredAgent && isLikelyPerson(entity.registeredAgent)) {
          addPerson({
            name: entity.registeredAgent,
            normalizedName: normalizeName(entity.registeredAgent),
            role: "registered_agent",
            title: "Registered Agent",
            confidence: 60,
            source: "TX SOS",
            address: entity.registeredAgentAddress || null,
            phone: null,
            email: null,
          });
        }
      }
    }
  }

  return people;
}

function selectPrimaryOwner(people: ExtractedPerson[]): string | null {
  if (people.length === 0) return null;

  const rolePriority: Record<string, number> = {
    owner: 100,
    managing_member: 90,
    officer: 70,
    contact: 60,
    manager: 50,
    registered_agent: 30,
  };

  people.sort((a, b) => {
    const aScore = (rolePriority[a.role] || 0) + a.confidence;
    const bScore = (rolePriority[b.role] || 0) + b.confidence;
    return bScore - aScore;
  });

  return people[0].normalizedName;
}

export async function resolveRooftopOwners(leadIds?: string[]): Promise<{ processed: number; people: number }> {
  let query;
  if (leadIds && leadIds.length > 0) {
    query = db.select().from(leads).where(
      sql`${leads.id} = ANY(${leadIds})`
    );
  } else {
    query = db.select().from(leads);
  }

  const allLeads = await query;
  let totalPeople = 0;

  if (!leadIds) {
    await db.delete(rooftopOwners);
  } else {
    for (const lid of leadIds) {
      await db.delete(rooftopOwners).where(eq(rooftopOwners.leadId, lid));
    }
  }

  const batchSize = 100;
  for (let i = 0; i < allLeads.length; i += batchSize) {
    const batch = allLeads.slice(i, i + batchSize);
    const inserts: any[] = [];

    for (const lead of batch) {
      const people = extractPeopleFromLead(lead);
      if (people.length === 0) continue;

      const primaryName = selectPrimaryOwner(people);

      for (const person of people) {
        inserts.push({
          leadId: lead.id,
          personName: person.name,
          normalizedName: person.normalizedName,
          role: person.role,
          title: person.title,
          confidence: person.confidence,
          source: person.source,
          address: person.address,
          phone: person.phone,
          email: person.email,
          isPrimary: person.normalizedName === primaryName,
        });
      }
    }

    if (inserts.length > 0) {
      await db.insert(rooftopOwners).values(inserts);
      totalPeople += inserts.length;
    }
  }

  return { processed: allLeads.length, people: totalPeople };
}

export async function buildPortfolioGroups(): Promise<{ groups: number; multiProperty: number }> {
  const owners = await db
    .select({
      normalizedName: rooftopOwners.normalizedName,
      count: sql<number>`COUNT(DISTINCT ${rooftopOwners.leadId})`,
    })
    .from(rooftopOwners)
    .where(eq(rooftopOwners.isPrimary, true))
    .groupBy(rooftopOwners.normalizedName)
    .having(sql`COUNT(DISTINCT ${rooftopOwners.leadId}) >= 1`);

  let groups = 0;
  let multiProperty = 0;

  for (const owner of owners) {
    const groupId = `pg_${owner.normalizedName.replace(/\s+/g, "_").toLowerCase().slice(0, 40)}_${Date.now().toString(36)}`;

    const portfolioData = await db
      .select({
        totalValue: sql<number>`COALESCE(SUM(${leads.totalValue}), 0)`,
        totalSqft: sql<number>`COALESCE(SUM(${leads.sqft}), 0)`,
      })
      .from(rooftopOwners)
      .innerJoin(leads, eq(rooftopOwners.leadId, leads.id))
      .where(
        sql`${rooftopOwners.normalizedName} = ${owner.normalizedName} AND ${rooftopOwners.isPrimary} = true`
      );

    const totalValue = portfolioData[0]?.totalValue || 0;
    const totalSqft = portfolioData[0]?.totalSqft || 0;

    await db
      .update(rooftopOwners)
      .set({
        portfolioGroupId: groupId,
        propertyCount: owner.count,
        totalPortfolioValue: totalValue,
        totalPortfolioSqft: totalSqft,
      })
      .where(eq(rooftopOwners.normalizedName, owner.normalizedName));

    groups++;
    if (owner.count > 1) multiProperty++;
  }

  return { groups, multiProperty };
}

export async function getRooftopOwner(leadId: string) {
  const owners = await db
    .select()
    .from(rooftopOwners)
    .where(eq(rooftopOwners.leadId, leadId))
    .orderBy(desc(rooftopOwners.isPrimary), desc(rooftopOwners.confidence));

  if (owners.length === 0) return null;

  const primary = owners.find(o => o.isPrimary) || owners[0];

  let otherProperties: any[] = [];
  if (primary.portfolioGroupId && primary.propertyCount > 1) {
    const related = await db
      .select({
        leadId: rooftopOwners.leadId,
        address: leads.address,
        city: leads.city,
        sqft: leads.sqft,
        totalValue: leads.totalValue,
        leadScore: leads.leadScore,
        hailEvents: leads.hailEvents,
      })
      .from(rooftopOwners)
      .innerJoin(leads, eq(rooftopOwners.leadId, leads.id))
      .where(
        sql`${rooftopOwners.normalizedName} = ${primary.normalizedName} AND ${rooftopOwners.isPrimary} = true AND ${rooftopOwners.leadId} != ${leadId}`
      )
      .orderBy(desc(leads.leadScore))
      .limit(20);

    otherProperties = related;
  }

  return {
    primary: {
      id: primary.id,
      name: primary.personName,
      role: primary.role,
      title: primary.title,
      confidence: primary.confidence,
      source: primary.source,
      address: primary.address,
      phone: primary.phone,
      email: primary.email,
      propertyCount: primary.propertyCount,
      totalPortfolioValue: primary.totalPortfolioValue,
      totalPortfolioSqft: primary.totalPortfolioSqft,
      portfolioGroupId: primary.portfolioGroupId,
    },
    allPeople: owners.map(o => ({
      id: o.id,
      name: o.personName,
      role: o.role,
      title: o.title,
      confidence: o.confidence,
      source: o.source,
      isPrimary: o.isPrimary,
    })),
    otherProperties,
  };
}

export async function getTopPortfolioOwners(limit = 25) {
  const topOwners = await db
    .select({
      normalizedName: rooftopOwners.normalizedName,
      personName: sql<string>`MAX(${rooftopOwners.personName})`,
      role: sql<string>`MAX(${rooftopOwners.role})`,
      propertyCount: sql<number>`COUNT(DISTINCT ${rooftopOwners.leadId})::int`,
      totalValue: sql<number>`COALESCE(SUM(${leads.totalValue}), 0)::bigint`,
      totalSqft: sql<number>`COALESCE(SUM(${leads.sqft}), 0)::int`,
      avgScore: sql<number>`ROUND(AVG(${leads.leadScore}))::int`,
      totalHail: sql<number>`COALESCE(SUM(${leads.hailEvents}), 0)::int`,
      portfolioGroupId: sql<string>`MAX(${rooftopOwners.portfolioGroupId})`,
    })
    .from(rooftopOwners)
    .innerJoin(leads, eq(rooftopOwners.leadId, leads.id))
    .where(eq(rooftopOwners.isPrimary, true))
    .groupBy(rooftopOwners.normalizedName)
    .orderBy(desc(sql`COUNT(DISTINCT ${rooftopOwners.leadId})`))
    .limit(limit);

  return topOwners;
}

export async function getPortfolioProperties(normalizedName: string) {
  const properties = await db
    .select({
      leadId: rooftopOwners.leadId,
      role: rooftopOwners.role,
      confidence: rooftopOwners.confidence,
      address: leads.address,
      city: leads.city,
      county: leads.county,
      sqft: leads.sqft,
      yearBuilt: leads.yearBuilt,
      totalValue: leads.totalValue,
      leadScore: leads.leadScore,
      hailEvents: leads.hailEvents,
      lastHailDate: leads.lastHailDate,
      ownerName: leads.ownerName,
      latitude: leads.latitude,
      longitude: leads.longitude,
      roofType: leads.roofType,
      estimatedRoofArea: leads.estimatedRoofArea,
      status: leads.status,
    })
    .from(rooftopOwners)
    .innerJoin(leads, eq(rooftopOwners.leadId, leads.id))
    .where(
      sql`${rooftopOwners.normalizedName} = ${normalizedName} AND ${rooftopOwners.isPrimary} = true`
    )
    .orderBy(desc(leads.leadScore));

  return properties;
}
