# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
RoofIntel is a SaaS platform for roofing contractors, specializing in identifying and prioritizing qualified commercial and multi-family leads. It integrates public property data, roof age, and historical hail exposure to deliver actionable intelligence. Currently serving the DFW 4-county region (Dallas, Tarrant, Collin, Denton), the platform is designed for multi-market expansion. Its primary goal is to enhance lead generation, qualification, and market potential for roofing businesses. The core principle is to use only real, verified data from public sources and government APIs.

## User Preferences
I prefer clear, concise explanations and direct answers. For development, I favor an iterative approach with frequent, small commits. Please ask for confirmation before implementing significant architectural changes or adding new external dependencies. When proposing solutions, prioritize scalability and maintainability.

## System Architecture
RoofIntel utilizes a modern web architecture with a strong emphasis on separation of concerns.

### UI/UX Decisions
- Professional B2B color scheme (blue/slate).
- Dark sidebar navigation with light/dark mode toggle.
- Inter font family for optimal readability.
- Responsive design using Shadcn/UI components.
- Interactive Leaflet map for lead visualization, featuring color-coded markers, detailed popups, live hail tracking (NEXRAD radar + NWS alerts), and Xweather predictive hail threats.

### Technical Implementations
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet, Wouter for routing, and react-helmet-async for SEO.
- **Backend**: Express.js with Node.js.
- **Database**: PostgreSQL with Drizzle ORM.
- **Data Management**: Multer for CSV uploads, TanStack React Query for client-side data.

### Core Agents & Services (Key Capabilities)
- **Property Data Agents**: Automated fetching from Dallas, Tarrant, Collin, and Denton Central Appraisal Districts (DCAD, TAD, Collin CAD, Denton CAD) ArcGIS APIs.
- **Hail Correlation & Monitoring**: Proximity-based hail event matching, real-time NOAA SWDI hail radar monitoring, and Xweather predictive hail threat forecasting.
- **Owner Intelligence**: Systems for identifying property owners, resolving entities, discovering ownership portfolios, and linking LLC chains.
- **Enrichment Pipeline**: A unified 3-stage pipeline (TX Open Data Portal, Phone, Web Research) for contact enrichment with confidence scoring.
- **Decision-Maker Discovery**: Classifies ownership structures, attributes property managers vs. owners, infers roles (8 types with authority scoring), and assigns primary/secondary/operational decision-makers. Includes compliance checks (opt-out, DNC).
- **Reverse Address Enrichment**: Identifies management companies and corporate offices via mailing address lookups using Google Places API.
- **GIS Roof Intelligence**: Uses OpenStreetMap Overpass API for building footprints, computes roof area, and integrates satellite imagery with roof age/material/type.
- **Lead Scoring (v3)**: Advanced algorithm (0-100) incorporating roof age, hail exposure, storm recency, roof area, contactability, owner type, property value, distress signals, flood risk, and property condition.
- **Evidence Management**: Records and corroborates contact evidence from various agents with source trust scoring.
- **Contact Validation**: E.164 phone normalization, MX-based email validation, disposable domain detection.
- **Pipeline Orchestrator**: Manages a 9-phase automated data processing pipeline with configurable lead filtering, progress tracking, and dependency-ordered execution.
- **Compliance & SEO**: Robots.txt checking, rate limiting, blocked domain lists, security headers, dynamic sitemaps, and content for E-E-A-T and legal compliance.

### Feature Specifications
- **Dashboard**: Key statistics, lead distribution.
- **Leads & Lead Detail**: Filterable list, comprehensive property intelligence, owner/contact enrichment, hail history, GIS roof data.
- **Map & Storms**: Interactive map with live hail, predictive threats, and building footprints.
- **Portfolios & Network Explorer**: Property portfolio discovery, relationship graph visualization.
- **Data Management**: CSV import, data source configuration, data quality metrics.
- **Admin**: Centralized management for property sources, storm data, enrichment, pipeline, and system settings.
- **Exports**: Lead data export to CSV.

## External Dependencies
- **PostgreSQL**: Primary database.
- **NOAA (National Oceanic and Atmospheric Administration)**: Historical and real-time hail data.
- **Dallas, Tarrant, Collin, Denton Central Appraisal Districts (CADs) ArcGIS APIs**: Commercial property data.
- **Xweather/Vaisala**: Predictive hail threat data and alerts.
- **Google Places API**: Phone enrichment, reverse-address lookups (manual-only).
- **OpenCorporates**: Additional phone enrichment and corporate entity data.
- **Serper Web Search API**: Fallback enrichment and web research (manual-only).
- **TX Open Data Portal**: Contact enrichment (taxpayer IDs, SOS numbers).
- **Texas Comptroller Public Information Request (PIR) API**: Officer extraction.
- **Socrata API**: Dallas building permits.
- **Fort Worth ArcGIS FeatureServer**: Building permits.
- **Hunter.io**: Email discovery (manual-only).
- **People Data Labs (PDL)**: Person/company enrichment (manual-only).
- **SEC EDGAR**: REIT and institutional owner details.
- **TX Secretary of State (via Comptroller API)**: Entity details, registered agents.
- **County Clerk Recording Data**: Deed record search for DFW counties.
- **FEMA Flood Zone API**: Flood risk assessment.
- **OpenStreetMap Overpass API**: Building footprint polygons.
- **Esri World Imagery**: Satellite imagery.
- **EmailMX verification services**: Email validation.
- **Various public record APIs/databases**: Including TREC, TDLR, HUD, BBB, WHOIS/RDAP for comprehensive intelligence.