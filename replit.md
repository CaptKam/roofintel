# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
RoofIntel is a SaaS platform that provides actionable intelligence to commercial roofing contractors for identifying and prioritizing qualified leads. It integrates public property data, roof age, and historical hail exposure, initially focusing on the DFW 4-county region. The platform aims to enhance lead generation, qualification, and market potential by leveraging verified public data. The business vision is to become the leading intelligence platform in the commercial roofing industry, enabling efficient targeting of high-potential properties.

## User Preferences
I prefer clear, concise explanations and direct answers. For development, I favor an iterative approach with frequent, small commits. Please ask for confirmation before implementing significant architectural changes or adding new external dependencies. When proposing solutions, prioritize scalability and maintainability.

## System Architecture
RoofIntel uses a modern web architecture designed for scalability and multi-market support, emphasizing separation of concerns and data integrity.

### UI/UX Decisions
The user interface features a professional B2B color scheme (blue/slate), dark sidebar navigation with light/dark mode, and the Inter font family. It utilizes responsive Shadcn/UI components and an interactive Leaflet map for lead visualization, including color-coded markers, detailed popups, live hail tracking, and predictive hail threats. Data quality is indicated by confidence badges and dashboard summary cards. The navigation is streamlined into a 5-item sidebar for optimal user focus: Hail Chaser (unified storm map), Ops Center (daily cockpit with KPIs, Grok Intelligence, ROI Engine, ZIP Priority), Leads (filterable list), Owners (Portfolios, Network graph, Contractors), and Admin (system configuration).

### Technical Implementations
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet, Wouter, react-helmet-async.
- **Backend**: Express.js with Node.js.
- **Database**: PostgreSQL with Drizzle ORM.
- **Data Management**: Multer for CSV uploads, TanStack React Query for client-side data.

### Core Agents & Services
- **Property Data Agents**: Automated fetching from Central Appraisal Districts ArcGIS APIs.
- **Hail Correlation & Monitoring**: Proximity-based hail event matching, real-time NOAA SWDI radar, and Xweather predictive hail threat forecasting.
- **Owner Intelligence & Decision-Maker Discovery**: Identifies owners, resolves entities, discovers portfolios, links LLCs, classifies ownership, and infers decision-makers.
- **Enrichment Pipeline**: A 3-stage pipeline for contact enrichment with confidence scoring.
- **GIS Roof Intelligence**: Uses OpenStreetMap Overpass API for building footprints, computes roof area, and integrates satellite imagery with roof age/material/type.
- **NAIP Roof Change Detection**: Fetches USDA NAIP aerial imagery to detect roof replacement events.
- **Lead Scoring (v3)**: Advanced algorithm incorporating property and contact attributes.
- **Pipeline Orchestrator**: Manages a 10-phase automated data processing pipeline.
- **AI Data Agent (Claude Haiku-powered)**: Includes modes for audit, web search, contractor scrub, website extract, portfolio detection, and stale data detection, with entity resolution.
- **Property Data Enrichment Agent**: Fills data gaps and fixes CAD field mappings.
- **PropStream CSV/Excel Import**: Parses exports, auto-detects headers, matches leads, and fills null fields.
- **Enrichment ROI Engine**: Tiered enrichment decision system based on expected lead value with budget guardrails.
- **ZIP-Code Tiling & Scoring**: Computes composite scores per ZIP code based on storm risk, roof age, data gaps, property value, and lead density.
- **Hail-Chaser Mode**: Full-screen storm-first UX with real-time map, lead markers by ROI tier, ZIP priority heatmap, active storm threats, and priority response queue.
- **Grok Intelligence Core (xAI-powered)**: Multi-agent AI system with ReAct supervisor loop and 5 tools (db-query, roi-trigger, zip-compute, pipeline-trigger, web-search) via an OpenAI-compatible API.
- **Graph Engine**: Builds a relationship network of entities, people, agents, and addresses for advanced intelligence queries.
- **Intelligence Alerts Engine**: Proactive alert system computing 7 alert types from real DB data (claim windows, high-value storm targets, contactability gaps, portfolio opportunities, permit activity, enrichment sources, data freshness).
- **Multi-Market Architecture**: Config-driven support for market expansion without code changes.
- **Normalized Satellite Tables**: Data model designed for flexibility and scalability, decomposing the monolithic `leads` table.
- **Data Quality System**: Computes `dataConfidence` for each lead and provides quality metrics.
- **Outcome Tracking & KPI Engine**: Tracks deal outcomes and captures periodic metrics for performance analysis and scoring weight adjustments.
- **Skip-Trace TTL & Cost Optimization**: Tracks enrichment API calls, costs, and cooldowns for efficient re-tracing.
- **Consent & Compliance Module**: Stores and verifies consent tokens, integrating with a compliance gate.
- **Phone Validation Pipeline**: Wraps Twilio Lookup V2 with TTL-aware validation.

## External Dependencies
- **PostgreSQL**: Primary database.
- **NOAA**: Historical and real-time hail data.
- **Central Appraisal Districts (CADs) ArcGIS APIs**: Commercial property data.
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
- **TX Secretary of State**: Entity details, registered agents.
- **County Clerk Recording Data**: Deed record search for DFW counties.
- **FEMA Flood Zone API**: Flood risk assessment.
- **OpenStreetMap Overpass API**: Building footprint polygons.
- **Esri World Imagery**: Satellite imagery.
- **Microsoft Planetary Computer STAC API**: NAIP aerial imagery.
- **EmailMX verification services**: Email validation.
- **Various public record APIs/databases**: Including TREC, TDLR, HUD, BBB, WHOIS/RDAP.
- **xAI (Grok API)**: AI-powered intelligence core.