# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
RoofIntel is a SaaS platform designed for roofing contractors to efficiently identify and prioritize qualified commercial and multi-family leads. It leverages public property data, roof age, and historical hail exposure to provide actionable intelligence. The platform currently focuses on the DFW (Dallas-Fort Worth) region but is built with a multi-market architecture for future expansion. Its core purpose is to streamline lead generation and qualification for roofing businesses, enhancing their market potential and operational efficiency.

## User Preferences
I prefer clear, concise explanations and direct answers. For development, I favor an iterative approach with frequent, small commits. Please ask for confirmation before implementing significant architectural changes or adding new external dependencies. When proposing solutions, prioritize scalability and maintainability.

## System Architecture
RoofIntel employs a modern web architecture with a clear separation of concerns.

**UI/UX Decisions:**
- A professional blue/slate B2B color scheme
- Dark sidebar navigation with a light/dark mode toggle
- Utilizes the Inter font family for readability
- Responsive layout achieved with Shadcn/UI components
- An interactive Leaflet map for lead visualization, including color-coded markers by lead score, popup detail cards, and overlays for live hail tracking (NEXRAD radar + NWS alerts) and Xweather predictive hail threats.

**Technical Implementations:**
- **Frontend**: React + TypeScript, Vite for fast development, TailwindCSS for styling, Shadcn/UI for components, Recharts for data visualization, and React-Leaflet for mapping. Wouter is used for frontend routing.
- **Backend**: Express.js with Node.js for API services.
- **Database**: PostgreSQL managed with Drizzle ORM.
- **Data Management**: Multer handles CSV property data uploads. TanStack React Query manages client-side data fetching and state.
- **Core Agents & Services**:
    - `dcad-agent`: Automated property fetching from Dallas Central Appraisal District (DCAD) ArcGIS REST API.
    - `hail-correlator`: Proximity-based engine to match hail events to leads and update scores.
    - `enrichment-pipeline`: A unified 3-stage pipeline (TX Open Data Portal, Phone, Web Research) for contact enrichment with confidence scoring.
    - `storm-monitor` & `xweather-hail`: Real-time NOAA SWDI hail radar monitoring and predictive hail threat forecasting from Xweather/Vaisala, including pre-storm SMS alerts.
    - `owner-intelligence` & `network-agent`: Comprehensive system for identifying property owners, resolving entities, discovering ownership portfolios, and linking LLC chains.
    - `entity-resolution`: Deterministic and probabilistic matching for lead deduplication and clustering.
    - `management-attribution` & `role-inference`: Engines to differentiate property managers from owners and rank decision-makers.
    - `reverse-address-enrichment`: Compares owner mailing vs property addresses, queries Google Places API to identify management companies, law firms, title companies, or corporate offices at the mailing address. Feeds discoveries into management attribution pipeline.
    - `compliance-gate`: Manages opt-outs, consent, and DNC checks.
    - `dm-confidence`: A 7-factor weighted formula for contact confidence scoring.
    - `lead-enrichment-orchestrator`: On-demand single-lead enrichment that auto-triggers all agents (owner intelligence, reverse address, building tenant/manager discovery, management attribution, role inference, confidence scoring, skip trace, phone enrichment) when a lead is first viewed or manually re-enriched.
    - `tad-agent`: Automated property fetching from Tarrant Appraisal District (TAD) ArcGIS REST API for Fort Worth area commercial properties.
    - `collin-cad-agent`: Automated property fetching from Collin CAD ArcGIS API for Plano/Frisco/McKinney area.
    - `denton-cad-agent`: Automated property fetching from Denton CAD FeatureServer for Denton/Lewisville/Flower Mound area.
    - `skip-trace-agent`: Multi-source skip trace combining building permits, sales tax permits, TCEQ, WHOIS, reverse address, and email pattern discovery.
    - `ownership-classifier`: Classifies leads into 4 ownership structure buckets (small_private, investment_firm, institutional_reit, third_party_managed) using entity patterns, LLC chain depth, mailing address type, portfolio size, and property value. Computes title relevance scores per structure and selects Primary/Secondary/Operational decision makers with fallback logic.
    - `job-scheduler`: Background job management for tasks like NOAA sync and score recalculation.
    - `evidence-recorder`: Batch evidence recording with source trust scoring, corroboration counting, conflict detection, and auto-resolution (15-point margin threshold). Records contact evidence from all 16 agents.
    - `contact-validation`: E.164 phone normalization, MX-based email domain validation, phone structure validation (TX area codes, toll-free, invalid patterns), email syntax validation with disposable domain detection.
    - `source-policy`: Compliance module with robots.txt checking, per-domain rate limiting (in-memory), blocked domain list (social media, people search sites), proper User-Agent header, and database-backed blocklist integration.
    - `source-trust`: Trust configuration for 30+ data sources (DCAD: 95, TX Comptroller: 92, Google Places: 75, etc.) with type and category classification.
- **Lead Scoring (v3)**: A refined scoring algorithm (0-100) optimized for roofing contractors, incorporating roof age, hail exposure, storm recency, roof area, contactability, owner type, property value, distress signals, flood risk, and property condition.

**Feature Specifications:**
- **Dashboard**: Provides key statistics, score distribution, and top-scoring leads.
- **Leads Management**: Filterable and searchable leads list, detailed lead view with property, owner, hail, and contact info.
- **Map & Storms**: Interactive map view, live hail tracker, and predictive hail threat visualization.
- **Data Imports**: Support for NOAA hail data, DCAD properties, Tarrant CAD, Collin CAD, Denton CAD, and generic property CSVs. Full DFW 4-county coverage.
- **Data Coverage Dashboard**: Admin tab showing real-time data completeness metrics — coverage bars for owner names, phones, emails, contacts, websites, managing members, taxpayer IDs, SOS numbers. Phone/evidence source breakdowns.
- **Contact & Phone Enrichment**: Two-tier enrichment architecture — **free agents auto-run** (TX SOS, LLC Chain, TX Comptroller, Property Tax, Email Discovery, TREC, TDLR, HUD, BBB, Skip Trace, free phone providers) and **paid APIs are manual-only buttons** (Google Places, Serper, Hunter.io 25/mo, PDL 100/mo). `enrichLead()` defaults to `skipPaidApis=true`. Batch free enrichment processes all unenriched leads via `/api/enrichment/batch-free`.
- **Enrichment Credits Dashboard**: Admin page shows real-time API credit usage for all paid APIs with "Manual Only" labels, progress bars, remaining counts, monthly reset countdown, and enrichment summary (free enriched count, paid API usage). Lead detail page has separate manual enrich buttons for Google Places, Serper, Hunter.io, and PDL showing remaining credits.
- **Web Research Agent**: Scans business websites to identify decision-makers and their contact details.
- **Relationship Network Agent**: Discovers and scores property portfolios by linking ownership connections.
- **Predictive Hail Monitoring**: Integrates Xweather for advanced hail threat forecasting and alerts.
- **Decision-Maker Discovery (Layer 3)**: Ownership structure classification (4 buckets: Small Private Owner, Real Estate Investment Firm, Institutional/REIT, Third-Party Managed), title relevance scoring weighted by structure type, multi-contact strategy (Primary/Secondary/Operational decision makers per property), management attribution (manager vs owner separation), role inference & ranking (8 role types with authority scoring), compliance gating (opt-out/consent/DNC), decomposed confidence scoring (7-factor formula with auto-publish/review/suppress tiers), human-in-the-loop review console
- **Reverse Address Enrichment**: Automatic mailing-vs-property address comparison with Google Places lookup to discover management companies, law firms, title companies, and corporate offices at owner mailing addresses
- **Admin**: Centralized management for property sources, storm data, contact enrichment, and system settings.

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **NOAA (National Oceanic and Atmospheric Administration)**: Source for historical hail event data (public CSVs) and real-time SWDI radar data.
- **Dallas Central Appraisal District (DCAD) ArcGIS API**: Used for automated commercial property data fetching.
- **Xweather/Vaisala**: Provides predictive hail threat data and APIs for nowcasting and alerts.
- **Google Places API**: Used for cascading phone number enrichment and enhanced reverse-address lookups.
- **OpenCorporates**: Integrated for additional phone number enrichment and corporate entity data.
- **Serper Web Search API**: Utilized as a fallback for phone number enrichment and general web research.
- **TX Open Data Portal**: Source for contact enrichment, including taxpayer IDs and SOS file numbers for Texas entities.
- **Texas Comptroller Public Information Request (PIR) API**: Used by the owner intelligence system for officer extraction.
- **Socrata API**: Accessed for DFW building permits in the skip trace agent.
- **Hunter.io**: Email discovery API for finding email addresses by domain (free tier: 25 searches/month). Manual-only with usage tracking.
- **People Data Labs (PDL)**: Person and company enrichment API for finding emails, phones, titles, and LinkedIn profiles (free tier: 100 matches/month). Manual-only with usage tracking.
- **SEC EDGAR**: Free SEC filing API (`data.sec.gov/submissions/`) for looking up REIT and institutional owner details — company name, phone, address, SIC classification, and filing history. No API key required.
- **TX Secretary of State (via Comptroller API)**: Officer/director extraction for Texas LLCs and corporations using SOS file numbers and taxpayer IDs. Pulls registered agents, formation dates, and entity types.
- **County Clerk Recording Data**: Deed record search for DFW counties (Dallas, Tarrant, Collin, Denton) via available public data portals. Identifies property transfers, grantors/grantees, and instrument types.
- **EmailMX verification services**: Integrated for validating email patterns.
- **Various public record APIs/databases**: Including TREC (Texas Real Estate Commission) license, TDLR (Texas Department of Licensing and Regulation) license, HUD multifamily database, BBB (Better Business Bureau) Direct, and WHOIS/RDAP for comprehensive owner and contact intelligence.