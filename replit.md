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
    - `job-scheduler`: Background job management for tasks like NOAA sync and score recalculation.
- **Lead Scoring (v3)**: A refined scoring algorithm (0-100) optimized for roofing contractors, incorporating roof age, hail exposure, storm recency, roof area, contactability, owner type, property value, distress signals, flood risk, and property condition.

**Feature Specifications:**
- **Dashboard**: Provides key statistics, score distribution, and top-scoring leads.
- **Leads Management**: Filterable and searchable leads list, detailed lead view with property, owner, hail, and contact info.
- **Map & Storms**: Interactive map view, live hail tracker, and predictive hail threat visualization.
- **Data Imports**: Support for NOAA hail data, DCAD properties, and generic property CSVs.
- **Contact & Phone Enrichment**: Automated processes to find owner contact information using various data sources.
- **Web Research Agent**: Scans business websites to identify decision-makers and their contact details.
- **Relationship Network Agent**: Discovers and scores property portfolios by linking ownership connections.
- **Predictive Hail Monitoring**: Integrates Xweather for advanced hail threat forecasting and alerts.
- **Decision-Maker Discovery**: Management attribution (manager vs owner separation), role inference & ranking (8 role types with authority scoring), compliance gating (opt-out/consent/DNC), decomposed confidence scoring (7-factor formula with auto-publish/review/suppress tiers), human-in-the-loop review console
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
- **EmailMX verification services**: Integrated for validating email patterns.
- **Various public record APIs/databases**: Including TREC (Texas Real Estate Commission) license, TDLR (Texas Department of Licensing and Regulation) license, HUD multifamily database, BBB (Better Business Bureau) Direct, and WHOIS/RDAP for comprehensive owner and contact intelligence.