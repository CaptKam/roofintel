import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  state: text("state").notNull(),
  counties: text("counties").array().notNull(),
  centerLat: real("center_lat").notNull(),
  centerLng: real("center_lng").notNull(),
  radiusMiles: integer("radius_miles").notNull().default(50),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  county: text("county").notNull(),
  state: text("state").notNull().default("TX"),
  zipCode: text("zip_code").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  sqft: integer("sqft").notNull(),
  yearBuilt: integer("year_built").notNull(),
  constructionType: text("construction_type").notNull(),
  zoning: text("zoning").notNull(),
  stories: integer("stories").notNull().default(1),
  units: integer("units").notNull().default(1),
  roofLastReplaced: integer("roof_last_replaced"),
  roofMaterial: text("roof_material"),
  roofType: text("roof_type"),
  estimatedRoofArea: integer("estimated_roof_area"),
  claimWindowOpen: boolean("claim_window_open"),
  lastRoofingPermitDate: text("last_roofing_permit_date"),
  lastRoofingContractor: text("last_roofing_contractor"),
  lastRoofingPermitType: text("last_roofing_permit_type"),
  ownerName: text("owner_name").notNull(),
  ownerType: text("owner_type").notNull(),
  ownerAddress: text("owner_address"),
  ownerPhone: text("owner_phone"),
  phoneSource: text("phone_source"),
  phoneEnrichedAt: timestamp("phone_enriched_at"),
  ownerEmail: text("owner_email"),
  businessName: text("business_name"),
  businessWebsite: text("business_website"),
  contactName: text("contact_name"),
  contactTitle: text("contact_title"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  contactSource: text("contact_source"),
  webResearchedAt: timestamp("web_researched_at"),
  llcName: text("llc_name"),
  registeredAgent: text("registered_agent"),
  officerName: text("officer_name"),
  officerTitle: text("officer_title"),
  sosFileNumber: text("sos_file_number"),
  taxpayerId: text("taxpayer_id"),
  contactEnrichedAt: timestamp("contact_enriched_at"),
  managingMember: text("managing_member"),
  managingMemberTitle: text("managing_member_title"),
  managingMemberPhone: text("managing_member_phone"),
  managingMemberEmail: text("managing_member_email"),
  llcChain: jsonb("llc_chain"),
  ownerIntelligence: jsonb("owner_intelligence"),
  intelligenceScore: integer("intelligence_score").notNull().default(0),
  intelligenceSources: text("intelligence_sources").array(),
  buildingContacts: jsonb("building_contacts"),
  intelligenceAt: timestamp("intelligence_at"),
  ownershipFlag: text("ownership_flag"),
  improvementValue: integer("improvement_value"),
  landValue: integer("land_value"),
  totalValue: integer("total_value"),
  hailEvents: integer("hail_events").notNull().default(0),
  lastHailDate: text("last_hail_date"),
  lastHailSize: real("last_hail_size"),
  floodZone: text("flood_zone"),
  floodZoneSubtype: text("flood_zone_subtype"),
  isFloodHighRisk: boolean("is_flood_high_risk").default(false),
  lastDeedDate: text("last_deed_date"),
  lienCount: integer("lien_count").default(0),
  foreclosureFlag: boolean("foreclosure_flag").default(false),
  taxDelinquent: boolean("tax_delinquent").default(false),
  violationCount: integer("violation_count").default(0),
  openViolations: integer("open_violations").default(0),
  lastViolationDate: text("last_violation_date"),
  permitCount: integer("permit_count").default(0),
  lastPermitDate: text("last_permit_date"),
  distressScore: integer("distress_score").default(0),
  leadScore: integer("lead_score").notNull().default(0),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  consentStatus: text("consent_status").default("unknown"),
  consentDate: text("consent_date"),
  consentChannel: text("consent_channel"),
  dncRegistered: boolean("dnc_registered"),
  sourceType: text("source_type").default("seed"),
  sourceId: text("source_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const hailEvents = pgTable("hail_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id"),
  eventDate: text("event_date").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  hailSize: real("hail_size").notNull(),
  county: text("county").notNull(),
  city: text("city"),
  state: text("state").default("TX"),
  source: text("source").notNull().default("NOAA"),
  noaaEventId: text("noaa_event_id"),
  noaaEpisodeId: text("noaa_episode_id"),
});

export const dataSources = pgTable("data_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  url: text("url"),
  marketId: varchar("market_id"),
  lastFetchedAt: timestamp("last_fetched_at"),
  nextFetchAt: timestamp("next_fetch_at"),
  isActive: boolean("is_active").notNull().default(true),
  config: jsonb("config"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const importRuns = pgTable("import_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dataSourceId: varchar("data_source_id"),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  recordsProcessed: integer("records_processed").default(0),
  recordsImported: integer("records_imported").default(0),
  recordsSkipped: integer("records_skipped").default(0),
  errors: text("errors"),
  metadata: jsonb("metadata"),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("idle"),
  schedule: text("schedule"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const stormAlertConfigs = pgTable("storm_alert_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id"),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  minHailSize: real("min_hail_size").notNull().default(1.0),
  minProbSevere: integer("min_prob_severe").notNull().default(40),
  predictiveAlerts: boolean("predictive_alerts").notNull().default(true),
  notifyEmail: boolean("notify_email").notNull().default(false),
  notifySms: boolean("notify_sms").notNull().default(false),
  recipients: jsonb("recipients").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const stormRuns = pgTable("storm_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id"),
  status: text("status").notNull().default("detected"),
  detectedAt: timestamp("detected_at").defaultNow(),
  radarSignatureCount: integer("radar_signature_count").notNull().default(0),
  maxHailProb: integer("max_hail_prob").notNull().default(0),
  maxSevereProb: integer("max_severe_prob").notNull().default(0),
  swathPolygon: jsonb("swath_polygon"),
  affectedLeadCount: integer("affected_lead_count").notNull().default(0),
  nwsAlertIds: text("nws_alert_ids").array(),
  metadata: jsonb("metadata"),
});

export const alertHistory = pgTable("alert_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stormRunId: varchar("storm_run_id"),
  alertConfigId: varchar("alert_config_id"),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const responseQueue = pgTable("response_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stormRunId: varchar("storm_run_id").notNull(),
  leadId: varchar("lead_id").notNull(),
  priority: integer("priority").notNull().default(0),
  distanceMiles: real("distance_miles"),
  hailProbability: integer("hail_probability"),
  status: text("status").notNull().default("pending"),
  assignedTo: text("assigned_to"),
  calledAt: timestamp("called_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const intelligenceClaims = pgTable("intelligence_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  agentName: text("agent_name").notNull(),
  claimType: text("claim_type").notNull(),
  fieldName: text("field_name").notNull(),
  fieldValue: text("field_value").notNull(),
  sourceUrl: text("source_url"),
  sourceDocId: text("source_doc_id"),
  retrievedAt: timestamp("retrieved_at").defaultNow(),
  effectiveDate: text("effective_date"),
  confidence: integer("confidence").notNull().default(50),
  parsingMethod: text("parsing_method").notNull().default("regex"),
  licenseFlag: text("license_flag").default("public_record"),
  metadata: jsonb("metadata"),
});

export const recordedDocuments = pgTable("recorded_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  marketId: varchar("market_id"),
  documentType: text("document_type").notNull(),
  instrumentNumber: text("instrument_number"),
  grantor: text("grantor"),
  grantee: text("grantee"),
  recordingDate: text("recording_date"),
  legalDescription: text("legal_description"),
  address: text("address"),
  county: text("county").notNull(),
  amount: real("amount"),
  source: text("source").notNull().default("dallas_county_clerk"),
  sourceDocId: text("source_doc_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const codeViolations = pgTable("code_violations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  marketId: varchar("market_id"),
  serviceRequestNumber: text("service_request_number"),
  address: text("address").notNull(),
  violationType: text("violation_type").notNull(),
  category: text("category"),
  status: text("status").notNull().default("open"),
  priority: text("priority"),
  createdDate: text("created_date"),
  closedDate: text("closed_date"),
  department: text("department"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  source: text("source").notNull().default("dallas_311"),
  sourceId: text("source_id"),
  metadata: jsonb("metadata"),
});

export const buildingPermits = pgTable("building_permits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  marketId: varchar("market_id"),
  permitNumber: text("permit_number").notNull(),
  permitType: text("permit_type").notNull(),
  issuedDate: text("issued_date"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  zipCode: text("zip_code"),
  contractor: text("contractor"),
  contractorPhone: text("contractor_phone"),
  owner: text("owner"),
  workDescription: text("work_description"),
  estimatedValue: real("estimated_value"),
  sqft: integer("sqft"),
  landUse: text("land_use"),
  status: text("status"),
  source: text("source").notNull().default("dallas_open_data"),
  sourcePermitId: text("source_permit_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const complianceConsent = pgTable("compliance_consent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  channel: text("channel").notNull(),
  consentStatus: text("consent_status").notNull().default("unknown"),
  consentSource: text("consent_source"),
  consentDate: timestamp("consent_date"),
  revokedDate: timestamp("revoked_date"),
  dncChecked: boolean("dnc_checked").default(false),
  dncResult: text("dnc_result"),
  dncCheckedAt: timestamp("dnc_checked_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMarketSchema = createInsertSchema(markets).omit({ id: true, createdAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export const insertHailEventSchema = createInsertSchema(hailEvents).omit({ id: true });
export const insertDataSourceSchema = createInsertSchema(dataSources).omit({ id: true, createdAt: true });
export const insertImportRunSchema = createInsertSchema(importRuns).omit({ id: true });
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, createdAt: true });
export const insertStormAlertConfigSchema = createInsertSchema(stormAlertConfigs).omit({ id: true, createdAt: true });
export const insertStormRunSchema = createInsertSchema(stormRuns).omit({ id: true });
export const insertAlertHistorySchema = createInsertSchema(alertHistory).omit({ id: true });
export const insertResponseQueueSchema = createInsertSchema(responseQueue).omit({ id: true, createdAt: true });
export const insertIntelligenceClaimSchema = createInsertSchema(intelligenceClaims).omit({ id: true });
export const insertRecordedDocumentSchema = createInsertSchema(recordedDocuments).omit({ id: true, createdAt: true });
export const insertCodeViolationSchema = createInsertSchema(codeViolations).omit({ id: true });
export const insertBuildingPermitSchema = createInsertSchema(buildingPermits).omit({ id: true, createdAt: true });
export const insertComplianceConsentSchema = createInsertSchema(complianceConsent).omit({ id: true, createdAt: true, updatedAt: true });

export type Market = typeof markets.$inferSelect;
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertHailEvent = z.infer<typeof insertHailEventSchema>;
export type HailEvent = typeof hailEvents.$inferSelect;
export type DataSource = typeof dataSources.$inferSelect;
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
export type ImportRun = typeof importRuns.$inferSelect;
export type InsertImportRun = z.infer<typeof insertImportRunSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type StormAlertConfig = typeof stormAlertConfigs.$inferSelect;
export type InsertStormAlertConfig = z.infer<typeof insertStormAlertConfigSchema>;
export type StormRun = typeof stormRuns.$inferSelect;
export type InsertStormRun = z.infer<typeof insertStormRunSchema>;
export type AlertHistoryRecord = typeof alertHistory.$inferSelect;
export type InsertAlertHistory = z.infer<typeof insertAlertHistorySchema>;
export type ResponseQueueItem = typeof responseQueue.$inferSelect;
export type InsertResponseQueue = z.infer<typeof insertResponseQueueSchema>;
export type IntelligenceClaim = typeof intelligenceClaims.$inferSelect;
export type InsertIntelligenceClaim = z.infer<typeof insertIntelligenceClaimSchema>;
export type RecordedDocument = typeof recordedDocuments.$inferSelect;
export type InsertRecordedDocument = z.infer<typeof insertRecordedDocumentSchema>;
export type CodeViolation = typeof codeViolations.$inferSelect;
export type InsertCodeViolation = z.infer<typeof insertCodeViolationSchema>;
export type BuildingPermit = typeof buildingPermits.$inferSelect;
export type InsertBuildingPermit = z.infer<typeof insertBuildingPermitSchema>;
export type ComplianceConsentRecord = typeof complianceConsent.$inferSelect;
export type InsertComplianceConsent = z.infer<typeof insertComplianceConsentSchema>;

export const leadFilterSchema = z.object({
  marketId: z.string().optional(),
  county: z.string().optional(),
  minScore: z.number().optional(),
  maxScore: z.number().optional(),
  minSqft: z.number().optional(),
  maxSqft: z.number().optional(),
  zoning: z.string().optional(),
  ownerType: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  hasPhone: z.boolean().optional(),
  hasDistress: z.boolean().optional(),
  floodRisk: z.boolean().optional(),
  hasViolations: z.boolean().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export type LeadFilter = z.infer<typeof leadFilterSchema>;

export const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "proposal", "closed"]).optional(),
  notes: z.string().optional(),
});

export type UpdateLead = z.infer<typeof updateLeadSchema>;
