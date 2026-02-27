# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
RoofIntel is a SaaS platform designed for roofing contractors to identify and prioritize qualified commercial and multi-family leads. It integrates public property data, roof age, and historical hail exposure to provide actionable intelligence. Initially focused on the DFW 4-county region, the platform is built for multi-market expansion through a config-driven architecture. Its core purpose is to enhance lead generation, qualification, and market potential for roofing businesses, strictly adhering to the use of real, verified data from public sources and government APIs. The business vision is to become a leading intelligence platform for the commercial roofing industry, enabling contractors to efficiently target high-potential properties.

## User Preferences
I prefer clear, concise explanations and direct answers. For development, I favor an iterative approach with frequent, small commits. Please ask for confirmation before implementing significant architectural changes or adding new external dependencies. When proposing solutions, prioritize scalability and maintainability.

## System Architecture
RoofIntel employs a modern web architecture emphasizing separation of concerns and data integrity.

### UI/UX Decisions
The user interface features a professional B2B color scheme (blue/slate), dark sidebar navigation with light/dark mode toggle, and the Inter font family for readability. It utilizes responsive Shadcn/UI components and an interactive Leaflet map for lead visualization, including color-coded markers, detailed popups, live hail tracking, and predictive hail threats. Data quality is indicated by confidence badges on lead pages and a summary card on the dashboard.

### Technical Implementations
- **Frontend**: Developed with React, TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet, Wouter for routing, and react-helmet-async for SEO.
- **Backend**: Implemented using Express.js with Node.js.
- **Database**: PostgreSQL is used with Drizzle ORM for data management.
- **Data Management**: Multer handles CSV uploads, and TanStack React Query manages client-side data.

### Core Agents & Services
- **Property Data Agents**: Automated fetching from Central Appraisal Districts (CADs) ArcGIS APIs via a generic, config-driven ArcGIS Importer.
- **Hail Correlation & Monitoring**: Proximity-based hail event matching, real-time NOAA SWDI radar, and Xweather predictive hail threat forecasting.
- **Owner Intelligence & Decision-Maker Discovery**: Identifies property owners, resolves entities, discovers ownership portfolios, links LLC chains, and classifies ownership structures to infer and assign primary/secondary decision-makers with compliance checks.
- **Enrichment Pipeline**: A 3-stage pipeline (TX Open Data Portal, Phone, Web Research) for contact enrichment with confidence scoring.
- **Contact Validation**: Centralized validation logic (`isPersonName()` function, E.164 phone normalization, MX-based email validation, disposable domain detection) ensures high data quality.
- **Batch Google Places Phone Lookup**: Batch processes leads to find published phone numbers from Google Places, with an admin UI for management.
- **Evidence Management**: Records and corroborates contact evidence from various sources, assigning trust scores and validation statuses (VERIFIED, CORROBORATED, FORMAT_VALID, UNVERIFIED).
- **DM Confidence Scoring**: Recalibrated thresholds and an "insufficient_data" tier for leads lacking sufficient enrichment signals.
- **Reverse Address Enrichment**: Uses Google Places API to identify management companies and corporate offices via mailing addresses.
- **GIS Roof Intelligence**: Utilizes OpenStreetMap Overpass API for building footprints, computes roof area, and integrates satellite imagery with roof age/material/type.
- **NAIP Roof Change Detection**: Fetches USDA NAIP aerial imagery (2012–2022) via Microsoft Planetary Computer STAC API. Computes per-year color statistics (brightness, R/G/B, uniformity) using `sharp`. Detects roof replacement events by analyzing brightness/color transitions between capture years (e.g., dark→white = BUR→TPO). High-confidence detections (≥70%) update `roofLastReplaced` with source "naip_change_detection". Tables: `naip_roof_snapshots`, `naip_roof_changes`. Files: `server/naip-imagery-agent.ts`, `server/roof-change-detector.ts`.
- **Lead Scoring (v3)**: An advanced algorithm incorporating various property and contact attributes for a comprehensive lead score (0-100).
- **Pipeline Orchestrator**: Manages a 9-phase automated data processing pipeline with configurable filtering and progress tracking.
- **Batch Reprocess**: Admin endpoint to re-run ownership classification, management attribution, role inference, and confidence scoring.
- **AI Data Agent (Claude Haiku-powered)**:
    - **Audit Mode**: Analyzes owner names, identifies entity types, and actionable next steps.
    - **Web Search Mode**: Generates investigation queries, scrapes websites, and validates contact data.
    - **Contractor Scrub Mode**: Identifies and corrects incorrectly stored contractor names.
    - **Website Extract Mode**: Extracts contacts from business websites for leads with missing contact info.
    - **Portfolio Detection Mode**: Identifies and analyzes owners with multiple properties.
    - **Stale Data Detection Mode**: SQL-based analysis for outdated or questionable data.
    - Includes post-batch entity resolution for duplicate detection and an admin UI for managing AI operations.
- **Property Data Enrichment Agent**: Fills data gaps across 16,691+ leads by fixing CAD field mappings (16 new columns: land_acreage, land_sqft, subdivision_name, previous_market_value, school_district, tax_district, deed_instrument, second_owner, owner_percentage, tax_exemptions, effective_year_built, property_use_description, parcel_area_sqft, dba_name, last_appraisal_date, cad_last_updated) and web-searching public sources (county assessor sites via Serper, CIMLS.com, OpenStreetMap building metadata). Includes CAD re-import endpoint to backfill existing leads without overwriting enrichments. Admin UI with data gap summary, CAD re-import controls, and web property scanner controls. Files: `server/property-data-scanner.ts`, `server/cad-reimport.ts`. Endpoints: `GET /api/admin/property-scan/gaps`, `POST /api/admin/property-scan/run`, `GET /api/admin/property-scan/status`, `GET /api/admin/property-scan/results`, `POST /api/admin/cad/reimport`, `GET /api/admin/cad/reimport/status`.
- **CAD Agent Field Mapping Fixes**: All 4 CAD agents (DCAD, TAD, Collin, Denton) updated to collect 15+ previously ignored fields. Fixed year_built defaulting: DCAD's `RESYRBLT` is residential-only (now accepts null for commercial instead of defaulting to 1995). TAD/Collin/Denton now preserve null when year_built is unknown (no longer default to 1900/1995).
- **PropStream CSV Import**: Enrichment importer (`server/propstream-importer.ts`) that parses PropStream CSV exports, auto-detects column headers, matches rows to existing leads by normalized address, and fills only null/sentinel fields. Supports year_built, last sale date, lot size, school district, subdivision, land use, and more. Admin UI card with upload, progress tracking, and per-field enrichment stats. Endpoints: `POST /api/import/propstream-csv`, `GET /api/import/propstream-csv/status`.
- **Compliance & SEO**: Implements robots.txt, rate limiting, blocked domain lists, security headers, dynamic sitemaps, and content for E-E-A-T and legal compliance.

### Multi-Market Architecture
The platform supports multi-market expansion through a `markets` table with hierarchical fields and a `market_data_sources` table that maps markets to configurable data sources (e.g., `cad_arcgis`, `permits_socrata`) via field mapping and filter configurations. New markets can be onboarded by adding configuration rows without requiring new code.

### Normalized Satellite Tables (Data Model v2)
The monolithic `leads` table (~115 columns) is being decomposed into 5 domain-specific satellite tables using an additive, non-breaking migration approach:
- **`property_roof`**: Roof type, material, age, area, permit data, risk index/breakdown. Unique on `property_id`.
- **`property_owner`**: Owner identity, LLC chain, registered agent, officer, managing member, ownership structure/signals. Unique on `property_id`.
- **`property_risk_signals`**: Hail events, flood zone, liens, foreclosure, violations, permits, distress score. Unique on `property_id`.
- **`property_contacts`**: Contact info, role inference, DM confidence, decision makers, management company, reverse address data. Unique on `property_id`.
- **`property_intelligence`**: Owner intelligence JSONB, intelligence score/sources, building contacts, business info. Unique on `property_id`.
- **`data_quality_metrics`**: Periodic snapshots of quality metrics per market.

All tables have `market_id` for multi-market support, `source` for data provenance, and `updated_at` timestamps. A **dual-write pattern** (`server/dual-write.ts`) ensures writes propagate to both the leads table and appropriate satellite tables during the transition period. The migration (`POST /api/admin/migrate/normalize`) populates satellite tables from existing leads data.

Key endpoints: `GET /api/admin/normalize/stats`, `GET /api/admin/migrate/status`, `GET /api/leads/:id/satellite`, `GET /api/markets/:id/readiness`, `POST /api/admin/quality/snapshot`, `GET /api/admin/quality/history`.

### Data Quality System
Each lead has a computed `dataConfidence` (High, Medium, Low) based on multiple indicators. A quality summary endpoint and dashboard card provide metrics on data quality tiers, key metrics, and identified data gaps. Admin endpoints are available for cleanup and backfilling evidence verification. Market readiness scores (0-100) are computed from weighted field coverage metrics.

### Feature Specifications
Key features include a comprehensive **Dashboard**, filterable **Leads & Lead Detail** pages with extensive property and contact intelligence, an interactive **Map & Storms** view, **Portfolios & Network Explorer** for relationship visualization, **Data Management** tools, and an **Admin** interface for system control. A **Contractors Directory** provides a searchable list of contractors from permit records, and all data can be **Exported** to CSV.

## External Dependencies
- **PostgreSQL**: Primary database.
- **NOAA (National Oceanic and Atmospheric Administration)**: Historical and real-time hail data.
- **Dallas, Tarrant, Collin, Denton Central Appraisal Districts (CADs) ArcGIS APIs**: Commercial property data.
- **Xweather/Vaisala**: Predictive hail threat data.
- **Google Places API**: Phone enrichment, reverse-address lookups.
- **OpenCorporates**: Additional phone enrichment and corporate entity data.
- **Serper Web Search API**: Web research.
- **TX Open Data Portal**: Contact enrichment.
- **Texas Comptroller Public Information Request (PIR) API**: Officer extraction.
- **Socrata API**: Dallas building permits.
- **Fort Worth ArcGIS FeatureServer**: Building permits.
- **Hunter.io**: Email discovery.
- **People Data Labs (PDL)**: Person/company enrichment.
- **SEC EDGAR**: REIT and institutional owner details.
- **TX Secretary of State (via Comptroller API)**: Entity details, registered agents.
- **County Clerk Recording Data**: Deed record search for DFW counties.
- **FEMA Flood Zone API**: Flood risk assessment.
- **OpenStreetMap Overpass API**: Building footprint polygons.
- **Esri World Imagery**: Satellite imagery.
- **Microsoft Planetary Computer STAC API**: NAIP aerial imagery (2012–2022) for roof change detection.
- **EmailMX verification services**: Email validation.
- **Various public record APIs/databases**: Including TREC, TDLR, HUD, BBB, WHOIS/RDAP.