# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
A SaaS platform for roofing contractors to find and prioritize qualified commercial/multi-family leads using public property data, roof age, and hail exposure history. Focused on the DFW (Dallas-Fort Worth) region with multi-market architecture for expansion.

## Tech Stack
- **Frontend**: React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet
- **Backend**: Express.js, Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: Wouter (frontend), Express (backend)
- **State Management**: TanStack React Query
- **File Upload**: Multer (CSV property data uploads)

## Architecture
- `client/src/pages/` - Page components (dashboard, leads, lead-detail, map-view, hail-events, export, data-management, owner-intelligence, storm-response, alert-config)
- `client/src/components/` - Shared components (app-sidebar, score-badge, status-badge, theme-provider, theme-toggle)
- `server/routes.ts` - API endpoints
- `server/storage.ts` - Database storage layer with Drizzle ORM
- `server/seed.ts` - Market setup and calculateScore function (no fake data)
- `server/noaa-importer.ts` - Real NOAA Storm Events hail data importer
- `server/dcad-agent.ts` - DCAD ArcGIS REST API property fetcher (automated, no CSV needed)
- `server/hail-correlator.ts` - Proximity-based hail-to-lead matching engine
- `server/property-importer.ts` - County appraisal district CSV property importer (manual fallback)
- `server/contact-enrichment.ts` - TX Open Data Portal contact enrichment agent (taxpayer IDs, SOS file numbers, filing status)
- `server/phone-enrichment.ts` - Cascading phone number enrichment (Google Places → OpenCorporates → Serper web search)
- `server/web-research-agent.ts` - Web research agent: finds business websites via Google Places, scrapes contact/team pages for facility managers and decision-makers, extracts phone/email, optional Serper web search fallback
- `server/enrichment-pipeline.ts` - Unified 3-stage enrichment pipeline with contact confidence scoring
- `server/storm-monitor.ts` - Real-time NOAA SWDI hail radar + NWS alerts monitor with swath polygon generation
- `server/xweather-hail.ts` - Xweather/Vaisala predictive hail service: polls /hail/threats API every 2 min, parses threat polygons, calculates ETAs, triggers pre-storm SMS alerts
- `server/hail-tracker.ts` - Live hail radar tracker (NOAA SWDI nx3hail + NWS Alerts API for DFW region)
- `server/owner-intelligence.ts` - 12-agent owner intelligence system using TX Comptroller PIR detail API for real officer extraction (TX SOS Deep, LLC Chain, TX Comptroller, Property Tax, People Search, Email Discovery, Google Business, Court Records, Social Intelligence, Building Contacts, Skip Trace, Master Orchestrator)
- `server/skip-trace-agent.ts` - Skip Trace Agent: 7 free official-records-first lookups (DFW building permits via Socrata, TX Comptroller sales tax, OpenCorporates officers, TCEQ environmental permits, WHOIS/RDAP, email pattern generation with MX verification, reverse address cross-reference)
- `server/job-scheduler.ts` - Background job scheduler (NOAA sync, score recalc)
- `shared/schema.ts` - Drizzle schema definitions and Zod validation (includes intelligenceClaims table for provenance tracking)

## Key Features
- **Dashboard**: Stats overview (total leads, hot leads, avg score, hail events), score distribution chart, county distribution pie chart, top scoring leads
- **Leads List**: Filterable/searchable lead table with score badges, status badges, filters by county/score/zoning/status
- **Lead Detail**: Full property info, hail exposure data, valuation, owner/contact info, status management, notes, score breakdown
- **Map View**: Interactive Leaflet map with color-coded markers by lead score, popup detail cards, live hail tracker overlay (NEXRAD radar signatures + NWS alert polygons), Xweather threat forecast overlay (color-coded polygons, forecast path lines)
- **Hail Events**: Grid of tracked NOAA storm events with severity badges, event count display
- **Export**: CSV export with configurable filters
- **Data Management**: Import controls for NOAA hail data, property CSV upload, contact enrichment, phone enrichment, background job monitoring, import history
- **Contact Enrichment**: TX Open Data Portal-based owner lookup for LLC/Corp entities - finds taxpayer IDs, SOS file numbers, filing status (free, no API key)
- **Phone Enrichment**: Cascading phone number lookup using Google Places API, OpenCorporates, and Serper web search - stops at first match to minimize cost
- **Web Research Agent**: Scans business websites to find facility managers, property managers, and decision-makers with their phone numbers and emails
- **Predictive Hail Monitoring**: Xweather/Vaisala lightning-based nowcasting predicts hail 30-60 min before radar detection, with threat polygons, forecast paths, ETAs, and pre-storm SMS alerts
- **Storm Response Dashboard**: Dual monitoring (NOAA reactive + Xweather predictive), prioritized call queue with distance/ETA ranking

## Data Sources
- **NOAA Storm Events**: Real hail event data fetched from NOAA's public CSV files (2020-present), 912+ events for DFW region
- **DCAD ArcGIS API**: Automated commercial property fetching from Dallas Central Appraisal District REST API (maps.dcad.org), filters by use code 2 (Commercial) with improvement value thresholds
- **Hail-to-Lead Correlation**: Proximity matching engine (5-mile radius) that links hail events to nearby properties and updates lead scores
- **Property CSV Import**: Upload county appraisal district CSV files with auto-column detection, supports DCAD and generic formats (manual fallback)
- **Background Jobs**: Automated NOAA sync and lead score recalculation on 4-hour intervals

## Data Model
- `markets` table: Market regions (name, state, counties, center coords, radius)
- `leads` table: Property details (address, sqft, year built, zoning), roof info, owner info, hail exposure, lead score, status, sourceType/sourceId for deduplication
- `hail_events` table: Storm event records with NOAA event IDs for deduplication
- `data_sources` table: Configured data source connections
- `import_runs` table: Import history with status, counts, timestamps
- `jobs` table: Background job definitions and scheduling
- `intelligence_claims` table: Provenance tracking for skip trace findings (leadId, agentName, fieldName, fieldValue, sourceUrl, confidence, parsingMethod, licenseFlag, retrievedAt)

## API Endpoints
- `GET /api/markets` - List markets
- `GET /api/dashboard/stats` - Dashboard statistics (optional marketId filter)
- `GET /api/leads` - List leads with query filters (search, county, minScore, zoning, status, marketId)
- `GET /api/leads/:id` - Single lead detail
- `PATCH /api/leads/:id` - Update lead status/notes
- `GET /api/leads/export` - CSV export with filters
- `GET /api/hail-events` - List hail events (optional marketId filter)
- `POST /api/import/noaa` - Trigger NOAA hail data import (marketId, startYear, endYear)
- `POST /api/import/dcad` - Trigger DCAD property import (marketId, minImpValue, maxRecords)
- `POST /api/correlate/hail` - Run hail-to-lead proximity matching (marketId, radiusMiles)
- `POST /api/import/property-csv` - Upload property CSV file (multipart form: file, marketId, minSqft)
- `GET /api/import/sample-csv` - Download sample property CSV template
- `GET /api/import/runs` - List import history
- `GET /api/data-sources` - List configured data sources
- `GET /api/jobs` - List background jobs
- `GET /api/enrichment/status` - Check contact enrichment status
- `POST /api/enrichment/contacts` - Trigger TX Open Data Portal contact enrichment (marketId, batchSize)
- `GET /api/enrichment/phone-status` - Check phone enrichment provider availability
- `POST /api/enrichment/phones` - Trigger cascading phone number enrichment (marketId, batchSize)
- `GET /api/enrichment/web-research-status` - Check web research agent status/capabilities
- `POST /api/enrichment/web-research` - Trigger web research agent (marketId, batchSize)
- `GET /api/enrichment/pipeline-stats` - Contact enrichment funnel stats with confidence scores
- `POST /api/enrichment/run-pipeline` - Run full 3-stage enrichment pipeline (TX Filing -> Phone -> Web Research)
- `GET /api/leads/:id/confidence` - Contact confidence score and factors for a lead
- `GET /api/hail-tracker` - Live radar hail detections + active NWS alerts (query: daysBack)
- `POST /api/jobs/:id/run` - Trigger a background job
- `GET /api/xweather/status` - Xweather predictive monitor status (running, configured, activeThreats)
- `GET /api/xweather/threats` - Active hail threat polygons with affected leads and ETAs
- `POST /api/xweather/scan` - Trigger manual Xweather prediction scan
- `POST /api/xweather/monitor/start` - Start Xweather polling (2-minute interval)
- `POST /api/xweather/monitor/stop` - Stop Xweather polling
- `GET /api/leads/:id/claims` - Provenance claims for a lead (skip trace source evidence)
- `GET /api/intelligence/skip-trace-status` - Skip Trace agent source availability

## Lead Scoring (0-100)
- Roof age: up to 30 points (2 pts per year since last replacement, 15 pts default if unknown)
- Hail exposure: up to 25 points (8 pts per event)
- Building size: up to 20 points (>=10k sqft: 20, >=5k: 15, >=2.5k: 10)
- Owner type: up to 15 points (LLC: 15, Corp: 10, Other: 5)
- Property value: up to 10 points

## Design
- Professional blue/slate B2B color scheme
- Dark sidebar navigation with light/dark mode toggle
- Inter font family
- Responsive layout with Shadcn sidebar component
- NOAA Live badge in sidebar footer
