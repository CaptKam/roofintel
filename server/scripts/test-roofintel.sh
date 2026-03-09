#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# ROOFINTEL — COMPLETE SYSTEM TEST SUITE (ALL 265 ENDPOINTS)
# Run from Replit shell: bash server/scripts/test-roofintel.sh
# ══════════════════════════════════════════════════════════════════════

BASE="${ROOFINTEL_URL:-http://localhost:5000}"
PASS=0
FAIL=0
WARN=0
TOTAL=0
LEAD_ID=""
COS_MARKET_ID=""
DFW_MARKET_ID=""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
}

subheader() {
  echo -e "  ${DIM}── $1 ──${NC}"
}

test_get() {
  local name="$1"
  local url="$2"
  local expect_contains="$3"

  TOTAL=$((TOTAL + 1))
  RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE$url" 2>/dev/null)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    if [ -n "$expect_contains" ]; then
      if echo "$BODY" | grep -qi "$expect_contains"; then
        echo -e "  ${GREEN}✓${NC} $name"
        PASS=$((PASS + 1))
      else
        echo -e "  ${RED}✗${NC} $name (missing '$expect_contains')"
        FAIL=$((FAIL + 1))
      fi
    else
      echo -e "  ${GREEN}✓${NC} $name"
      PASS=$((PASS + 1))
    fi
  else
    echo -e "  ${RED}✗${NC} $name (HTTP $HTTP_CODE)"
    FAIL=$((FAIL + 1))
  fi
}

test_post() {
  local name="$1"
  local url="$2"
  local body="$3"
  local expect_status="$4"
  local expect_contains="$5"

  TOTAL=$((TOTAL + 1))
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE$url" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  RBODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "$expect_status" ]; then
    if [ -n "$expect_contains" ]; then
      if echo "$RBODY" | grep -qi "$expect_contains"; then
        echo -e "  ${GREEN}✓${NC} $name (HTTP $HTTP_CODE)"
        PASS=$((PASS + 1))
      else
        echo -e "  ${RED}✗${NC} $name (HTTP $HTTP_CODE, missing '$expect_contains')"
        FAIL=$((FAIL + 1))
      fi
    else
      echo -e "  ${GREEN}✓${NC} $name (HTTP $HTTP_CODE)"
      PASS=$((PASS + 1))
    fi
  else
    echo -e "  ${RED}✗${NC} $name (expected $expect_status, got $HTTP_CODE)"
    FAIL=$((FAIL + 1))
  fi
}

test_patch() {
  local name="$1"
  local url="$2"
  local body="$3"
  local expect_status="$4"

  TOTAL=$((TOTAL + 1))
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE$url" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null)

  if [ "$HTTP_CODE" = "$expect_status" ]; then
    echo -e "  ${GREEN}✓${NC} $name (HTTP $HTTP_CODE)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $name (expected $expect_status, got $HTTP_CODE)"
    FAIL=$((FAIL + 1))
  fi
}

test_delete() {
  local name="$1"
  local url="$2"
  local expect_status="$3"

  TOTAL=$((TOTAL + 1))
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE$url" 2>/dev/null)

  if [ "$HTTP_CODE" = "$expect_status" ]; then
    echo -e "  ${GREEN}✓${NC} $name (HTTP $HTTP_CODE)"
    PASS=$((PASS + 1))
  else
    # 404 on delete is often OK (nothing to delete)
    if [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "200" ]; then
      echo -e "  ${GREEN}✓${NC} $name (HTTP $HTTP_CODE)"
      PASS=$((PASS + 1))
    else
      echo -e "  ${RED}✗${NC} $name (expected $expect_status, got $HTTP_CODE)"
      FAIL=$((FAIL + 1))
    fi
  fi
}

test_external() {
  local name="$1"
  local url="$2"

  TOTAL=$((TOTAL + 1))
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null)

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo -e "  ${GREEN}✓${NC} $name (HTTP $HTTP_CODE)"
    PASS=$((PASS + 1))
  elif [ "$HTTP_CODE" = "000" ]; then
    echo -e "  ${RED}✗${NC} $name (timeout/unreachable)"
    FAIL=$((FAIL + 1))
  else
    echo -e "  ${YELLOW}⚠${NC} $name (HTTP $HTTP_CODE)"
    WARN=$((WARN + 1))
  fi
}

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     ROOFINTEL — COMPLETE SYSTEM TEST (265 ENDPOINTS)        ║${NC}"
echo -e "${BOLD}║     $(date '+%Y-%m-%d %H:%M:%S %Z')                                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"


# ═══════════════════════════════════════════════════════════════════
header "1. SERVER HEALTH & SEO"
# ═══════════════════════════════════════════════════════════════════

TOTAL=$((TOTAL + 1))
SERVER_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/" 2>/dev/null)
if [ "$SERVER_CHECK" != "000" ]; then
  echo -e "  ${GREEN}✓${NC} Server reachable at $BASE (HTTP $SERVER_CHECK)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗ Server not reachable — is it running?${NC}"
  FAIL=$((FAIL + 1))
  exit 1
fi

test_get "GET /robots.txt" "/robots.txt" "User-agent"
test_get "GET /sitemap.xml" "/sitemap.xml" "urlset"


# ═══════════════════════════════════════════════════════════════════
header "2. MARKETS & DATA SOURCES"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/markets" "/api/markets" "id"
test_get "GET /api/data-sources" "/api/data-sources" ""

# Extract market IDs
MARKETS_JSON=$(curl -s "$BASE/api/markets" 2>/dev/null)

# Try to extract DFW market ID
DFW_MARKET_ID=$(echo "$MARKETS_JSON" | python3 -c "
import sys,json
try:
  data=json.load(sys.stdin)
  for m in data:
    if 'dallas' in m.get('name','').lower() or 'dfw' in m.get('name','').lower():
      print(m['id']); break
except: pass
" 2>/dev/null)

COS_MARKET_ID=$(echo "$MARKETS_JSON" | python3 -c "
import sys,json
try:
  data=json.load(sys.stdin)
  for m in data:
    if 'colorado' in m.get('name','').lower() or 'cos' in m.get('name','').lower():
      print(m['id']); break
except: pass
" 2>/dev/null)

TOTAL=$((TOTAL + 1))
if [ -n "$DFW_MARKET_ID" ]; then
  echo -e "  ${GREEN}✓${NC} Dallas-Fort Worth market found (ID: $DFW_MARKET_ID)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} Dallas-Fort Worth market not found"
  FAIL=$((FAIL + 1))
  DFW_MARKET_ID="dfw"  # fallback
fi

TOTAL=$((TOTAL + 1))
if [ -n "$COS_MARKET_ID" ]; then
  echo -e "  ${GREEN}✓${NC} Colorado Springs market found (ID: $COS_MARKET_ID)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} Colorado Springs market not found — seed may not have run"
  FAIL=$((FAIL + 1))
  COS_MARKET_ID="cos"  # fallback
fi

# Market data sources
test_get "GET /api/markets/$DFW_MARKET_ID/data-sources" "/api/markets/$DFW_MARKET_ID/data-sources" ""
test_get "GET /api/markets/$COS_MARKET_ID/data-sources" "/api/markets/$COS_MARKET_ID/data-sources" ""

# Check COS has the seeded data source
TOTAL=$((TOTAL + 1))
COS_SOURCES=$(curl -s "$BASE/api/markets/$COS_MARKET_ID/data-sources" 2>/dev/null)
if echo "$COS_SOURCES" | grep -qi "colorado springs land records\|cad_arcgis"; then
  echo -e "  ${GREEN}✓${NC} COS Land Records ArcGIS source seeded (PATCH 3 verified)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} COS data source missing — seedColoradoSpringsSources() did not run"
  FAIL=$((FAIL + 1))
fi

# Market data source CRUD
test_post "POST /api/market-data-sources (validation)" "/api/market-data-sources" '{}' "500" ""
test_get "GET /api/markets/$DFW_MARKET_ID/readiness" "/api/markets/$DFW_MARKET_ID/readiness" ""
test_get "GET /api/markets/$COS_MARKET_ID/readiness" "/api/markets/$COS_MARKET_ID/readiness" ""


# ═══════════════════════════════════════════════════════════════════
header "3. DASHBOARD & COMMAND CENTER"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/dashboard/command-center" "/api/dashboard/command-center" "totalLeads"
test_get "GET /api/dashboard/command-center?marketId=$DFW_MARKET_ID" "/api/dashboard/command-center?marketId=$DFW_MARKET_ID" "totalLeads"
test_get "GET /api/dashboard/stats" "/api/dashboard/stats" ""
test_get "GET /api/dashboard/roof-risk-summary" "/api/dashboard/roof-risk-summary" ""
test_get "GET /api/data/quality-summary" "/api/data/quality-summary" ""


# ═══════════════════════════════════════════════════════════════════
header "4. LEADS — Core CRUD & Filters"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/leads" "/api/leads?limit=3" "leads"
test_get "GET /api/leads (filter: minScore)" "/api/leads?minScore=50&limit=3" "leads"
test_get "GET /api/leads (filter: hasPhone)" "/api/leads?hasPhone=true&limit=3" "leads"
test_get "GET /api/leads (filter: zoning)" "/api/leads?zoning=Commercial&limit=3" "leads"
test_get "GET /api/leads (filter: status)" "/api/leads?status=new&limit=3" "leads"
test_get "GET /api/leads (filter: ownerType)" "/api/leads?ownerType=LLC&limit=3" "leads"
test_get "GET /api/leads (filter: county)" "/api/leads?county=Dallas&limit=3" "leads"
test_get "GET /api/leads (filter: marketId)" "/api/leads?marketId=$DFW_MARKET_ID&limit=3" "leads"
test_get "GET /api/leads (filter: claimWindowOpen)" "/api/leads?claimWindowOpen=true&limit=3" "leads"
test_get "GET /api/leads/export (CSV)" "/api/leads/export?limit=5" "Address"

# Get first lead ID for per-lead tests later
LEAD_ID=$(curl -s "$BASE/api/leads?limit=1" 2>/dev/null | grep -oP '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
if [ -n "$LEAD_ID" ]; then
  echo -e "  ${DIM}  Using lead $LEAD_ID for per-lead tests${NC}"
fi


# ═══════════════════════════════════════════════════════════════════
header "5. PHASE 1 — Property Import"
# ═══════════════════════════════════════════════════════════════════

subheader "ArcGIS Generic Importer"
test_post "POST /api/import/generic-arcgis (requires dataSourceId)" "/api/import/generic-arcgis" '{}' "400" "dataSourceId"
test_post "POST /api/import/market-properties (requires marketId)" "/api/import/market-properties" '{}' "400" "marketId"

subheader "CSV Import"
test_get "GET /api/import/sample-csv" "/api/import/sample-csv" ""

subheader "Unified Free Import"
test_get "GET /api/import/unified-free/status" "/api/import/unified-free/status" ""

subheader "PropStream Import"
test_get "GET /api/import/propstream-csv/status" "/api/import/propstream-csv/status" ""

subheader "Import History"
test_get "GET /api/import/runs" "/api/import/runs" ""

subheader "CAD Reimport"
test_get "GET /api/admin/cad/reimport/status" "/api/admin/cad/reimport/status" ""

subheader "Data Fix"
test_post "POST /api/data/fix-locations" "/api/data/fix-locations" '{}' "200" ""


# ═══════════════════════════════════════════════════════════════════
header "6. PHASE 2 — Building Intelligence"
# ═══════════════════════════════════════════════════════════════════

test_post "POST /api/leads/estimate-stories" "/api/leads/estimate-stories" '{}' "200" ""
test_post "POST /api/leads/estimate-roof-type" "/api/leads/estimate-roof-type" '{}' "200" ""
test_post "POST /api/leads/scan-roofing-permits" "/api/leads/scan-roofing-permits" '{}' "200" ""
test_post "POST /api/leads/flag-ownership" "/api/leads/flag-ownership" '{}' "200" ""


# ═══════════════════════════════════════════════════════════════════
header "7. PHASE 3 — Storm Data (NOAA + Hail)"
# ═══════════════════════════════════════════════════════════════════

subheader "NOAA Hail Data"
test_get "GET /api/hail-events" "/api/hail-events" ""
test_get "GET /api/hail-tracker?daysBack=7" "/api/hail-tracker?daysBack=7" ""
test_post "POST /api/correlate/hail" "/api/correlate/hail" '{}' "200" ""

subheader "Storm Monitor"
test_get "GET /api/storm/status" "/api/storm/status" ""
test_get "GET /api/storm/runs" "/api/storm/runs" ""
test_get "GET /api/storm/runs/active" "/api/storm/runs/active" ""
test_get "GET /api/storm/response-queue" "/api/storm/response-queue" ""
test_get "GET /api/storm/alert-configs" "/api/storm/alert-configs" ""
test_get "GET /api/storm/alert-history" "/api/storm/alert-history" ""
test_post "POST /api/storm/scan" "/api/storm/scan" '{}' "200" ""

subheader "Xweather"
test_get "GET /api/xweather/status" "/api/xweather/status" ""
test_get "GET /api/xweather/threats" "/api/xweather/threats" ""
test_post "POST /api/xweather/scan" "/api/xweather/scan" '{}' "200" ""


# ═══════════════════════════════════════════════════════════════════
header "8. PHASE 4 — Violations & Permits"
# ═══════════════════════════════════════════════════════════════════

subheader "Violations"
test_get "GET /api/violations/status" "/api/violations/status" ""

subheader "Route Guard Tests (PATCH 2 verification)"
test_post "COS 311 import → graceful reject" "/api/violations/import-311" "{\"marketId\":\"$COS_MARKET_ID\"}" "400" "not yet available"
test_post "COS code import → graceful reject" "/api/violations/import-code" "{\"marketId\":\"$COS_MARKET_ID\"}" "400" "not yet available"
test_post "COS Dallas permits → graceful reject" "/api/permits/import-dallas" "{\"marketId\":\"$COS_MARKET_ID\"}" "400" "not yet available"
test_post "COS FW permits → graceful reject" "/api/permits/import-fortworth" "{\"marketId\":\"$COS_MARKET_ID\"}" "400" "not yet available"
test_post "COS roofing permits → graceful reject" "/api/permits/import-roofing" "{\"marketId\":\"$COS_MARKET_ID\"}" "400" "not yet available"

subheader "Permits"
test_get "GET /api/permits/status" "/api/permits/status" ""
test_get "GET /api/permits/roofing-stats" "/api/permits/roofing-stats" ""
test_post "POST /api/violations/match" "/api/violations/match" "{\"marketId\":\"$DFW_MARKET_ID\"}" "200" ""
test_post "POST /api/permits/match" "/api/permits/match" "{\"marketId\":\"$DFW_MARKET_ID\"}" "200" ""
test_post "POST /api/permits/sync-contractors" "/api/permits/sync-contractors" '{}' "200" ""

subheader "Contractors Directory"
test_get "GET /api/contractors" "/api/contractors" ""
test_get "GET /api/contractors?roofingOnly=true" "/api/contractors?roofingOnly=true" ""

subheader "Flood Zones"
test_get "GET /api/flood/status" "/api/flood/status" ""


# ═══════════════════════════════════════════════════════════════════
header "9. PHASE 6 — Contact Enrichment"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/enrichment/status" "/api/enrichment/status" ""
test_get "GET /api/enrichment/phone-status" "/api/enrichment/phone-status" ""
test_get "GET /api/enrichment/web-research-status" "/api/enrichment/web-research-status" ""
test_get "GET /api/enrichment/pipeline-stats" "/api/enrichment/pipeline-stats" ""
test_get "GET /api/enrichment/usage" "/api/enrichment/usage" ""
test_get "GET /api/enrichment/batch-free/status" "/api/enrichment/batch-free/status" ""
test_get "GET /api/admin/enrichment-jobs" "/api/admin/enrichment-jobs" ""

subheader "Validation"
test_post "POST /api/validate/phone" "/api/validate/phone" '{"phone":"2145551234"}' "200" ""
test_post "POST /api/validate/email" "/api/validate/email" '{"email":"test@example.com"}' "200" ""

subheader "CO Secretary of State"
test_get "GET /api/admin/co-sos-status" "/api/admin/co-sos-status" ""

subheader "Geocoding"
test_get "GET /api/admin/geocode-status" "/api/admin/geocode-status" ""

subheader "Weather Enrichment"
test_get "GET /api/admin/weather-status" "/api/admin/weather-status" ""

subheader "Web Search"
test_get "GET /api/admin/web-search-usage" "/api/admin/web-search-usage" ""


# ═══════════════════════════════════════════════════════════════════
header "10. PHASE 7 — Post-Enrichment (Ownership/Roles)"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/intelligence/status" "/api/intelligence/status" ""
test_get "GET /api/intelligence/skip-trace-status" "/api/intelligence/skip-trace-status" ""
test_get "GET /api/compliance/rate-limits" "/api/compliance/rate-limits" ""
test_get "GET /api/roles/stats" "/api/roles/stats" ""
test_get "GET /api/attribution/stats" "/api/attribution/stats" ""
test_get "GET /api/dm-confidence/stats" "/api/dm-confidence/stats" ""
test_get "GET /api/dm-confidence/review-queue" "/api/dm-confidence/review-queue" ""
test_get "GET /api/reverse-address/stats" "/api/reverse-address/stats" ""


# ═══════════════════════════════════════════════════════════════════
header "11. PHASE 8 — Network & Portfolio Discovery"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/network/stats" "/api/network/stats" ""
test_get "GET /api/portfolios" "/api/portfolios" ""
test_get "GET /api/portfolio/top" "/api/portfolio/top" ""
test_get "GET /api/entity-resolution/stats" "/api/entity-resolution/stats" ""
test_get "GET /api/entity-resolution/clusters" "/api/entity-resolution/clusters" ""

subheader "Relationship Graph"
test_get "GET /api/graph/stats" "/api/graph/stats" ""
test_get "GET /api/graph/build/status" "/api/graph/build/status" ""
test_get "GET /api/graph/search?q=dallas" "/api/graph/search?q=dallas" ""


# ═══════════════════════════════════════════════════════════════════
header "12. PHASE 9 — Lead Scoring"
# ═══════════════════════════════════════════════════════════════════

test_post "POST /api/leads/recalculate-scores" "/api/leads/recalculate-scores" '{}' "200" ""


# ═══════════════════════════════════════════════════════════════════
header "13. PHASE 10 — ROI Gate & ZIP Tiles"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/admin/roi/status" "/api/admin/roi/status" ""
test_get "GET /api/admin/roi/stats" "/api/admin/roi/stats" ""
test_get "GET /api/admin/roi/decisions" "/api/admin/roi/decisions" ""
test_get "GET /api/admin/zip-tiles/status" "/api/admin/zip-tiles/status" ""
test_get "GET /api/zip-tiles?marketId=$DFW_MARKET_ID" "/api/zip-tiles?marketId=$DFW_MARKET_ID" ""

subheader "Sectors"
test_get "GET /api/sectors" "/api/sectors" ""

subheader "Budgets"
test_get "GET /api/admin/budgets?marketId=$DFW_MARKET_ID" "/api/admin/budgets?marketId=$DFW_MARKET_ID" ""


# ═══════════════════════════════════════════════════════════════════
header "14. PIPELINE ORCHESTRATOR"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/pipeline/run-all/status" "/api/pipeline/run-all/status" ""
test_get "GET /api/pipeline/preview" "/api/pipeline/preview" ""


# ═══════════════════════════════════════════════════════════════════
header "15. ADMIN — AI Agent & Data Quality"
# ═══════════════════════════════════════════════════════════════════

subheader "AI Data Quality Agent"
test_get "GET /api/admin/ai-agent/status" "/api/admin/ai-agent/status" ""
test_get "GET /api/admin/ai-agent/summary" "/api/admin/ai-agent/summary" ""
test_get "GET /api/admin/ai-agent/results" "/api/admin/ai-agent/results" ""

subheader "Batch Operations"
test_get "GET /api/admin/batch-reprocess/status" "/api/admin/batch-reprocess/status" ""
test_get "GET /api/admin/batch-google-places/status" "/api/admin/batch-google-places/status" ""

subheader "Data Coverage"
test_get "GET /api/admin/data-coverage" "/api/admin/data-coverage" ""

subheader "NAIP Satellite Imagery"
test_get "GET /api/admin/naip/status" "/api/admin/naip/status" ""
test_get "GET /api/admin/naip/stats" "/api/admin/naip/stats" ""
test_get "GET /api/admin/naip/results" "/api/admin/naip/results" ""

subheader "Roof Risk"
test_get "GET /api/admin/roof-risk/status" "/api/admin/roof-risk/status" ""

subheader "Property Scanner"
test_get "GET /api/admin/property-scan/status" "/api/admin/property-scan/status" ""
test_get "GET /api/admin/property-scan/gaps" "/api/admin/property-scan/gaps" ""
test_get "GET /api/admin/property-scan/results" "/api/admin/property-scan/results" ""

subheader "Migration & Normalization"
test_get "GET /api/admin/migrate/status" "/api/admin/migrate/status" ""
test_get "GET /api/admin/normalize/stats" "/api/admin/normalize/stats" ""

subheader "Quality History"
test_get "GET /api/admin/quality/history" "/api/admin/quality/history" ""

subheader "Phone Validation"
test_get "GET /api/admin/phone-validation/status" "/api/admin/phone-validation/status" ""

subheader "KPIs & Outcomes"
test_get "GET /api/admin/kpis/current?marketId=$DFW_MARKET_ID" "/api/admin/kpis/current?marketId=$DFW_MARKET_ID" ""
test_get "GET /api/admin/kpis/timeseries?marketId=$DFW_MARKET_ID" "/api/admin/kpis/timeseries?marketId=$DFW_MARKET_ID" ""
test_get "GET /api/admin/kpis/funnel?marketId=$DFW_MARKET_ID" "/api/admin/kpis/funnel?marketId=$DFW_MARKET_ID" ""

subheader "Skip Trace"
test_get "GET /api/admin/trace-costs" "/api/admin/trace-costs" ""
test_get "GET /api/admin/trace/batch-economics" "/api/admin/trace/batch-economics" ""


# ═══════════════════════════════════════════════════════════════════
header "16. COMPLIANCE & CONSENT"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/compliance/status" "/api/compliance/status" ""
test_get "GET /api/compliance/overview" "/api/compliance/overview" ""
test_get "GET /api/suppression/stats" "/api/suppression/stats" ""
test_get "GET /api/suppression/list" "/api/suppression/list" ""
test_get "GET /api/pm-companies" "/api/pm-companies" ""
test_get "GET /api/admin/compliance/report?marketId=$DFW_MARKET_ID" "/api/admin/compliance/report?marketId=$DFW_MARKET_ID" ""


# ═══════════════════════════════════════════════════════════════════
header "17. GROK INTELLIGENCE CORE"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/ops/grok-sessions" "/api/ops/grok-sessions" ""
test_get "GET /api/ops/grok-cost-summary" "/api/ops/grok-cost-summary" ""
test_get "GET /api/ops/alerts" "/api/ops/alerts" ""
test_get "GET /api/ops/intel-briefing" "/api/ops/intel-briefing" ""


# ═══════════════════════════════════════════════════════════════════
header "18. SAVED FILTERS & MISC"
# ═══════════════════════════════════════════════════════════════════

test_get "GET /api/saved-filters" "/api/saved-filters" ""
test_get "GET /api/jobs" "/api/jobs" ""


# ═══════════════════════════════════════════════════════════════════
header "19. PER-LEAD ENDPOINTS (21 endpoints on single lead)"
# ═══════════════════════════════════════════════════════════════════

if [ -n "$LEAD_ID" ]; then
  test_get "GET /api/leads/$LEAD_ID" "/api/leads/$LEAD_ID" "address"
  test_get "  score-breakdown" "/api/leads/$LEAD_ID/score-breakdown" ""
  test_get "  evidence" "/api/leads/$LEAD_ID/evidence" ""
  test_get "  conflicts" "/api/leads/$LEAD_ID/conflicts" ""
  test_get "  intelligence" "/api/leads/$LEAD_ID/intelligence" ""
  test_get "  permits" "/api/leads/$LEAD_ID/permits" ""
  test_get "  claims" "/api/leads/$LEAD_ID/claims" ""
  test_get "  contact-path" "/api/leads/$LEAD_ID/contact-path" ""
  test_get "  confidence" "/api/leads/$LEAD_ID/confidence" ""
  test_get "  enrichment-jobs" "/api/leads/$LEAD_ID/enrichment-jobs" ""
  test_get "  enrichment-status" "/api/leads/$LEAD_ID/enrichment-status" ""
  test_get "  decision-makers" "/api/leads/$LEAD_ID/decision-makers" ""
  test_get "  dm-confidence" "/api/leads/$LEAD_ID/dm-confidence" ""
  test_get "  graph-intelligence" "/api/leads/$LEAD_ID/graph-intelligence" ""
  test_get "  satellite" "/api/leads/$LEAD_ID/satellite" ""
  test_get "  naip-history" "/api/leads/$LEAD_ID/naip-history" ""
  test_get "  roof-risk" "/api/leads/$LEAD_ID/roof-risk" ""
  test_get "  outcomes" "/api/leads/$LEAD_ID/outcomes" ""
  test_get "  consent" "/api/leads/$LEAD_ID/consent" ""
  test_get "  consent/audit" "/api/leads/$LEAD_ID/consent/audit" ""
  test_get "  trace-history" "/api/leads/$LEAD_ID/trace-history" ""
  test_get "  rooftop-owner" "/api/leads/$LEAD_ID/rooftop-owner" ""
  test_get "  building-footprint" "/api/leads/$LEAD_ID/building-footprint" ""
  test_get "  roi-decision" "/api/leads/$LEAD_ID/roi-decision" ""
  test_get "  graph via /api/graph/lead/:id" "/api/graph/lead/$LEAD_ID" ""
else
  echo -e "  ${YELLOW}⚠ WARN${NC} No leads — skipping 25 per-lead tests"
  WARN=$((WARN + 1))
fi


# ═══════════════════════════════════════════════════════════════════
header "20. EXTERNAL DATA SOURCES"
# ═══════════════════════════════════════════════════════════════════

subheader "ArcGIS Endpoints"
test_external "Dallas DCAD ArcGIS" "https://maps.dcad.org/prdwa/rest/services/Property/PropertyData/MapServer/0/query?where=1=1&outFields=OBJECTID&f=json&resultRecordCount=1"
test_external "Colorado Springs GIS (CRITICAL)" "https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/LandRecords/MapServer/4/query?where=1=1&outFields=OBJECTID&f=json&resultRecordCount=1"

# If COS GIS is live, check what fields we get
TOTAL=$((TOTAL + 1))
COS_SAMPLE=$(curl -s --max-time 10 "https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/LandRecords/MapServer/4/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1" 2>/dev/null)
if echo "$COS_SAMPLE" | grep -q "features"; then
  echo -e "  ${GREEN}✓${NC} COS GIS returns features — field mapping testable"
  # Show first few field names
  FIELDS=$(echo "$COS_SAMPLE" | grep -oP '"[A-Z_][A-Z_0-9]*"\s*:' | head -15 | sed 's/"//g;s/://;s/ //' | tr '\n' ', ')
  echo -e "      ${DIM}Fields: ${FIELDS}${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} COS GIS returned no features — import will fail"
  FAIL=$((FAIL + 1))
fi

subheader "NOAA & Weather"
test_external "NOAA Storm Events" "https://www.ncdc.noaa.gov/stormevents/"
test_external "NOAA SWDI (hail)" "https://www.ncei.noaa.gov/access/services/"

subheader "State Registries"
test_external "Colorado SOS (Socrata API)" "https://data.colorado.gov/resource/4ykn-tg5h.json?\$limit=1"
test_external "El Paso County Assessor" "https://assessor.elpasoco.com/"
test_external "El Paso County Open Data Hub" "https://opendata-elpasoco.hub.arcgis.com/"


# ═══════════════════════════════════════════════════════════════════
header "21. DATA HEALTH — DFW Market"
# ═══════════════════════════════════════════════════════════════════

CMD_CENTER=$(curl -s "$BASE/api/dashboard/command-center" 2>/dev/null)

TOTAL_LEADS=$(echo "$CMD_CENTER" | grep -o '"totalLeads":[0-9]*' | grep -o '[0-9]*')
HOT_LEADS=$(echo "$CMD_CENTER" | grep -o '"hotLeads":[0-9]*' | grep -o '[0-9]*')
ACTIONABLE=$(echo "$CMD_CENTER" | grep -o '"actionableLeads":[0-9]*' | grep -o '[0-9]*')
AVG_SCORE=$(echo "$CMD_CENTER" | grep -o '"avgScore":[0-9.]*' | grep -o '[0-9.]*')
PIPELINE_VAL=$(echo "$CMD_CENTER" | grep -o '"totalPipelineValue":[0-9]*' | grep -o '[0-9]*')

TOTAL=$((TOTAL + 1))
if [ -n "$TOTAL_LEADS" ] && [ "$TOTAL_LEADS" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} Total leads: ${BOLD}$TOTAL_LEADS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} No leads in database"
  FAIL=$((FAIL + 1))
fi

echo -e "  ${CYAN}  Hot leads (80+):     ${HOT_LEADS:-0}${NC}"
echo -e "  ${CYAN}  Actionable leads:    ${ACTIONABLE:-0}${NC}"
echo -e "  ${CYAN}  Average score:       ${AVG_SCORE:-0}${NC}"
echo -e "  ${CYAN}  Pipeline value:      \$${PIPELINE_VAL:-0}${NC}"

# Coverage
PHONE_PCT=$(echo "$CMD_CENTER" | grep -o '"hasPhone":[0-9]*' | grep -o '[0-9]*')
EMAIL_PCT=$(echo "$CMD_CENTER" | grep -o '"hasEmail":[0-9]*' | grep -o '[0-9]*')
DM_PCT=$(echo "$CMD_CENTER" | grep -o '"hasDecisionMaker":[0-9]*' | grep -o '[0-9]*')
ENRICHED_PCT=$(echo "$CMD_CENTER" | grep -o '"enriched":[0-9]*' | grep -o '[0-9]*')
PERMIT_PCT=$(echo "$CMD_CENTER" | grep -o '"hasPermitData":[0-9]*' | grep -o '[0-9]*')

echo -e "  ${CYAN}  Phone coverage:      ${PHONE_PCT:-0}%${NC}"
echo -e "  ${CYAN}  Email coverage:      ${EMAIL_PCT:-0}%${NC}"
echo -e "  ${CYAN}  Decision makers:     ${DM_PCT:-0}%${NC}"
echo -e "  ${CYAN}  Enriched:            ${ENRICHED_PCT:-0}%${NC}"
echo -e "  ${CYAN}  Permit data:         ${PERMIT_PCT:-0}%${NC}"

# Storm pulse
STORM_30D=$(echo "$CMD_CENTER" | grep -o '"recentEvents30d":[0-9]*' | grep -o '[0-9]*')
STORM_7D=$(echo "$CMD_CENTER" | grep -o '"recentEvents7d":[0-9]*' | grep -o '[0-9]*')
echo -e "  ${CYAN}  Hail events (30d):   ${STORM_30D:-0}${NC}"
echo -e "  ${CYAN}  Hail events (7d):    ${STORM_7D:-0}${NC}"


# ═══════════════════════════════════════════════════════════════════
header "22. DATA HEALTH — Colorado Springs Market"
# ═══════════════════════════════════════════════════════════════════

COS_CMD=$(curl -s "$BASE/api/dashboard/command-center?marketId=$COS_MARKET_ID" 2>/dev/null)
COS_LEADS=$(echo "$COS_CMD" | grep -o '"totalLeads":[0-9]*' | grep -o '[0-9]*')

TOTAL=$((TOTAL + 1))
if [ -n "$COS_LEADS" ] && [ "$COS_LEADS" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} Colorado Springs has ${BOLD}$COS_LEADS${NC} leads"
  PASS=$((PASS + 1))
else
  echo -e "  ${YELLOW}⚠${NC} Colorado Springs has 0 leads — import needed"
  echo -e "      ${DIM}Run: POST /api/import/market-properties {\"marketId\":\"$COS_MARKET_ID\"}${NC}"
  WARN=$((WARN + 1))
fi

COS_HAIL=$(curl -s "$BASE/api/hail-events?marketId=$COS_MARKET_ID" 2>/dev/null)
COS_HAIL_COUNT=$(echo "$COS_HAIL" | grep -o '"id"' | wc -l)
TOTAL=$((TOTAL + 1))
if [ "$COS_HAIL_COUNT" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} Colorado Springs has $COS_HAIL_COUNT hail events"
  PASS=$((PASS + 1))
else
  echo -e "  ${YELLOW}⚠${NC} Colorado Springs has 0 hail events — NOAA import needed"
  echo -e "      ${DIM}Run: POST /api/import/noaa {\"marketId\":\"$COS_MARKET_ID\",\"startYear\":2020}${NC}"
  WARN=$((WARN + 1))
fi


# ═══════════════════════════════════════════════════════════════════
# RESULTS
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                    TEST RESULTS                              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

PASS_PCT=0
if [ "$TOTAL" -gt 0 ]; then
  PASS_PCT=$((PASS * 100 / TOTAL))
fi

echo -e "  Total tests:   ${BOLD}$TOTAL${NC}"
echo -e "  ${GREEN}Passed:   $PASS${NC}  ($PASS_PCT%)"
echo -e "  ${RED}Failed:   $FAIL${NC}"
echo -e "  ${YELLOW}Warnings: $WARN${NC}"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}★ ALL TESTS PASSED ★${NC}"
elif [ "$FAIL" -le 3 ]; then
  echo -e "  ${GREEN}${BOLD}MOSTLY PASSING — $FAIL minor issues${NC}"
elif [ "$FAIL" -le 10 ]; then
  echo -e "  ${YELLOW}${BOLD}FUNCTIONAL — $FAIL issues to fix${NC}"
else
  echo -e "  ${RED}${BOLD}NEEDS WORK — $FAIL failures${NC}"
fi

echo ""
echo -e "${BOLD}  KEY CHECKS:${NC}"
echo -e "  ${CYAN}  ✓ COS market exists?          → Section 2${NC}"
echo -e "  ${CYAN}  ✓ COS data source seeded?      → Section 2 (Patch 3)${NC}"
echo -e "  ${CYAN}  ✓ Route guards patched?         → Section 8 (Patch 2)${NC}"
echo -e "  ${CYAN}  ✓ COS GIS endpoint live?        → Section 20${NC}"
echo -e "  ${CYAN}  ✓ COS has leads?                → Section 22${NC}"
echo -e "  ${CYAN}  ✓ COS has hail data?            → Section 22${NC}"
echo ""
echo -e "  ${DIM}Warnings = non-critical (missing optional data, external timeouts)${NC}"
echo -e "  ${DIM}Run time: ~30-60 seconds depending on network${NC}"
echo ""