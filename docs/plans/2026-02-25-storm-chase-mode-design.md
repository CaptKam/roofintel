# Storm Chase Mode Design Document

**Date**: February 25, 2026  
**Status**: Design & Architecture  
**Objective**: React Native mobile companion app for RoofIntel field teams to efficiently identify and respond to qualified roofing leads in real-time, with GPS-aware proximity alerts and storm-driven prioritization.

---

## 1. Overview

Storm Chase Mode is a dedicated React Native (Expo) mobile application that extends RoofIntel's lead intelligence capabilities to field operations. It enables roofing contractors to:

- **Chase storms in real-time**: View live hail event locations and affected properties
- **Proximity-based lead discovery**: Receive alerts when valuable leads appear nearby
- **Efficient field routing**: Prioritized queue based on location, lead score, and storm proximity
- **Field action tracking**: Record interactions (called, knocked, left card, scheduled, not interested) directly from the field
- **Offline-friendly**: Works with intermittent connectivity in rural/storm areas

The app shares the RoofIntel PostgreSQL backend and extends it with mobile-specific features (location tracking, push notifications, field sessions).

---

## 2. Architecture

### 2.1 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React Native + Expo | Cross-platform (iOS/Android) managed workflow |
| **Navigation** | Expo Router | File-based routing (tab navigation + modals) |
| **Mapping** | React Native Maps | Native map rendering with lead pins |
| **Location** | expo-location | Background/foreground GPS tracking |
| **Notifications** | expo-notifications | Local + push notifications for proximity alerts |
| **Animations** | react-native-reanimated | Smooth pulsing pins, card transitions |
| **Gestures** | react-native-gesture-handler | Swipe actions, drag-to-reorder queue |
| **Storage** | AsyncStorage | Persist settings, session data |
| **Backend** | Express.js (shared) | Chase Mode API endpoints |
| **Database** | PostgreSQL (shared) | Session/action/device tracking |
| **Build** | Expo EAS Build | Cloud compilation to iOS/Android |

### 2.2 Data Model Extensions

New database tables in PostgreSQL:

```
chase_sessions
├── id (uuid, pk)
├── contractor_id (fk → users)
├── started_at (timestamp)
├── ended_at (timestamp, nullable)
├── current_location (geometry point)
├── session_config (jsonb) — radius, score threshold, settings
└── status (enum: active | paused | ended)

chase_actions
├── id (uuid, pk)
├── session_id (fk → chase_sessions)
├── lead_id (fk → leads)
├── action_type (enum: called | knocked | left_card | scheduled | not_interested)
├── timestamp (timestamp)
├── location (geometry point)
├── notes (text, nullable)
└── duration_secs (int, nullable)

push_devices
├── id (uuid, pk)
├── user_id (fk → users)
├── push_token (text, unique)
├── platform (enum: ios | android)
├── device_id (text)
├── registered_at (timestamp)
└── last_seen (timestamp)

alert_history_chase
├── id (uuid, pk)
├── device_id (fk → push_devices)
├── lead_id (fk → leads)
├── alert_type (enum: proximity | score_change | storm)
├── fired_at (timestamp)
├── dismissed_at (timestamp, nullable)
└── action_taken (enum: opened | ignored | snooze, nullable)
```

---

## 3. Feature Specification

### 3.1 Bottom Tab Navigation (4 Tabs)

**Layout**: Icon-only tab bar at bottom of screen  
**Dark Theme**: `#0A0A0B` near-black background, zinc surfaces

| Tab | Icon | Screen | Badge |
|-----|------|--------|-------|
| **Map** | Compass | Chase Map (live lead pins) | None |
| **Queue** | List | Today's Queue (prioritized leads) | Unvisited count |
| **Alerts** | Bell | Storm Alerts (active storms) | Red dot if storms |
| **Settings** | Gear | Settings & Profile | None |

Active tab: filled icon, inactive: outlined icon.

---

### 3.2 Chase Map Screen

**Purpose**: Full-screen map view centered on contractor's GPS position with interactive lead pins.

**Key Features**:
- Centered on current location (blue pulsing dot)
- Lead pins color-coded by score:
  - Green: 80-100
  - Amber: 60-79
  - Orange: 40-59
  - Gray: <40
- Tap pin → slide-up preview card:
  - Address (large), city, zip
  - Score badge + quick metrics (roof area, roof age, last hail date)
  - "Navigate" button (opens Apple Maps/Google Maps)
  - "Details" button (opens full lead modal)
- Pulse animation on new proximity alerts
- Minimal UI: just map + tab bar

**Location Tracking**:
- Moving (>5 mph): update every 5 minutes
- Stationary: update every 15 minutes
- Background: update every 30 minutes
- On each update: call `/api/chase/check-proximity`

---

### 3.3 Lead Detail Modal

**Purpose**: Deep-dive view of a single lead triggered from map or queue.

**Screens**:
1. **Satellite Photo**: Esri World Imagery tile of property
2. **Lead Summary**:
   - Address (large, primary)
   - City, State, Zip (secondary)
   - Score badge (large, centered)
   - Owner name
   - Decision-maker contact info (name, title, phone/email)
   - Large "Call" button (one-tap to dial)
3. **Intel Grid**:
   - Roof Area, Roof Age, Property Value
   - Last Hail Date/Size, Storm Recency
4. **Quick Actions Row**:
   - 5 buttons: Called / Knocked / Left Card / Scheduled / Not Interested
   - POST to `/api/chase/action`
   - Button state toggles (tapped action highlighted)
5. **Swipe Down**: Dismiss modal

---

### 3.4 Storm Alerts Screen

**Purpose**: View active/recent storm events and filter map to affected properties.

**Key Features**:
- List of storm events from NOAA + Xweather
- Storm card per event:
  - Mini-map tile showing hail swath (orange/red overlay)
  - Max hail size (e.g., "1.5 in")
  - Affected lead count ("23 leads")
  - Detection time ("15 min ago")
  - "Chase This Storm" button → filters map to affected properties
- Red badge on tab when active storms exist
- Empty state: "No active storms" message
- Pull-to-refresh to update storm data

---

### 3.5 Today's Queue Screen

**Purpose**: Prioritized lead list based on proximity + score + storm recency.

**Top Summary Card**:
- Lead count in queue
- Total drive time estimate (based on location)
- Total property value (aggregate)

**Queue Items**:
- Address (bold), city (secondary), state/zip (tertiary)
- Score badge (right side)
- Distance to contractor ("0.3 mi away")
- Drive time estimate ("5 min")
- Swipe right → mark complete (green checkmark, grayed out)
- Swipe left → skip (marked as skipped, grayed out)
- Drag handle (left of item) → reorder list
- Reordered list persists to AsyncStorage

**"Add Lead" Button**:
- Opens manual search dialog (optional MVP+ feature)

---

### 3.6 Settings Screen

**Purpose**: Configure alert preferences, connection, and profile.

**Sections**:

1. **Alert Radius** (Slider)
   - Options: 1, 3, 5, 10 miles
   - Default: 3 miles
   - Real-time filtering on map

2. **Lead Score Threshold** (Slider)
   - Range: 40-100
   - Default: 60
   - Filters which leads trigger proximity alerts

3. **Alert Toggles**:
   - "Storm alerts" — On/Off
   - "Score change alerts" — On/Off
   - "Quiet hours" — Enable + time pickers (e.g., 10 PM to 6 AM)

4. **API Server Configuration**:
   - Text input: API base URL (e.g., `https://roofintel.example.com`)
   - Connection status indicator (green: connected, red: offline)
   - Test connection button

5. **Dark/Light Mode** (Toggle)
   - Persistent to AsyncStorage
   - Default: dark mode

6. **Profile**:
   - Name (text input)
   - Phone (text input)
   - Save button
   - Persists to AsyncStorage + user table in DB

**Persistence**: All settings stored in AsyncStorage (local) and synced to backend user table.

---

### 3.7 Location Service & Proximity Alerts

**Background Location Tracking**:
- Uses `expo-location` with background mode enabled
- Adaptive update frequency:
  - **Moving** (>5 mph): every 5 minutes
  - **Stationary**: every 15 minutes
  - **Background**: every 30 minutes

**Proximity Check** (on location update):
1. POST contractor GPS to `/api/chase/check-proximity`
2. Backend returns leads within alert radius, above score threshold
3. Local push notification fired per lead:
   - Title: "High-value lead nearby"
   - Body: "[Address], Score [X], hail damage [Y] days ago"
   - Tap → opens lead detail modal

**Anti-Spam Logic**:
- Max 5 alerts per hour per contractor
- 10 minute cooldown per lead (same lead won't trigger twice in 10 min)
- Respect quiet hours (no alerts outside configured window)
- "3 dismiss" pause: if user dismisses 3 alerts in a row, pause for 5 min

---

## 4. API Endpoints (Backend)

### 4.1 Core Endpoints

#### `POST /api/chase/check-proximity`
Finds actionable leads near contractor's GPS position.

**Request**:
```json
{
  "latitude": 32.7555,
  "longitude": -96.7769,
  "radiusMiles": 3,
  "minScore": 60
}
```

**Response**:
```json
{
  "leads": [
    {
      "id": "lead-uuid",
      "address": "123 Main St",
      "city": "Dallas",
      "zip": "75201",
      "score": 78,
      "distance": 0.3,
      "lastHailDate": "2026-02-20",
      "ownerName": "John Smith",
      "primaryContact": {
        "name": "Jane Doe",
        "title": "Manager",
        "phone": "+14155551234",
        "email": "jane@example.com"
      }
    }
  ],
  "timestamp": "2026-02-25T14:30:00Z"
}
```

---

#### `POST /api/chase/update-location`
Stores contractor GPS position (breadcrumb trail for analytics).

**Request**:
```json
{
  "latitude": 32.7555,
  "longitude": -96.7769,
  "accuracy": 10,
  "speed": 12.5
}
```

**Response**: `{ "status": "recorded" }`

---

#### `POST /api/chase/register-device`
Registers push notification token with user account.

**Request**:
```json
{
  "pushToken": "ExponentPushToken[...]",
  "platform": "ios",
  "deviceId": "device-uuid"
}
```

**Response**: `{ "deviceId": "push-device-uuid" }`

---

#### `GET /api/chase/queue`
Returns prioritized queue of leads for today based on location + score.

**Query Params**:
- `latitude` (required)
- `longitude` (required)
- `minScore` (optional, default 60)

**Response**:
```json
{
  "queue": [
    {
      "id": "lead-uuid",
      "address": "123 Main St",
      "city": "Dallas",
      "score": 85,
      "distance": 0.2,
      "driveTime": 5,
      "propertyValue": 450000,
      "completed": false,
      "skipped": false
    }
  ],
  "summary": {
    "totalLeads": 12,
    "totalDriveTime": 45,
    "totalPropertyValue": 4200000
  }
}
```

---

#### `POST /api/chase/action`
Records field action for a lead.

**Request**:
```json
{
  "leadId": "lead-uuid",
  "actionType": "called|knocked|left_card|scheduled|not_interested",
  "latitude": 32.7555,
  "longitude": -96.7769,
  "notes": "Spoke to Jane, interested in summer inspection",
  "durationSecs": 180
}
```

**Response**:
```json
{
  "actionId": "action-uuid",
  "leadId": "lead-uuid",
  "actionType": "called",
  "timestamp": "2026-02-25T14:35:00Z"
}
```

---

#### `GET /api/chase/lead/:id/summary`
Simplified lead data for mobile detail view.

**Response**:
```json
{
  "id": "lead-uuid",
  "address": "123 Main St",
  "city": "Dallas",
  "state": "TX",
  "zip": "75201",
  "score": 78,
  "roofArea": 12500,
  "roofAge": 14,
  "lastHailDate": "2026-02-20",
  "lastHailSize": 1.5,
  "propertyValue": 450000,
  "ownerName": "John Smith",
  "ownerType": "small_private",
  "primaryContact": {
    "name": "Jane Doe",
    "title": "Property Manager",
    "phone": "+14155551234",
    "email": "jane@example.com"
  },
  "secondaryContact": {
    "name": "John Smith",
    "title": "Owner",
    "phone": "+14155552345",
    "email": null
  },
  "satelliteImageUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/...",
  "recentActions": [
    {
      "type": "called",
      "timestamp": "2026-02-24T10:00:00Z",
      "notes": "Left voicemail"
    }
  ]
}
```

---

#### `GET /api/chase/storms`
Returns active/recent storm events.

**Query Params**:
- `hours` (optional, default 24) — look back this many hours

**Response**:
```json
{
  "storms": [
    {
      "id": "storm-uuid",
      "detectedAt": "2026-02-25T13:00:00Z",
      "location": { "latitude": 32.85, "longitude": -96.95 },
      "maxHailSize": 1.5,
      "affectedLeadCount": 23,
      "hailSwath": {
        "type": "Polygon",
        "coordinates": [[...]]
      },
      "source": "NOAA|Xweather"
    }
  ]
}
```

---

## 5. Mobile App Structure

```
mobile/
├── app/
│   ├── _layout.tsx                 (root layout, SidebarProvider if needed)
│   ├── (tabs)/
│   │   ├── _layout.tsx             (tab navigation, icon-only bar)
│   │   ├── map.tsx                 (chase map screen)
│   │   ├── queue.tsx               (today's queue screen)
│   │   ├── alerts.tsx              (storm alerts screen)
│   │   └── settings.tsx            (settings & profile)
│   └── lead/
│       └── [id].tsx                (lead detail modal)
├── components/
│   ├── LeadPin.tsx                 (map pin with pulsing animation)
│   ├── LeadPreviewCard.tsx         (slide-up preview from map)
│   ├── LeadDetailCard.tsx          (full detail modal content)
│   ├── ScoreBadge.tsx              (score display)
│   ├── StormCard.tsx               (storm event card)
│   └── QueueItem.tsx               (queue list item with swipe)
├── lib/
│   ├── api.ts                      (HTTP client to backend)
│   ├── types.ts                    (TypeScript types, extends shared/schema)
│   ├── theme.ts                    (dark mode colors, spacing, typography)
│   ├── location.ts                 (background location tracking)
│   └── notifications.ts            (push notification setup)
├── hooks/
│   ├── useLocation.ts              (location tracking hook)
│   ├── useProximityAlert.ts        (proximity alert logic)
│   └── useSettings.ts              (AsyncStorage settings)
├── app.json                        (Expo config: name, slug, permissions)
├── eas.json                        (EAS Build config)
├── package.json                    (React Native deps)
└── tsconfig.json
```

---

## 6. Key Features Explained

### 6.1 Proximity-Based Alerts

**Workflow**:
1. Background location service tracks contractor GPS every 5-30 min
2. On location update, POST to `/api/chase/check-proximity`
3. Backend queries leads within radius + above score threshold
4. For each new lead, fire local push notification
5. Anti-spam prevents duplicate alerts (10 min cooldown)

**Notification Payload**:
```
Title: "High-value lead nearby"
Body: "456 Oak Ave, Dallas • Score 82 • Hail 5 days ago"
Data: { "leadId": "uuid" }
Action: Tap → opens lead detail
```

---

### 6.2 Storm Chasing

**Workflow**:
1. `/api/chase/storms` returns active storm events + affected lead IDs
2. Storm Alerts screen displays each storm card
3. User taps "Chase This Storm" → filters queue + map to affected properties
4. Queue re-sorts by proximity to storm center
5. Map shows only affected leads with pulse animation

---

### 6.3 Field Actions

**5 Action Types**:
1. **Called** — Dialed phone number (tracks duration)
2. **Knocked** — Visited property, attempted contact
3. **Left Card** — Left business card/flyer at address
4. **Scheduled** — Appointment booked
5. **Not Interested** — Lead disqualified by contractor

**Persistence**: All actions POST to `/api/chase/action`, recorded in `chase_actions` table with timestamp + location.

---

### 6.4 Settings Persistence

- **Local**: AsyncStorage (survives app restart)
- **Remote**: User table in PostgreSQL (syncs across devices)
- **Sync**: On app launch, fetch remote settings; on change, POST update

Settings include:
- Alert radius, score threshold
- Quiet hours
- API server URL
- Dark/light mode preference
- Profile (name, phone)

---

## 7. Anti-Spam & Compliance

### 7.1 Alert Throttling

- **Max 5 alerts per hour** per contractor
- **10 min cooldown** per lead (same lead won't trigger twice within 10 min)
- **Quiet hours** respected (e.g., no alerts 10 PM–6 AM)
- **3 dismiss pause** — if user dismisses 3 alerts in a row, pause for 5 min

### 7.2 Data Privacy

- User location is ephemeral (stored in `chase_actions` for audit trail, deleted after 90 days)
- Push tokens registered per device, can be revoked
- All API calls authenticated via existing RoofIntel auth

---

## 8. Performance & Offline

### 8.1 Offline Support

- **Map**: Last known leads cached in AsyncStorage
- **Queue**: Last fetched queue persists
- **Settings**: All settings cached locally
- **Background Location**: Continues working without network
- **Push Notifications**: Queued locally, fires when network restored

### 8.2 Caching Strategy

- **Leads**: Cache 30 min or on manual refresh
- **Storms**: Cache 15 min or on manual refresh
- **Queue**: Cache 10 min or when location changes significantly (0.5 mi+)
- **Settings**: Cache indefinitely, sync on change

---

## 9. Build & Deployment

### 9.1 Expo EAS Build

**Configuration** (`eas.json`):
```json
{
  "build": {
    "preview": {
      "ios": "simulator",
      "android": "preview"
    },
    "production": {
      "ios": "archive",
      "android": "apk"
    }
  },
  "submit": {
    "ios": {
      "appleId": "...",
      "appleTeamId": "..."
    },
    "android": {
      "serviceAccount": "..."
    }
  }
}
```

**Build Command**:
```bash
eas build --platform ios --build-profile production
eas build --platform android --build-profile production
```

**Deployment**: Testflight (iOS) / Google Play Beta (Android)

---

### 9.2 App Store Metadata

- **App Name**: "RoofIntel Storm Chase"
- **Category**: Productivity / Navigation
- **Privacy Policy**: Link to existing RoofIntel privacy policy
- **Permissions Requested**:
  - Location (always/when-in-use, for background tracking)
  - Notifications (push alerts)
  - Camera (optional, for photo evidence)
  - Contacts (optional, for quick call)

---

## 10. MVP vs Future Features

### 10.1 MVP (Phase 1: Core Mobile App)

- Tab navigation (Map, Queue, Alerts, Settings)
- Background location + proximity alerts
- Lead detail modal with call button
- 5 field actions (called, knocked, etc.)
- Settings & AsyncStorage persistence
- Dark theme by default

**Scope**: ~3-4 weeks, 1 senior mobile engineer

### 10.2 Future Features (Phase 2+)

- **Photo Evidence**: Capture roof photos at property, attach to lead
- **Offline Map**: Download offline tiles for rural areas
- **Advanced Routing**: Integrate Google Maps Directions API for optimal field route
- **Team Collaboration**: View other contractors' actions, avoid duplicate visits
- **Predictive Routing**: AI-powered route optimization based on score + hail zone
- **AR Roof Inspector**: Augmented reality roof measurement tool
- **Voice Notes**: Record voice memos while driving
- **Crew Management**: Assign leads to crew members, track progress
- **Geofence Triggers**: Automatic check-in/check-out at property boundaries

---

## 11. Testing Strategy

### 11.1 Unit Tests

- API client functions
- Location update logic
- Alert throttling logic
- Settings persistence

**Tool**: Jest + @react-native-testing-library

### 11.2 Integration Tests

- End-to-end: Location → Proximity Check → Alert → Lead Detail
- Settings sync (local ↔ remote)
- Offline caching behavior

**Tool**: Detox (end-to-end testing for RN)

### 11.3 Manual Testing

- Real GPS testing (Xcode simulator location spoofing)
- Background location in both foreground + backgrounded states
- Push notification delivery
- Storm chase scenario (mock storm, verify map filtering)
- Swipe actions (queue reorder, quick actions)

---

## 12. Known Limitations & Considerations

1. **Battery Drain**: Background location tracking every 5 min consumes significant battery. Users advised to enable Battery Saver during long chases.
2. **Network Latency**: Proximity checks depend on network. In rural areas, may take 30-60 sec to sync.
3. **Push Notification Delivery**: iOS/Android may delay notifications 1-5 min. Not guaranteed real-time.
4. **Map Rendering**: 100+ lead pins on-screen may cause 60 FPS drops. Implement clustering at zoom <14.
5. **Geolocation Accuracy**: GPS accuracy varies (5-50 m). Proximity alerts use 100 m buffer to account for error.

---

## 13. Success Metrics

1. **User Adoption**: 80%+ of active contractors on platform use mobile app
2. **Daily Active Users (DAU)**: 40%+ of contractor user base
3. **Lead Conversion**: 15%+ of proximity alerts result in contact/action
4. **Session Duration**: Avg 45+ min per storm chase session
5. **App Retention**: 70% 30-day retention
6. **Crash Rate**: <0.1% crash-free session rate
7. **Push Notification Success**: 95%+ delivery rate
8. **Battery Impact**: <15% additional battery drain vs baseline

---

## Appendix: Data Flow Diagram

```
Contractor (Mobile App)
    ↓
[Background Location Service]
    ↓
POST /api/chase/check-proximity
    ↓
[Backend: Check Proximity]
    ↓
Query leads within radius + score
    ↓
Response: Lead array
    ↓
[Local: Fire Push Notification]
    ↓
Contractor taps notification
    ↓
Open Lead Detail Modal
    ↓
Call / Knock / Leave Card / Schedule / Skip
    ↓
POST /api/chase/action
    ↓
[Backend: Record Action]
    ↓
Update chase_actions table
    ↓
Done
```

---

**Document Version**: 1.0  
**Last Updated**: February 25, 2026  
**Next Review**: Q2 2026 (post-launch)
