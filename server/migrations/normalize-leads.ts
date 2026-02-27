import { db } from "../storage";
import { sql } from "drizzle-orm";

export interface MigrationProgress {
  running: boolean;
  phase: string;
  processed: number;
  total: number;
  startedAt: string | null;
  completedAt: string | null;
  tables: {
    property_roof: number;
    property_owner: number;
    property_risk_signals: number;
    property_contacts: number;
    property_intelligence: number;
  };
  errors: string[];
}

export let migrationProgress: MigrationProgress = {
  running: false,
  phase: "idle",
  processed: 0,
  total: 0,
  startedAt: null,
  completedAt: null,
  tables: { property_roof: 0, property_owner: 0, property_risk_signals: 0, property_contacts: 0, property_intelligence: 0 },
  errors: [],
};

export async function runNormalizationMigration(): Promise<void> {
  if (migrationProgress.running) throw new Error("Migration already running");

  migrationProgress = {
    running: true,
    phase: "counting",
    processed: 0,
    total: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    tables: { property_roof: 0, property_owner: 0, property_risk_signals: 0, property_contacts: 0, property_intelligence: 0 },
    errors: [],
  };

  try {
    const countResult = (await db.execute(sql`SELECT COUNT(*) as cnt FROM leads`)) as any;
    const total = Number(countResult.rows[0].cnt);
    migrationProgress.total = total;
    console.log(`[migration] Starting normalization for ${total} leads...`);

    const BATCH = 500;

    migrationProgress.phase = "property_roof";
    console.log(`[migration] Phase 1/5: property_roof`);
    for (let offset = 0; offset < total; offset += BATCH) {
      await db.execute(sql`
        INSERT INTO property_roof (property_id, market_id, roof_type, roof_material, roof_last_replaced,
          estimated_roof_area, last_roofing_permit_date, last_roofing_contractor, last_roofing_permit_type,
          claim_window_open, roof_risk_index, roof_risk_breakdown, source)
        SELECT id, market_id, roof_type, roof_material, roof_last_replaced,
          estimated_roof_area, last_roofing_permit_date, last_roofing_contractor, last_roofing_permit_type,
          claim_window_open, roof_risk_index, roof_risk_breakdown, 'migration_v1'
        FROM leads
        ORDER BY id
        OFFSET ${offset} LIMIT ${BATCH}
        ON CONFLICT (property_id) DO NOTHING
      `);
      migrationProgress.processed = Math.min(offset + BATCH, total);
    }
    const roofCount = (await db.execute(sql`SELECT COUNT(*) as cnt FROM property_roof`)) as any;
    migrationProgress.tables.property_roof = Number(roofCount.rows[0].cnt);
    console.log(`[migration] property_roof: ${migrationProgress.tables.property_roof} rows`);

    migrationProgress.phase = "property_owner";
    migrationProgress.processed = 0;
    console.log(`[migration] Phase 2/5: property_owner`);
    for (let offset = 0; offset < total; offset += BATCH) {
      await db.execute(sql`
        INSERT INTO property_owner (property_id, market_id, owner_name, owner_type, owner_address,
          owner_phone, owner_email, phone_source, phone_enriched_at, llc_name, registered_agent,
          officer_name, officer_title, sos_file_number, taxpayer_id, managing_member, managing_member_title,
          managing_member_phone, managing_member_email, llc_chain, ownership_flag, ownership_structure,
          ownership_signals, source)
        SELECT id, market_id, owner_name, owner_type, owner_address,
          owner_phone, owner_email, phone_source, phone_enriched_at, llc_name, registered_agent,
          officer_name, officer_title, sos_file_number, taxpayer_id, managing_member, managing_member_title,
          managing_member_phone, managing_member_email, llc_chain, ownership_flag, ownership_structure,
          ownership_signals, 'migration_v1'
        FROM leads
        ORDER BY id
        OFFSET ${offset} LIMIT ${BATCH}
        ON CONFLICT (property_id) DO NOTHING
      `);
      migrationProgress.processed = Math.min(offset + BATCH, total);
    }
    const ownerCount = (await db.execute(sql`SELECT COUNT(*) as cnt FROM property_owner`)) as any;
    migrationProgress.tables.property_owner = Number(ownerCount.rows[0].cnt);
    console.log(`[migration] property_owner: ${migrationProgress.tables.property_owner} rows`);

    migrationProgress.phase = "property_risk_signals";
    migrationProgress.processed = 0;
    console.log(`[migration] Phase 3/5: property_risk_signals`);
    for (let offset = 0; offset < total; offset += BATCH) {
      await db.execute(sql`
        INSERT INTO property_risk_signals (property_id, market_id, hail_events, last_hail_date, last_hail_size,
          flood_zone, flood_zone_subtype, is_flood_high_risk, lien_count, foreclosure_flag, tax_delinquent,
          violation_count, open_violations, last_violation_date, permit_count, last_permit_date,
          permit_contractors, distress_score, last_deed_date, source)
        SELECT id, market_id, hail_events, last_hail_date, last_hail_size,
          flood_zone, flood_zone_subtype, is_flood_high_risk, lien_count, foreclosure_flag, tax_delinquent,
          violation_count, open_violations, last_violation_date, permit_count, last_permit_date,
          permit_contractors, distress_score, last_deed_date, 'migration_v1'
        FROM leads
        ORDER BY id
        OFFSET ${offset} LIMIT ${BATCH}
        ON CONFLICT (property_id) DO NOTHING
      `);
      migrationProgress.processed = Math.min(offset + BATCH, total);
    }
    const riskCount = (await db.execute(sql`SELECT COUNT(*) as cnt FROM property_risk_signals`)) as any;
    migrationProgress.tables.property_risk_signals = Number(riskCount.rows[0].cnt);
    console.log(`[migration] property_risk_signals: ${migrationProgress.tables.property_risk_signals} rows`);

    migrationProgress.phase = "property_contacts";
    migrationProgress.processed = 0;
    console.log(`[migration] Phase 4/5: property_contacts`);
    for (let offset = 0; offset < total; offset += BATCH) {
      await db.execute(sql`
        INSERT INTO property_contacts (property_id, market_id, contact_name, contact_title, contact_phone,
          contact_email, contact_source, contact_role, role_confidence, decision_maker_rank, role_evidence,
          dm_confidence_score, dm_confidence_components, dm_review_status, decision_makers,
          management_company, management_contact, management_phone, management_email,
          management_evidence, management_attributed_at, reverse_address_type, reverse_address_businesses,
          reverse_address_enriched_at, source)
        SELECT id, market_id, contact_name, contact_title, contact_phone,
          contact_email, contact_source, contact_role, role_confidence, decision_maker_rank, role_evidence,
          dm_confidence_score, dm_confidence_components, dm_review_status, decision_makers,
          management_company, management_contact, management_phone, management_email,
          management_evidence, management_attributed_at, reverse_address_type, reverse_address_businesses,
          reverse_address_enriched_at, 'migration_v1'
        FROM leads
        ORDER BY id
        OFFSET ${offset} LIMIT ${BATCH}
        ON CONFLICT (property_id) DO NOTHING
      `);
      migrationProgress.processed = Math.min(offset + BATCH, total);
    }
    const contactsCount = (await db.execute(sql`SELECT COUNT(*) as cnt FROM property_contacts`)) as any;
    migrationProgress.tables.property_contacts = Number(contactsCount.rows[0].cnt);
    console.log(`[migration] property_contacts: ${migrationProgress.tables.property_contacts} rows`);

    migrationProgress.phase = "property_intelligence";
    migrationProgress.processed = 0;
    console.log(`[migration] Phase 5/5: property_intelligence`);
    for (let offset = 0; offset < total; offset += BATCH) {
      await db.execute(sql`
        INSERT INTO property_intelligence (property_id, market_id, owner_intelligence, intelligence_score,
          intelligence_sources, building_contacts, intelligence_at, business_name, business_website,
          web_researched_at, source)
        SELECT id, market_id, owner_intelligence, intelligence_score,
          intelligence_sources, building_contacts, intelligence_at, business_name, business_website,
          web_researched_at, 'migration_v1'
        FROM leads
        ORDER BY id
        OFFSET ${offset} LIMIT ${BATCH}
        ON CONFLICT (property_id) DO NOTHING
      `);
      migrationProgress.processed = Math.min(offset + BATCH, total);
    }
    const intelCount = (await db.execute(sql`SELECT COUNT(*) as cnt FROM property_intelligence`)) as any;
    migrationProgress.tables.property_intelligence = Number(intelCount.rows[0].cnt);
    console.log(`[migration] property_intelligence: ${migrationProgress.tables.property_intelligence} rows`);

    migrationProgress.phase = "complete";
    migrationProgress.running = false;
    migrationProgress.completedAt = new Date().toISOString();
    console.log(`[migration] Normalization complete. Tables: roof=${migrationProgress.tables.property_roof}, owner=${migrationProgress.tables.property_owner}, risk=${migrationProgress.tables.property_risk_signals}, contacts=${migrationProgress.tables.property_contacts}, intel=${migrationProgress.tables.property_intelligence}`);
  } catch (error: any) {
    console.error(`[migration] Error in phase ${migrationProgress.phase}:`, error.message);
    migrationProgress.errors.push(`${migrationProgress.phase}: ${error.message}`);
    migrationProgress.running = false;
    migrationProgress.completedAt = new Date().toISOString();
  }
}
