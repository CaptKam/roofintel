import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { PageMeta } from "@/components/page-meta";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarket } from "@/hooks/use-market";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScoreBadge, ScoreDot } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Building2,
  MapPin,
  Ruler,
  Calendar,
  CloudLightning,
  SlidersHorizontal,
  X,
  ChevronRight,
  ChevronLeft,
  User,
  Phone,
  Mail,
  Fingerprint,
  HardHat,
  Download,
  DollarSign,
  Shield,
  Layers,
  CircleCheck,
  CircleMinus,
  CircleAlert,
  ShieldAlert,
  ArrowUpDown,
  Flame,
} from "lucide-react";
import { SavedFilterBar } from "@/components/saved-filter-bar";
import { AIFilterBar } from "@/components/ai-filter-bar";
import type { Lead } from "@shared/schema";

const PAGE_SIZE = 50;

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

export default function Leads() {
  const { toast } = useToast();
  const { activeMarket } = useMarket();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [county, setCounty] = useState<string>(urlParams.get("county") || "");
  const [minScore, setMinScore] = useState<string>(urlParams.get("minScore") || "");
  const [zoning, setZoning] = useState<string>(urlParams.get("zoning") || "");
  const [status, setStatus] = useState<string>(urlParams.get("status") || "");
  const [hasPhone, setHasPhone] = useState(urlParams.get("hasPhone") === "true");
  const [minRoofAge, setMinRoofAge] = useState<string>(urlParams.get("minRoofAge") || "");
  const [minRoofArea, setMinRoofArea] = useState<string>(urlParams.get("minRoofArea") || "");
  const [lastHailWithin, setLastHailWithin] = useState<string>(urlParams.get("lastHailWithin") || "");
  const [claimWindowOpen, setClaimWindowOpen] = useState(urlParams.get("claimWindowOpen") === "true");
  const [minPropertyValue, setMinPropertyValue] = useState<string>(urlParams.get("minPropertyValue") || "");
  const [ownershipStructure, setOwnershipStructure] = useState<string>(urlParams.get("ownershipStructure") || "");
  const [roofType, setRoofType] = useState<string>(urlParams.get("roofType") || "");
  const [riskTier, setRiskTier] = useState<string>(urlParams.get("riskTier") || "");
  const [sortBy, setSortBy] = useState<string>(urlParams.get("sortBy") || "");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(!!urlParams.get("minScore") || !!urlParams.get("county") || !!urlParams.get("zoning") || !!urlParams.get("status") || urlParams.get("hasPhone") === "true" || !!urlParams.get("minRoofAge") || !!urlParams.get("minRoofArea") || !!urlParams.get("lastHailWithin") || urlParams.get("claimWindowOpen") === "true" || !!urlParams.get("minPropertyValue") || !!urlParams.get("ownershipStructure") || !!urlParams.get("roofType") || !!urlParams.get("riskTier"));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const fresh = new URLSearchParams(searchString);
    const newMinScore = fresh.get("minScore") || "";
    const newCounty = fresh.get("county") || "";
    const newZoning = fresh.get("zoning") || "";
    const newStatus = fresh.get("status") || "";
    const newHasPhone = fresh.get("hasPhone") === "true";
    const newMinRoofAge = fresh.get("minRoofAge") || "";
    const newMinRoofArea = fresh.get("minRoofArea") || "";
    const newLastHailWithin = fresh.get("lastHailWithin") || "";
    const newClaimWindowOpen = fresh.get("claimWindowOpen") === "true";
    const newMinPropertyValue = fresh.get("minPropertyValue") || "";
    const newOwnershipStructure = fresh.get("ownershipStructure") || "";
    const newRoofType = fresh.get("roofType") || "";
    const newRiskTier = fresh.get("riskTier") || "";
    const newSortBy = fresh.get("sortBy") || "";
    setMinScore(newMinScore);
    setCounty(newCounty);
    setZoning(newZoning);
    setStatus(newStatus);
    setHasPhone(newHasPhone);
    setMinRoofAge(newMinRoofAge);
    setMinRoofArea(newMinRoofArea);
    setLastHailWithin(newLastHailWithin);
    setClaimWindowOpen(newClaimWindowOpen);
    setMinPropertyValue(newMinPropertyValue);
    setOwnershipStructure(newOwnershipStructure);
    setRoofType(newRoofType);
    setRiskTier(newRiskTier);
    setSortBy(newSortBy);
    if (newMinScore || newCounty || newZoning || newStatus || newHasPhone || newMinRoofAge || newMinRoofArea || newLastHailWithin || newClaimWindowOpen || newMinPropertyValue || newOwnershipStructure || newRoofType || newRiskTier) {
      setShowFilters(true);
    }
    setPage(1);
  }, [searchString]);

  useEffect(() => {
    setPage(1);
  }, [activeMarket?.id, debouncedSearch, county, minScore, zoning, status, hasPhone, minRoofAge, minRoofArea, lastHailWithin, claimWindowOpen, minPropertyValue, ownershipStructure, roofType, riskTier, sortBy]);

  const params = new URLSearchParams();
  if (activeMarket?.id) params.set("marketId", activeMarket.id);
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (county) params.set("county", county);
  if (minScore) params.set("minScore", minScore);
  if (zoning) params.set("zoning", zoning);
  if (status) params.set("status", status);
  if (hasPhone) params.set("hasPhone", "true");
  if (minRoofAge) params.set("minRoofAge", minRoofAge);
  if (minRoofArea) params.set("minRoofArea", minRoofArea);
  if (lastHailWithin) params.set("lastHailWithin", lastHailWithin);
  if (claimWindowOpen) params.set("claimWindowOpen", "true");
  if (minPropertyValue) params.set("minPropertyValue", minPropertyValue);
  if (ownershipStructure) params.set("ownershipStructure", ownershipStructure);
  if (roofType) params.set("roofType", roofType);
  if (riskTier) params.set("riskTier", riskTier);
  if (sortBy) params.set("sortBy", sortBy);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String((page - 1) * PAGE_SIZE));

  const queryString = params.toString();

  const { data, isLoading } = useQuery<LeadsResponse>({
    queryKey: [`/api/leads?${queryString}`],
  });

  const { data: roiDecisionsData } = useQuery<Array<{ leadId: string; decisionType: string; roiScore: number }>>({
    queryKey: ["/api/admin/roi/decisions", { limit: 500 }],
    queryFn: async () => {
      const res = await fetch("/api/admin/roi/decisions?limit=500");
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.decisions || [];
    },
  });

  const roiDecisionMap = new Map<string, { decisionType: string; roiScore: number }>();
  if (roiDecisionsData) {
    for (const d of roiDecisionsData) {
      roiDecisionMap.set(d.leadId, { decisionType: d.decisionType, roiScore: d.roiScore });
    }
  }

  const leads = data?.leads;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = county || minScore || zoning || status || hasPhone || minRoofAge || minRoofArea || lastHailWithin || claimWindowOpen || minPropertyValue || ownershipStructure || roofType || riskTier;

  const currentFilterState = {
    county, minScore, zoning, status,
    hasPhone: hasPhone || undefined,
    minRoofAge, minRoofArea, lastHailWithin,
    claimWindowOpen: claimWindowOpen || undefined,
    minPropertyValue, ownershipStructure, roofType, riskTier,
  };

  const applyFilterPreset = (filters: Record<string, any>) => {
    setCounty(filters.county || "");
    setMinScore(filters.minScore ? String(filters.minScore) : "");
    setZoning(filters.zoning || "");
    setStatus(filters.status || "");
    setHasPhone(!!filters.hasPhone);
    setMinRoofAge(filters.minRoofAge ? String(filters.minRoofAge) : "");
    setMinRoofArea(filters.minRoofArea ? String(filters.minRoofArea) : "");
    setLastHailWithin(filters.lastHailWithin ? String(filters.lastHailWithin) : "");
    setClaimWindowOpen(!!filters.claimWindowOpen);
    setMinPropertyValue(filters.minPropertyValue ? String(filters.minPropertyValue) : "");
    setOwnershipStructure(filters.ownershipStructure || "");
    setRoofType(filters.roofType || "");
    setRiskTier(filters.riskTier || "");
    setSortBy(filters.sortBy || "");
    setShowFilters(true);
  };

  const clearFilters = () => {
    setCounty("");
    setMinScore("");
    setZoning("");
    setStatus("");
    setHasPhone(false);
    setMinRoofAge("");
    setMinRoofArea("");
    setLastHailWithin("");
    setClaimWindowOpen(false);
    setMinPropertyValue("");
    setOwnershipStructure("");
    setRoofType("");
    setRiskTier("");
    setSortBy("");
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportParams = new URLSearchParams();
      if (county) exportParams.set("county", county);
      if (minScore) exportParams.set("minScore", minScore);
      if (zoning) exportParams.set("zoning", zoning);
      const res = await fetch(`/api/leads/export?${exportParams.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roofIntel-leads-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: `${total} leads exported to CSV` });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setExporting(false);
  };

  const unmaskedCount = !isLoading && leads ? leads.filter(l => l.managingMember).length : 0;

  return (
    <div className="p-8 space-y-6">
      <PageMeta
        title="Leads"
        description="Browse, filter, and manage commercial roofing leads scored by roof age, hail exposure, and property data. Prioritize your best opportunities."
        path="/leads"
      />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Loading..." : `${total.toLocaleString()} properties`} in your pipeline
            </p>
            {!isLoading && leads && unmaskedCount > 0 && (
              <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] font-normal" data-testid="badge-unmasked-count">
                {unmaskedCount} unmasked
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exporting || isLoading || total === 0}
          data-testid="button-export-csv"
        >
          <Download className="w-4 h-4 mr-1.5" />
          {exporting ? "Exporting..." : "Export CSV"}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input
            placeholder="Search address, owner, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl bg-card"
            data-testid="input-search-leads"
          />
        </div>
        <Button
          variant={minScore === "80" ? "default" : "outline"}
          onClick={() => {
            if (minScore === "80") {
              applyFilterPreset({});
            } else {
              applyFilterPreset({ minScore: "80" });
            }
          }}
          data-testid="button-hot-leads"
          className={minScore === "80" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
        >
          <Flame className="w-4 h-4 mr-1.5" />
          Hot Leads
        </Button>
        <Button
          variant={showFilters ? "secondary" : "outline"}
          onClick={() => setShowFilters(!showFilters)}
          data-testid="button-toggle-filters"
        >
          <SlidersHorizontal className="w-4 h-4 mr-1.5" />
          Filters
          {hasFilters && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              Active
            </Badge>
          )}
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="w-3 h-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <AIFilterBar
        marketId={activeMarket?.id}
        onApplyFilters={applyFilterPreset}
      />

      <SavedFilterBar
        currentFilters={currentFilterState}
        onApplyFilter={applyFilterPreset}
        onClearFilters={clearFilters}
      />

      {showFilters && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">County</label>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger data-testid="select-county">
                    <SelectValue placeholder="All counties" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All counties</SelectItem>
                    <SelectItem value="Dallas">Dallas</SelectItem>
                    <SelectItem value="Tarrant">Tarrant</SelectItem>
                    <SelectItem value="Collin">Collin</SelectItem>
                    <SelectItem value="Denton">Denton</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Min Score</label>
                <Select value={minScore} onValueChange={setMinScore}>
                  <SelectTrigger data-testid="select-min-score">
                    <SelectValue placeholder="Any score" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any score</SelectItem>
                    <SelectItem value="80">80+ (Hot)</SelectItem>
                    <SelectItem value="60">60+ (Warm)</SelectItem>
                    <SelectItem value="40">40+ (Cool)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Zoning</label>
                <Select value={zoning} onValueChange={setZoning}>
                  <SelectTrigger data-testid="select-zoning">
                    <SelectValue placeholder="All zoning" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All zoning</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                    <SelectItem value="Multi-Family">Multi-Family</SelectItem>
                    <SelectItem value="Industrial">Industrial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Contact Info</label>
                <Button
                  variant={hasPhone ? "default" : "outline"}
                  className="w-full toggle-elevate"
                  onClick={() => setHasPhone(!hasPhone)}
                  data-testid="button-filter-has-phone"
                >
                  <Phone className="w-4 h-4 mr-1.5" />
                  Has Phone
                </Button>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Roof & Property Filters</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Roof Age</label>
                  <Select value={minRoofAge} onValueChange={setMinRoofAge}>
                    <SelectTrigger data-testid="select-roof-age">
                      <SelectValue placeholder="Any age" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any age</SelectItem>
                      <SelectItem value="5">5+ years</SelectItem>
                      <SelectItem value="10">10+ years</SelectItem>
                      <SelectItem value="15">15+ years</SelectItem>
                      <SelectItem value="20">20+ years</SelectItem>
                      <SelectItem value="25">25+ years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Roof Area</label>
                  <Select value={minRoofArea} onValueChange={setMinRoofArea}>
                    <SelectTrigger data-testid="select-roof-area">
                      <SelectValue placeholder="Any size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any size</SelectItem>
                      <SelectItem value="5000">5,000+ sqft</SelectItem>
                      <SelectItem value="10000">10,000+ sqft</SelectItem>
                      <SelectItem value="20000">20,000+ sqft</SelectItem>
                      <SelectItem value="50000">50,000+ sqft</SelectItem>
                      <SelectItem value="100000">100,000+ sqft</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Roof Type</label>
                  <Select value={roofType} onValueChange={setRoofType}>
                    <SelectTrigger data-testid="select-roof-type">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="TPO">TPO</SelectItem>
                      <SelectItem value="EPDM">EPDM</SelectItem>
                      <SelectItem value="Modified Bitumen">Modified Bitumen</SelectItem>
                      <SelectItem value="Built-Up (BUR)">Built-Up (BUR)</SelectItem>
                      <SelectItem value="Metal">Metal</SelectItem>
                      <SelectItem value="Shingle">Shingle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Hail Exposure</label>
                  <Select value={lastHailWithin} onValueChange={setLastHailWithin}>
                    <SelectTrigger data-testid="select-hail-exposure">
                      <SelectValue placeholder="Any time" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any time</SelectItem>
                      <SelectItem value="6">Last 6 months</SelectItem>
                      <SelectItem value="12">Last year</SelectItem>
                      <SelectItem value="24">Last 2 years</SelectItem>
                      <SelectItem value="36">Last 3 years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Property Value</label>
                  <Select value={minPropertyValue} onValueChange={setMinPropertyValue}>
                    <SelectTrigger data-testid="select-property-value">
                      <SelectValue placeholder="Any value" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any value</SelectItem>
                      <SelectItem value="1000000">$1M+</SelectItem>
                      <SelectItem value="2000000">$2M+</SelectItem>
                      <SelectItem value="5000000">$5M+</SelectItem>
                      <SelectItem value="10000000">$10M+</SelectItem>
                      <SelectItem value="25000000">$25M+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Owner Type</label>
                  <Select value={ownershipStructure} onValueChange={setOwnershipStructure}>
                    <SelectTrigger data-testid="select-ownership-structure">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="small_private">Small Private</SelectItem>
                      <SelectItem value="investment_firm">Investment Firm</SelectItem>
                      <SelectItem value="institutional_reit">Institutional/REIT</SelectItem>
                      <SelectItem value="third_party_managed">Third-Party Managed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Claim Window</label>
                  <Button
                    variant={claimWindowOpen ? "default" : "outline"}
                    className="w-full toggle-elevate"
                    onClick={() => setClaimWindowOpen(!claimWindowOpen)}
                    data-testid="button-filter-claim-window"
                  >
                    <Shield className="w-4 h-4 mr-1.5" />
                    Open
                  </Button>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Risk & Sorting</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Roof Risk Tier</label>
                  <Select value={riskTier} onValueChange={setRiskTier}>
                    <SelectTrigger data-testid="select-risk-tier">
                      <SelectValue placeholder="All tiers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tiers</SelectItem>
                      <SelectItem value="critical">Critical (81-100)</SelectItem>
                      <SelectItem value="high">High (61-80)</SelectItem>
                      <SelectItem value="moderate">Moderate (31-60)</SelectItem>
                      <SelectItem value="low">Low (0-30)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Sort By</label>
                  <Button
                    variant={sortBy === "roofRiskIndex" ? "default" : "outline"}
                    className="w-full toggle-elevate"
                    onClick={() => setSortBy(sortBy === "roofRiskIndex" ? "" : "roofRiskIndex")}
                    data-testid="button-sort-risk"
                  >
                    <ArrowUpDown className="w-4 h-4 mr-1.5" />
                    Risk Score
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-0">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4 border-b border-border/50">
              <Skeleton className="w-2 h-2 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-64 mb-2" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : leads && leads.length > 0 ? (
        <div>
          {leads.map((lead) => (
            <Link key={lead.id} href={`/leads/${lead.id}`}>
              <div
                className="flex items-center gap-4 py-4 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                data-testid={`card-lead-${lead.id}`}
              >
                <ScoreDot score={lead.leadScore} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium" data-testid={`text-address-${lead.id}`}>{lead.address}</p>
                    {lead.ownerType === "LLC" && (
                      <Badge variant="outline" className="text-[10px]">{lead.llcName || "LLC"}</Badge>
                    )}
                    {lead.claimWindowOpen && (
                      <Badge variant="default" className="text-[9px]" data-testid={`badge-claimable-${lead.id}`}>Claimable</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {lead.city}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Ruler className="w-3 h-3" />
                      {lead.sqft.toLocaleString()} sqft
                    </span>
                    {lead.roofLastReplaced && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Roof: {lead.roofLastReplaced}
                      </span>
                    )}
                    {lead.hailEvents > 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <CloudLightning className="w-3 h-3" />
                        {lead.hailEvents} hail
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                      {lead.ownerName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {(lead.ownerPhone || lead.contactPhone) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-phone-${lead.id}`}>
                        <Phone className="w-2.5 h-2.5" />
                        Phone
                      </span>
                    )}
                    {(lead.ownerEmail || lead.contactEmail) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-email-${lead.id}`}>
                        <Mail className="w-2.5 h-2.5" />
                        Email
                      </span>
                    )}
                    {lead.managingMember && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-dm-${lead.id}`}>
                        <Fingerprint className="w-2.5 h-2.5" />
                        DM
                      </span>
                    )}
                    {(lead as any).permitContractors && (lead as any).permitContractors.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-permits-${lead.id}`}>
                        <HardHat className="w-2.5 h-2.5" />
                        {(lead as any).permitContractors.length}
                      </span>
                    )}
                    {lead.totalValue && lead.totalValue > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-1 tabular-nums">
                        {lead.totalValue >= 1_000_000 ? `$${(lead.totalValue / 1_000_000).toFixed(1)}M` : `$${(lead.totalValue / 1_000).toFixed(0)}K`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {roiDecisionMap.has(lead.id) && (() => {
                    const roi = roiDecisionMap.get(lead.id)!;
                    const tierColors: Record<string, string> = {
                      premium: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
                      tier3: "bg-red-500/15 text-red-700 dark:text-red-400",
                      tier2: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
                      tier1: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
                      free_only: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
                      skip: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
                    };
                    const colorClass = tierColors[roi.decisionType] || "bg-gray-500/15 text-gray-700 dark:text-gray-400";
                    return (
                      <Badge
                        variant="secondary"
                        className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${colorClass}`}
                        data-testid={`badge-roi-tier-${lead.id}`}
                      >
                        {roi.decisionType}
                      </Badge>
                    );
                  })()}
                  {lead.roofRiskIndex != null && lead.roofRiskIndex > 0 && (
                    <Badge
                      variant="secondary"
                      className={`no-default-hover-elevate no-default-active-elevate font-mono text-[10px] ${
                        lead.roofRiskIndex >= 81
                          ? "bg-red-500/15 text-red-700 dark:text-red-400"
                          : lead.roofRiskIndex >= 61
                          ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
                          : lead.roofRiskIndex >= 31
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      }`}
                      data-testid={`badge-risk-${lead.id}`}
                    >
                      <ShieldAlert className="w-3 h-3 mr-0.5" />
                      {lead.roofRiskIndex}
                    </Badge>
                  )}
                  {(lead as any).dataConfidence && (
                    <Badge
                      variant="secondary"
                      className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${
                        (lead as any).dataConfidence === "high"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : (lead as any).dataConfidence === "medium"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/15 text-red-700 dark:text-red-400"
                      }`}
                      data-testid={`badge-confidence-${lead.id}`}
                    >
                      {(lead as any).dataConfidence === "high" ? (
                        <CircleCheck className="w-3 h-3 mr-0.5" />
                      ) : (lead as any).dataConfidence === "medium" ? (
                        <CircleMinus className="w-3 h-3 mr-0.5" />
                      ) : (
                        <CircleAlert className="w-3 h-3 mr-0.5" />
                      )}
                      {(lead as any).dataConfidence === "high" ? "High" : (lead as any).dataConfidence === "medium" ? "Med" : "Low"}
                    </Badge>
                  )}
                  <StatusBadge status={lead.status} />
                  <ScoreBadge score={lead.leadScore} />
                  <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                </div>
              </div>
            </Link>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 pt-6">
              <p className="text-xs text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <div className="flex items-center gap-0.5 px-2">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (page <= 4) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = page - 3 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        className={`min-w-[2rem] h-8 text-sm rounded-lg transition-colors ${
                          pageNum === page
                            ? "bg-primary text-primary-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setPage(pageNum)}
                        data-testid={`button-page-${pageNum}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="py-20 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-medium text-muted-foreground">No leads found</p>
          <p className="text-sm text-muted-foreground/60 mt-1.5">
            {hasFilters ? "Try adjusting your filters" : "Leads will appear here once data is loaded"}
          </p>
        </div>
      )}
    </div>
  );
}
