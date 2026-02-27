# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
RoofIntel is a SaaS platform designed to empower roofing contractors by providing actionable intelligence for identifying and prioritizing qualified commercial and multi-family leads. It integrates public property data, roof age, and historical hail exposure, initially focusing on the DFW 4-county region with a config-driven architecture for multi-market expansion. The platform's core purpose is to enhance lead generation, qualification, and market potential for roofing businesses by leveraging real, verified public data sources. The business vision is to become the leading intelligence platform in the commercial roofing industry, enabling efficient targeting of high-potential properties.

## User Preferences
I prefer clear, concise explanations and direct answers. For development, I favor an iterative approach with frequent, small commits. Please ask for confirmation before implementing significant architectural changes or adding new external dependencies. When proposing solutions, prioritize scalability and maintainability.

## System Architecture
RoofIntel employs a modern web architecture focused on separation of concerns and data integrity, designed for scalability and multi-market support.

### UI/UX Decisions
The user interface features a professional B2B color scheme (blue/slate), dark sidebar navigation with light/dark mode, and the Inter font family. It uses responsive Shadcn/UI components and an interactive Leaflet map for lead visualization, including color-coded markers, detailed popups, live hail tracking, and predictive hail threats. Data quality is indicated by confidence badges and dashboard summary cards.

### Technical Implementations
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet, Wouter, react-helmet-async.
- **Backend**: Express.js with Node.js.
- **Database**: PostgreSQL with Drizzle ORM.
- **Data Management**: Multer for CSV uploads, TanStack React Query for client-side data.

### Core Agents & Services
- **Property Data Agents**: Automated fetching from Central Appraisal Districts (CADs) ArcGIS APIs via a config-driven ArcGIS Importer.
- **Hail Correlation & Monitoring**: Proximity-based hail event matching, real-time NOAA SWDI radar, and Xweather predictive hail threat forecasting.
- **Owner Intelligence & Decision-Maker Discovery**: Identifies owners, resolves entities, discovers portfolios, links LLCs, classifies ownership, and infers primary/secondary decision-makers with compliance checks.
- **Enrichment Pipeline**: A 3-stage pipeline (TX Open Data Portal, Phone, Web Research) for contact enrichment with confidence scoring.
- **Contact Validation**: Centralized logic for person names, E.164 phone normalization, MX-based email validation, and disposable domain detection.
- **GIS Roof Intelligence**: Uses OpenStreetMap Overpass API for building footprints, computes roof area, and integrates satellite imagery with roof age/material/type.
- **NAIP Roof Change Detection**: Fetches USDA NAIP aerial imagery (2012–2022) to detect roof replacement events by analyzing color statistics and brightness transitions.
- **Lead Scoring (v3)**: Advanced algorithm incorporating property and contact attributes for a comprehensive lead score (0-100).
- **Pipeline Orchestrator**: Manages a 10-phase automated data processing pipeline with configurable filtering.
- **AI Data Agent (Claude Haiku-powered)**: Includes modes for audit, web search, contractor scrub, website extract, portfolio detection, and stale data detection, with post-batch entity resolution and an admin UI.
- **Property Data Enrichment Agent**: Fills data gaps across leads by fixing CAD field mappings and web-searching public sources, with a CAD re-import endpoint and admin UI.
- **PropStream CSV/Excel Import**: Parses PropStream exports, auto-detects column headers, matches leads by address, and fills null/sentinel fields for property and skip trace data, with an admin UI.
- **Enrichment ROI Engine**: Tiered enrichment decision system based on expected lead value, incorporating budget guardrails and ROI threshold gating.
- **ZIP-Code Tiling & Scoring**: Computes composite scores (0-100) per ZIP code based on storm risk, roof age, data gaps, property value, and lead density, with recommended spend and projected EV.
- **Hail-Chaser Mode**: Full-screen storm-first UX with real-time map, lead markers by ROI tier, ZIP priority heatmap, active storm threats, and priority response queue.
- **Grok Intelligence Core (xAI-powered)**: Multi-agent AI system with ReAct supervisor loop, 5 tools (db-query, roi-trigger, zip-compute, pipeline-trigger, web-search), natural language Ops Center bar, and per-lead chat. Uses OpenAI-compatible xAI API with grok-3-fast model, rate limiting (380 RPM), cost tracking ($0.30/M input, $0.50/M output), and budget gating via enrichment_budgets table. Graceful fallback when XAI_API_KEY not configured.

### Grok Intelligence Core Architecture
- **Proxy**: `server/intelligence/grok-proxy.ts` — OpenAI-compatible client wrapper with rate limiting, cost tracking, budget gating
- **Supervisor**: `server/intelligence/supervisor.ts` — ReAct loop (max 8 steps), tool calling, session/trace persistence
- **Tools**: `server/intelligence/tools/` — 5 tool definitions (db-query, roi-trigger, zip-compute, pipeline-trigger, web-search)
- **Database tables**: `agent_sessions` (conversation state, messages JSONB), `agent_traces` (per-call logging with tokens, cost, latency)
- **API endpoints**:
  - `POST /api/ops/grok-ask` — Main prompt endpoint (creates/resumes sessions)
  - `GET /api/ops/grok-sessions` — List recent sessions
  - `GET /api/ops/grok-sessions/:sessionId` — Full session with traces
  - `GET /api/ops/grok-cost-summary` — Aggregate cost stats (24h, 7d, 30d, all-time)
  - `POST /api/leads/:leadId/grok-ask` — Lead-specific chat with auto-injected lead context
- **Frontend**: Grok Insights card in Ops Center with NL bar (`client/src/components/ops/natural-language-bar.tsx`), reasoning display (`client/src/components/ops/reasoning-display.tsx`), lead chat panel (`client/src/components/lead/grok-chat-panel.tsx`)

### Multi-Market Architecture
The platform supports multi-market expansion through a `markets` table and `market_data_sources` table, mapping markets to configurable data sources via field mapping and filter configurations, allowing new markets to be onboarded without code changes.

### Normalized Satellite Tables (Data Model v2)
The monolithic `leads` table is being decomposed into five domain-specific satellite tables (`property_roof`, `property_owner`, `property_risk_signals`, `property_contacts`, `property_intelligence`) using an additive, non-breaking migration approach with a dual-write pattern during transition.

### Data Quality System
Each lead has a computed `dataConfidence` (High, Medium, Low) based on multiple indicators. A quality summary and dashboard card provide metrics, and admin endpoints are available for cleanup and evidence verification. Market readiness scores are computed from weighted field coverage.

### Outcome Tracking & KPI Engine
The `lead_outcomes` table records deal outcomes (appointment_set, proposal_sent, closed_won, closed_lost, no_response). The `kpi_snapshots` table captures periodic metrics (match rate, contactable rate, conversion rate, cost/lead, cost/sale, ROI). A weight retraining system analyzes won vs lost outcomes to recommend scoring weight adjustments for admin review.

### Skip-Trace TTL & Cost Optimization
The `skip_trace_log` table tracks every enrichment API call with provider, cost, fields returned, match quality, and a cooldown expiry (default 180 days). The enrichment-roi-agent and phone-validation-pipeline check TTL before re-tracing. Batch economics computation recommends optimal provider mix based on lead count and historical match rates.

### Consent & Compliance Module
The `consent_tokens` table stores TrustedForm/Jornaya/manual consent tokens with verification status and expiry. The consent-manager integrates with the existing compliance-gate to verify consent before contact. Compliance reports aggregate consent, DNC, and suppression metrics per market.

### Phone Validation Pipeline
The phone-validation-pipeline wraps Twilio Lookup V2 with TTL-aware validation, logging results to contact_evidence and skip_trace_log. Batch validation supports rate limiting. The ROI agent uses phone line type (mobile/landline/voip) in contactability scoring.

### UX Architecture: Ops Center + Admin
The frontend is split into two focused surfaces:
- **`/ops` (Operations Center)**: Daily command center with 7 card-based panels — Grok Intelligence Core (NL bar + cost meter), Live Budget Guardrails, ROI Engine (expandable), ZIP Priority Tiles, Pipeline Control, Analytics & KPIs (expandable), Storm & Phone Ops. Search bar for card filtering. File: `client/src/pages/ops-center.tsx`.
- **`/admin` (System Config)**: 4-tab admin for rarely-changed settings — Markets & Sources, Data Quality, Compliance, System. File: `client/src/pages/admin.tsx`.
- **Extracted panel components**: `client/src/components/admin/roi-engine-panel.tsx`, `analytics-kpis-panel.tsx`, `compliance-panel.tsx` — shared between Ops Center and Admin.
- **Sidebar**: Ops Center prominently featured in Navigation group (first item, Zap icon). Admin in System group.

### Feature Specifications
Key features include a comprehensive Dashboard with KPI cards (conversion rate, cost/lead, ROI), filterable Leads & Lead Detail pages with ROI decision cards and outcome recording, an interactive Map & Storms view with ZIP priority heatmap, a Hail Chaser mode, Portfolios & Network Explorer, Data Management tools, an Operations Center for daily ROI/pipeline/budget/storm management, and an Admin interface with 4 system config tabs (Markets & Sources, Data Quality, Compliance, System). A Contractors Directory and CSV export functionality are also included.

## External Dependencies
- **PostgreSQL**: Primary database.
- **NOAA**: Historical and real-time hail data.
- **Central Appraisal Districts (CADs) ArcGIS APIs (Dallas, Tarrant, Collin, Denton)**: Commercial property data.
- **Xweather/Vaisala**: Predictive hail threat data.
- **Google Places API**: Phone enrichment, reverse-address lookups.
- **OpenCorporates**: Corporate entity data.
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
- **Microsoft Planetary Computer STAC API**: NAIP aerial imagery.
- **EmailMX verification services**: Email validation.
- **Various public record APIs/databases**: Including TREC, TDLR, HUD, BBB, WHOIS/RDAP.
- **xAI (Grok API)**: AI-powered intelligence core via OpenAI-compatible API.