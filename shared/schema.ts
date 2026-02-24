import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  permitContractors: jsonb("permit_contractors"),
  distressScore: integer("distress_score").default(0),
  leadScore: integer("lead_score").notNull().default(0),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  consentStatus: text("consent_status").default("unknown"),
  consentDate: text("consent_date"),
  consentChannel: text("consent_channel"),
  dncRegistered: boolean("dnc_registered"),
  managementCompany: text("management_company"),
  managementContact: text("management_contact"),
  managementPhone: text("management_phone"),
  managementEmail: text("management_email"),
  managementEvidence: jsonb("management_evidence"),
  managementAttributedAt: timestamp("management_attributed_at"),
  contactRole: text("contact_role"),
  roleConfidence: integer("role_confidence"),
  decisionMakerRank: integer("decision_maker_rank"),
  roleEvidence: jsonb("role_evidence"),
  dmConfidenceScore: integer("dm_confidence_score"),
  dmConfidenceComponents: jsonb("dm_confidence_components"),
  dmReviewStatus: text("dm_review_status").default("unreviewed"),
  dmReviewedAt: timestamp("dm_reviewed_at"),
  dmReviewedBy: text("dm_reviewed_by"),
  ownershipStructure: text("ownership_structure"),
  ownershipSignals: jsonb("ownership_signals"),
  decisionMakers: jsonb("decision_makers"),
  reverseAddressType: text("reverse_address_type"),
  reverseAddressBusinesses: jsonb("reverse_address_businesses"),
  reverseAddressEnrichedAt: timestamp("reverse_address_enriched_at"),
  lastEnrichedAt: timestamp("last_enriched_at"),
  enrichmentStatus: text("enrichment_status").default("pending"),
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

export const suppressionList = pgTable("suppression_list", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  entityName: text("entity_name"),
  phone: text("phone"),
  email: text("email"),
  channel: text("channel").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull().default("manual"),
  addedAt: timestamp("added_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
});

export const decisionMakerReviews = pgTable("decision_maker_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  action: text("action").notNull(),
  previousRole: text("previous_role"),
  newRole: text("new_role"),
  previousConfidence: integer("previous_confidence"),
  newConfidence: integer("new_confidence"),
  reviewerNotes: text("reviewer_notes"),
  evidenceSummary: jsonb("evidence_summary"),
  reviewedBy: text("reviewed_by").notNull().default("system"),
  reviewedAt: timestamp("reviewed_at").defaultNow(),
});

export const portfolios = pgTable("portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id"),
  name: text("name").notNull(),
  keyOwner: text("key_owner").notNull(),
  ownerType: text("owner_type").notNull().default("LLC"),
  propertyCount: integer("property_count").notNull().default(0),
  totalSqft: integer("total_sqft").notNull().default(0),
  totalRoofArea: integer("total_roof_area").notNull().default(0),
  totalValue: bigint("total_value", { mode: "number" }).notNull().default(0),
  avgLeadScore: integer("avg_lead_score").notNull().default(0),
  totalHailEvents: integer("total_hail_events").notNull().default(0),
  claimWindowCount: integer("claim_window_count").notNull().default(0),
  portfolioScore: integer("portfolio_score").notNull().default(0),
  keyDecisionMaker: text("key_decision_maker"),
  keyDecisionMakerTitle: text("key_decision_maker_title"),
  keyPhone: text("key_phone"),
  keyEmail: text("key_email"),
  linkageType: text("linkage_type").notNull().default("owner_name"),
  linkageKeys: text("linkage_keys").array(),
  registeredAgent: text("registered_agent"),
  managingMember: text("managing_member"),
  llcEntities: text("llc_entities").array(),
  metadata: jsonb("metadata"),
  analyzedAt: timestamp("analyzed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const portfolioLeads = pgTable("portfolio_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").notNull(),
  leadId: varchar("lead_id").notNull(),
  linkReason: text("link_reason").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const duplicateClusters = pgTable("duplicate_clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  marketId: varchar("market_id"),
  canonicalLeadId: varchar("canonical_lead_id").notNull(),
  memberLeadIds: text("member_lead_ids").array().notNull(),
  matchType: text("match_type").notNull(),
  matchKeys: text("match_keys").array().notNull(),
  matchConfidence: integer("match_confidence").notNull().default(0),
  matchExplanation: text("match_explanation").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at"),
  mergedAt: timestamp("merged_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const entityMerges = pgTable("entity_merges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clusterId: varchar("cluster_id").notNull(),
  canonicalLeadId: varchar("canonical_lead_id").notNull(),
  mergedLeadId: varchar("merged_lead_id").notNull(),
  fieldsApplied: jsonb("fields_applied"),
  previousValues: jsonb("previous_values"),
  mergedAt: timestamp("merged_at").defaultNow(),
});

export const contactEvidence = pgTable("contact_evidence", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  entityType: text("entity_type").notNull().default("LEAD"),
  entityId: varchar("entity_id"),
  contactType: text("contact_type").notNull(),
  contactValue: text("contact_value").notNull(),
  normalizedValue: text("normalized_value"),
  isPublicBusiness: boolean("is_public_business").default(true),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  sourceType: text("source_type").notNull().default("API"),
  extractedAt: timestamp("extracted_at").defaultNow(),
  extractorMethod: text("extractor_method").notNull().default("RULE"),
  rawSnippet: text("raw_snippet"),
  confidence: integer("confidence").notNull().default(50),
  sourceTrustScore: integer("source_trust_score").notNull().default(50),
  recencyFactor: real("recency_factor").notNull().default(1.0),
  corroborationCount: integer("corroboration_count").notNull().default(1),
  domainMatchFactor: real("domain_match_factor").notNull().default(0),
  extractionQuality: real("extraction_quality").notNull().default(0.7),
  computedScore: real("computed_score").notNull().default(50),
  validationStatus: text("validation_status").notNull().default("UNVERIFIED"),
  validationDetail: text("validation_detail"),
  validatedAt: timestamp("validated_at"),
  phoneLineType: text("phone_line_type"),
  carrierName: text("carrier_name"),
  suppressedAt: timestamp("suppressed_at"),
  suppressedReason: text("suppressed_reason"),
  suppressedBy: text("suppressed_by"),
  lastVerifiedAt: timestamp("last_verified_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const conflictSets = pgTable("conflict_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  contactType: text("contact_type").notNull(),
  candidateValues: jsonb("candidate_values").notNull(),
  winnerEvidenceId: varchar("winner_evidence_id"),
  resolution: text("resolution").notNull().default("UNRESOLVED"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  scoreMargin: real("score_margin"),
  auditTrail: jsonb("audit_trail"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const enrichmentJobs = pgTable("enrichment_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  status: text("status").notNull().default("queued"),
  currentStage: text("current_stage"),
  stages: jsonb("stages"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sourceBlocklist = pgTable("source_blocklist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: text("domain"),
  entityName: text("entity_name"),
  reason: text("reason").notNull(),
  blockedBy: text("blocked_by").notNull().default("system"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pmCompanies = pgTable("pm_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  contactPerson: text("contact_person"),
  contactTitle: text("contact_title"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  propertiesManaged: integer("properties_managed").default(0),
  source: text("source"),
  confidence: integer("confidence").default(50),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPmCompanySchema = createInsertSchema(pmCompanies).omit({ id: true, createdAt: true, updatedAt: true });
export type PmCompany = typeof pmCompanies.$inferSelect;
export type InsertPmCompany = z.infer<typeof insertPmCompanySchema>;

export const rooftopOwners = pgTable("rooftop_owners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  personName: text("person_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  role: text("role").notNull(),
  title: text("title"),
  confidence: integer("confidence").notNull().default(50),
  source: text("source").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isPrimary: boolean("is_primary").notNull().default(false),
  portfolioGroupId: varchar("portfolio_group_id"),
  propertyCount: integer("property_count").notNull().default(1),
  totalPortfolioValue: bigint("total_portfolio_value", { mode: "number" }),
  totalPortfolioSqft: integer("total_portfolio_sqft"),
  resolvedAt: timestamp("resolved_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRooftopOwnerSchema = createInsertSchema(rooftopOwners).omit({ id: true, createdAt: true, resolvedAt: true });
export type RooftopOwner = typeof rooftopOwners.$inferSelect;
export type InsertRooftopOwner = z.infer<typeof insertRooftopOwnerSchema>;

export const graphNodes = pgTable("graph_nodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nodeType: text("node_type").notNull(),
  label: text("label").notNull(),
  normalizedLabel: text("normalized_label").notNull(),
  entityId: varchar("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const graphEdges = pgTable("graph_edges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceNodeId: varchar("source_node_id").notNull(),
  targetNodeId: varchar("target_node_id").notNull(),
  edgeType: text("edge_type").notNull(),
  label: text("label"),
  weight: real("weight").notNull().default(1.0),
  evidence: text("evidence"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const graphBuildRuns = pgTable("graph_build_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("pending"),
  nodesCreated: integer("nodes_created").notNull().default(0),
  edgesCreated: integer("edges_created").notNull().default(0),
  leadsProcessed: integer("leads_processed").notNull().default(0),
  totalLeads: integer("total_leads").notNull().default(0),
  currentPhase: text("current_phase"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGraphNodeSchema = createInsertSchema(graphNodes).omit({ id: true, createdAt: true });
export const insertGraphEdgeSchema = createInsertSchema(graphEdges).omit({ id: true, createdAt: true });
export const insertGraphBuildRunSchema = createInsertSchema(graphBuildRuns).omit({ id: true, createdAt: true });

export type GraphNode = typeof graphNodes.$inferSelect;
export type InsertGraphNode = z.infer<typeof insertGraphNodeSchema>;
export type GraphEdge = typeof graphEdges.$inferSelect;
export type InsertGraphEdge = z.infer<typeof insertGraphEdgeSchema>;
export type GraphBuildRun = typeof graphBuildRuns.$inferSelect;
export type InsertGraphBuildRun = z.infer<typeof insertGraphBuildRunSchema>;

export const insertContactEvidenceSchema = createInsertSchema(contactEvidence).omit({ id: true, createdAt: true });
export const insertConflictSetSchema = createInsertSchema(conflictSets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEnrichmentJobSchema = createInsertSchema(enrichmentJobs).omit({ id: true, createdAt: true });
export const insertSourceBlocklistSchema = createInsertSchema(sourceBlocklist).omit({ id: true, createdAt: true });

export type ContactEvidence = typeof contactEvidence.$inferSelect;
export type InsertContactEvidence = z.infer<typeof insertContactEvidenceSchema>;
export type ConflictSet = typeof conflictSets.$inferSelect;
export type InsertConflictSet = z.infer<typeof insertConflictSetSchema>;
export type EnrichmentJob = typeof enrichmentJobs.$inferSelect;
export type InsertEnrichmentJob = z.infer<typeof insertEnrichmentJobSchema>;
export type SourceBlocklistEntry = typeof sourceBlocklist.$inferSelect;
export type InsertSourceBlocklistEntry = z.infer<typeof insertSourceBlocklistSchema>;

export const insertDuplicateClusterSchema = createInsertSchema(duplicateClusters).omit({ id: true, createdAt: true, reviewedAt: true, mergedAt: true });
export const insertEntityMergeSchema = createInsertSchema(entityMerges).omit({ id: true, mergedAt: true });

export type DuplicateCluster = typeof duplicateClusters.$inferSelect;
export type InsertDuplicateCluster = z.infer<typeof insertDuplicateClusterSchema>;
export type EntityMerge = typeof entityMerges.$inferSelect;
export type InsertEntityMerge = z.infer<typeof insertEntityMergeSchema>;

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
export const insertSuppressionListSchema = createInsertSchema(suppressionList).omit({ id: true, addedAt: true });
export const insertDecisionMakerReviewSchema = createInsertSchema(decisionMakerReviews).omit({ id: true, reviewedAt: true });
export const insertPortfolioSchema = createInsertSchema(portfolios).omit({ id: true, createdAt: true, analyzedAt: true });
export const insertPortfolioLeadSchema = createInsertSchema(portfolioLeads).omit({ id: true, createdAt: true });

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
export type SuppressionEntry = typeof suppressionList.$inferSelect;
export type InsertSuppressionEntry = z.infer<typeof insertSuppressionListSchema>;
export type DecisionMakerReview = typeof decisionMakerReviews.$inferSelect;
export type InsertDecisionMakerReview = z.infer<typeof insertDecisionMakerReviewSchema>;
export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type PortfolioLead = typeof portfolioLeads.$inferSelect;
export type InsertPortfolioLead = z.infer<typeof insertPortfolioLeadSchema>;

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

export const apiUsageTracker = pgTable("api_usage_tracker", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  service: text("service").notNull(),
  month: text("month").notNull(),
  usedCount: integer("used_count").notNull().default(0),
  monthlyLimit: integer("monthly_limit").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertApiUsageSchema = createInsertSchema(apiUsageTracker).omit({ id: true, createdAt: true });
export type InsertApiUsage = z.infer<typeof insertApiUsageSchema>;
export type ApiUsage = typeof apiUsageTracker.$inferSelect;
