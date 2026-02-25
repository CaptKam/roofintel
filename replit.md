# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
RoofIntel is a SaaS platform designed to empower roofing contractors by providing actionable intelligence for identifying and prioritizing qualified commercial and multi-family leads. It aggregates and analyzes public property data, roof age, and historical hail exposure. Initially focused on the DFW region, the platform is built with a multi-market architecture to support future expansion, aiming to streamline lead generation and qualification, thereby enhancing market potential and operational efficiency for roofing businesses.

## User Preferences
I prefer clear, concise explanations and direct answers. For development, I favor an iterative approach with frequent, small commits. Please ask for confirmation before implementing significant architectural changes or adding new external dependencies. When proposing solutions, prioritize scalability and maintainability.

## System Architecture
RoofIntel utilizes a modern web architecture emphasizing separation of concerns and scalability.

**UI/UX Decisions:**
- Employs a professional blue/slate B2B color scheme with a dark sidebar navigation and a light/dark mode toggle.
- Uses the Inter font family for optimal readability.
- Achieves responsiveness through Shadcn/UI components.
- Features an interactive Leaflet map for lead visualization, including color-coded lead score markers, detailed popup cards, and overlays for real-time hail tracking (NEXRAD radar + NWS alerts) and predictive hail threats (Xweather).

**Technical Implementations:**
- **Frontend**: Built with React, TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts for data visualization, and React-Leaflet for mapping, with Wouter handling routing.
- **Backend**: Powered by Express.js and Node.js for API services.
- **Database**: PostgreSQL, managed with Drizzle ORM.
- **Data Management**: Multer for CSV uploads and TanStack React Query for client-side data handling.
- **Core Agents & Services**:
    - **Property Data Agents**: Automated fetching from Dallas (DCAD), Tarrant (TAD), Collin (Collin CAD), and Denton (Denton CAD) ArcGIS APIs.
    - **Hail Intelligence**: `hail-correlator` matches hail events to leads, and `storm-monitor` integrates NOAA SWDI data with `xweather-hail` for predictive forecasting and alerts.
    - **Lead Enrichment & Ownership Intelligence**: A multi-stage pipeline for contact enrichment, including `owner-intelligence`, `network-agent` for discovering portfolios, `entity-resolution` for deduplication, `management-attribution` to differentiate roles, and `reverse-address-enrichment` using Google Places for identifying management entities. `skip-trace-agent` consolidates multiple sources for comprehensive contact data. `lead-enrichment-orchestrator` automates the enrichment process.
    - **Scoring & Classification**: `ownership-classifier` categorizes leads into ownership structures, while a refined **Lead Scoring (v3)** algorithm evaluates leads based on roof age, hail exposure, storm recency, and property attributes. `dm-confidence` provides contact confidence scoring.
    - **GIS & Roof Intelligence**: `building-footprint-agent` uses OpenStreetMap for roof area calculation, and the platform integrates satellite imagery (Esri World Imagery) to display roof details.
    - **Compliance & Data Integrity**: `compliance-gate` manages opt-outs, `evidence-recorder` tracks data sources, `contact-validation` ensures data quality, `source-policy` enforces data scraping ethics, and `source-trust` assigns trust scores to data sources.
    - **Job Scheduling**: `job-scheduler` manages background tasks.
- **Feature Specifications**:
    - **Dashboard**: Offers key statistics and top-scoring leads.
    - **Leads Management**: Filterable list, detailed lead views.
    - **Map & Storms**: Interactive map, live hail tracking, predictive hail threats, and building footprint overlays.
    - **Data Imports**: Support for NOAA, various CADs, and generic CSVs.
    - **Data Coverage Dashboard**: Admin view for real-time data completeness metrics.
    - **Contact & Phone Enrichment**: Two-tier system with free auto-run agents and manual-only paid API integrations.
    - **Enrichment Credits Dashboard**: Admin view for tracking paid API usage.
    - **Web Research Agent**: Scans websites for decision-maker contacts.
    - **Relationship Network Agent**: Discovers and scores property portfolios, with a Network Explorer for visualization.
    - **Predictive Hail Monitoring**: Utilizes Xweather for advanced forecasting.
    - **Decision-Maker Discovery (Layer 3)**: Advanced system for classifying ownership, ranking decision-makers, and managing compliance.
    - **GIS Roof Intelligence**: Displays computed roof area, age, material, and type with satellite imagery.
    - **Admin**: Centralized management for platform settings.
    - **SEO & Compliance**: Implements SEO best practices and security headers.
    - **Storm Chase Mode**: A companion React Native (Expo) mobile app in `mobile/` for field teams, offering live lead maps, task queues, storm alerts, and field action recording. Uses Expo Router file-based routing, `react-native-maps` for the chase map, and `expo-location` for GPS tracking. Dark mode by default (#0A0A0B bg). 5 screens: Chase Map, Today's Queue, Storm Alerts, Settings, Lead Detail (modal). Backend endpoints under `/api/chase/*` in `server/chase-mode.ts` with 4 DB tables (`chase_sessions`, `chase_actions`, `push_devices`, `chase_alert_history`). Anti-spam: max 5 alerts/hr, 10-min cooldown per lead, 3-dismiss pause, quiet hours. EAS Build for cloud compilation.

## Mobile App Structure (`mobile/`)
- **Entry**: `app/_layout.tsx` (Stack) → `app/(tabs)/_layout.tsx` (Tabs)
- **Screens**: `map.tsx`, `queue.tsx`, `alerts.tsx`, `settings.tsx`, `lead/[id].tsx`
- **Components**: `ScoreBadge.tsx`, `LeadPreviewCard.tsx`, `QueueItem.tsx`
- **Libraries**: `lib/api.ts` (API client), `lib/theme.ts` (design tokens), `lib/location.ts` (GPS + notifications)
- **Config**: `app.json` (Expo config), `eas.json` (EAS Build), `package.json`, `tsconfig.json`

## External Dependencies
- **PostgreSQL**: Primary database.
- **NOAA (National Oceanic and Atmospheric Administration)**: Historical and real-time hail data.
- **Dallas Central Appraisal District (DCAD) ArcGIS API**: Property data.
- **Xweather/Vaisala**: Predictive hail threat data and APIs.
- **Google Places API**: Phone number enrichment and reverse-address lookups.
- **OpenCorporates**: Additional phone number and corporate entity data.
- **Serper Web Search API**: Fallback for web research and enrichment.
- **TX Open Data Portal**: Contact enrichment.
- **Texas Comptroller Public Information Request (PIR) API**: Officer extraction.
- **Socrata API**: Dallas building permits.
- **Fort Worth ArcGIS FeatureServer**: Building permits.
- **Hunter.io**: Email discovery API.
- **People Data Labs (PDL)**: Person and company enrichment API.
- **SEC EDGAR**: Public company filing data.
- **TX Secretary of State (via Comptroller API)**: Entity information.
- **County Clerk Recording Data**: Deed records for DFW counties.
- **EmailMX verification services**: Email validation.
- **Various public record APIs/databases**: Including TREC, TDLR, HUD, BBB, and WHOIS/RDAP for comprehensive intelligence.