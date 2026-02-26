# RoofIntel — Source Code Architecture

A comprehensive technical reference for the RoofIntel commercial roofing lead intelligence platform.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Project Structure](#2-project-structure)
3. [Data Model & Schema](#3-data-model--schema)
4. [Storage Layer](#4-storage-layer)
5. [Agent Architecture Pattern](#5-agent-architecture-pattern)
6. [Property Data Agents (CAD)](#6-property-data-agents-cad)
7. [Owner Intelligence System](#7-owner-intelligence-system)
8. [Decision-Maker Discovery Pipeline](#8-decision-maker-discovery-pipeline)
9. [Evidence & Trust System](#9-evidence--trust-system)
10. [Enrichment Orchestrator](#10-enrichment-orchestrator)
11. [Hail & Storm Intelligence](#11-hail--storm-intelligence)
12. [Pipeline Orchestrator](#12-pipeline-orchestrator)
13. [Lead Scoring Algorithm (v3)](#13-lead-scoring-algorithm-v3)
14. [Frontend Architecture](#14-frontend-architecture)
15. [API Route Map](#15-api-route-map)
16. [Background Jobs & Scheduling](#16-background-jobs--scheduling)
17. [Compliance & Security](#17-compliance--security)
18. [External API Reference](#18-external-api-reference)

---

## 1. System Overview

RoofIntel is a B2B SaaS platform for commercial roofing contractors. It aggregates public property data, roof intelligence, historical hail exposure, and owner/contact information to deliver prioritized, actionable leads. The platform currently covers the DFW 4-county region (Dallas, Tarrant, Collin, Denton) with ~16,691 leads.

**Core Principle:** No mock or fake data ever. All data comes from real public sources, government APIs, and verified third-party services. All free public agents auto-run; paid APIs are manual-only buttons.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Shadcn/UI (Radix primitives) |
| Routing | Wouter (lightweight client-side router) |
| State Management | TanStack React Query v5 |
| Charts | Recharts |
| Maps | React-Leaflet + Leaflet |
| SEO | react-helmet-async |
| Backend | Express.js on Node.js |
| ORM | Drizzle ORM |
| Database | PostgreSQL |
| File Uploads | Multer (CSV imports) |
| Compression | compression middleware |

---

## 2. Project Structure

```
├── client/                     # Frontend React application
│   └── src/
│       ├── components/         # Reusable UI components (sidebar, map, forms)
│       │   └── ui/             # Shadcn/UI primitives (button, card, dialog, etc.)
│       ├── hooks/              # Custom React hooks (use-toast, use-mobile)
│       ├── lib/                # Utilities (queryClient, utils)
│       ├── pages/              # 19 route pages
│       │   ├── dashboard.tsx
│       │   ├── leads.tsx
│       │   ├── lead-detail.tsx
│       │   ├── map-view.tsx
│       │   ├── map-storms.tsx
│       │   ├── admin.tsx
│       │   ├── portfolios.tsx
│       │   ├── network-explorer.tsx
│       │   ├── owner-intelligence.tsx
│       │   ├── data-intelligence.tsx
│       │   ├── data-management.tsx
│       │   ├── storm-response.tsx
│       │   ├── alert-config.tsx
│       │   ├── hail-events.tsx
│       │   ├── export.tsx
│       │   ├── about.tsx
│       │   ├── contact.tsx
│       │   ├── privacy.tsx
│       │   └── not-found.tsx
│       └── App.tsx             # Root component with routing
├── server/                     # Backend Express application
│   ├── index.ts                # Express app setup, middleware, server start
│   ├── routes.ts               # All API route definitions (~2800 lines)
│   ├── storage.ts              # IStorage interface + DatabaseStorage implementation
│   ├── seed.ts                 # Lead scoring algorithm + database seeding
│   ├── vite.ts                 # Vite dev server integration (DO NOT MODIFY)
│   ├── static.ts               # Static file serving for production
│   │
│   ├── # --- Property Import Agents ---
│   ├── dcad-agent.ts           # Dallas Central Appraisal District
│   ├── tad-agent.ts            # Tarrant Appraisal District
│   ├── collin-cad-agent.ts     # Collin County CAD
│   ├── denton-cad-agent.ts     # Denton County CAD
│   ├── property-importer.ts    # Generic CSV property import
│   │
│   ├── # --- Owner Intelligence Agents ---
│   ├── owner-intelligence.ts   # 11-stage owner research pipeline
│   ├── rooftop-owner-resolver.ts  # People extraction from lead data
│   ├── tx-sos.ts               # Texas Secretary of State lookups
│   ├── sec-edgar.ts            # SEC EDGAR REIT/institutional lookups
│   ├── county-clerk.ts         # County deed record searches
│   │
│   ├── # --- Enrichment Agents ---
│   ├── lead-enrichment-orchestrator.ts  # Single-lead + batch enrichment
│   ├── enrichment-pipeline.ts  # 3-stage TX Open Data enrichment
│   ├── phone-enrichment.ts     # Multi-source phone discovery
│   ├── skip-trace-agent.ts     # Skip trace (permits, WHOIS, email patterns)
│   ├── web-research-agent.ts   # Website scraping for decision-makers
│   ├── social-intel-agents.ts  # Google Places enhanced discovery
│   ├── hunter-io.ts            # Hunter.io email discovery (paid, manual)
│   ├── pdl-enrichment.ts       # People Data Labs enrichment (paid, manual)
│   ├── twilio-lookup.ts        # Twilio phone verification
│   │
│   ├── # --- Decision-Maker Discovery ---
│   ├── ownership-classifier.ts # 4-bucket ownership classification + DM assignment
│   ├── management-attribution.ts  # Manager vs owner separation
│   ├── role-inference.ts       # Role type inference + authority ranking
│   ├── dm-confidence.ts        # 7-factor confidence scoring
│   ├── compliance-gate.ts      # DNC/suppression/consent checking
│   ├── contact-ranking.ts      # Best phone/email selection
│   ├── contact-validation.ts   # E.164 normalization, MX validation
│   ├── contact-feedback.ts     # Wrong number / confirmed good tracking
│   │
│   ├── # --- Evidence & Trust ---
│   ├── evidence-recorder.ts    # Evidence recording + conflict detection
│   │
│   ├── # --- Storm & Hail ---
│   ├── hail-tracker.ts         # NOAA SWDI + NWS alert fetching
│   ├── hail-correlator.ts      # Proximity-based hail-to-lead matching
│   ├── storm-monitor.ts        # Real-time 10-min monitoring cycle
│   ├── xweather-hail.ts        # Xweather predictive hail nowcasting
│   ├── noaa-importer.ts        # Historical NOAA CSV import
│   │
│   ├── # --- Intelligence & Analysis ---
│   ├── entity-resolution.ts    # Deduplication + clustering
│   ├── network-agent.ts        # Relationship graph building
│   ├── graph-engine.ts         # Graph traversal + portfolio linking
│   ├── building-footprint-agent.ts  # OSM building polygons + roof area
│   ├── flood-zone-agent.ts     # FEMA flood zone enrichment
│   ├── reverse-address-enrichment.ts  # Google Places address lookups
│   │
│   ├── # --- Permits & Violations ---
│   ├── permits-agent.ts        # Dallas + Fort Worth permit import
│   ├── permit-contractor-sync.ts  # Contractor-to-lead matching
│   ├── dallas-records-agent.ts # 311 complaints + code violations
│   │
│   ├── # --- Pipeline & Orchestration ---
│   ├── pipeline-orchestrator.ts  # 9-phase automated pipeline
│   ├── job-scheduler.ts        # Background job scheduling
│   │
│   ├── # --- Utility ---
│   ├── pm-company-manager.ts   # Property management company database
│   ├── google-places-tracker.ts  # API usage tracking
│   └── source-trust config     # Trust scores for 30+ data sources
│
├── shared/
│   └── schema.ts               # Drizzle ORM schema (all tables + types)
│
├── drizzle.config.ts           # Drizzle migration config (DO NOT MODIFY)
├── vite.config.ts              # Vite build config (DO NOT MODIFY)
└── package.json                # Dependencies (DO NOT MODIFY directly)
```

---

## 3. Data Model & Schema

All tables are defined in `shared/schema.ts` using Drizzle ORM. The `leads` table is the central entity with 80+ columns.

### 3.1 The `leads` Table

#### Basic Property Information
| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key, auto-generated |
| `marketId` | varchar | Foreign key to markets table |
| `address` | text | Street address |
| `city` | text | City name |
| `county` | text | County name (Dallas, Tarrant, Collin, Denton) |
| `state` | text | State (defaults to TX) |
| `zipCode` | text | ZIP code |
| `latitude` | double | Geospatial latitude |
| `longitude` | double | Geospatial longitude |
| `sqft` | integer | Building square footage |
| `yearBuilt` | integer | Year of construction |
| `constructionType` | text | Construction material type |
| `zoning` | text | Inferred zoning (Commercial, Industrial, Multi-Family) |
| `stories` | integer | Number of stories (estimated or actual) |
| `units` | integer | Number of units (for multi-family) |

#### Roofing & Storm Intelligence
| Column | Type | Description |
|--------|------|-------------|
| `roofLastReplaced` | integer | Year roof was last replaced |
| `roofMaterial` | text | Roof material (TPO, EPDM, Metal, etc.) |
| `roofType` | text | Roof construction type |
| `estimatedRoofArea` | integer | Computed roof area from GIS data |
| `claimWindowOpen` | boolean | Whether an active insurance claim window exists |
| `lastRoofingPermitDate` | text | Date of most recent roofing permit |
| `lastRoofingContractor` | text | Contractor from most recent roofing permit |
| `lastRoofingPermitType` | text | Type of roofing permit |
| `hailEvents` | integer | Count of historical hail events within radius |
| `lastHailDate` | text | Date of most recent hail event |
| `lastHailSize` | double | Size of most recent hail (inches) |
| `permitCount` | integer | Total permit count |
| `lastPermitDate` | text | Most recent permit date |
| `permitContractors` | jsonb | Array of contractor records from permits |

#### Ownership & Contact Information
| Column | Type | Description |
|--------|------|-------------|
| `ownerName` | text (NOT NULL) | Property owner name (from CAD records) |
| `ownerType` | text (NOT NULL) | Inferred type: LLC, Corporation, LP, Trust, Government, Individual |
| `ownerAddress` | text | Owner mailing address |
| `ownerPhone` | text | Owner phone number |
| `phoneSource` | text | Source that provided the phone number |
| `phoneEnrichedAt` | timestamp | When phone enrichment last ran |
| `ownerEmail` | text | Owner email address |
| `businessName` | text | Business/DBA name |
| `businessWebsite` | text | Business website URL |
| `contactName` | text | Primary contact name |
| `contactTitle` | text | Contact title/role |
| `contactPhone` | text | Contact phone number |
| `contactEmail` | text | Contact email address |
| `contactSource` | text | Where contact info was discovered |
| `webResearchedAt` | timestamp | When web research agent last ran |
| `llcName` | text | LLC entity name |
| `registeredAgent` | text | Registered agent for the entity |
| `officerName` | text | Corporate officer name |
| `officerTitle` | text | Officer title |
| `sosFileNumber` | text | TX Secretary of State file number |
| `taxpayerId` | text | TX Comptroller taxpayer ID |
| `contactEnrichedAt` | timestamp | When contact enrichment last ran |
| `managingMember` | text | LLC managing member name |
| `managingMemberTitle` | text | Managing member title |
| `managingMemberPhone` | text | Managing member phone |
| `managingMemberEmail` | text | Managing member email |
| `llcChain` | jsonb | Array of LLC chain links (recursive resolution) |
| `ownerIntelligence` | jsonb | Full owner dossier from intelligence pipeline |
| `intelligenceSources` | text[] | Array of source names that contributed intelligence |
| `buildingContacts` | jsonb | Contacts discovered at the building (tenants, managers) |
| `intelligenceAt` | timestamp | When intelligence pipeline last ran |
| `ownershipFlag` | text | Ownership flag (e.g., "Deep Holding Structure", "Corp Service Shield") |

#### Management & Decision Makers
| Column | Type | Description |
|--------|------|-------------|
| `managementCompany` | text | Attributed property management company |
| `managementContact` | text | Management company contact person |
| `managementPhone` | text | Management company phone |
| `managementEmail` | text | Management company email |
| `managementEvidence` | jsonb | Array of management attribution evidence |
| `managementAttributedAt` | timestamp | When management was attributed |
| `contactRole` | text | Inferred decision-maker role |
| `roleConfidence` | integer | Confidence in role inference (0-100) |
| `decisionMakerRank` | integer | Authority rank (1=highest) |
| `roleEvidence` | jsonb | Evidence supporting role assignment |
| `dmConfidenceScore` | integer | Overall DM confidence (0-100) |
| `dmConfidenceComponents` | jsonb | Breakdown of 7 confidence factors |
| `dmReviewStatus` | text | Default "unreviewed". Set to: auto_publish / review / suppress |
| `dmReviewedAt` | timestamp | When manual review occurred |
| `dmReviewedBy` | text | Who performed the review |
| `ownershipStructure` | text | small_private / investment_firm / institutional_reit / third_party_managed |
| `ownershipSignals` | jsonb | Signals used for classification |
| `decisionMakers` | jsonb | Array of Primary/Secondary/Operational DMs |

#### Compliance & Consent
| Column | Type | Description |
|--------|------|-------------|
| `consentStatus` | text | Default "unknown". TCPA consent status |
| `consentDate` | text | Date consent was recorded |
| `consentChannel` | text | Channel through which consent was obtained |
| `dncRegistered` | boolean | Whether contact is on DNC registry |

#### Reverse Address Intelligence
| Column | Type | Description |
|--------|------|-------------|
| `reverseAddressType` | text | Type discovered at mailing address (management_company, law_firm, etc.) |
| `reverseAddressBusinesses` | jsonb | Businesses found at the owner mailing address |
| `reverseAddressEnrichedAt` | timestamp | When reverse address enrichment last ran |

#### Valuation & Risk
| Column | Type | Description |
|--------|------|-------------|
| `improvementValue` | integer | Improvement appraisal value |
| `landValue` | integer | Land appraisal value |
| `totalValue` | integer | Total appraisal value |
| `floodZone` | text | FEMA flood zone designation |
| `floodZoneSubtype` | text | Specific flood zone subtype |
| `isFloodHighRisk` | boolean | Default false. Whether property is in high-risk zone |
| `lastDeedDate` | text | Date of last deed transfer |
| `lienCount` | integer | Default 0. Number of liens |
| `foreclosureFlag` | boolean | Default false. Whether property is in foreclosure |
| `taxDelinquent` | boolean | Default false. Whether taxes are delinquent |
| `violationCount` | integer | Default 0. Total code violation count |
| `openViolations` | integer | Default 0. Currently open violations |
| `lastViolationDate` | text | Date of most recent violation |
| `distressScore` | integer | Default 0. Calculated distress score (0-15) |
| `leadScore` | integer (NOT NULL) | Default 0. Overall lead priority score (0-100) |
| `intelligenceScore` | integer (NOT NULL) | Default 0. Data completeness score |

#### Pipeline & System Metadata
| Column | Type | Description |
|--------|------|-------------|
| `status` | text | CRM status (new, contacted, qualified, etc.) |
| `notes` | text | User notes |
| `enrichmentStatus` | text | Default "pending". States: pending / running / complete / error |
| `lastEnrichedAt` | timestamp | When single-lead enrichment last ran |
| `pipelineLastProcessedAt` | timestamp | When the full pipeline last processed this lead |
| `pipelineRunId` | text | ID of the pipeline run that processed this lead |
| `sourceType` | text | Origin source (dcad, tad, collin_cad, denton_cad, csv) |
| `sourceId` | text | Source-specific unique identifier |
| `createdAt` | timestamp | Record creation timestamp |

### 3.2 Supporting Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `markets` | Geographic regions | id, name, centerLat, centerLng, radiusMiles |
| `hail_events` | Individual hail incidents | id, latitude, longitude, hailSize, probability, eventDate, source |
| `storm_runs` | Storm detection events | id, swathPolygon, totalLeadsAffected, detectedAt |
| `storm_alert_configs` | User notification settings | id, hailSizeThreshold, probabilityThreshold, channels |
| `alert_history` | Sent notifications log | id, type (SMS/Email), recipientId, sentAt |
| `response_queue` | Post-storm call priority list | id, leadId, stormRunId, priority, status |
| `recorded_documents` | Deed/lien records | id, leadId, instrumentType, grantor, grantee, recordDate |
| `code_violations` | Municipal 311 / code violations | id, leadId, violationType, status, reportDate |
| `building_permits` | Historical permit records | id, leadId, permitType, contractor, issueDate |
| `building_footprints` | GIS building polygons | id, leadId, polygon (jsonb), roofArea, source |
| `portfolios` | Owner property groups | id, ownerEntity, leadCount, totalValue |
| `portfolio_leads` | Junction: portfolio ↔ leads | portfolioId, leadId |
| `contact_evidence` | Granular contact provenance | id, leadId, contactType, contactValue, sourceName, computedScore |
| `conflict_sets` | Conflicting contact data resolution | id, leadId, contactType, status, winnerValue, auditTrail |
| `pm_companies` | Property management company directory | id, name, phone, email, website |
| `rooftop_owners` | Resolved decision-makers | id, leadId, personName, title, phone, email |
| `compliance_consent` | TCPA/DNC consent tracking | id, contactValue, consentType, consentDate |
| `suppression_list` | Do-not-contact entries | id, contactValue, reason, suppressedAt |
| `enrichment_jobs` | Multi-stage enrichment state machine | id, leadId, stage, status, startedAt |
| `duplicate_clusters` | Deduplication groups | id, leadIds, matchScore, mergedInto |
| `data_sources` | External API/scraper config | id, name, type, lastSyncAt, status |
| `import_runs` | Data ingestion logs | id, sourceType, recordCount, errors, startedAt, completedAt |
| `jobs` | Scheduled background tasks | id, type, schedule, lastRunAt, nextRunAt |

### 3.3 Type Exports

For every table, the schema exports:
```typescript
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;
```

These types are shared between frontend and backend via the `@shared/schema` import alias.

---

## 4. Storage Layer

### 4.1 IStorage Interface

Defined in `server/storage.ts`, the `IStorage` interface is the data access contract. It abstracts all database operations so the rest of the application never writes raw SQL directly (agents use Drizzle directly for performance-critical operations).

Key method categories:
- **Markets**: `getMarkets()`, `createMarket()`
- **Leads**: `getLeads(filter)`, `getLeadById(id)`, `createLead()`, `createLeadsBatch()`, `updateLead()`, `getLeadBySourceId()`, `getLeadsInBounds()`, `getLeadCount()`
- **Hail Events**: `createHailEvent()`, `getHailEvents()`
- **Import Runs**: `createImportRun()`, `updateImportRun()`
- **Storm Alerts**: CRUD for alert configs, alert history, response queue
- **Evidence**: `createContactEvidence()`, `getContactEvidence()`

### 4.2 DatabaseStorage Implementation

`DatabaseStorage` implements `IStorage` using Drizzle ORM with a PostgreSQL connection pool (`node-postgres`).

#### Query Pattern: Dynamic Filter Composition
The `getLeads(filter)` method builds WHERE clauses dynamically:
```
1. Initialize empty conditions[] array
2. Check each optional filter field (marketId, minScore, hasPhone, search, etc.)
3. Push Drizzle operators (eq, gte, lte, ilike) for each active filter
4. Join with and(...conditions)
5. Execute two queries:
   a. COUNT(*) for pagination totals
   b. SELECT with LIMIT/OFFSET + ORDER BY leadScore DESC
```

#### Query Pattern: Geospatial Bounding Box
`getLeadsInBounds(north, south, east, west)` uses simple lat/lng comparisons:
```typescript
where: and(
  gte(leads.latitude, south), lte(leads.latitude, north),
  gte(leads.longitude, west), lte(leads.longitude, east)
)
limit: 5000
```

#### Query Pattern: Batch Upserts
`createLeadsBatch(leadsData)` slices arrays into chunks of 100 and inserts each chunk via `db.insert(leads).values(chunk)`.

#### Query Pattern: Full-Text Search
Search queries use `or()` with `ilike` across address, city, ownerName, and county fields with `%term%` wildcards.

---

## 5. Agent Architecture Pattern

All agents in RoofIntel follow a consistent architectural pattern:

### 5.1 Agent Structure

```typescript
// Every agent exports:
// 1. A single-record processing function
export async function processOneThing(lead: Lead): Promise<Result> { ... }

// 2. A batch processing function
export async function runBatchThing(marketId?: string, filterLeadIds?: string[]): Promise<BatchResult> { ... }
```

**Key patterns:**
- **Direct DB Access**: Agents import `db` from Drizzle and query/update the `leads` table directly (not through IStorage) for performance.
- **Evidence Recording**: After discovering contact data, agents call `recordEvidence()` from `evidence-recorder.ts` to create auditable provenance records with source trust scoring.
- **Optional Lead Filtering**: Batch functions accept an optional `filterLeadIds` parameter. When provided, only those leads are processed. When absent, all leads are processed (backward compatible).
- **Import Run Tracking**: Property import agents create `ImportRun` records to track progress, counts, and errors.
- **Error Isolation**: Each lead is processed in a try/catch so one failure doesn't abort the batch.

### 5.2 Agent Inventory

| Agent | File | Type | Description |
|-------|------|------|-------------|
| DCAD Agent | `dcad-agent.ts` | Property Import | Dallas County ArcGIS property data |
| TAD Agent | `tad-agent.ts` | Property Import | Tarrant County ArcGIS property data |
| Collin CAD Agent | `collin-cad-agent.ts` | Property Import | Collin County ArcGIS property data |
| Denton CAD Agent | `denton-cad-agent.ts` | Property Import | Denton County FeatureServer data |
| Owner Intelligence | `owner-intelligence.ts` | Enrichment | 11-stage deep owner research pipeline |
| Skip Trace Agent | `skip-trace-agent.ts` | Enrichment | Multi-source skip trace (permits, WHOIS, email patterns) |
| Phone Enrichment | `phone-enrichment.ts` | Enrichment | Multi-source phone number discovery |
| Web Research Agent | `web-research-agent.ts` | Enrichment | Website scraping for decision-makers |
| Social Intel Agent | `social-intel-agents.ts` | Enrichment | Google Places enhanced business discovery |
| Hunter.io | `hunter-io.ts` | Enrichment (Paid) | Email discovery by domain (25/mo) |
| PDL Enrichment | `pdl-enrichment.ts` | Enrichment (Paid) | Person/company enrichment (100/mo) |
| Management Attribution | `management-attribution.ts` | Analysis | Manager vs owner separation |
| Role Inference | `role-inference.ts` | Analysis | Role type + authority ranking |
| DM Confidence | `dm-confidence.ts` | Analysis | 7-factor decision-maker confidence |
| Ownership Classifier | `ownership-classifier.ts` | Analysis | 4-bucket structure classification + DM assignment |
| Building Footprint | `building-footprint-agent.ts` | GIS | OSM building polygons + roof area computation |
| Flood Zone Agent | `flood-zone-agent.ts` | GIS | FEMA flood zone enrichment |
| Reverse Address | `reverse-address-enrichment.ts` | Enrichment | Google Places mailing address lookups |
| Hail Tracker | `hail-tracker.ts` | Storm | NOAA SWDI + NWS alert fetching |
| Hail Correlator | `hail-correlator.ts` | Storm | Proximity-based hail-to-lead matching |
| Storm Monitor | `storm-monitor.ts` | Storm | Real-time 10-min detection cycle |
| Xweather Hail | `xweather-hail.ts` | Storm | Predictive hail nowcasting (2-min cycle) |
| Permits Agent | `permits-agent.ts` | Records | Dallas + Fort Worth permit import/matching |
| Dallas Records | `dallas-records-agent.ts` | Records | 311 complaints + code violations |
| Evidence Recorder | `evidence-recorder.ts` | Core | Contact evidence with trust scoring |
| Entity Resolution | `entity-resolution.ts` | Core | Lead deduplication + clustering |
| Network Agent | `network-agent.ts` | Core | Relationship graph building |

---

## 6. Property Data Agents (CAD)

The four CAD agents import commercial property data from county Central Appraisal District ArcGIS REST APIs.

### 6.1 ArcGIS API Endpoints

| Agent | Endpoint |
|-------|----------|
| DCAD (Dallas) | `https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query` |
| TAD (Tarrant) | `https://mapit.tarrantcounty.com/arcgis/rest/services/Tax/TCProperty/MapServer/0/query` |
| Collin CAD | `https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1/query` |
| Denton CAD | `https://geo.dentoncad.com/arcgis/rest/services/Hosted/Parcels_with_CAMA_Data/FeatureServer/0/query` |

### 6.2 Request Parameters

All agents send similar ArcGIS query parameters:
- `where`: Filters by improvement value (typically `IMPR_VALUE > 200000`)
- `outFields`: Specifies attributes (OWNER_NAME, SITUS_ADDR, BLDGAREA, etc.)
- `returnGeometry: true` in `outSR: 4326` (WGS84 coordinate system)
- `resultRecordCount`: Page size (1000-2000 records)
- `resultOffset`: For pagination through large datasets
- `f: json`: JSON response format

### 6.3 Data Transformation Pipeline

Each agent transforms heterogeneous ArcGIS schemas into a unified `InsertLead` type:

```
ArcGIS Response → Parse Attributes → Transform:
  1. getCentroid(geometry)     → latitude, longitude
  2. inferOwnerType(ownerName) → LLC | Corporation | LP | Trust | Government | Individual
  3. inferZoning(landUseCode)  → Commercial | Industrial | Multi-Family | Retail | Office
  4. estimateSqft(value)       → sqft (fallback: improvementValue / 120)
  5. normalizeAddress(parts)   → full ownerAddress string
  6. calculateScore(lead)      → initial leadScore (0-100)
```

**Centroid Calculation**: Extracts the geometric center of the parcel polygon to provide a single lat/lng point:
```typescript
function getCentroid(rings: number[][][]): { lat: number; lng: number } {
  // Average all polygon vertices
  let sumLat = 0, sumLng = 0, count = 0;
  for (const point of rings[0]) {
    sumLng += point[0];
    sumLat += point[1];
    count++;
  }
  return { lat: sumLat / count, lng: sumLng / count };
}
```

**Owner Type Inference**: Regex-based pattern matching on owner names:
```
LLC, L.L.C.           → "LLC"
INC, CORP, CO          → "Corporation"
LTD, LP, L.P.         → "LP"
TRUST, TRUSTEES        → "Trust"
CITY OF, COUNTY, ISD   → "Government"
(default)              → "Individual"
```

### 6.4 Deduplication & Upsert

Before inserting, each agent checks for existing records:
```
1. Call storage.getLeadBySourceId(sourceType, sourceId)
2. If exists → skip (no update)
3. If new → add to leadsBatch[]
4. When batch reaches BATCH_INSERT_SIZE (100):
   → storage.createLeadsBatch(leadsBatch)
   → reset batch
```

### 6.5 Import Run Tracking

Every import creates an `ImportRun` record:
```typescript
const run = await storage.createImportRun({
  sourceType: "dcad",
  status: "running",
  recordCount: 0,
});
// ... processing ...
await storage.updateImportRun(run.id, {
  status: "completed",
  recordCount: totalImported,
  errors: errorMessages,
  completedAt: new Date(),
});
```

---

## 7. Owner Intelligence System

The owner intelligence system (`server/owner-intelligence.ts`) is the most complex agent. It runs an 11-stage sequential pipeline to build a comprehensive "Owner Dossier" for each lead.

### 7.1 Pipeline Stages

```
Stage 1: TX SOS Deep Agent
  └─ Query TX Comptroller using taxpayerId or sosFileNumber
  └─ Extract officers, registered agent, formation date, entity type

Stage 2: LLC Chain Agent
  └─ If officer name fails isPersonName() (is another entity):
     └─ Queue entity for recursive resolution
     └─ Search Comptroller for that entity
     └─ Extract its officers
     └─ Repeat until human found or maxDepth=3 reached
  └─ Result: llcChain[] array of parent entities

Stage 3: TX Comptroller Agent
  └─ Franchise Tax Public Information Reports (PIR)
  └─ TX_COMPTROLLER_API_KEY required
  └─ Extracts responsible parties with titles

Stage 4: Property Tax Records Agent
  └─ Parses "ATTN" and "C/O" names from CAD data
  └─ Identifies management contacts from tax records

Stage 5: Google Places Agent (paid, skipped if skipPaidApis=true)
  └─ Searches for businesses at property address
  └─ Extracts phone numbers, websites, business names

Stage 6: Serper Web Search Agent (paid, skipped if skipPaidApis=true)
  └─ Web search for owner name + property address
  └─ Extracts decision-makers from search results

Stage 7: Email Pattern Discovery
  └─ Discovers email patterns from business website domain
  └─ Generates candidate emails for known contacts

Stage 8: Court Records Agent
  └─ County clerk deed record searches
  └─ Identifies grantors/grantees and property transfers

Stage 9: Social Intel Agent
  └─ Google Places enhanced search near property coordinates
  └─ Identifies building tenants and managers

Stage 10: Skip Trace Agent
  └─ Building permits, sales tax permits, TCEQ records
  └─ WHOIS lookups, reverse address discovery
  └─ Email pattern generation

Stage 11: SEC EDGAR Agent
  └─ For REIT/institutional owners
  └─ SEC filing API (data.sec.gov/submissions/)
  └─ Company details, SIC classification, filing history
```

### 7.2 LLC Chain Resolution

The LLC chain agent handles multi-layered corporate ownership:

```
Input: "ABC HOLDINGS LLC" owns the property
  │
  ├─ TX SOS lookup for "ABC HOLDINGS LLC"
  │   └─ Officers: ["JOHN SMITH", "XYZ INVESTMENTS LLC"]
  │
  ├─ "JOHN SMITH" passes isPersonName() ✓ → Record as person
  │
  └─ "XYZ INVESTMENTS LLC" fails isPersonName() → Recurse (depth 2)
      │
      ├─ TX SOS lookup for "XYZ INVESTMENTS LLC"
      │   └─ Officers: ["JANE DOE"]
      │
      └─ "JANE DOE" passes isPersonName() ✓ → Record as person

Result: llcChain = [
  { entity: "ABC HOLDINGS LLC", depth: 1, officers: [...] },
  { entity: "XYZ INVESTMENTS LLC", depth: 2, officers: [...] }
]
Ultimate human owners: ["JOHN SMITH", "JANE DOE"]
```

### 7.3 Key Helper Functions

- `isPersonName(name)`: Regex-based check to distinguish human names from entity names. Filters out strings containing LLC, INC, CORP, TRUST, etc.
- `expandTitle(abbrev)`: Converts shorthand titles ("MANAGING M" → "Managing Member", "PRES" → "President")
- `fetchWithTimeout(url, options, ms)`: Fetch wrapper with configurable timeout to prevent hanging on slow government APIs

### 7.4 Output: Owner Dossier

The pipeline produces an `OwnerDossier` stored in the lead's `ownerIntelligence` jsonb column:
```typescript
interface OwnerDossier {
  people: PersonRecord[];      // All discovered human contacts
  entities: EntityRecord[];    // All corporate entities in chain
  llcChain: LlcChainLink[];   // Ownership chain
  sources: string[];           // Which stages produced data
  enrichedAt: Date;
}
```

---

## 8. Decision-Maker Discovery Pipeline

The decision-maker discovery system is a 7-step pipeline that transforms raw owner data into ranked, verified decision-makers ready for outreach.

### 8.1 Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    LEAD DATA INPUT                          │
│  ownerName, ownerType, llcChain, contacts, permits, etc.   │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 1: OWNERSHIP CLASSIFICATION       │
│  ownership-classifier.ts               │
│                                         │
│  Analyzes: entity patterns, LLC depth,  │
│  mailing address type, portfolio size,  │
│  property value                         │
│                                         │
│  Output: one of 4 buckets:              │
│  • small_private                        │
│  • investment_firm                      │
│  • institutional_reit                   │
│  • third_party_managed                  │
│                                         │
│  Each bucket has different              │
│  TITLE RELEVANCE scores:               │
│  small_private → Managing Member: 100   │
│  institutional_reit → Facilities: 100   │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 2: MANAGEMENT ATTRIBUTION         │
│  management-attribution.ts             │
│                                         │
│  Triangulates from 3 sources:           │
│  1. Building permits (applicant ≠       │
│     owner → likely manager)             │
│  2. Assessor mailing address            │
│     ("C/O" entities)                    │
│  3. Corporate registry records          │
│                                         │
│  Output: managementCompany,             │
│  managementContact, evidence[]          │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 3: ROLE INFERENCE                 │
│  role-inference.ts                     │
│                                         │
│  Uses TITLE_ROLE_MAP to normalize       │
│  diverse titles to 8 standard roles:    │
│                                         │
│  Role              Authority Rank       │
│  ──────────────────────────────         │
│  Asset Manager          1               │
│  Owner Representative   2               │
│  Property Manager       3               │
│  Facilities Director    4               │
│  Regional Manager       5               │
│  Leasing Agent          6               │
│  Building Engineer      7               │
│  Administrative         8               │
│                                         │
│  Output: RoleCandidate[] with           │
│  confidence scores per person           │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 4: DECISION-MAKER ASSIGNMENT      │
│  selectDecisionMakers() in             │
│  ownership-classifier.ts               │
│                                         │
│  Scoring formula per person:            │
│  combinedScore =                        │
│    (TitleRelevance × 0.5) +             │
│    (Confidence × 0.35) +                │
│    (HasContactInfo ? 15 : 0)            │
│                                         │
│  Assignment tiers:                      │
│  • Primary: Highest combined score      │
│  • Secondary: For escalation            │
│  • Operational: Day-to-day contacts     │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 5: DM CONFIDENCE SCORING          │
│  dm-confidence.ts                      │
│                                         │
│  7-factor weighted formula (0-100):     │
│                                         │
│  Factor            Weight               │
│  ───────────────────────                │
│  Match Quality       45%                │
│  Role Fit            20%                │
│  Source Diversity     10%                │
│  Reachability        10%                │
│  Corroboration        5%                │
│  Recency              5%                │
│  Penalties           -10%               │
│                                         │
│  Tier assignment:                       │
│  • auto_publish: score ≥ 85            │
│  • review:       score 60-84           │
│  • suppress:     score < 60            │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 6: CONTACT RANKING                │
│  contact-ranking.ts                    │
│                                         │
│  Groups all contactEvidence records     │
│  for the lead's decision-maker.         │
│                                         │
│  Ranking priorities:                    │
│  • Mobile > Landline > VoIP             │
│  • Confidence decay: 5% per month       │
│                                         │
│  Output: bestPhone, bestEmail,          │
│  overallConfidence (high/medium/low)    │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Step 7: COMPLIANCE GATE                │
│  compliance-gate.ts                    │
│                                         │
│  Checks against:                        │
│  • Suppression list (opt-outs)          │
│  • DNC (Do Not Call) registry           │
│  • TCPA consent status                  │
│                                         │
│  Output: ComplianceCheckResult          │
│  { allowPhone, allowEmail, allowMail,   │
│    blockReasons[] }                     │
└─────────────────────────────────────────┘
```

### 8.2 Ownership Structure Buckets

| Structure | Signals | Title Priority |
|-----------|---------|---------------|
| `small_private` | Individual/family name, no LLC chain, low property value | Managing Member (100), Owner (95), Officer (90) |
| `investment_firm` | LLC with officers, LLC chain depth 1-2, multiple properties | Asset Manager (100), Partner (95), VP (90) |
| `institutional_reit` | Corporation, deep LLC chain, high value, SEC filings | Facilities Director (100), Regional Manager (95), VP Operations (90) |
| `third_party_managed` | C/O mailing address, management company detected | Property Manager (100), Building Engineer (95), Facilities (90) |

---

## 9. Evidence & Trust System

The evidence system (`server/evidence-recorder.ts`) provides auditable provenance tracking for all discovered contact data.

### 9.1 Evidence Recording Flow

```
Agent discovers data (e.g., phone number from TX Comptroller)
  │
  ├─ Call recordEvidence({
  │     leadId, contactType: "phone",
  │     contactValue: "2145551234",
  │     sourceName: "TX Comptroller",
  │     sourceType: "API"
  │   })
  │
  ├─ Check: Does this exact (leadId + type + value + source) exist?
  │   ├─ YES: Increment corroborationCount, refresh recencyFactor, recalc score
  │   └─ NO: Count existing records with same value from other sources
  │          Calculate initial score, insert new record
  │
  └─ Call detectAndStoreConflicts(leadId, "phone")
      └─ If multiple distinct values exist → create/update conflict_set
```

### 9.2 Source Trust Configuration

Trust scores for 30+ data sources (defined in `server/config/sourceTrust.ts`):

| Source | Base Score | Type |
|--------|-----------|------|
| DCAD ArcGIS | 95 | Government |
| TX Comptroller | 92 | Government |
| Dallas Building Permits | 90 | Government |
| Fort Worth Permits | 90 | Government |
| TX Secretary of State | 90 | Government |
| County Clerk Records | 88 | Government |
| FEMA Flood Zones | 85 | Government |
| SEC EDGAR | 85 | Government |
| Google Places | 75 | Commercial API |
| OpenCorporates | 70 | Aggregator |
| Hunter.io | 68 | Commercial API |
| People Data Labs | 65 | Commercial API |
| BBB Direct | 60 | Directory |
| WHOIS/RDAP | 55 | Public Record |
| Serper Web Search | 45 | Search |
| Email Pattern Guess | 30 | Inference |

### 9.3 Computed Score Formula

```
Score = (SourceTrust × Recency × ExtractionQuality) + CorroborationBonus + DomainBonus
```

**Recency Factor Decay:**
| Age | Factor |
|-----|--------|
| < 30 days | 1.0 |
| 30-90 days | 0.95 |
| 90-180 days | 0.85 |
| 180-365 days | 0.7 |
| 1+ year | 0.5 |

**Corroboration Bonus:** +5 per additional independent source confirming the same value (max +15)

### 9.4 Conflict Detection & Resolution

When multiple distinct values exist for the same lead + contact type:

```
1. Group all active evidence by normalizedValue
2. If > 1 unique value → conflict detected
3. Calculate score margin between top two candidates
4. If margin ≥ 15 (CONFLICT_AUTO_RESOLVE_MARGIN):
   → AUTO_RESOLVED: highest-scoring value wins
5. If margin < 15:
   → UNRESOLVED: queued for manual review
6. Store in conflict_sets table with auditTrail
```

---

## 10. Enrichment Orchestrator

The enrichment orchestrator (`server/lead-enrichment-orchestrator.ts`) manages both single-lead and batch enrichment workflows.

### 10.1 Single-Lead Enrichment: `enrichLead()`

Called when a user views a lead detail page for the first time, or manually re-enriches.

```
enrichLead(leadId, { skipPaidApis: true })
  │
  ├─ Mark lead enrichmentStatus = "running"
  ├─ Return initial progress object immediately
  │
  └─ Background async execution:
     │
     Step 1: Owner Intelligence
     │  └─ runOwnerIntelligenceStep(lead, skipPaidApis)
     │     └─ Calls runOwnerIntelligence() from owner-intelligence.ts
     │     └─ Updates: ownerIntelligence, llcChain, officerName, etc.
     │
     Step 2: Reverse Address Enrichment
     │  └─ SKIPPED if skipPaidApis=true (uses Google Places API)
     │  └─ Compares owner mailing address vs property address
     │  └─ Identifies management companies at mailing address
     │
     Step 3: Building Discovery
     │  └─ SKIPPED if skipPaidApis=true (uses Google Places API)
     │  └─ Google Places search near property coordinates
     │  └─ Discovers building tenants and managers
     │
     Step 4: Management Attribution
     │  └─ attributeLeadManagement(lead) from management-attribution.ts
     │  └─ Updates: managementCompany, managementContact
     │
     Step 5: Role Inference
     │  └─ inferLeadRoles(lead) from role-inference.ts
     │  └─ Updates: contactRole, roleConfidence, decisionMakerRank
     │
     Step 6: Confidence Scoring
     │  └─ computeDecisionMakerConfidence(lead) from dm-confidence.ts
     │  └─ Updates: dmConfidenceScore, dmReviewStatus
     │
     Step 7: Phone Enrichment
     │  └─ enrichPhone(lead, { freeOnly: skipPaidApis })
     │  └─ Searches free sources (TREC, TDLR, tax permits)
     │  └─ Skips paid sources (Twilio) if freeOnly=true
     │
     └─ Mark lead enrichmentStatus = "complete"
        Set lastEnrichedAt = now()
```

### 10.2 Batch Free Enrichment: `runBatchFreeEnrichment()`

Processes all unenriched leads using only free data sources.

```
runBatchFreeEnrichment(filterLeadIds?)
  │
  ├─ Query leads WHERE ownerName IS NOT NULL AND lastEnrichedAt IS NULL
  ├─ If filterLeadIds provided → filter to only those IDs
  │
  └─ Sequential loop with 500ms throttle:
     for each lead:
       ├─ Run Steps 1, 4, 5, 6, 7 (skip Steps 2, 3 — paid)
       ├─ Force skipPaidApis = true
       ├─ Update batchFreeStatus for UI progress bar
       └─ await sleep(500ms)  // Rate limiting
```

### 10.3 Paid API Manual Triggers: `enrichLeadPaidApis()`

Separate function for manual-only paid enrichment:
```
enrichLeadPaidApis(leadId, apis: string[])
  │
  ├─ "google-places" → Run reverse address + building discovery
  ├─ "hunter" → Hunter.io email discovery (25 searches/month)
  ├─ "pdl" → People Data Labs person/company lookup (100 matches/month)
  └─ "serper" → Serper web search for owner intelligence
```

Each paid API has usage tracking with monthly reset counters displayed in the Admin dashboard.

---

## 11. Hail & Storm Intelligence

The storm system is a multi-layered real-time monitoring and historical correlation engine.

### 11.1 Data Sources

| Source | Module | Frequency | Data Type |
|--------|--------|-----------|-----------|
| NOAA SWDI | `hail-tracker.ts` | Historical import | Radar hail signatures (NX3HAIL) |
| NWS API | `hail-tracker.ts` | Every 10 min | Active severe weather alerts |
| Xweather | `xweather-hail.ts` | Every 2 min | Predictive hail threat forecasts |
| NOAA CSV | `noaa-importer.ts` | Manual import | Historical hail event records |

### 11.2 NOAA SWDI Fetching

```typescript
// Fetch radar hail signatures for DFW bounding box
const url = `https://www.ncdc.noaa.gov/swdiws/json/nx3hail
  ?startdate=${startStr}
  &enddate=${endStr}
  &bbox=${bbox}
  &limit=5000`;
```

Returns radar-detected hail with `prob` (probability of hail) and `sevprob` (probability of severe hail ≥ 1").

### 11.3 NWS Active Alerts

```typescript
// Fetch active severe weather alerts for Texas
const url = "https://api.weather.gov/alerts/active?area=TX";
// Filter for hail-related keywords in DFW counties
```

### 11.4 Storm Monitor Cycle (10 minutes)

The storm monitor (`storm-monitor.ts`) runs every 10 minutes:

```
1. Fetch SWDI radar signatures for last 24 hours
2. Fetch active NWS alerts
3. Cluster nearby signatures into "Hail Swath Polygons"
   └─ Uses convex hull algorithm on nearby points
4. For each swath polygon:
   a. Find leads within the swath or 5-mile radius
   b. Calculate ResponsePriority for each affected lead
   c. Add to response_queue
   d. Create storm_run record
5. Send post-storm alerts to configured recipients
```

### 11.5 Xweather Predictive Cycle (2 minutes)

The Xweather monitor (`xweather-hail.ts`) provides advance warning:

```
1. Fetch active threats from Xweather API
   └─ Includes hail size, probability, storm motion (speed + direction)
2. For each threat:
   a. Calculate ETA to each property:
      ETA = distance_to_property / storm_speed
   b. Identify leads in the predicted storm path
   c. Add predictive hail events to database
3. Send pre-storm alerts if ETA < threshold
   └─ Allows contractors to "pre-warm" high-value leads
```

### 11.6 Hail Correlator

The hail correlator (`hail-correlator.ts`) matches historical events to leads:

```
correlateHailToLeads(marketId, radiusMiles = 5):
  1. Get all hail events for the market
  2. For each lead with lat/lng:
     a. Calculate Haversine distance to each event
     b. If distance ≤ radiusMiles:
        └─ Increment hailEvents count
        └─ Update lastHailDate if more recent
        └─ Update lastHailSize if larger
  3. Recalculate leadScore with new hail data
```

### 11.7 Response Queue Prioritization

Affected leads are ranked using:
```
ResponsePriority = BaseLeadScore
  + ProximityBonus (closer = higher)
  + SeverityBonus (bigger hail = higher)
  + ContactBonus (has verified phone = +10)
```

---

## 12. Pipeline Orchestrator

The pipeline orchestrator (`server/pipeline-orchestrator.ts`) manages the full 9-phase automated data processing workflow.

### 12.1 The 9 Phases

```
Phase 1: IMPORT PROPERTIES
  └─ Import from DCAD, TAD, Collin CAD, Denton CAD
  └─ Calls: /api/import/dcad, /api/import/tad, etc.

Phase 2: BUILDING & ROOF INTELLIGENCE
  └─ Estimate stories from property characteristics
  └─ Estimate roof type and construction type
  └─ Flag holding companies (shell detection)
  └─ Fix missing geolocation data
  └─ Calls: /api/leads/estimate-stories, /api/leads/estimate-roof-type,
            /api/leads/flag-ownership, /api/data/fix-locations

Phase 3: STORM & HAIL DATA
  └─ Import current year NOAA hail data
  └─ Correlate hail events to leads within 5-mile radius
  └─ Calls: /api/import/noaa, /api/correlate/hail

Phase 4: INTELLIGENCE DATA
  └─ Import Dallas 311 service requests
  └─ Import code violations
  └─ Import building permits (Dallas + Fort Worth)
  └─ Sync permit contractors to leads
  └─ Enrich flood zones via FEMA API
  └─ Calls: /api/violations/import-311, /api/violations/import-code,
            /api/permits/import-dallas, /api/permits/import-fw,
            /api/permits/sync-contractors, /api/flood/enrich

Phase 5: ROOFING PERMITS
  └─ Scan for roofing-specific permits (last 10 years)
  └─ Identify aging roofs and recent repairs
  └─ Calls: /api/leads/scan-roofing-permits

Phase 6: CONTACT ENRICHMENT
  └─ Batch free enrichment for all qualified leads
  └─ Runs all free agents (TX SOS, LLC Chain, Comptroller, etc.)
  └─ Direct call: runBatchFreeEnrichment(qualifiedLeadIds)

Phase 7: POST-ENRICHMENT ANALYSIS
  └─ Classify ownership structures (4 buckets)
  └─ Assign decision-makers (Primary/Secondary/Operational)
  └─ Attribute management companies
  └─ Reverse address enrichment (if API key configured)
  └─ Infer roles and rank authority
  └─ Direct calls: classifyAndAssignDecisionMakers(),
                    runManagementAttribution(), runReverseAddressEnrichment(),
                    runRoleInference()

Phase 8: NETWORK & DEDUPLICATION
  └─ Build relationship graph
  └─ Scan for duplicate lead records
  └─ Direct calls: buildRelationshipGraph(), scanForDuplicates()

Phase 9: FINAL SCORING
  └─ Recalculate lead scores with all gathered intelligence
  └─ Run confidence scoring for all decision-makers
  └─ Calls: /api/leads/recalculate-scores
  └─ Direct call: runConfidenceScoring()
  └─ Batch stamp: pipelineLastProcessedAt + pipelineRunId
```

### 12.2 Internal HTTP Call Pattern

The orchestrator uses `callInternalApi()` to trigger Express routes within the same process:

```typescript
async function callInternalApi(path: string, body?: any): Promise<any> {
  const port = process.env.PORT || 5000;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `API call failed: ${res.status}`);
  }
  return res.json();
}
```

For post-enrichment phases that use exported functions directly, the orchestrator imports and calls them:
```typescript
const { classifyAndAssignDecisionMakers } = await import("./ownership-classifier");
await classifyAndAssignDecisionMakers(qualifiedLeadIds);
```

### 12.3 Lead Filtering System

The pipeline supports configurable filters via `PipelineFilters`:

```typescript
interface PipelineFilters {
  minSqft?: number;         // Default: 10,000
  maxStories?: number;      // Default: 1
  roofTypes?: string[];     // Default: all types
  excludeShellCompanies?: boolean;  // Default: true
  minPropertyValue?: number; // Default: 0
  onlyUnprocessed?: boolean; // Default: true
  forceReprocess?: boolean;  // Default: false
}
```

`queryFilteredLeadIds(filters)` builds a raw SQL WHERE clause:
```sql
SELECT id FROM leads
WHERE sqft >= 10000
  AND (stories IS NULL OR stories <= 1)
  AND (roof_type IN ('Metal','TPO','EPDM',...) OR roof_type IS NULL)
  AND ownership_structure NOT IN ('shell_company')
  AND total_value >= 0
  AND pipeline_last_processed_at IS NULL  -- onlyUnprocessed
```

### 12.4 LeadIds Threading

Every phase receives the `qualifiedLeadIds` array:
- **HTTP routes**: Passed as `{ leadIds: qualifiedLeadIds }` in POST body
- **Direct function calls**: Passed as `filterLeadIds` parameter
- When `leadIds` is provided, the route/function filters to only those leads
- When absent (manual button clicks), all leads are processed

### 12.5 Pipeline Run Tracking

After all phases complete:
```typescript
// Generate unique run ID
const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Batch stamp processed leads (500 at a time)
for (let i = 0; i < qualifiedLeadIds.length; i += 500) {
  const batch = qualifiedLeadIds.slice(i, i + 500);
  const idList = batch.map(id => `'${id}'`).join(",");
  await db.execute(sql.raw(
    `UPDATE leads SET pipeline_last_processed_at = NOW(),
     pipeline_run_id = '${runId}' WHERE id IN (${idList})`
  ));
}
```

The `onlyUnprocessed` filter uses `pipeline_last_processed_at IS NULL` to skip already-processed leads on subsequent runs.

---

## 13. Lead Scoring Algorithm (v3)

Defined in `server/seed.ts`, the scoring algorithm produces a 0-100 priority score.

### 13.1 Scoring Factors

| Factor | Max Points | Logic |
|--------|-----------|-------|
| **Roof Age** | 20 | If `roofLastReplaced` known: `(currentYear - replacementYear) × 2` (cap 20). Unknown: 10 pts. |
| **Hail Exposure** | 15 | `hailEvents × 5` (cap 15) |
| **Storm Recency** | 15 | ≤30 days: 15 · ≤90 days: 12 · ≤180 days: 10 · ≤365 days: 7 · ≤730 days: 4 · Older: 1 |
| **Roof Area / Job Size** | 15 | ≥20,000 sqft: 15 · ≥10,000 sqft: 12 · ≥5,000 sqft: 8 · ≥2,500 sqft: 5 |
| **Contactability** | 10 | +4 for phone · +3 for email · +3 for contact name |
| **Owner Type** | 8 | LLC: 8 · Corporation: 6 · Other/Individual: 2 |
| **Property Value** | 7 | ≥$1M: 7 · ≥$500K: 4 · Other: 1 |
| **Distress Signals** | 5 | From distress sub-score (see below), capped at 5 |
| **Flood Risk** | 3 | High-risk zone: 3 · Other flood zone: 1 |
| **Property Condition** | 2 | ≥3 open violations: 2 · ≥1 open violation: 1 |
| **TOTAL** | **100** | Sum capped at 100 |

### 13.2 Distress Sub-Score

The `calculateDistressScore()` function produces a 0-15 internal score:

| Signal | Points |
|--------|--------|
| Foreclosure flag | +5 |
| Tax delinquent | +4 |
| 3+ liens | +3 |
| 1+ liens | +1 |
| 5+ violations | +3 |
| 2+ violations | +2 |
| 1+ violations | +1 |

Only 5 points from the distress score contribute to the overall lead score.

### 13.3 Score Breakdown

`getScoreBreakdown(lead)` returns a detailed object explaining point allocation per category — displayed on the lead detail page.

---

## 14. Frontend Architecture

### 14.1 Routing (Wouter)

All routes are defined in `client/src/App.tsx` using Wouter's `<Switch>` and `<Route>` components:

```
/                    → Dashboard
/leads               → Leads list
/leads/:id           → Lead detail
/map                 → Map view
/storms              → Map with storm overlays
/portfolios          → Portfolio browser
/network             → Network explorer graph
/owner-intelligence  → Owner research tool
/data-intelligence   → Data quality metrics
/data-management     → CSV import management
/storm-response      → Post-storm call lists
/alert-config        → Storm alert settings
/hail-events         → Hail event browser
/export              → CSV export
/admin               → Admin dashboard
/about               → About page
/contact             → Contact page
/privacy             → Privacy policy
```

### 14.2 Sidebar Navigation

The sidebar (`client/src/components/app-sidebar.tsx`) provides:

**Market Selector**: Dropdown at top to switch between geographic markets.

**Navigation Groups**:
- Main: Dashboard, Leads, Portfolios, Network, Hot Leads (filtered), Map & Storms
- System: Admin

**System Status Footer**: Live status indicators polling every 30 seconds:
- NOAA (Storm Watch active/inactive)
- Storm Monitor (running/stopped)
- XWeather Predictions (active/inactive)

### 14.3 TanStack React Query Patterns

#### Default Query Function
```typescript
// queryClient.ts configures a default queryFn that maps queryKey to URL:
// queryKey: ["/api/leads", id] → fetch("/api/leads/[id]")
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      staleTime: Infinity,           // Manual invalidation only
      refetchOnWindowFocus: false,   // No background refetches
    },
  },
});
```

#### API Request Wrapper
```typescript
// For mutations (POST/PATCH/DELETE):
async function apiRequest(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res;
}
```

#### Cache Invalidation
After mutations, queries are manually invalidated:
```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
  queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "intelligence"] });
}
```

### 14.4 Lead Detail Page

The most complex page in the app. Uses multiple parallel queries:
- Core lead data (`/api/leads/:id`)
- Intelligence dossier (`/api/leads/:id/intelligence`)
- Rooftop owner data (`/api/leads/:id/rooftop-owner`)
- Contact path analysis (best phones/emails)
- Permit history
- Conflict resolution sets

Features real-time enrichment polling (2-second interval) when an auto-enrich job is running.

### 14.5 Component Library

- **Shadcn/UI**: Button, Card, Dialog, Select, Input, Badge, Avatar, Tabs, etc.
- **Recharts**: Score distribution charts, data coverage bars, trend lines
- **React-Leaflet**: Interactive map with multiple tile layers, marker clusters, polygon overlays
- **Lucide React**: Icon library for actions and visual cues

---

## 15. API Route Map

All routes are registered in `server/routes.ts` (~2800 lines).

### Property Import
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/import/dcad` | Import Dallas County properties |
| POST | `/api/import/tad` | Import Tarrant County properties |
| POST | `/api/import/collin` | Import Collin County properties |
| POST | `/api/import/denton` | Import Denton County properties |
| POST | `/api/import/noaa` | Import NOAA hail data |
| POST | `/api/import/csv` | Import generic property CSV |

### Leads CRUD
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leads` | List leads with filtering/pagination |
| GET | `/api/leads/:id` | Get single lead |
| PATCH | `/api/leads/:id` | Update lead fields |
| GET | `/api/leads/export` | Export leads to CSV |
| GET | `/api/leads/count` | Get lead count |
| GET | `/api/leads/in-bounds` | Geospatial bounding box query |

### Lead Intelligence
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/leads/estimate-stories` | Estimate building stories |
| POST | `/api/leads/estimate-roof-type` | Estimate roof construction type |
| POST | `/api/leads/flag-ownership` | Flag holding/shell companies |
| POST | `/api/leads/recalculate-scores` | Recalculate all lead scores |
| POST | `/api/leads/scan-roofing-permits` | Scan for roofing permits |
| GET | `/api/leads/:id/intelligence` | Get owner dossier |
| GET | `/api/leads/:id/rooftop-owner` | Get resolved rooftop owners |
| GET | `/api/leads/:id/enrichment-status` | Poll enrichment progress |

### Enrichment
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/leads/:id/enrich` | Trigger single-lead enrichment |
| POST | `/api/leads/:id/enrich-paid` | Trigger paid API enrichment |
| POST | `/api/enrichment/batch-free` | Batch free enrichment |
| GET | `/api/enrichment/batch-free/status` | Batch progress status |
| POST | `/api/enrichment/hunter` | Manual Hunter.io lookup |
| POST | `/api/enrichment/pdl` | Manual PDL lookup |

### Storm & Hail
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/correlate/hail` | Correlate hail events to leads |
| GET | `/api/storm/status` | Storm monitor status |
| GET | `/api/storm/alert-configs` | List alert configurations |
| POST | `/api/storm/alert-configs` | Create alert config |
| GET | `/api/storm/response-queue` | Get prioritized call list |
| GET | `/api/hail/recent` | Recent hail events |

### Pipeline
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/pipeline/run-all` | Start full pipeline |
| GET | `/api/pipeline/run-all/status` | Pipeline progress status |
| POST | `/api/pipeline/cancel` | Cancel running pipeline |
| GET | `/api/pipeline/preview` | Preview matching lead count |

### Intelligence & Analysis
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/data/fix-locations` | Fix missing geolocation |
| GET | `/api/portfolios` | List property portfolios |
| GET | `/api/portfolios/:id` | Get portfolio details |
| POST | `/api/network/build` | Build relationship graph |
| GET | `/api/network/graph` | Get graph data |
| POST | `/api/flood/enrich` | Enrich flood zone data |

### Permits & Violations
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/permits/import-dallas` | Import Dallas permits |
| POST | `/api/permits/import-fw` | Import Fort Worth permits |
| POST | `/api/permits/sync-contractors` | Sync contractors to leads |
| POST | `/api/violations/import-311` | Import 311 complaints |
| POST | `/api/violations/import-code` | Import code violations |

### Admin & System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data-sources` | List configured data sources |
| GET | `/api/import-runs` | List import history |
| GET | `/api/data/coverage` | Data completeness metrics |
| GET | `/api/enrichment/credits` | Paid API credit usage |

---

## 16. Background Jobs & Scheduling

### 16.1 Job Scheduler

`server/job-scheduler.ts` manages recurring background tasks:
- Runs every 4 hours
- Tasks include NOAA data sync and score recalculation
- Jobs tracked in the `jobs` table with `lastRunAt` and `nextRunAt`

### 16.2 Storm Monitor

`server/storm-monitor.ts` starts automatically on server boot:
- Checks NOAA SWDI + NWS alerts every 10 minutes
- Clusters hail signatures into swath polygons
- Updates response queue with affected leads

### 16.3 Xweather Monitor

`server/xweather-hail.ts` runs independently:
- Checks Xweather threat API every 2 minutes
- Only starts if `XWEATHER_CLIENT_ID` and `XWEATHER_CLIENT_SECRET` are configured
- Calculates ETAs for storm-to-property impact

---

## 17. Compliance & Security

### 17.1 Source Policy

`server/source-policy.ts` enforces responsible data collection:
- **Robots.txt Checking**: Verifies crawl permissions before scraping
- **Per-Domain Rate Limiting**: In-memory rate limiter per domain
- **Blocked Domain List**: Social media, people search sites blocked
- **User-Agent Header**: Proper identification in all requests

### 17.2 Contact Compliance

- **Suppression List**: Opt-out tracking in `suppression_list` table
- **DNC Registry**: Do Not Call list checking
- **TCPA Consent**: Consent tracking in `compliance_consent` table
- **Compliance Gate**: Final check before any outreach channel

### 17.3 Security Headers

Set in `server/index.ts`:
```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Production adds:
- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)

### 17.4 SEO

- **react-helmet-async**: Per-page titles and meta descriptions
- **Dynamic sitemap.xml**: Auto-generated from route list
- **robots.txt**: Domain-aware configuration
- **Compression**: gzip middleware for all responses
- **Static HTML**: Nav/footer/skip-link/landmarks for crawler visibility
- **noscript fallback**: Content visible without JavaScript

---

## 18. External API Reference

### Free APIs (Auto-Run)

| API | Endpoint | Auth | Rate Limit |
|-----|----------|------|------------|
| DCAD ArcGIS | `maps.dcad.org/prdwa/rest/services/...` | None | Pagination-based |
| TAD ArcGIS | `mapit.tarrantcounty.com/arcgis/rest/services/...` | None | Pagination-based |
| Collin CAD ArcGIS | `gismaps.cityofallen.org/arcgis/rest/services/...` | None | Pagination-based |
| Denton CAD FeatureServer | `geo.dentoncad.com/arcgis/rest/services/...` | None | Pagination-based |
| NOAA SWDI | `ncdc.noaa.gov/swdiws/json/nx3hail` | None | 5000/query |
| NWS Alerts | `api.weather.gov/alerts/active` | None | Standard |
| TX Comptroller PIR | Comptroller website + API | `TX_COMPTROLLER_API_KEY` | Per-request |
| TX Open Data (Socrata) | `data.texas.gov/resource/9cir-efmm.json` | None | 1000/query |
| Dallas Permits (Socrata) | `dallasopendata.com/resource/e7gq-4sah.json` | None | 1000/query |
| Fort Worth Permits | `services5.arcgis.com/.../CFW_Open_Data_...` | None | Pagination-based |
| SEC EDGAR | `data.sec.gov/submissions/` | None | 10 req/sec |
| FEMA Flood Zones | FEMA API | None | Standard |
| OSM Overpass | `overpass-api.de/api/interpreter` | None | Fair use |
| Esri World Imagery | Tile server | None | Free tier |
| WHOIS/RDAP | Various registrars | None | Per-domain |

### Paid APIs (Manual-Only)

| API | Endpoint | Auth | Monthly Limit | Use |
|-----|----------|------|--------------|-----|
| Hunter.io | `api.hunter.io/v2/` | `HUNTER_API_KEY` | 25 searches | Email discovery by domain |
| People Data Labs | `api.peopledatalabs.com/v5/` | `PDL_API_KEY` | 100 matches | Person/company enrichment |
| Google Places | `maps.googleapis.com/maps/api/place/` | `GOOGLE_PLACES_API_KEY` | Pay-per-use | Phone enrichment, reverse address |
| Serper | `google.serper.dev/search` | `SERPER_API_KEY` | Pay-per-use | Web search for owner intelligence |
| Xweather | `data.api.xweather.com/` | `XWEATHER_CLIENT_ID` + `SECRET` | Subscription | Predictive hail nowcasting |

---

*Last updated: February 2026*
