# RoofIntel - Commercial Roofing Lead Intelligence Platform

## Overview
A SaaS platform for roofing contractors to find and prioritize qualified commercial/multi-family leads using public property data, roof age, and hail exposure history. Focused on the DFW (Dallas-Fort Worth) region.

## Tech Stack
- **Frontend**: React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Recharts, React-Leaflet
- **Backend**: Express.js, Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: Wouter (frontend), Express (backend)
- **State Management**: TanStack React Query

## Architecture
- `client/src/pages/` - Page components (dashboard, leads, lead-detail, map-view, hail-events, export)
- `client/src/components/` - Shared components (app-sidebar, score-badge, status-badge, theme-provider, theme-toggle)
- `server/routes.ts` - API endpoints
- `server/storage.ts` - Database storage layer with Drizzle ORM
- `server/seed.ts` - Seed data for DFW region properties and hail events
- `shared/schema.ts` - Drizzle schema definitions and Zod validation

## Key Features
- **Dashboard**: Stats overview (total leads, hot leads, avg score, hail events), score distribution chart, county distribution pie chart, top scoring leads
- **Leads List**: Filterable/searchable lead table with score badges, status badges, filters by county/score/zoning/status
- **Lead Detail**: Full property info, hail exposure data, valuation, owner/contact info, status management, notes, score breakdown
- **Map View**: Interactive Leaflet map with color-coded markers by lead score, popup detail cards
- **Hail Events**: Grid of tracked NOAA storm events with severity badges
- **Export**: CSV export with configurable filters

## Data Model
- `leads` table: Property details (address, sqft, year built, zoning), roof info (last replaced, material), owner info (name, type, LLC, contact), hail exposure (events count, last date/size), lead score, status
- `hail_events` table: Storm event records with date, location, hail size, source

## API Endpoints
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/leads` - List leads with query filters (search, county, minScore, zoning, status)
- `GET /api/leads/:id` - Single lead detail
- `PATCH /api/leads/:id` - Update lead status/notes
- `GET /api/leads/export` - CSV export with filters
- `GET /api/hail-events` - List all hail events

## Lead Scoring (0-100)
- Roof age: up to 30 points (2 pts per year since last replacement)
- Hail exposure: up to 25 points (8 pts per event)
- Building size: up to 20 points (based on sqft)
- Owner type: up to 15 points (LLC > Corp > Individual)
- Property value: up to 10 points

## Design
- Professional blue/slate B2B color scheme
- Dark sidebar navigation with light/dark mode toggle
- Inter font family
- Responsive layout with Shadcn sidebar component
