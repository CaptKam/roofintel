# RoofIntel Data Structure

## Database Overview

| Table | Records | Size | Purpose |
|-------|---------|------|---------|
| `leads` | 16,691 | 99 MB | Core property records — one row per commercial building |
| `intelligence_claims` | 131,084 | 47 MB | Every data point discovered by agents, with provenance |
| `building_permits` | 42,244 | 25 MB | Building permits matched to properties |
| `contact_evidence` | 12,498 | 10 MB | Phone/email evidence with trust scoring |
| `portfolio_leads` | 7,491 | 3.7 MB | Links leads to portfolios (many-to-many) |
| `rooftop_owners` | 5,116 | 5.3 MB | Resolved real people/entities tied to properties |
| `duplicate_clusters` | 1,915 | 2.3 MB | Detected duplicate lead groups |
| `portfolios` | 1,522 | 1.4 MB | Multi-property owner portfolios |
| `ai_audit_results` | 1,218 | 1.2 MB | AI agent analysis findings |
| `code_violations` | 1,150 | 552 KB | Municipal code violations |
| `hail_events` | 917 | 280 KB | NOAA hail records |
| `conflict_sets` | 219 | 296 KB | Conflicting contact data needing resolution |
| `building_footprints` | 49 | 88 KB | OpenStreetMap building polygons |

---

## Core Tables

### `leads` — The Central Record (16,691 rows)

Every commercial or multi-family property in the system. This is the primary table everything else connects to.

#### Property Identity
| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `market_id` | varchar | Links to `markets` table |
| `address` | text | Street address |
| `city` | text | City name |
| `county` | text | County (Dallas, Tarrant, Collin, Denton) |
| `state` | text | State (default: TX) |
| `zip_code` | text | ZIP code |
| `latitude` | real | GPS latitude |
| `longitude` | real | GPS longitude |
| `source_type` | text | Where this lead came from (e.g., `dcad_api`) |
| `source_id` | text | Original record ID from the source system |

#### Building Characteristics
| Column | Type | Description |
|--------|------|-------------|
| `sqft` | integer | Building square footage |
| `year_built` | integer | Year constructed (100% populated) |
| `construction_type` | text | Construction material (e.g., Masonry, Steel Frame) |
| `zoning` | text | Zoning classification |
| `stories` | integer | Number of floors |
| `units` | integer | Number of units |

#### Roof Data
| Column | Type | Description |
|--------|------|-------------|
| `roof_type` | text | Roof material type: BUR (62%), EPDM (15%), Modified Bitumen (12%), Shingle (7%), Metal (2%), TPO (1%) |
| `roof_material` | text | Additional roof material detail |
| `roof_last_replaced` | integer | Year roof was last replaced (rarely populated) |
| `estimated_roof_area` | integer | Estimated roof area in sqft |
| `last_roofing_permit_date` | text | Date of most recent roofing-specific permit (2.3% populated) |
| `last_roofing_contractor` | text | Contractor who did last roofing work |
| `last_roofing_permit_type` | text | Type of last roofing permit |
| `claim_window_open` | boolean | Whether the insurance claim window is still open |

#### Roof Risk Index
| Column | Type | Description |
|--------|------|-------------|
| `roof_risk_index` | integer | Composite risk score 0-100 (Low 0-30, Moderate 31-60, High 61-80, Critical 81-100) |
| `roof_risk_breakdown` | jsonb | 5-pillar scoring detail: `{ score, tier, exposureWindow, breakdown: { ageRisk, stormRisk, permitSilence, climateStress, portfolioConcentration } }` |

#### Owner & Contact Information
| Column | Type | Description |
|--------|------|-------------|
| `owner_name` | text | Property owner name from appraisal district |
| `owner_type` | text | Entity type (LLC, Corporation, Individual, Trust, etc.) |
| `owner_address` | text | Owner's mailing address |
| `owner_phone` | text | Owner's phone number |
| `owner_email` | text | Owner's email address |
| `phone_source` | text | Where the phone was found |
| `phone_enriched_at` | timestamp | When phone was last enriched |
| `business_name` | text | Business name at the property |
| `business_website` | text | Business website URL |

#### Decision Maker
| Column | Type | Description |
|--------|------|-------------|
| `contact_name` | text | Identified decision maker's name |
| `contact_title` | text | Their title (e.g., Property Manager) |
| `contact_phone` | text | Decision maker's direct phone |
| `contact_email` | text | Decision maker's email |
| `contact_source` | text | Where this contact was discovered |
| `contact_role` | text | Inferred role (e.g., General Contractor, Property Manager) |
| `role_confidence` | integer | Confidence in role assignment (0-100) |
| `decision_maker_rank` | integer | Priority ranking among possible DMs |
| `role_evidence` | jsonb | Evidence supporting the role assignment |
| `dm_confidence_score` | integer | Overall decision-maker confidence (0-100) |
| `dm_confidence_components` | jsonb | Score breakdown: `{ ownerMatch, personRoleFit, propertyMatch, conflictPenalty, managementMatch, stalenessPenalty, contactReachability }` |
| `dm_review_status` | text | Review state: `unreviewed`, `pending_review`, `approved`, `rejected` |

#### Corporate Intelligence
| Column | Type | Description |
|--------|------|-------------|
| `llc_name` | text | LLC entity name |
| `registered_agent` | text | Registered agent from SOS filings |
| `officer_name` | text | Corporate officer name |
| `officer_title` | text | Officer's title |
| `sos_file_number` | text | TX Secretary of State filing number |
| `taxpayer_id` | text | TX Comptroller taxpayer ID |
| `managing_member` | text | Managing member identified from filings |
| `managing_member_title` | text | Their title |
| `managing_member_phone` | text | Their phone number |
| `managing_member_email` | text | Their email |
| `llc_chain` | jsonb | Full LLC ownership chain: `[{ entityName, entityType, officers, registeredAgent, sosFileNumber, source, status }]` |
| `owner_intelligence` | jsonb | Raw intelligence dossier |
| `intelligence_score` | integer | Intelligence completeness score |
| `intelligence_sources` | text[] | Array of sources used (e.g., "Google Business", "Skip Trace") |
| `building_contacts` | jsonb | Contacts found at the building: `[{ name, role, phone, email, source, address }]` |
| `ownership_flag` | text | Flag (e.g., "Corp Service Shield") |
| `ownership_structure` | text | Classification: `small_private`, `investment_firm`, `reit`, `government`, `nonprofit`, `family_trust` |
| `ownership_signals` | jsonb | Signals used for classification: `[{ factor, value, weight, direction }]` |
| `decision_makers` | jsonb | Ranked decision makers: `[{ name, role, tier, phone, email, title, confidence, combinedScore }]` |

#### Property Management
| Column | Type | Description |
|--------|------|-------------|
| `management_company` | text | Identified property management company |
| `management_contact` | text | PM company contact person |
| `management_phone` | text | PM company phone |
| `management_email` | text | PM company email |
| `management_evidence` | jsonb | Evidence for PM attribution |
| `management_attributed_at` | timestamp | When PM was identified |

#### Reverse Address Enrichment
| Column | Type | Description |
|--------|------|-------------|
| `reverse_address_type` | text | What was found at the mailing address |
| `reverse_address_businesses` | jsonb | Businesses found at owner's mailing address |
| `reverse_address_enriched_at` | timestamp | When reverse lookup was done |

#### Hail & Storm Exposure
| Column | Type | Description |
|--------|------|-------------|
| `hail_events` | integer | Total hail events near this property (99.7% populated, avg 15/lead) |
| `last_hail_date` | text | Date of most recent hail event |
| `last_hail_size` | real | Size of last hail in inches (94% have >= 1.5") |

#### Flood Risk
| Column | Type | Description |
|--------|------|-------------|
| `flood_zone` | text | FEMA flood zone designation |
| `flood_zone_subtype` | text | Specific flood zone subtype |
| `is_flood_high_risk` | boolean | Whether in a high-risk flood zone |

#### Financial Distress
| Column | Type | Description |
|--------|------|-------------|
| `improvement_value` | integer | Assessed improvement value |
| `land_value` | integer | Assessed land value |
| `total_value` | integer | Total assessed value |
| `last_deed_date` | text | Most recent deed transfer date |
| `lien_count` | integer | Number of liens filed |
| `foreclosure_flag` | boolean | Whether under foreclosure |
| `tax_delinquent` | boolean | Whether taxes are delinquent |
| `distress_score` | integer | Composite financial distress score |

#### Code Violations
| Column | Type | Description |
|--------|------|-------------|
| `violation_count` | integer | Total violations on record |
| `open_violations` | integer | Currently open violations |
| `last_violation_date` | text | Date of most recent violation |

#### Permits (Summary)
| Column | Type | Description |
|--------|------|-------------|
| `permit_count` | integer | Total building permits matched (12.7% populated) |
| `last_permit_date` | text | Date of most recent permit |
| `permit_contractors` | jsonb | Contractors from matched permits: `[{ name, phone, email, address, permitDate, permitType, workDescription }]` |

#### Scoring & Status
| Column | Type | Description |
|--------|------|-------------|
| `lead_score` | integer | Lead prioritization score (0-100) |
| `status` | text | Pipeline status: `new`, `contacted`, `qualified`, `proposal`, `closed` |
| `notes` | text | User-added notes |
| `enrichment_status` | text | Enrichment state: `pending`, `in_progress`, `complete`, `failed` |
| `last_enriched_at` | timestamp | Last enrichment timestamp |

#### Compliance
| Column | Type | Description |
|--------|------|-------------|
| `consent_status` | text | Contact consent status |
| `consent_date` | text | When consent was given |
| `consent_channel` | text | Channel consent was given through |
| `dnc_registered` | boolean | Whether on Do Not Call registry |

---

### `hail_events` — Storm Records (917 rows)

Historical hail events from NOAA. Matched to leads by proximity.

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `market_id` | varchar | Market reference |
| `event_date` | text | Date of the hail event |
| `latitude` | real | Event location |
| `longitude` | real | Event location |
| `hail_size` | real | Hail diameter in inches |
| `county` | text | County |
| `city` | text | City |
| `source` | text | Data source (default: NOAA) |
| `noaa_event_id` | text | NOAA event identifier |
| `noaa_episode_id` | text | NOAA episode identifier |

---

### `building_permits` — Permit Records (42,244 rows)

Building permits from Dallas Open Data and Fort Worth ArcGIS. Matched to leads by address.

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `lead_id` | varchar | Linked lead (if matched) |
| `market_id` | varchar | Market reference |
| `permit_number` | text | Official permit number |
| `permit_type` | text | Type (Building, Electrical, Plumbing, Roofing, etc.) |
| `issued_date` | text | Date issued |
| `address` | text | Property address |
| `city` | text | City |
| `contractor` | text | Contractor name |
| `contractor_phone` | text | Contractor's phone |
| `contractor_email` | text | Contractor's email |
| `contractor_address` | text | Contractor's address |
| `applicant_name` | text | Permit applicant |
| `owner` | text | Property owner on permit |
| `work_description` | text | Description of work |
| `estimated_value` | real | Estimated project value |
| `sqft` | integer | Square footage of work |
| `land_use` | text | Land use classification |
| `source` | text | Data source (dallas_open_data, fort_worth_arcgis) |

---

## Contact Intelligence

### `contact_evidence` — Evidence Records (12,498 rows)

Every discovered phone number, email, or contact claim — with full provenance and trust scoring.

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `lead_id` | varchar | Associated lead |
| `entity_type` | text | Entity type (LEAD) |
| `contact_type` | text | Type: `PHONE`, `EMAIL`, `BUILDING_CONTACT`, `SALES_TAX_PERMIT` |
| `contact_value` | text | The actual phone/email/name |
| `normalized_value` | text | Normalized format |
| `is_public_business` | boolean | Whether this is a public business number |
| `source_name` | text | Where it was found (e.g., "Dallas Open Data (Permits)", "Google Places", "TX Comptroller Sales Tax") |
| `source_url` | text | Source URL if applicable |
| `source_type` | text | Source category: `API`, `WEB_SCRAPE`, `MANUAL` |
| `confidence` | integer | Base confidence score (0-100) |
| `source_trust_score` | integer | How trustworthy is this source (TX Comptroller = 88, Permits = 40-90) |
| `recency_factor` | real | Recency multiplier |
| `corroboration_count` | integer | How many sources found the same value |
| `computed_score` | real | Final computed trust score |
| `validation_status` | text | `VERIFIED`, `CORROBORATED`, `FORMAT_VALID`, `UNVERIFIED` |
| `phone_line_type` | text | Line type if checked (landline, mobile, voip) |
| `carrier_name` | text | Phone carrier if checked |
| `suppressed_at` | timestamp | If suppressed, when |
| `suppressed_reason` | text | Why it was suppressed |
| `is_active` | boolean | Whether this evidence is still active |

### `conflict_sets` — Conflicting Data (219 rows)

When multiple sources provide different phone numbers or emails for the same lead.

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `lead_id` | varchar | Associated lead |
| `contact_type` | text | `PHONE` or `EMAIL` |
| `candidate_values` | jsonb | All competing values with scores: `[{ value, count, bestScore, evidenceIds }]` |
| `winner_evidence_id` | varchar | Which evidence record won |
| `resolution` | text | `UNRESOLVED`, `AUTO_RESOLVE`, `MANUAL_RESOLVED` |
| `score_margin` | real | Score difference between top candidates |

---

## Ownership & Portfolio

### `portfolios` — Multi-Property Owners (1,522 rows)

Groups of properties owned by the same entity. Detected by matching owner names, registered agents, and LLC chains.

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `name` | text | Portfolio display name |
| `key_owner` | text | Primary owner entity |
| `owner_type` | text | Entity type (LLC, Corporation, etc.) |
| `property_count` | integer | Number of properties in portfolio |
| `total_sqft` | integer | Total square footage across portfolio |
| `total_roof_area` | integer | Total roof area across portfolio |
| `total_value` | bigint | Combined property value |
| `avg_lead_score` | integer | Average lead score across properties |
| `total_hail_events` | integer | Aggregate hail exposure |
| `portfolio_score` | integer | Portfolio priority score |
| `key_decision_maker` | text | Best contact identified |
| `key_phone` | text | Best phone number |
| `key_email` | text | Best email |
| `linkage_type` | text | How properties were linked: `owner_name`, `registered_agent`, `llc_chain` |
| `linkage_keys` | text[] | Keys used for matching |
| `registered_agent` | text | Shared registered agent |
| `managing_member` | text | Shared managing member |
| `llc_entities` | text[] | All LLC names in the portfolio |

### `portfolio_leads` — Portfolio Membership (7,491 rows)

Many-to-many link between portfolios and leads.

| Column | Type | Description |
|--------|------|-------------|
| `portfolio_id` | varchar | Portfolio reference |
| `lead_id` | varchar | Lead reference |
| `link_reason` | text | Why this lead was included (e.g., "Owner name match") |

### `rooftop_owners` — Resolved People (5,116 rows)

Real people and entities tied to properties, resolved from multiple data sources.

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar (UUID) | Primary key |
| `lead_id` | varchar | Associated lead |
| `person_name` | text | Full name |
| `normalized_name` | text | Normalized for matching |
| `role` | text | Role (owner, officer, registered_agent, managing_member) |
| `title` | text | Business title |
| `confidence` | integer | Confidence score (0-100) |
| `source` | text | Where this person was found |
| `phone` | text | Phone number |
| `email` | text | Email address |
| `is_primary` | boolean | Whether this is the primary contact |
| `portfolio_group_id` | varchar | Links to portfolio if multi-property owner |
| `property_count` | integer | How many properties they're associated with |
| `total_portfolio_value` | bigint | Total value of their properties |

---

## Intelligence & AI

### `intelligence_claims` — Agent Findings (131,084 rows)

Every data point discovered by enrichment agents, with full attribution.

| Column | Type | Description |
|--------|------|-------------|
| `lead_id` | varchar | Associated lead |
| `agent_name` | text | Which agent found this |
| `claim_type` | text | Type of claim |
| `field_name` | text | Which field it populates |
| `field_value` | text | The discovered value |
| `source_url` | text | URL source |
| `confidence` | integer | How confident the agent is |
| `parsing_method` | text | How it was extracted (regex, api_structured, etc.) |
| `license_flag` | text | Data license: `public_record`, `fair_use`, etc. |

### `ai_audit_results` — AI Analysis (1,218 rows)

Results from Claude Haiku-powered data audit agent.

| Column | Type | Description |
|--------|------|-------------|
| `lead_id` | varchar | Associated lead |
| `audit_type` | text | Mode: `audit`, `search`, `contractor_scrub`, `website_extract`, `portfolio`, `stale_data`, `permit_audit`, `roof_risk` |
| `findings` | jsonb | Structured findings from the analysis |
| `confidence` | real | Overall confidence (0-1) |
| `status` | text | `pending`, `applied`, `rejected` |
| `tokens_used` | integer | API tokens consumed |

### `duplicate_clusters` — Deduplication (1,915 rows)

Groups of leads that may be duplicates, detected by entity resolution.

| Column | Type | Description |
|--------|------|-------------|
| `canonical_lead_id` | varchar | The "winner" lead in the cluster |
| `member_lead_ids` | text[] | All leads in the cluster |
| `match_type` | text | How they matched |
| `match_keys` | text[] | Keys used for matching |
| `match_confidence` | integer | Confidence score |
| `status` | text | `pending`, `merged`, `rejected` |

---

## Infrastructure & Compliance

### `markets` — Geographic Markets (1 row)

Currently DFW only, designed for multi-market expansion.

| Column | Type | Description |
|--------|------|-------------|
| `name` | text | Market name (e.g., "Dallas-Fort Worth") |
| `state` | text | State |
| `counties` | text[] | Counties covered |
| `center_lat` / `center_lng` | real | Map center point |
| `radius_miles` | integer | Coverage radius |
| `bounding_box` | jsonb | Geographic bounding box |

### `market_data_sources` — Data Source Config (4 rows)

Configuration for automated data imports. Each row maps a source API to a market.

| Column | Type | Description |
|--------|------|-------------|
| `market_id` | varchar | Which market |
| `source_type` | text | Source type (e.g., `cad_arcgis`, `permits_socrata`) |
| `source_name` | text | Human-readable name |
| `endpoint` | text | API endpoint URL |
| `field_mapping` | jsonb | Maps source fields to lead fields |
| `filter_config` | jsonb | Query filters for the source |

### `api_usage_tracker` — API Budget Tracking (3 rows)

Tracks monthly usage of paid APIs.

| Column | Type | Description |
|--------|------|-------------|
| `service` | text | API service name (Google Places, Hunter.io, PDL) |
| `month` | text | Month (e.g., "2026-02") |
| `used_count` | integer | Calls used this month |
| `monthly_limit` | integer | Budget limit |

### `building_footprints` — GIS Data (49 rows)

Building polygon outlines from OpenStreetMap, cached for satellite overlay.

| Column | Type | Description |
|--------|------|-------------|
| `lead_id` | varchar | Associated lead |
| `polygon` | jsonb | GeoJSON polygon coordinates |
| `roof_area_sqft` | real | Computed roof area from polygon |
| `source` | text | Data source (overpass/openstreetmap) |

### `code_violations` — Municipal Violations (1,150 rows)

Code violations from Dallas 311 data.

| Column | Type | Description |
|--------|------|-------------|
| `lead_id` | varchar | Matched lead |
| `violation_type` | text | Type of violation |
| `category` | text | Violation category |
| `status` | text | `open` or `closed` |
| `priority` | text | Priority level |

### Compliance Tables

| Table | Purpose |
|-------|---------|
| `compliance_consent` | Tracks contact consent per channel |
| `suppression_list` | Do-not-contact list (phone, email, entity) |
| `decision_maker_reviews` | Audit trail for DM review actions |
| `source_blocklist` | Blocked domains and entities |

### Storm Monitoring

| Table | Purpose |
|-------|---------|
| `storm_alert_configs` | Alert rules (min hail size, notification prefs) |
| `storm_runs` | Detected storm events with swath polygons |
| `alert_history` | Sent alert log |
| `response_queue` | Prioritized leads to call after a storm |

### Entity Resolution

| Table | Purpose |
|-------|---------|
| `graph_nodes` | Network graph nodes (people, companies, addresses) |
| `graph_edges` | Relationships between nodes |
| `graph_build_runs` | Graph build job history |
| `entity_merges` | Record of merged duplicate leads |

### User & UI

| Table | Purpose |
|-------|---------|
| `saved_filters` | User-saved lead filter presets |
| `pm_companies` | Property management company directory |

---

## Data Flow Summary

```
Central Appraisal Districts (ArcGIS APIs)
    → leads (property data, owner info, valuations)

NOAA SWDI + NWS Alerts
    → hail_events → correlated to leads (hail_events, last_hail_date, last_hail_size)

Dallas Open Data / Fort Worth ArcGIS
    → building_permits → matched to leads (permit_count, permit_contractors)
    → contact_evidence (contractor phones)

TX Comptroller / Secretary of State
    → intelligence_claims (LLC chains, officers, registered agents)
    → contact_evidence (business phones from sales tax permits)

Google Places API
    → contact_evidence (published business phones)
    → building_contacts (tenants/occupants at address)

Enrichment Pipeline (TX Open Data → Phone → Web Research)
    → contact_evidence (phones, emails with trust scores)
    → conflict_sets (when sources disagree)

AI Agent (Claude Haiku)
    → ai_audit_results (analysis findings)
    → leads (cleaned/corrected data applied)

Portfolio Detection
    → portfolios + portfolio_leads (grouped by owner matching)

Roof Risk Engine (SQL-only computation)
    → leads.roof_risk_index + leads.roof_risk_breakdown
```

---

## Key JSONB Structures

### `llc_chain` (on leads)
```json
[{
  "entityName": "ACME PROPERTIES LLC",
  "entityType": "LLC (TX)",
  "sosFileNumber": "0801234567",
  "registeredAgent": "CT CORPORATION SYSTEM",
  "registeredAgentAddress": "1999 BRYAN ST, DALLAS, TX 75201",
  "officers": [
    { "name": "John Smith", "title": "Manager", "source": "TX Comptroller PIR", "confidence": 60 }
  ],
  "source": "TX Comptroller PIR",
  "status": "Active"
}]
```

### `roof_risk_breakdown` (on leads)
```json
{
  "score": 81,
  "tier": "Critical",
  "exposureWindow": "Past expected lifespan (EPDM rated 20-25 yrs). Replacement overdue.",
  "breakdown": {
    "ageRisk": { "score": 24, "max": 25, "detail": "31yr old, past expected EPDM lifespan..." },
    "stormRisk": { "score": 22, "max": 25, "detail": "2.25\" hail (severe). 29 hail events..." },
    "permitSilence": { "score": 20, "max": 20, "detail": "No roofing permits on record..." },
    "climateStress": { "score": 0, "max": 15, "detail": "No financial stress signals..." },
    "portfolioConcentration": { "score": 15, "max": 15, "detail": "Portfolio: 2993 properties..." }
  }
}
```

### `decision_makers` (on leads)
```json
[{
  "name": "Jane Doe",
  "role": "property_manager",
  "tier": "primary",
  "phone": "(214) 555-1234",
  "email": "jane@example.com",
  "title": "Regional Property Manager",
  "source": "Web Research + TX Comptroller",
  "confidence": 85,
  "combinedScore": 78,
  "titleRelevance": 95
}]
```

### `permit_contractors` (on leads)
```json
[{
  "name": "ABC ROOFING CO",
  "phone": "(972) 555-5678",
  "email": null,
  "address": "123 Main St, Dallas, TX 75201",
  "permitDate": "2019-07-15",
  "permitType": "Building (BU) Commercial Renovation",
  "workDescription": "REROOF - REMOVE AND REPLACE EXISTING ROOF"
}]
```
