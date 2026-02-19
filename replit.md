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
- `client/src/pages/` - Page components (dashboard, leads, lead-detail, map-view, hail-events, export, data-management)
- `client/src/components/` - Shared components (app-sidebar, score-badge, status-badge, theme-provider, theme-toggle)
- `server/routes.ts` - API endpoints
- `server/storage.ts` - Database storage layer with Drizzle ORM
- `server/seed.ts` - Seed data and calculateScore function
- `server/noaa-importer.ts` - Real NOAA Storm Events hail data importer
- `server/property-importer.ts` - County appraisal district CSV property importer
- `server/job-scheduler.ts` - Background job scheduler (NOAA sync, score recalc)
- `shared/schema.ts` - Drizzle schema definitions and Zod validation

## Key Features
- **Dashboard**: Stats overview (total leads, hot leads, avg score, hail events), score distribution chart, county distribution pie chart, top scoring leads
- **Leads List**: Filterable/searchable lead table with score badges, status badges, filters by county/score/zoning/status
- **Lead Detail**: Full property info, hail exposure data, valuation, owner/contact info, status management, notes, score breakdown
- **Map View**: Interactive Leaflet map with color-coded markers by lead score, popup detail cards
- **Hail Events**: Grid of tracked NOAA storm events with severity badges, event count display
- **Export**: CSV export with configurable filters
- **Data Management**: Import controls for NOAA hail data, property CSV upload, background job monitoring, import history

## Data Sources
- **NOAA Storm Events**: Real hail event data fetched from NOAA's public CSV files (2020-present), 912+ events for DFW region
- **Property CSV Import**: Upload county appraisal district CSV files with auto-column detection, supports DCAD and generic formats
- **Background Jobs**: Automated NOAA sync and lead score recalculation on 4-hour intervals

## Data Model
- `markets` table: Market regions (name, state, counties, center coords, radius)
- `leads` table: Property details (address, sqft, year built, zoning), roof info, owner info, hail exposure, lead score, status, sourceType/sourceId for deduplication
- `hail_events` table: Storm event records with NOAA event IDs for deduplication
- `data_sources` table: Configured data source connections
- `import_runs` table: Import history with status, counts, timestamps
- `jobs` table: Background job definitions and scheduling

## API Endpoints
- `GET /api/markets` - List markets
- `GET /api/dashboard/stats` - Dashboard statistics (optional marketId filter)
- `GET /api/leads` - List leads with query filters (search, county, minScore, zoning, status, marketId)
- `GET /api/leads/:id` - Single lead detail
- `PATCH /api/leads/:id` - Update lead status/notes
- `GET /api/leads/export` - CSV export with filters
- `GET /api/hail-events` - List hail events (optional marketId filter)
- `POST /api/import/noaa` - Trigger NOAA hail data import (marketId, startYear, endYear)
- `POST /api/import/property-csv` - Upload property CSV file (multipart form: file, marketId, minSqft)
- `GET /api/import/sample-csv` - Download sample property CSV template
- `GET /api/import/runs` - List import history
- `GET /api/data-sources` - List configured data sources
- `GET /api/jobs` - List background jobs
- `POST /api/jobs/:id/run` - Trigger a background job

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
