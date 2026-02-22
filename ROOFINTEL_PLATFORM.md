# RoofIntel — Commercial Roofing Lead Intelligence Platform

## What It Is

RoofIntel is a B2B SaaS platform built for commercial roofing contractors. It finds, scores, and prioritizes qualified commercial and multi-family roofing leads using public property data, roof age, hail exposure history, and ownership intelligence. The platform is currently focused on the Dallas-Fort Worth (DFW) metro area with a multi-market architecture designed for expansion.

---

## The Problem It Solves

Commercial roofing contractors waste enormous time and money chasing unqualified leads. They drive neighborhoods after storms, cold-call property managers who already replaced their roofs, and miss high-value portfolio owners who control dozens of properties. RoofIntel automates the entire lead discovery, qualification, and prioritization pipeline — turning public data into actionable sales intelligence.

---

## Core Pages

### 1. Dashboard
The command center. At a glance you see:
- Total leads in your market
- Hot leads (score 70+) ready for outreach
- Average lead score across your pipeline
- Total hail events tracked
- Score distribution chart showing pipeline health
- County distribution breakdown
- Top-scoring leads for immediate action

### 2. Leads
A filterable, searchable table of every commercial property in your market. Each lead shows:
- Address, city, county, zoning type
- Building square footage and year built
- Owner name and type (LLC, Corp, Individual)
- Lead score (0-100) with color-coded badges
- Current status (New, Contacted, Qualified, Proposal, Won, Lost)
- Hail exposure count and last hail date

Filters include county, minimum score, zoning type, and status. CSV export is built in with configurable filters.

### 3. Lead Detail
The full intelligence dossier on a single property:
- Complete property information (sqft, year built, construction type, stories, zoning)
- Roof information (type, estimated roof area, last replacement, claim window status)
- Owner and contact information (owner name, type, address, phone, email)
- Decision-maker contacts (managing member, officer names, titles)
- Hail exposure history with event count, last hail date, and max hail size
- Property valuation (improvement value, land value, total value)
- Score breakdown showing exactly how the 0-100 score was calculated
- Status management and notes
- Provenance tracking showing exactly where each piece of intelligence came from

### 4. Portfolios (Relationship Network Agent)
The portfolio discovery engine. This page maps hidden ownership connections across properties:
- Network statistics (total portfolios, linked leads, average portfolio size)
- Portfolio cards showing key owner, property count, total sqft, total value, portfolio score
- Decision-maker contact info (name, title, phone, email)
- Linkage type badges showing how properties are connected
- Expandable detail views showing every property in a portfolio with individual lead scores
- Search across owner names, LLC entities, and registered agents
- Sort by portfolio score, property count, total value, or total roof area
- "Analyze Network" button to trigger fresh portfolio discovery

### 5. Map & Storms
Three tabs in one view:

**Map Tab** — Interactive Leaflet map with:
- Color-coded markers by lead score (green = hot, red = cold)
- Popup detail cards with property info
- Live hail tracker overlay showing NEXRAD radar signatures
- NWS alert polygon overlay
- Xweather threat forecast overlay with color-coded threat polygons and forecast path lines

**Storm Response Tab** — Dual monitoring dashboard:
- NOAA reactive monitoring (confirmed hail events)
- Xweather predictive monitoring (hail forecast 30-60 min ahead)
- Prioritized call queue ranked by distance and ETA to threat

**Alert Settings Tab** — Configure your storm alert preferences

### 6. Admin
Six tabs for data management and system control:

**Property Sources** — Import controls for property data:
- DCAD ArcGIS API automated import (Dallas Central Appraisal District)
- CSV property file upload with auto-column detection
- Sample CSV template download

**Storm Data** — NOAA hail data import:
- Multi-year import from NOAA Storm Events (2020-present)
- Hail-to-lead proximity correlation engine (5-mile radius matching)
- Import history with status tracking

**Contact Enrichment** — Three-stage enrichment pipeline:
- TX Open Data Portal contact lookup (taxpayer IDs, SOS file numbers, filing status)
- Cascading phone enrichment (Google Places, OpenCorporates, Serper web search)
- Web research agent (website scraping for facility managers and decision-makers)
- Enrichment funnel statistics with confidence scoring

**Intelligence** — Advanced owner intelligence:
- 16-agent owner intelligence system
- Relationship Network Agent for portfolio discovery
- Skip trace with provenance tracking

**Roofing Permits** — 10-year permit history:
- Dallas Open Data roofing permit import
- Competitor tracking (who last worked on each roof)
- Permit type classification (Replacement, Repair, Tear-Off, Overlay)

**System** — Background jobs and scheduling

---

## Data Sources

### Property Data
- **DCAD ArcGIS REST API** — Automated commercial property fetching from Dallas Central Appraisal District. Filters by use code 2 (Commercial) with improvement value thresholds. No CSV needed.
- **County Appraisal District CSV** — Manual fallback for importing property data from any county. Auto-detects column mappings for DCAD and generic formats.

### Storm & Hail Data
- **NOAA Storm Events** — Real hail event data from NOAA public CSV files (2020-present). 912+ hail events tracked for the DFW region.
- **NOAA SWDI (Severe Weather Data Inventory)** — Live NEXRAD radar hail signatures for real-time storm tracking.
- **NWS Alerts API** — Active National Weather Service severe weather alerts for Texas.
- **Xweather/Vaisala** — Predictive hail nowcasting using lightning-based analysis. Predicts hail 30-60 minutes before radar detection. Includes threat polygons, forecast paths, ETAs, and pre-storm SMS alerts.

### Contact & Owner Intelligence
- **TX Open Data Portal** — Free taxpayer ID and SOS file number lookup for LLC/Corp entities. No API key required.
- **TX Comptroller PIR (Public Information Reports)** — Real officer and director extraction from Texas Secretary of State corporate filings.
- **Google Places API** — Business phone number lookup and reverse-address property identification.
- **OpenCorporates** — Corporate officer and registered agent discovery.
- **Serper Web Search** — Fallback web search for phone numbers and contact information.
- **Dallas Open Data (Socrata)** — Building permit history including roofing-specific permits.
- **TX Comptroller Sales Tax** — Business identification at property addresses.
- **TCEQ** — Environmental permit records for industrial properties.
- **WHOIS/RDAP** — Domain registration data for businesses with websites.
- **HUD Multifamily Database** — Federal housing records for apartment complexes.
- **BBB Direct** — Better Business Bureau profile lookup.
- **TREC** — Texas Real Estate Commission license lookup.
- **TDLR** — Texas Department of Licensing and Regulation records.

---

## Intelligence Systems

### Lead Scoring (v3) — 0 to 100 Points

Every lead is scored across 10 factors optimized for roofing contractors:

| Factor | Max Points | How It Works |
|--------|-----------|--------------|
| Roof Age | 20 | 2 points per year since last replacement. 10 default if unknown. |
| Hail Exposure | 15 | 5 points per documented hail event. |
| Storm Recency | 15 | 15 if hail within 30 days, scales down to 1 if over 2 years. |
| Roof Area (Job Size) | 15 | Based on estimated roof sqft (building sqft / stories). |
| Contactability | 10 | 4 for phone, 3 for email, 3 for named decision-maker. |
| Owner Type | 8 | LLC: 8, Corp: 6, Other: 2. |
| Property Value | 7 | Scaled by total assessed value. |
| Distress Signals | 5 | Tax delinquency, liens, violations, foreclosure flags. |
| Flood Risk | 3 | FEMA flood zone designation. |
| Property Condition | 2 | Based on violation history and open violations. |

### 16-Agent Owner Intelligence System

A coordinated intelligence pipeline that extracts real people and contact information from public records:

1. **TX SOS Deep** — Officers and members from TX Comptroller PIR detail API
2. **LLC Chain** — Multi-level entity tracing through parent/child LLC relationships
3. **TX Comptroller** — Responsible parties from state tax records
4. **Property Tax Records** — Care-of contacts from county tax records
5. **People Search** — Web-based person lookup (requires Serper API key)
6. **Email Discovery** — Email extraction from business websites
7. **Google Business** — Google Places business identification at property address
8. **Court Records** — Legal filing search (requires Serper API key)
9. **TREC License** — Texas Real Estate Commission license lookup
10. **TDLR License** — TX Dept of Licensing property manager/contractor licenses
11. **HUD Multifamily** — Federal housing database for apartment complexes
12. **BBB Direct** — Better Business Bureau profile and rating lookup
13. **Google Places Enhanced** — Reverse-address lookup for tenant/occupant identification
14. **Building Contacts** — Aggregated contacts discovered at the property address
15. **Skip Trace** — 7-source official-records-first lookup (building permits, sales tax, OpenCorporates, TCEQ, WHOIS, email pattern generation, reverse address)
16. **Master Orchestrator** — Coordinates all agents and produces final intelligence score

### Relationship Network Agent

The portfolio discovery system that maps ownership connections across properties:

**How it works:**
1. Loads all leads in the market (14,000+ in DFW)
2. Indexes every lead by owner name, LLC name, registered agent, managing member, taxpayer ID, and SOS file number
3. Extracts additional entities from LLC chain data (officers, parent entities, registered agents)
4. Clusters leads that share any identifier using exact matching
5. Runs fuzzy name matching (80% similarity threshold) with prefix-bucketed optimization
6. Merges overlapping clusters into unified portfolios
7. Scores each portfolio (0-100) based on property count, roof area, lead scores, hail exposure, claim windows, and contact quality
8. Extracts the best decision-maker contact for each portfolio

**Linkage strategies:**
- Same owner name (exact and fuzzy)
- Same taxpayer ID
- Same SOS file number
- LLC chain entity match (shared officers, parent entities)
- Same registered agent
- Same managing member

**Results in DFW:** 1,334 portfolios discovered linking 4,253 properties out of 14,091 total leads (~30% of all properties belong to multi-property portfolios).

### Contact Enrichment Pipeline

A three-stage pipeline that progressively enriches lead contact data:

1. **Stage 1: TX Filing Lookup** — Free lookup of LLC/Corp entities through TX Open Data Portal. Finds taxpayer IDs, SOS file numbers, and filing status.
2. **Stage 2: Phone Enrichment** — Cascading phone lookup using Google Places API, OpenCorporates, and Serper web search. Stops at first match to minimize API costs.
3. **Stage 3: Web Research** — Scans business websites to find facility managers, property managers, and decision-makers with their direct phone numbers and emails.

Each contact is assigned a confidence score based on source reliability and data completeness.

### Roofing Permit History

10-year lookback into Dallas Open Data building permits:
- Identifies properties with recent roofing work
- Extracts contractor names (competitor intelligence)
- Classifies permit types: Replacement, Repair, Tear-Off/Replace, Overlay, Inspection
- Estimates roof type from permit descriptions (TPO, EPDM, Modified Bitumen, Built-Up, Metal, Shingle, Flat)

---

## Predictive Storm Monitoring

### Reactive Monitoring (NOAA)
- Polls NOAA SWDI every 10 minutes for live NEXRAD radar hail signatures
- Monitors NWS Alerts API for active severe weather warnings
- Generates swath polygons for confirmed hail paths

### Predictive Monitoring (Xweather/Vaisala)
- Polls Xweather /hail/threats API every 2 minutes
- Uses lightning-based analysis to predict hail 30-60 minutes before radar detection
- Parses threat polygons with severity levels
- Calculates ETAs to affected properties
- Can trigger pre-storm SMS alerts to contractors

### Storm Response
- Dual monitoring dashboard combining reactive and predictive data
- Prioritized call queue ranking affected properties by distance and ETA
- Color-coded threat overlays on the interactive map

---

## Technical Architecture

### Stack
- **Frontend**: React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet
- **Backend**: Express.js, Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: Wouter (frontend), Express (backend)
- **State Management**: TanStack React Query

### Key Technical Details
- Market-scoped architecture supporting multi-region expansion
- Source deduplication using sourceType/sourceId pairs
- Background job scheduler for automated NOAA sync and score recalculation (4-hour intervals)
- Provenance tracking (intelligenceClaims table) for audit trail on all intelligence findings
- Contact confidence scoring system
- Hail-to-lead proximity matching engine (configurable radius, default 5 miles)
- Fuzzy name matching with prefix-bucketed optimization for 14,000+ lead datasets
- Portfolio scoring algorithm with weighted multi-factor analysis
- Insurance claim window tracking (2-year statute of limitations)
- Estimated roof area calculation (building sqft / stories)

### Design
- Apple/Steve Jobs-inspired minimal aesthetic (2026 redesign)
- Professional blue/slate B2B color scheme
- Dark sidebar navigation with light/dark mode toggle
- Inter font family
- Responsive layout with Shadcn sidebar component
- Clean typography and purposeful spacing

---

## Current State (February 2026)

### DFW Market Data
- **14,091** commercial and multi-family properties imported from DCAD
- **912+** NOAA hail events tracked (2020-present)
- **1,334** ownership portfolios discovered
- **4,253** leads linked into multi-property portfolios
- Contact enrichment pipeline operational across all three stages
- 16-agent intelligence system fully functional
- Roofing permit history imported and matched

### What Makes It Different
1. **Portfolio discovery** — Most CRMs treat each property as isolated. RoofIntel maps the ownership network so one relationship can unlock 5, 10, or 50 roofing jobs.
2. **Predictive hail** — Not just tracking where hail has been, but predicting where it's going 30-60 minutes before radar sees it.
3. **Free-first data strategy** — The platform maximizes use of free public data sources (TX Comptroller, NOAA, DCAD, HUD) before falling back to paid APIs.
4. **Provenance tracking** — Every piece of intelligence has a source URL, confidence score, and retrieval timestamp. You know exactly where the data came from.
5. **Roofing-specific scoring** — The lead scoring algorithm is purpose-built for commercial roofing, weighting roof age, job size, hail exposure, and insurance claim windows.
