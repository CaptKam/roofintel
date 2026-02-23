# RoofIntel Agent Architecture

> 13,221 lines of intelligence code across 34 modules powering automated lead discovery, contact enrichment, storm monitoring, and decision-maker identification for commercial roofing contractors.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Property Data Agents](#property-data-agents)
3. [Storm & Weather Agents](#storm--weather-agents)
4. [Owner Intelligence System (16 Agents)](#owner-intelligence-system-16-agents)
5. [Contact Enrichment Pipeline](#contact-enrichment-pipeline)
6. [Decision-Maker Discovery (Layer 3)](#decision-maker-discovery-layer-3)
7. [Evidence & Provenance System](#evidence--provenance-system)
8. [Entity Resolution & Portfolio Discovery](#entity-resolution--portfolio-discovery)
9. [Compliance & Validation Infrastructure](#compliance--validation-infrastructure)
10. [Orchestration & Scheduling](#orchestration--scheduling)
11. [Agent Dependency Map](#agent-dependency-map)

---

## System Overview

RoofIntel uses a multi-agent architecture where each agent is a specialized module responsible for a single domain of intelligence gathering. Agents are composed together through orchestrators that manage execution order, data flow, and error handling.

**Total Agent Modules:** 34
**Total Lines of Code:** 13,221
**Data Sources Integrated:** 30+
**External APIs:** DCAD ArcGIS, NOAA SWDI, NWS, Xweather/Vaisala, Google Places, OpenCorporates, TX SOS, TX Comptroller PIR, Serper, Socrata, FEMA NFHL, TREC, TDLR, HUD, BBB, WHOIS/RDAP

---

## Property Data Agents

### 1. DCAD Agent
**File:** `server/dcad-agent.ts` (422 lines)
**Purpose:** Automated commercial property fetching from Dallas Central Appraisal District

| Attribute | Detail |
|-----------|--------|
| **Data Source** | DCAD ArcGIS REST API (`maps.dcad.org`) |
| **Trigger** | Manual via Admin UI or scheduled batch |
| **Output** | Lead records with property details |

**What it does:**
- Queries the DCAD ArcGIS MapServer for commercial properties using use codes and class descriptions
- Filters for commercial use codes (class 2) and commercial/industrial/multi-family classes
- Extracts parcel ID, site address, owner name, building area, assessed value, year built, floor count, improvement/land values, ZIP, mailing address, structure class, and DBA
- Computes geographic centroid from polygon geometry rings
- Batch-inserts leads in groups of 100, deduplicating by parcel ID
- Calculates initial lead score for each imported property

**Key Functions:**
- `fetchDcadProperties(marketId)` - Main fetch and import pipeline
- `getCentroid(geometry)` - Converts polygon rings to lat/lng center point

---

### 2. Dallas Records Agent
**File:** `server/dallas-records-agent.ts` (455 lines)
**Purpose:** Fetches code violations and recorded documents from Dallas Open Data

| Attribute | Detail |
|-----------|--------|
| **Data Sources** | Dallas 311 API, Dallas Code Violations API |
| **Trigger** | Manual or orchestrated enrichment |
| **Output** | Code violations and recorded documents linked to leads |

**What it does:**
- Pulls code compliance records from Dallas Open Data Portal (Socrata API)
- Matches violations to leads by normalized address comparison
- Filters for relevant compliance keywords: Code Compliance, High Weeds, Junk Vehicle, Litter/Dumping, Structural
- Stores violations and recorded documents as structured records linked to lead IDs
- Rate-limited at 300ms between requests with 5,000 records per page

---

### 3. Permits Agent
**File:** `server/permits-agent.ts` (697 lines)
**Purpose:** Fetches building permits from Dallas and Fort Worth open data portals

| Attribute | Detail |
|-----------|--------|
| **Data Sources** | Dallas Open Data (Socrata), Fort Worth Open Data (Socrata) |
| **Trigger** | Manual or batch enrichment |
| **Output** | Building permit records linked to leads |

**What it does:**
- Queries Dallas and Fort Worth permit databases for commercial building permits
- Filters by 40+ commercial land use keywords (Commercial, Industrial, Retail, Office, Warehouse, Multi-family, etc.)
- Matches permits to existing leads by address normalization
- Extracts permit type, applicant, contractor, issue date, and status
- Used by management attribution to detect third-party managers (when permit applicant differs from property owner)

---

### 4. Flood Zone Agent
**File:** `server/flood-zone-agent.ts` (203 lines)
**Purpose:** FEMA flood zone risk assessment for properties

| Attribute | Detail |
|-----------|--------|
| **Data Source** | FEMA National Flood Hazard Layer (NFHL) ArcGIS API |
| **Trigger** | Batch enrichment or on-demand lookup |
| **Output** | Flood zone designation, subtype, and high-risk flag |

**What it does:**
- Queries FEMA NFHL MapServer with property coordinates
- Returns flood zone code (A, AE, X, etc.), zone subtype, and SFHA (Special Flood Hazard Area) determination
- Enriches leads with flood risk data that feeds into lead scoring
- Rate-limited at 500ms between requests with 15-second timeout
- Processes leads in batch with progress logging

---

## Storm & Weather Agents

### 5. Hail Tracker
**File:** `server/hail-tracker.ts` (172 lines)
**Purpose:** Real-time NOAA radar hail signature monitoring and NWS alert fetching

| Attribute | Detail |
|-----------|--------|
| **Data Sources** | NOAA SWDI (Severe Weather Data Inventory), NWS Alerts API |
| **Trigger** | Polling interval (configurable) |
| **Output** | Live radar signatures and active weather alerts |

**What it does:**
- Fetches NEXRAD Level-III hail signatures from NOAA SWDI for the DFW bounding box (32.4N-33.2N, 97.6W-96.2W)
- Pulls active NWS alerts (Severe Thunderstorm Warnings, Tornado Warnings) with polygon boundaries
- Returns structured data for map overlay visualization
- Supports configurable lookback period (default 7 days)

---

### 6. Hail Correlator
**File:** `server/hail-correlator.ts` (114 lines)
**Purpose:** Proximity-based matching of hail events to property leads

| Attribute | Detail |
|-----------|--------|
| **Algorithm** | Haversine distance calculation |
| **Default Radius** | 5 miles |
| **Trigger** | After NOAA data import or on-demand |
| **Output** | Updated lead records with hail hit count and nearest event data |

**What it does:**
- Implements haversine great-circle distance formula for accurate geographic proximity matching
- Pre-filters candidates using bounding box (lat/lng degree approximation) before expensive distance calculations
- For each lead, finds all hail events within the configured radius
- Updates lead records with: hail hit count, nearest event distance, most recent hail date, max hail size
- Triggers lead score recalculation after correlation updates

---

### 7. Storm Monitor
**File:** `server/storm-monitor.ts` (400 lines)
**Purpose:** Real-time storm tracking with lead impact analysis and response queue management

| Attribute | Detail |
|-----------|--------|
| **Data Sources** | NOAA SWDI radar, NWS alerts |
| **Trigger** | Continuous monitoring interval |
| **Output** | Storm runs, affected lead lists, response queue entries |

**What it does:**
- Runs on a configurable polling interval, checking for new hail signatures
- Clusters radar signatures within 5-mile radius using density-based clustering
- Builds hail swath polygons from clustered signatures with centroid, max probability, and signature count
- Cross-references swaths against all leads to identify affected properties
- Creates storm run records with metadata (signature count, swath area, affected lead count)
- Populates response queue with prioritized affected leads for contractor outreach
- Uses signature hash deduplication to avoid redundant processing
- Calculates impact severity and distance metrics for each affected lead

---

### 8. Xweather Hail (Predictive)
**File:** `server/xweather-hail.ts` (547 lines)
**Purpose:** Predictive hail threat nowcasting from Xweather/Vaisala with pre-storm alerting

| Attribute | Detail |
|-----------|--------|
| **Data Source** | Xweather (Vaisala) Threats API |
| **Trigger** | Monitoring interval or on-demand fetch |
| **Output** | Hail threat forecasts with affected lead lists and ETAs |

**What it does:**
- Queries Xweather Threats API for active and predicted hail threats in the DFW region
- Extracts threat details: max hail size (inches/mm), severe probability, storm motion (direction/speed)
- Builds forecast path polygons showing predicted storm trajectory
- Cross-references threat polygons and paths against all leads to identify at-risk properties
- Calculates ETA (estimated time of arrival) for each affected lead based on storm motion vector
- Generates structured threat objects with affected lead lists including distance and ETA
- Supports pre-storm SMS alert generation (via response queue) for leads in the threat path
- Tracks alerted threat IDs to prevent duplicate notifications
- Provides map-ready data: threat polygons, forecast paths, and affected lead markers

---

### 9. NOAA Importer
**File:** `server/noaa-importer.ts` (266 lines)
**Purpose:** Historical hail event data import from NOAA CSV archives

| Attribute | Detail |
|-----------|--------|
| **Data Source** | NOAA Storm Events Database (CSV) |
| **Trigger** | Scheduled job or manual import |
| **Output** | Historical hail event records |

**What it does:**
- Downloads and parses NOAA Storm Events CSV data for specified years and counties
- Filters for hail events in target market counties
- Extracts event details: date, coordinates, hail size, county, state
- Deduplicates against existing records by event ID
- Batch-inserts historical hail events for use in lead scoring and correlation

---

## Owner Intelligence System (16 Agents)

### 10. Owner Intelligence (Master Orchestrator)
**File:** `server/owner-intelligence.ts` (1,752 lines)
**Purpose:** Comprehensive 16-agent owner research system that resolves the real people behind commercial properties

| Attribute | Detail |
|-----------|--------|
| **Sub-agents** | 16 specialized research agents |
| **Output** | Complete Owner Dossier with people, contacts, LLC chains, business profiles |
| **Evidence** | Full provenance tracking via Evidence Recorder |

**What it does:**
This is the largest and most complex module in RoofIntel. It orchestrates 16 specialized agents to build a complete intelligence dossier for each property owner.

**The 16 Agents:**

| # | Agent | Source | What It Finds |
|---|-------|--------|---------------|
| 1 | **TX SOS Entity Lookup** | TX Secretary of State | Entity filings, officers, registered agents |
| 2 | **TX Comptroller PIR** | TX Comptroller API | Franchise tax records, officer names, addresses |
| 3 | **TX Comptroller Sales Tax** | TX Open Data Portal | Sales tax permits, business locations, taxpayer IDs |
| 4 | **LLC Chain Resolver** | TX SOS + Comptroller | Traverses parent/child LLC relationships up to 5 levels deep |
| 5 | **Property Tax Mailing** | County tax records | Owner mailing addresses (often reveals management companies) |
| 6 | **Google Places Business** | Google Places API | Business name, phone, website, hours, reviews |
| 7 | **OpenCorporates** | OpenCorporates API | Corporate entity data, officers, filings across jurisdictions |
| 8 | **Serper Web Search** | Serper API | Web search results for owner names, business names |
| 9 | **WHOIS/RDAP Domain** | WHOIS/RDAP APIs | Domain registrant info for business websites |
| 10 | **TREC License** | TX Real Estate Commission | Licensed real estate professionals associated with property |
| 11 | **TDLR License** | TX Dept of Licensing | Licensed contractors, engineers at the property |
| 12 | **HUD Multifamily** | HUD Database | Federal housing program contacts, management agents |
| 13 | **BBB Direct** | Better Business Bureau | Business profiles, complaints, owner names |
| 14 | **Google Places Enhanced** | Google Places API | Enhanced lookup with nearby business detection |
| 15 | **Skip Trace Agent** | Multiple (Socrata permits, web scraping) | Fills gaps with permit applicants, website contacts |
| 16 | **Social Intel Pipeline** | TREC + TDLR + HUD + BBB + Google Enhanced | Aggregates all social/regulatory intelligence sources |

**Data Flow:**
1. Starts with lead's owner name and address
2. Runs TX SOS/Comptroller lookups to identify entity structure
3. Resolves LLC chains up to 5 levels deep to find ultimate beneficial owners
4. Cross-references with public record databases (TREC, TDLR, HUD, BBB)
5. Searches web for additional contact information
6. Performs skip trace to fill remaining gaps
7. Records all evidence with source trust scores and provenance
8. Returns structured Owner Dossier with: real people, building contacts, LLC chain, business profiles, court records, emails, phones, skip trace hits, and per-agent results

**Output Structure:**
```typescript
interface OwnerDossier {
  realPeople: PersonRecord[];        // Named individuals found
  buildingContacts: BuildingContact[]; // On-site/building-level contacts
  llcChain: LlcChainLink[];          // Full LLC ownership chain
  businessProfiles: BusinessProfile[]; // Business listings found
  courtRecords: CourtRecord[];        // Legal/court filings
  emails: EmailRecord[];              // Verified/unverified emails
  phones: PhoneRecord[];              // Phone numbers with source
  skipTraceHits: SkipTraceHit[];      // Skip trace discoveries
  agentResults: AgentResult[];        // Per-agent status/counts
  generatedAt: string;               // Timestamp
}
```

---

### 11. Skip Trace Agent
**File:** `server/skip-trace-agent.ts` (886 lines)
**Purpose:** Gap-filling agent that finds missing contact information through web scraping and permit records

| Attribute | Detail |
|-----------|--------|
| **Data Sources** | DFW building permits (Socrata), business websites, web scraping |
| **Trigger** | Called by Owner Intelligence orchestrator |
| **Output** | People, building contacts, and intelligence claims |

**What it does:**
- Searches DFW building permit databases for permit applicants at the property address
- Scrapes business websites found during other agent runs for contact pages, team pages, about pages
- Extracts emails and phone numbers using regex patterns with extensive false-positive filtering
- Validates person names against junk patterns (navigation text, HTML artifacts, company names)
- Cleans company names by stripping legal suffixes (LLC, Inc, Corp, etc.)
- Implements 10-second fetch timeout with AbortController for resilient web scraping
- Produces structured PersonRecord and BuildingContact objects with source attribution

---

### 12. Social Intel Agents (5 Sub-agents)
**File:** `server/social-intel-agents.ts` (718 lines)
**Purpose:** Regulatory and directory intelligence gathering from government and business databases

**Contains 5 specialized agents:**

#### 12a. TREC License Agent
- **Source:** Texas Real Estate Commission
- **Finds:** Licensed real estate professionals associated with the property or owner
- **Method:** Queries TREC license lookup by owner/business name

#### 12b. TDLR License Agent
- **Source:** Texas Department of Licensing and Regulation
- **Finds:** Licensed contractors, engineers, and other regulated professionals
- **Method:** Queries TDLR records for licenses at the property address

#### 12c. HUD Multifamily Agent
- **Source:** HUD Multifamily Housing Database
- **Finds:** Federal housing program contacts, management agents, owner reps for HUD-assisted properties
- **Method:** Searches HUD database by property name and address

#### 12d. BBB Direct Agent
- **Source:** Better Business Bureau
- **Finds:** Business profiles, owner/principal names, complaint history, accreditation status
- **Method:** Direct BBB search by business name and location

#### 12e. Google Places Enhanced Agent
- **Source:** Google Places API (enhanced mode)
- **Finds:** Business details, phone numbers, websites, plus nearby business detection for property management companies
- **Method:** Place search with detailed fields, plus nearby search for management company offices

**Pipeline Function:** `runSocialIntelPipeline()` executes all 5 agents and aggregates results, deduplicating against already-known people.

---

### 13. Web Research Agent
**File:** `server/web-research-agent.ts` (515 lines)
**Purpose:** Scans business websites to identify decision-makers and their contact details

| Attribute | Detail |
|-----------|--------|
| **Data Source** | Business websites (scraped) |
| **Trigger** | Pipeline Stage 3 or on-demand |
| **Output** | Contact names, titles, phones, emails |

**What it does:**
- Discovers business websites through Google Places, owner records, or existing lead data
- Scrapes contact pages, about pages, team/leadership pages, and footer content
- Extracts and ranks decision-makers by title relevance (Facility Manager=100, Property Manager=95, Owner/CEO=50)
- Uses regex-based email and phone extraction with extensive junk filtering
- Validates person names against common web page artifacts
- 30+ relevant title patterns tracked for roofing-relevant decision-makers
- Implements batch processing with progress tracking

---

### 14. Phone Enrichment Agent
**File:** `server/phone-enrichment.ts` (360 lines)
**Purpose:** Cascading phone number discovery from multiple sources

| Attribute | Detail |
|-----------|--------|
| **Data Sources** | Google Places, OpenCorporates, Serper, TX Comptroller |
| **Trigger** | Pipeline Stage 2 or on-demand |
| **Output** | Phone numbers with source attribution |

**What it does:**
- Implements a cascading search strategy through multiple providers:
  1. **Google Places** - Search by business name + city for Google-listed phone numbers
  2. **OpenCorporates** - Look up corporate entity phone/contact records
  3. **Serper Web Search** - Fall back to web search for phone numbers
  4. **TX Comptroller** - Check state records for registered phone numbers
- Each provider has availability checking (API key presence)
- Validates phone numbers against known invalid patterns (all zeros, sequential, fictional area codes)
- Normalizes and deduplicates results across sources
- Stops at first valid result (cascading priority)

---

## Contact Enrichment Pipeline

### 15. Enrichment Pipeline
**File:** `server/enrichment-pipeline.ts` (139 lines)
**Purpose:** Unified 3-stage enrichment pipeline coordinator

| Stage | Agent | Description |
|-------|-------|-------------|
| **Stage 1** | Contact Enrichment | TX Open Data Portal lookups (taxpayer IDs, SOS file numbers) |
| **Stage 2** | Phone Enrichment | Cascading phone number discovery |
| **Stage 3** | Web Research | Business website scraping for decision-makers |

**What it does:**
- Runs all three enrichment stages in sequence with configurable batch sizes
- Calculates contact confidence score (0-100) based on 7 factors: owner name, TX filing verification, phone number, business website, decision-maker name, direct phone, email
- Classifies confidence into tiers: High (60+), Medium (30-59), Low (1-29), None (0)
- Provides pipeline statistics: total leads, enrichment coverage percentages, confidence distribution
- Returns per-stage results with status (completed/skipped/error) and detail messages

---

### 16. Contact Enrichment (TX Open Data)
**File:** `server/contact-enrichment.ts` (219+ lines)
**Purpose:** Stage 1 enrichment using Texas Open Data Portal for entity verification

| Attribute | Detail |
|-----------|--------|
| **Data Source** | TX Open Data Portal (Socrata API) |
| **Trigger** | Pipeline Stage 1 |
| **Output** | Taxpayer IDs, SOS file numbers, entity verification |

**What it does:**
- Queries TX Open Data Portal for business entity records matching lead owner names
- Extracts taxpayer IDs and SOS (Secretary of State) file numbers
- Verifies entity existence and status in state records
- Provides foundation data that subsequent agents (Owner Intelligence) build upon
- Reports enrichment configuration status and API key availability

---

## Decision-Maker Discovery (Layer 3)

### 17. Ownership Classifier
**File:** `server/ownership-classifier.ts` (494 lines)
**Purpose:** Classifies property ownership into 4 structural buckets and identifies primary decision-makers

| Attribute | Detail |
|-----------|--------|
| **Input** | Lead data + portfolio size |
| **Output** | Ownership structure, signals, decision-maker list |

**4 Ownership Buckets:**

| Bucket | Description | Example |
|--------|-------------|---------|
| `small_private` | Individual or family-owned, <5 properties | "John Smith", "Smith Family Trust" |
| `investment_firm` | Real estate investment entity, 5-50 properties | "Oakwood Capital LLC", "DFW Holdings LP" |
| `institutional_reit` | Large institutional owner or REIT, 50+ properties | "Prologis Inc", "Camden Property Trust" |
| `third_party_managed` | Property managed by external management company | Detected via reverse address enrichment |

**Classification Signals (8 factors):**
1. **Owner Type** (weight: 40) - Individual, LLC, Corporation, Trust, LP, REIT
2. **LLC Chain Depth** (weight: 15) - How many layers of LLCs exist
3. **Mailing Address Type** (weight: 25) - Residential, management office, corporate HQ
4. **Management Company** (weight: 20) - Whether a management company was detected
5. **Portfolio Size** (weight: 10) - Number of properties under same owner
6. **Property Value** (weight: 10) - Total assessed value thresholds
7. **Entity Name Patterns** - Keywords like "holdings", "capital", "trust", "REIT"
8. **Officer Count** - Number of officers/members found in LLC chain

**Title Relevance Scoring:**
Each ownership structure has its own weight matrix for roofing decision authority:

| Title | Small Private | Investment Firm | Institutional | Third-Party |
|-------|:---:|:---:|:---:|:---:|
| Facilities Director | 50 | 75 | 100 | 80 |
| Property Manager | 40 | 60 | 70 | 100 |
| Managing Member | 100 | 85 | 30 | 45 |
| Owner/President | 100 | 70 | 20 | 15 |
| Asset Manager | 30 | 100 | 90 | 60 |

**Multi-Contact Strategy:**
- Selects up to 3 decision-makers per property: **Primary**, **Secondary**, **Operational**
- Combined score = `titleRelevance * 0.5 + confidence * 0.35 + contactBonus * 0.15`
- Contact bonus: +30 for phone+email, +20 for phone only, +10 for email only
- Falls back to entity owner name or management contact when no people are extracted

---

### 18. Rooftop Owner Resolver
**File:** `server/rooftop-owner-resolver.ts` (419 lines)
**Purpose:** Extracts and normalizes all people associated with a lead, builds portfolio groups

| Attribute | Detail |
|-----------|--------|
| **Input** | Lead records with intelligence data |
| **Output** | Rooftop owner records, portfolio groups |

**What it does:**
- Extracts people from multiple lead data sources:
  - Owner name (if person, not entity)
  - Managing member from LLC chain resolution
  - Officer name from TX SOS/Comptroller
  - Contact name from web research
  - LLC chain officers (all levels)
  - Intelligence dossier people
  - Building contacts
- Normalizes names by stripping legal suffixes, punctuation, and standardizing case
- Detects person vs. entity names using heuristic rules (word count, corporate indicators)
- Creates rooftop owner records linking people to properties
- Builds portfolio groups by clustering properties under normalized owner names
- Provides portfolio analysis: top owners by property count, portfolio property lists

---

### 19. Management Attribution
**File:** `server/management-attribution.ts` (291 lines)
**Purpose:** Differentiates property managers from property owners

| Attribute | Detail |
|-----------|--------|
| **Evidence Sources** | Permits, mailing addresses, reverse address results, PM company database |
| **Output** | Management company identification with evidence chain |

**What it does:**
- Compares property owner with building permit applicants to detect third-party management
- Checks owner mailing address against property address (different = possible management)
- Matches against known DFW property management company database (25+ companies)
- Identifies management company keywords in owner/contact names
- Detects registered agent services (CT Corporation, CSC Global, etc.) as management indicators
- Normalizes addresses for comparison (street abbreviations, directional standardization)
- Returns management company name, contact, phone, email with evidence chain including source, field, value, confidence, and recency

---

### 20. Role Inference Engine
**File:** `server/role-inference.ts` (301 lines)
**Purpose:** Infers contact roles from titles and ranks by decision authority

| Attribute | Detail |
|-----------|--------|
| **Input** | Contact titles, intelligence claims, building contacts |
| **Output** | Role assignments with authority ranking |

**8 Contact Roles (ranked by authority):**

| Rank | Role | Typical Titles |
|------|------|----------------|
| 1 | Asset Manager | VP of Asset Management, Director of Asset Management |
| 2 | Owner Representative | Owner, President, CEO, Managing Partner, Principal |
| 3 | Property Manager | Community Manager, Site Manager, Regional Manager |
| 4 | Facilities Director | Facilities Manager, Maintenance Director |
| 5 | Building Engineer | Chief Engineer, Plant Engineer |
| 6 | General Contractor | Contractor |
| 7 | Leasing Agent | Leasing Manager, Leasing Director |
| 8 | Unknown | No matching title pattern |

**What it does:**
- Maps 30+ title patterns to 8 standardized roles
- Ranks candidates by authority level (Asset Manager > Owner Rep > Property Manager...)
- Gathers evidence from intelligence claims, building permits, and contact records
- Produces role candidates with confidence scores and evidence chains

---

### 21. DM Confidence Scoring
**File:** `server/dm-confidence.ts` (460 lines)
**Purpose:** 7-factor weighted formula for decision-maker contact confidence

| Factor | Weight | What It Measures |
|--------|--------|-----------------|
| Property Match | 20% | Geocoding, address, sq ft, year built, source verification |
| Owner Match | 25% | Owner name, taxpayer ID, SOS file number, officer data |
| Management Match | 15% | Management company detection, permit cross-reference |
| Person-Role Fit | 20% | Title relevance, authority level, evidence support |
| Contact Reachability | 10% | Phone and email availability and verification |
| Conflict Penalty | 5% | Unresolved evidence conflicts reduce score |
| Staleness Penalty | 5% | Data age reduces score over time |

**Confidence Tiers:**

| Tier | Score Range | Action |
|------|------------|--------|
| **Auto-Publish** | 75-100 | Contact info automatically made available to contractors |
| **Review** | 40-74 | Flagged for human review before publishing |
| **Suppress** | 0-39 | Too low confidence, hidden from contractors |

---

## Evidence & Provenance System

### 22. Evidence Recorder
**File:** `server/evidence-recorder.ts` (234 lines)
**Purpose:** Full provenance tracking for all contact discoveries with conflict detection

| Attribute | Detail |
|-----------|--------|
| **Input** | Evidence from any agent (structured EvidenceInput) |
| **Output** | Stored evidence records with computed trust scores |

**What it does:**
- Records every piece of contact information discovered by any agent with full provenance:
  - Lead ID, entity type/ID, contact type (PHONE/EMAIL), contact value
  - Source name, source URL, source type, extraction method
  - Raw snippet of source text, confidence score
- Computes evidence scores using: source trust * recency factor * corroboration count * domain match * extraction quality
- Deduplicates: if same contact value from same source already exists, increments corroboration count and updates score
- Counts cross-source corroboration (how many different sources report the same value)
- Detects and stores conflicts when multiple different values exist for the same contact type
- Auto-resolves conflicts when one value's score exceeds the runner-up by 15+ points (configurable margin)
- Supports batch evidence recording for efficiency

---

### 23. Source Trust Configuration
**File:** `server/config/sourceTrust.ts` (255 lines)
**Purpose:** Trust scoring configuration for 30+ data sources

**Trust Scores by Source:**

| Source | Trust Score | Type | Category |
|--------|:---------:|------|----------|
| DCAD ArcGIS | 95 | API | Government |
| NOAA SWDI | 95 | API | Government |
| TX Comptroller PIR | 92 | API | Government |
| HUD Multifamily | 92 | API | Government |
| TX SOS | 90 | API | Corporate Registry |
| Property Tax Records | 90 | API | Government |
| TREC License | 88 | API | Government |
| TDLR License | 88 | API | Government |
| TX Comptroller Sales Tax | 88 | API | Government |
| Google Places | 75 | API | Directory |
| Google Business | 72 | API | Directory |
| OpenCorporates | 70 | API | Aggregator |
| BBB Direct | 65 | HTML | Directory |
| Serper Web Search | 55 | API | Aggregator |
| Website Scrape | 50 | HTML | Official Website |

**Score Computation Formula:**
```
evidenceScore = sourceTrust * recencyFactor * (1 + corroboration * 0.1) * domainMatch * extractionQuality
```

**Recency Factor:** Decays from 1.0 (today) by 0.05 per month, minimum 0.1

**Auto-Resolution:** Conflicts auto-resolve when winning value exceeds runner-up by 15+ points

---

### 24. Contact Feedback System
**File:** `server/contact-feedback.ts` (95 lines)
**Purpose:** Human-in-the-loop contact verification and suppression

| Attribute | Detail |
|-----------|--------|
| **Input** | Contractor feedback (wrong number, confirmed good, suppress) |
| **Output** | Updated evidence records with validation status |

**What it does:**
- `suppressContact()` - Marks evidence as inactive, zeroes confidence and score, sets validation to INVALID
- `unsuppressContact()` - Reactivates evidence, resets validation to UNVERIFIED for re-verification
- `markWrongNumber()` - Suppresses the reported number and auto-promotes the next-best alternative
- `markConfirmedGood()` - Sets validation to VERIFIED, boosts confidence and computed score

---

### 25. Contact Ranking
**File:** `server/contact-ranking.ts` (195 lines)
**Purpose:** Ranks and recommends the best contact path for each lead

| Attribute | Detail |
|-----------|--------|
| **Input** | All active evidence for a lead |
| **Output** | Ranked phone and email lists with best recommendations |

**What it does:**
- Groups evidence by normalized contact value (deduplicating same number from multiple sources)
- Applies time-based confidence decay: 5% per month, minimum 10% of original score
- Ranks contacts by decayed computed score
- Requires minimum 2 sources for "recommended" status
- Produces a `ContactPath` with:
  - Ranked phone list with scores, source counts, line type, carrier, validation status
  - Ranked email list with similar metadata
  - Best phone and best email recommendations
  - Overall confidence tier (high/medium/low/none)
  - Warnings for missing data or low confidence situations

---

## Entity Resolution & Portfolio Discovery

### 26. Entity Resolution Engine
**File:** `server/entity-resolution.ts` (534 lines)
**Purpose:** Deterministic and probabilistic matching for lead deduplication and entity clustering

| Attribute | Detail |
|-----------|--------|
| **Algorithm** | Jaro-Winkler string similarity + multi-field matching |
| **Output** | Duplicate clusters with merge capability |

**What it does:**
- Normalizes owner names (strips legal suffixes, punctuation, stop words)
- Normalizes addresses (standardizes abbreviations: Street→ST, Avenue→AVE, etc.)
- Implements Jaro-Winkler similarity algorithm for fuzzy name matching
- Multi-field matching across: owner name, mailing address, taxpayer ID, SOS file number, officer names, LLC chain entities, registered agents
- Creates duplicate clusters with match type and confidence score
- Supports human review workflow: approve merge, skip, or flag
- `mergeCluster()` consolidates duplicate leads: enriches winner with data from losers, updates portfolio links, marks losers as merged
- Provides statistics: total clusters, pending review, merged, skipped

---

### 27. Network Agent (Portfolio Discovery)
**File:** `server/network-agent.ts` (528 lines)
**Purpose:** Discovers and scores property portfolios by linking ownership connections

| Attribute | Detail |
|-----------|--------|
| **Input** | Lead records with owner data, LLC chains, registered agents |
| **Output** | Portfolio groups with scoring and network statistics |

**What it does:**
- Clusters leads into ownership groups using multi-signal linking:
  - Normalized owner name matching
  - LLC chain entity name overlap
  - Shared registered agents
  - Shared managing members
  - Matching taxpayer IDs
  - Matching SOS file numbers
- Each link records the reason (e.g., "Same owner name", "Shared registered agent: CT Corporation")
- Builds portfolio records with:
  - Total property count, total assessed value, total square footage
  - Primary owner name, decision-maker info, top-scoring lead
  - List of linked lead IDs with link reasons
- Scores portfolios for prioritization
- Provides portfolio detail views with all constituent properties
- Network statistics: total groups, multi-property owners, average portfolio size

---

### 28. PM Company Manager
**File:** `server/pm-company-manager.ts` (162 lines)
**Purpose:** Property management company database for the DFW market

| Attribute | Detail |
|-----------|--------|
| **Data** | 25 pre-seeded DFW property management companies |
| **Output** | PM company matching and linking to leads |

**What it does:**
- Maintains a database of known DFW property management companies (Lincoln Property, JLL, CBRE, Cushman & Wakefield, Stream Realty, etc.)
- Each entry includes: company name, city, phone, website
- Fuzzy name matching for lead-to-PM-company linking
- Supports CRUD operations: seed, find, add, list, link to lead
- Used by management attribution to identify when a property is third-party managed

---

## Compliance & Validation Infrastructure

### 29. Compliance Gate
**File:** `server/compliance-gate.ts` (266 lines)
**Purpose:** Manages opt-outs, consent, and DNC checks before contact

| Attribute | Detail |
|-----------|--------|
| **Checks** | DNC registry, consent status, suppression list, channel-specific blocks |
| **Output** | Per-channel allow/deny with reason codes |

**What it does:**
- Checks lead's DNC registration status
- Validates consent status (granted, denied, revoked)
- Queries suppression list for phone, email, or lead-level suppressions
- Checks expiration dates on suppression entries
- Returns per-channel compliance decisions:
  - Phone: allowed/denied with reason
  - Email: allowed/denied with reason
  - Mail: allowed/denied with reason
- Flags for downstream processing: `dnc_registered`, `consent_denied`, `consent_revoked`, `suppressed_phone`, `suppressed_email`, etc.
- Supports decision-maker review records for human-in-the-loop approval

---

### 30. Contact Validation
**File:** `server/contact-validation.ts` (216 lines)
**Purpose:** Phone and email validation with structural analysis

**Phone Validation:**
- E.164 normalization (handles 10-digit, 11-digit US numbers)
- Display formatting: `+12145551234` → `(214) 555-1234`
- Structure validation:
  - Rejects repeated digits (all zeros, all ones)
  - Rejects sequential patterns (1234567890)
  - Rejects invalid area codes (000, 911, 555)
  - Rejects fictional 555 exchanges
  - Rejects exchanges starting with 0 or 1
  - Identifies Texas area codes (28 codes) and toll-free numbers
- Returns validity status with human-readable reason

**Email Validation:**
- RFC-compliant syntax validation
- Local part and domain length limits
- Disposable domain detection (mailinator, guerrillamail, tempmail, etc.)
- MX record verification via DNS lookup (validates domain can receive email)
- Returns validity status with reason

---

### 31. Source Policy
**File:** `server/config/sourcePolicy.ts` (241 lines)
**Purpose:** Ethical scraping compliance module

| Feature | Detail |
|---------|--------|
| **Blocked Domains** | 20 sites (social media, people search sites) |
| **Rate Limiting** | Per-domain in-memory limits |
| **robots.txt** | Automatic checking before scraping |

**Blocked Domains:** facebook.com, instagram.com, twitter.com, linkedin.com, tiktok.com, pinterest.com, reddit.com, spokeo.com, whitepages.com, beenverified.com, truepeoplesearch.com, fastpeoplesearch.com, peoplefinders.com, intelius.com, mylife.com, pipl.com, radaris.com, zabasearch.com

**Rate Limits:**
| Domain | Per Minute | Per Hour |
|--------|:---:|:---:|
| maps.googleapis.com | 30 | 500 |
| data.texas.gov | 20 | 200 |
| mycpa.cpa.state.tx.us | 10 | 100 |
| direct.sos.state.tx.us | 10 | 100 |
| api.opencorporates.com | 5 | 50 |
| google.serper.dev | 15 | 150 |
| Default | 20 | 300 |

**Additional Features:**
- Database-backed domain blocklist (extends hardcoded list)
- Entity blocklist (block specific companies from being scraped)
- Proper User-Agent header: `RoofIntel/1.0 (Commercial Property Intelligence)`
- `policyFetch()` wrapper that checks domain blocks, rate limits, and robots.txt before any HTTP request

---

### 32. Twilio Lookup
**File:** `server/twilio-lookup.ts` (139 lines)
**Purpose:** Phone number carrier verification via Twilio Lookup API

| Attribute | Detail |
|-----------|--------|
| **Data Source** | Twilio Lookup v2 API |
| **Output** | Line type, carrier name, validity |

**What it does:**
- Verifies phone numbers via Twilio Lookup v2 with line type intelligence
- Returns: line type (mobile, landline, VoIP), carrier name, validity
- Falls back to structure-only validation when Twilio credentials aren't configured
- `verifyAndUpdateEvidence()` - Verifies a specific evidence record's phone and updates validation status
- `verifyAllPhonesForLead()` - Batch verifies all phone evidence for a lead
- 10-second request timeout with AbortController

---

## Orchestration & Scheduling

### 33. Lead Enrichment Orchestrator
**File:** `server/lead-enrichment-orchestrator.ts` (324 lines)
**Purpose:** On-demand single-lead enrichment that auto-triggers all agents

| Attribute | Detail |
|-----------|--------|
| **Trigger** | First view of a lead, or manual re-enrichment |
| **Steps** | 6 sequential enrichment steps |

**Enrichment Steps:**

| Step | Agent | What It Does |
|------|-------|-------------|
| 1 | Owner Intelligence (16 Agents) | Full owner research dossier |
| 2 | Reverse Address Lookup | Mailing address analysis |
| 3 | Management Attribution | Manager vs. owner separation |
| 4 | Role Inference | Contact role assignment |
| 5 | Confidence Scoring | 7-factor DM confidence |
| 6 | Phone Enrichment | Cascading phone discovery |

**What it does:**
- Tracks enrichment progress with real-time step status updates
- Each step can be: pending, running, complete, skipped, or error
- Skips steps when prerequisites aren't met (e.g., no owner name → skip intelligence)
- Updates lead record after each step with newly discovered data
- Re-fetches lead between steps to ensure each step has latest data
- Provides progress polling via `getEnrichmentProgress(leadId)`
- Stores active enrichment state in memory for real-time UI updates

---

### 34. Job Scheduler
**File:** `server/job-scheduler.ts` (124 lines)
**Purpose:** Background job management for recurring tasks

| Job | Schedule | Description |
|-----|----------|-------------|
| `noaa_hail_sync` | Daily | Fetch latest NOAA hail events for all active markets |
| `lead_score_recalc` | Daily | Recalculate lead scores based on latest hail data |

**What it does:**
- Creates default jobs on startup if they don't exist
- Manages job lifecycle: create, activate/deactivate, run, track status
- NOAA sync job: iterates all active markets, imports hail data for current year, filters by market counties
- Score recalculation job: re-scores all leads using latest hail correlation data
- Tracks job status (idle, running), last run timestamp, and error state
- Evidence cleanup: purges expired or stale evidence records based on configurable age thresholds

---

### 35. Reverse Address Enrichment
**File:** `server/reverse-address-enrichment.ts` (297 lines)
**Purpose:** Compares owner mailing vs property addresses and discovers businesses at mailing address

| Attribute | Detail |
|-----------|--------|
| **Data Source** | Google Places API |
| **Output** | Address type classification, business discoveries |

**What it does:**
- Compares owner's mailing address with property address using normalized comparison
- When addresses differ, queries Google Places API for businesses at the mailing address
- Classifies discovered businesses into categories:
  - `management_company` - Property management firms
  - `law_firm` - Legal offices
  - `title_company` - Title/escrow companies
  - `accounting_firm` - CPA/tax offices
  - `corporate_office` - Corporate headquarters
  - `financial_institution` - Banks/finance companies
  - `retail_commercial` - Retail/restaurant businesses
  - `other_business` - Unclassified businesses
- Classifies overall address type: management office, law firm office, corporate HQ, residential/vacant, mixed commercial
- Feeds discoveries into management attribution pipeline
- Batch processes leads with missing reverse address data

---

## Agent Dependency Map

```
Lead Import
  └── DCAD Agent ──────────────────────────────────┐
  └── Property CSV Import                          │
                                                   ▼
Enrichment Pipeline ──────────────────────── Lead Record
  ├── Stage 1: Contact Enrichment (TX Open Data)
  ├── Stage 2: Phone Enrichment (Google/OC/Serper)
  └── Stage 3: Web Research Agent

Lead Enrichment Orchestrator (On-Demand)
  ├── Step 1: Owner Intelligence (16 Agents)
  │     ├── TX SOS Entity Lookup
  │     ├── TX Comptroller PIR
  │     ├── TX Comptroller Sales Tax
  │     ├── LLC Chain Resolver
  │     ├── Property Tax Mailing
  │     ├── Google Places Business
  │     ├── OpenCorporates
  │     ├── Serper Web Search
  │     ├── WHOIS/RDAP Domain
  │     ├── Skip Trace Agent
  │     │     └── Permits Agent (DFW Socrata)
  │     └── Social Intel Pipeline
  │           ├── TREC License Agent
  │           ├── TDLR License Agent
  │           ├── HUD Multifamily Agent
  │           ├── BBB Direct Agent
  │           └── Google Places Enhanced Agent
  ├── Step 2: Reverse Address Enrichment
  │     └── Google Places API
  ├── Step 3: Management Attribution
  │     ├── Permits Agent
  │     └── PM Company Manager
  ├── Step 4: Role Inference Engine
  ├── Step 5: DM Confidence Scoring
  └── Step 6: Phone Enrichment

Storm Monitoring (Continuous)
  ├── Hail Tracker (NOAA SWDI + NWS)
  ├── Storm Monitor (Clustering + Impact)
  ├── Xweather Hail (Predictive Nowcasting)
  └── Hail Correlator (Lead Matching)

Background Jobs
  ├── NOAA Hail Sync (Daily)
  └── Lead Score Recalculation (Daily)

Decision-Maker Discovery (Layer 3)
  ├── Ownership Classifier (4 Buckets)
  ├── Rooftop Owner Resolver
  ├── Entity Resolution Engine
  └── Network Agent (Portfolio Discovery)

Evidence System (Cross-Cutting)
  ├── Evidence Recorder (Provenance)
  ├── Source Trust Scoring
  ├── Contact Ranking
  ├── Contact Feedback (Human Loop)
  ├── Contact Validation
  ├── Twilio Lookup
  └── Source Policy (Compliance)

Compliance (Cross-Cutting)
  └── Compliance Gate (DNC/Consent/Suppression)
```

---

*Generated from RoofIntel codebase — 13,221 lines across 34 agent modules*
