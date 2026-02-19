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
  intelligenceAt: timestamp("intelligence_at"),
  improvementValue: integer("improvement_value"),
  landValue: integer("land_value"),
  totalValue: integer("total_value"),
  hailEvents: integer("hail_events").notNull().default(0),
  lastHailDate: text("last_hail_date"),
  lastHailSize: real("last_hail_size"),
  leadScore: integer("lead_score").notNull().default(0),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
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
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export type LeadFilter = z.infer<typeof leadFilterSchema>;

export const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "proposal", "closed"]).optional(),
  notes: z.string().optional(),
});

export type UpdateLead = z.infer<typeof updateLeadSchema>;
