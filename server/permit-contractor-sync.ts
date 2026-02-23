import { db } from "./storage";
import { leads } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

interface ParsedContractor {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  permitType: string;
  permitDate: string | null;
  workDescription: string | null;
}

function extractPhone(text: string): { phone: string | null; remaining: string } {
  const patterns = [
    /\((\d{3})\)\s*(\d{3})[- .]?(\d{4})/,
    /\b1?[- .]?(\d{3})[- .](\d{3})[- .](\d{4})\b/,
    /\/(\d{3})(\d{3})(\d{4})/,
    /\b(\d{3})\.(\d{3})\.(\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const groups = match.slice(1);
      let a: string, b: string, c: string;
      if (groups.length === 1 && groups[0].length === 10) {
        a = groups[0].slice(0,3); b = groups[0].slice(3,6); c = groups[0].slice(6);
      } else {
        [a, b, c] = groups.length >= 3 ? groups : [groups[0], groups[1] || "", groups[2] || ""];
      }
      if (a && b && c && a.length === 3 && b.length === 3 && c.length === 4) {
        return { phone: `(${a}) ${b}-${c}`, remaining: text.replace(match[0], "") };
      }
    }
  }
  return { phone: null, remaining: text };
}

function parseContractorField(raw: string): { name: string; phone: string | null; email: string | null; address: string | null } {
  if (!raw || raw.trim().length < 3) return { name: raw?.trim() || "", phone: null, email: null, address: null };

  let cleaned = raw.trim();

  const { phone, remaining: afterPhone } = extractPhone(cleaned);

  const emailMatch = afterPhone.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1].toLowerCase() : null;

  let namePart = afterPhone;
  if (emailMatch) namePart = namePart.replace(emailMatch[0], "");

  let address: string | null = null;
  let name = namePart;

  const addressPatterns = [
    /(\d+\s+(?:N\.?|S\.?|E\.?|W\.?|NORTH|SOUTH|EAST|WEST)?\s*[A-Z0-9].*?,\s*[A-Z]+.*?,\s*[A-Z]{2}\s+\d{5})/i,
    /(P\.?O\.?\s*BOX\s+\d+.*?,\s*[A-Z]+.*?,\s*[A-Z]{2}\s+\d{5})/i,
    /(\d+\s+[A-Z][\w\s]+(?:ST|AVE|BLVD|DR|RD|LN|CT|PL|WAY|PKWY|HWY|FM|TRAIL|ROW|CIRCLE|STE|SUITE)[\w\s#]*?,\s*[A-Z]+.*?,\s*[A-Z]{2}\s+\d{5})/i,
  ];

  for (const pattern of addressPatterns) {
    const match = namePart.match(pattern);
    if (match) {
      address = match[1].replace(/\s+/g, " ").trim();
      name = namePart.replace(match[0], "");
      break;
    }
  }

  name = name
    .replace(/\\+/g, " ")
    .replace(/[,\s]+$/, "")
    .replace(/^\s*,\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length < 2 || /^[,\s().-]+$/.test(name)) {
    return { name: "", phone: null, email: null, address: null };
  }

  return { name, phone, email, address };
}

export async function syncPermitContractorsToLeads(): Promise<{ updated: number; totalContractors: number; newlyLinked: number }> {
  console.log("[Permit Sync] Step 1: Re-linking unlinked permits to leads by address...");

  const linked = await db.execute(sql`
    UPDATE building_permits bp
    SET lead_id = l.id
    FROM leads l
    WHERE bp.lead_id IS NULL
      AND LOWER(TRIM(l.address)) = LOWER(
        REGEXP_REPLACE(
          TRIM(bp.address),
          '\s+(Ste|STE|Suite|SUITE|Unit|UNIT|Apt|APT|#)\s*:?\s*\S+$',
          '',
          'i'
        )
      )
  `);
  const newlyLinked = (linked as any).rowCount || 0;
  console.log(`[Permit Sync] Newly linked ${newlyLinked} permits by address match`);

  console.log("[Permit Sync] Step 2: Parsing and syncing contractors to leads...");

  const rows = await db.execute(sql`
    SELECT 
      bp.lead_id,
      bp.contractor,
      bp.contractor_phone,
      bp.permit_type,
      bp.issued_date,
      bp.work_description
    FROM building_permits bp
    WHERE bp.lead_id IS NOT NULL
      AND bp.contractor IS NOT NULL
      AND bp.contractor != ''
    ORDER BY bp.lead_id, bp.issued_date DESC
  `);

  const leadPermits = new Map<string, ParsedContractor[]>();

  for (const row of rows.rows as any[]) {
    const leadId = row.lead_id;
    const parsed = parseContractorField(row.contractor);

    if (!parsed.name || parsed.name.length < 2) continue;

    const phone = parsed.phone || (row.contractor_phone && row.contractor_phone.length > 5 ? row.contractor_phone : null);

    const contractor: ParsedContractor = {
      name: parsed.name,
      phone,
      email: parsed.email,
      address: parsed.address,
      permitType: row.permit_type || "Unknown",
      permitDate: row.issued_date || null,
      workDescription: row.work_description || null,
    };

    if (!leadPermits.has(leadId)) {
      leadPermits.set(leadId, []);
    }
    leadPermits.get(leadId)!.push(contractor);
  }

  let updated = 0;
  let totalContractors = 0;

  for (const [leadId, contractors] of leadPermits) {
    const seen = new Set<string>();
    const deduped = contractors.filter(c => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    totalContractors += deduped.length;

    try {
      await db.update(leads).set({
        permitContractors: deduped,
        permitCount: contractors.length,
      }).where(eq(leads.id, leadId));
      updated++;
    } catch (err: any) {
      console.error(`[Permit Sync] Failed to update lead ${leadId}:`, err.message);
    }
  }

  console.log(`[Permit Sync] Complete: ${updated} leads updated with ${totalContractors} unique contractors (${newlyLinked} newly linked)`);
  return { updated, totalContractors, newlyLinked };
}
