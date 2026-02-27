import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { PageMeta } from "@/components/page-meta";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ScoreBadge } from "@/components/score-badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ForceGraph2D from "react-force-graph-2d";
import {
  Building2, Users, ChevronRight, TrendingUp, Search, Loader2, Network,
  RefreshCw, ChevronDown, AlertCircle, MapPin, ShieldAlert, Clock, Layers,
  TriangleAlert, Share2, User, Landmark, ZoomIn, ZoomOut, Maximize2, X,
  Info, HardHat, Phone, Mail, ChevronLeft, ChevronUp, ExternalLink,
  DollarSign, Calendar,
} from "lucide-react";

interface RooftopOwnerSummary {
  normalizedName: string;
  personName: string;
  role: string;
  propertyCount: number;
  totalValue: number;
  totalSqft: number;
  avgScore: number;
  totalHail: number;
  portfolioGroupId: string;
}

interface PortfolioProperty {
  leadId: string;
  role: string;
  confidence: number;
  address: string;
  city: string;
  county: string;
  sqft: number;
  yearBuilt: number;
  totalValue: number;
  leadScore: number;
  hailEvents: number;
  lastHailDate: string | null;
  ownerName: string;
  latitude: number;
  longitude: number;
  roofType: string | null;
  estimatedRoofArea: number | null;
  status: string;
  roofRiskIndex: number | null;
}

interface PortfolioRiskSummary {
  portfolioId: string;
  name: string;
  propertyCount: number;
  avgRisk: number;
  maxRisk: number;
  criticalCount: number;
  highCount: number;
  dominantRoofType: string | null;
  dominantDecade: string;
  eraConcentration: number;
  avgYearBuilt: number;
  systemicWindow: string;
  boardLevelRisk: boolean;
}

interface GraphNodeData {
  id: string;
  nodeType: string;
  label: string;
  normalizedLabel: string;
  entityId: string | null;
  metadata: any;
}

interface GraphEdgeData {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  label: string;
  weight: number;
  evidence: string | null;
}

interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

interface BuildStatus {
  id?: string;
  status: string;
  nodesCreated?: number;
  edgesCreated?: number;
  leadsProcessed?: number;
  totalLeads?: number;
  currentPhase?: string;
}

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  topConnected: Array<{ id: string; label: string; nodeType: string; connections: number }>;
  lastBuild: any;
}

interface Contractor {
  contractor_name: string;
  permit_count: string;
  roofing_permit_count: string;
  most_recent_permit: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface ContractorsResponse {
  contractors: Contractor[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

interface ContractorPermit {
  id: string;
  permit_number: string;
  permit_type: string;
  issued_date: string | null;
  address: string;
  city: string;
  zip_code: string;
  work_description: string;
  estimated_value: number | null;
  sqft: number | null;
  lead_id: string | null;
}

interface LinkedLead {
  id: string;
  address: string;
  city: string;
  owner_name: string;
  lead_score: number;
  total_value: number;
}

function num(v: any): number {
  const n = typeof v === "string" ? parseInt(v) : v;
  return isNaN(n) ? 0 : n;
}

function formatValue(value: number): string {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatSqft(sqft: number): string {
  if (sqft >= 1000000) return `${(sqft / 1000000).toFixed(1)}M sqft`;
  if (sqft >= 1000) return `${(sqft / 1000).toFixed(0)}K sqft`;
  return `${sqft.toLocaleString()} sqft`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(val: number | null): string {
  if (!val) return "\u2014";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function formatContractorName(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(/\s+\d/);
  let name = parts[0].trim();
  name = name.replace(/\\+/g, "").replace(/\s*\/\d+$/, "").replace(/,\s*$/, "").trim();
  return name
    .split(" ")
    .map((w) => {
      if (["LLC", "INC", "DBA", "CO", "LP", "LTD", "CORP"].includes(w)) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(" ");
}

const NODE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  company: "#8b5cf6",
  property: "#10b981",
  llc: "#f59e0b",
  address: "#6b7280",
};

const NODE_ICONS: Record<string, any> = {
  person: User,
  company: Building2,
  property: Landmark,
  llc: Share2,
  address: MapPin,
};

const EDGE_COLORS: Record<string, string> = {
  owns: "#10b981",
  manages_property: "#8b5cf6",
  officer_of: "#3b82f6",
  registered_agent_for: "#f59e0b",
  member_of: "#ef4444",
  located_at: "#6b7280",
  shared_officer: "#ec4899",
  shared_agent: "#f97316",
  mailing_match: "#06b6d4",
};

function formatGraphForForce(data: GraphData) {
  const nodeMap = new Map<string, any>();
  for (const n of data.nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      label: n.label,
      nodeType: n.nodeType,
      entityId: n.entityId,
      metadata: n.metadata,
      color: NODE_COLORS[n.nodeType] || "#6b7280",
    });
  }

  const links = data.edges
    .filter(e => nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId))
    .map(e => ({
      source: e.sourceNodeId,
      target: e.targetNodeId,
      edgeType: e.edgeType,
      label: e.label,
      weight: e.weight,
      evidence: e.evidence,
      color: EDGE_COLORS[e.edgeType] || "#94a3b8",
    }));

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
}

function getRiskTierColor(score: number) {
  if (score >= 81) return { bg: "bg-red-500/15", text: "text-red-700 dark:text-red-400", label: "Critical" };
  if (score >= 61) return { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-400", label: "High" };
  if (score >= 31) return { bg: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-400", label: "Moderate" };
  return { bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-400", label: "Low" };
}

function RiskScoreCircle({ score }: { score: number }) {
  const tier = getRiskTierColor(score);
  const circumference = 2 * Math.PI * 32;
  const offset = circumference - (score / 100) * circumference;
  const strokeColor = score >= 81 ? "#ef4444" : score >= 61 ? "#f97316" : score >= 31 ? "#f59e0b" : "#10b981";

  return (
    <div className="relative w-20 h-20 flex-shrink-0" data-testid="risk-score-circle">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="32" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
        <circle cx="36" cy="36" r="32" fill="none" stroke={strokeColor} strokeWidth="4"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-bold ${tier.text}`} data-testid="text-risk-score">{score}</span>
        <span className="text-[9px] text-muted-foreground font-medium">/100</span>
      </div>
    </div>
  );
}

function PortfolioRiskCard({ risk }: { risk: PortfolioRiskSummary }) {
  const tier = getRiskTierColor(risk.avgRisk);
  const showWarning = risk.propertyCount >= 12 && risk.eraConcentration >= 70;

  return (
    <div className="space-y-3" data-testid="portfolio-risk-card">
      {risk.boardLevelRisk && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3 flex items-start gap-3" data-testid="board-level-risk-alert">
          <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">Board-Level Risk</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Portfolio average risk score of {risk.avgRisk} across {risk.propertyCount} properties warrants executive attention.
            </p>
          </div>
        </div>
      )}

      {showWarning && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 flex items-start gap-3" data-testid="era-concentration-warning">
          <TriangleAlert className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Systemic Concentration Risk</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {risk.propertyCount} buildings with {risk.eraConcentration}% same-era construction. Multiple roofs may need simultaneous replacement.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        <RiskScoreCircle score={Math.round(risk.avgRisk)} />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold" data-testid="text-risk-tier-label">Portfolio Risk Rating</span>
              <Badge variant="secondary" className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${tier.bg} ${tier.text}`} data-testid="badge-risk-tier">
                {tier.label}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Weighted avg across {risk.propertyCount} properties (max: {risk.maxRisk})
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Dominant Roof Type</p>
                <p className="text-xs font-medium" data-testid="text-dominant-roof-type">{risk.dominantRoofType || "Unknown"}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Era Concentration</p>
                <p className="text-xs font-medium" data-testid="text-era-concentration">{risk.eraConcentration}% in {risk.dominantDecade}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 col-span-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Systemic Failure Window</p>
                <p className="text-xs font-medium" data-testid="text-systemic-window">{risk.systemicWindow}</p>
              </div>
            </div>
          </div>

          {(risk.criticalCount > 0 || risk.highCount > 0) && (
            <div className="flex items-center gap-2 flex-wrap">
              {risk.criticalCount > 0 && (
                <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] bg-red-500/15 text-red-700 dark:text-red-400" data-testid="badge-critical-count">
                  {risk.criticalCount} Critical
                </Badge>
              )}
              {risk.highCount > 0 && (
                <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] bg-orange-500/15 text-orange-700 dark:text-orange-400" data-testid="badge-high-count">
                  {risk.highCount} High Risk
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskBadgeInline({ score }: { score: number }) {
  const tier = getRiskTierColor(score);
  return (
    <Badge variant="secondary" className={`no-default-hover-elevate no-default-active-elevate text-[10px] font-mono ${tier.bg} ${tier.text}`} data-testid="badge-risk-inline">
      {score}
    </Badge>
  );
}

function OwnerRow({
  owner,
  isExpanded,
  onToggle,
  onViewInNetwork,
}: {
  owner: RooftopOwnerSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onViewInNetwork: (name: string) => void;
}) {
  const { data: properties, isLoading, isError } = useQuery<PortfolioProperty[]>({
    queryKey: ["/api/portfolio/owner", owner.normalizedName],
    queryFn: () => fetch(`/api/portfolio/owner/${encodeURIComponent(owner.normalizedName)}`).then(r => r.json()),
    enabled: isExpanded,
  });

  const { data: riskSummary, isLoading: riskLoading } = useQuery<PortfolioRiskSummary>({
    queryKey: ["/api/portfolios", owner.portfolioGroupId, "risk-summary"],
    queryFn: () => fetch(`/api/portfolios/${encodeURIComponent(owner.portfolioGroupId)}/risk-summary`).then(r => {
      if (!r.ok) return null;
      return r.json();
    }),
    enabled: isExpanded && !!owner.portfolioGroupId,
  });

  const count = num(owner.propertyCount);
  const value = num(owner.totalValue);
  const sqft = num(owner.totalSqft);
  const hail = num(owner.totalHail);
  const avg = num(owner.avgScore);

  const summary = properties ? {
    totalRoofArea: properties.reduce((s, p) => s + (p.estimatedRoofArea || 0), 0),
    avgYearBuilt: Math.round(properties.reduce((s, p) => s + p.yearBuilt, 0) / properties.length),
    highestScore: Math.max(...properties.map(p => p.leadScore)),
    cities: Array.from(new Set(properties.map(p => p.city))),
  } : null;

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden" data-testid={`owner-row-${owner.normalizedName}`}>
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-muted/30 transition-colors flex items-center gap-4"
        data-testid={`button-expand-owner-${owner.normalizedName}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" data-testid="text-owner-name">{owner.personName}</span>
            {count > 1 && (
              <span className="text-[10px] text-primary font-medium" data-testid="text-property-count">{count} properties</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
            <span>{formatSqft(sqft)}</span>
            <span>{formatValue(value)}</span>
            {hail > 0 && <span>{hail} hail events</span>}
            <span>Avg score {avg}</span>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {isExpanded && (
        <div className="border-t px-4 pb-4">
          {isError && (
            <div className="py-4 text-center">
              <AlertCircle className="w-5 h-5 text-destructive mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Failed to load properties</p>
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2 pt-3">
              {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : properties && properties.length > 0 ? (
            <div className="space-y-4 pt-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {summary && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 flex-1" data-testid="portfolio-summary">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Properties</p>
                      <p className="text-lg font-bold mt-0.5">{properties.length}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Value</p>
                      <p className="text-lg font-bold mt-0.5">{formatValue(value)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Sqft</p>
                      <p className="text-lg font-bold mt-0.5">{formatSqft(sqft)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Roof Area</p>
                      <p className="text-lg font-bold mt-0.5">{formatSqft(summary.totalRoofArea)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Best Score</p>
                      <p className="text-lg font-bold mt-0.5">{summary.highestScore}</p>
                    </div>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewInNetwork(owner.personName);
                  }}
                  data-testid={`button-view-in-network-${owner.normalizedName}`}
                >
                  <Share2 className="w-3.5 h-3.5 mr-1.5" />
                  View in Network
                </Button>
              </div>

              {riskLoading && (
                <Skeleton className="h-28" />
              )}

              {riskSummary && (
                <PortfolioRiskCard risk={riskSummary} />
              )}

              {properties.length > 1 && summary && (
                <div className="rounded-lg border bg-muted/20 p-3 flex items-center gap-3" data-testid="portfolio-locations">
                  <MapPin className="w-5 h-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium">{properties.length} properties across {summary.cities.length} {summary.cities.length === 1 ? "city" : "cities"}</p>
                    <p className="text-[11px] text-muted-foreground">{summary.cities.join(", ")}</p>
                  </div>
                </div>
              )}

              <div className="divide-y">
                {properties.map((prop) => (
                  <Link key={prop.leadId} href={`/leads/${prop.leadId}`}>
                    <div className="py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors cursor-pointer rounded-lg px-2 -mx-2" data-testid={`link-portfolio-property-${prop.leadId}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" data-testid={`text-property-address-${prop.leadId}`}>{prop.address}</p>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                          <span>{prop.city}, {prop.county}</span>
                          <span>{prop.sqft.toLocaleString()} sqft</span>
                          {prop.totalValue > 0 && <span>{formatValue(prop.totalValue)}</span>}
                          {prop.roofType && <span>{prop.roofType}</span>}
                          {prop.hailEvents > 0 && <span>{prop.hailEvents} hail</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {prop.roofRiskIndex != null && prop.roofRiskIndex > 0 && (
                          <RiskBadgeInline score={prop.roofRiskIndex} />
                        )}
                        <ScoreBadge score={prop.leadScore} />
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : !isError && (
            <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-properties">No properties found</p>
          )}
        </div>
      )}
    </div>
  );
}

function PortfoliosTab({ onViewInNetwork }: { onViewInNetwork: (name: string) => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedOwner, setExpandedOwner] = useState<string | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const ownerParam = searchParams.get("owner");

  useEffect(() => {
    if (ownerParam) {
      setSearch(ownerParam);
    }
  }, [ownerParam]);

  const { data: topOwners, isLoading, isError } = useQuery<RooftopOwnerSummary[]>({
    queryKey: ["/api/portfolio/top"],
  });

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rooftop-owners/rebuild", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Owner Network Rebuilt", description: `Found ${data.people} people across ${data.processed} properties. ${data.multiPropertyOwners} multi-property owners discovered.` });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/top"] });
    },
    onError: (error: any) => {
      toast({ title: "Rebuild Failed", description: error.message, variant: "destructive" });
    },
  });

  const filtered = (topOwners || []).filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return o.personName.toLowerCase().includes(s) || o.normalizedName.toLowerCase().includes(s);
  });

  const multiPropertyOwners = filtered.filter(o => num(o.propertyCount) > 1);
  const totalProperties = multiPropertyOwners.reduce((sum, o) => sum + num(o.propertyCount), 0);
  const totalValue = multiPropertyOwners.reduce((sum, o) => sum + num(o.totalValue), 0);

  return (
    <div className="space-y-6" data-testid="tab-portfolios">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Multi-property owners discovered from rooftop intelligence
          </p>
        </div>
        <Button
          onClick={() => rebuildMutation.mutate()}
          disabled={rebuildMutation.isPending}
          variant="outline"
          data-testid="button-rebuild-owners"
        >
          {rebuildMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Rebuild Network
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Multi-Property Owners", value: multiPropertyOwners.length, icon: Users },
          { label: "Properties Linked", value: totalProperties, icon: Building2 },
          { label: "Portfolio Value", value: formatValue(totalValue), icon: TrendingUp },
          { label: "Total People Found", value: (topOwners || []).length, icon: Network },
        ].map((stat) => (
          <Card key={stat.label} className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center">
                  <stat.icon className="w-[18px] h-[18px] text-primary" />
                </div>
                <div>
                  <p className="text-xl font-bold" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground font-medium">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
        <Input
          placeholder="Search owners..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10 rounded-lg"
          data-testid="input-search-portfolios"
        />
      </div>

      {isError && (
        <Card className="shadow-sm border-destructive/30">
          <CardContent className="py-8 text-center">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium">Failed to load portfolio data</p>
            <p className="text-xs text-muted-foreground mt-1">Try rebuilding the network or refreshing the page</p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : !isError && filtered.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-base font-medium" data-testid="text-empty-state">No Owners Found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {(topOwners || []).length === 0
                ? "Click \"Rebuild Network\" to discover property owners"
                : "No owners match your search"}
            </p>
          </CardContent>
        </Card>
      ) : !isError && (
        <div className="space-y-1">
          {filtered.map((owner) => (
            <OwnerRow
              key={owner.normalizedName}
              owner={owner}
              isExpanded={expandedOwner === owner.normalizedName}
              onToggle={() => setExpandedOwner(expandedOwner === owner.normalizedName ? null : owner.normalizedName)}
              onViewInNetwork={onViewInNetwork}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NetworkTab({ initialSearchQuery }: { initialSearchQuery: string }) {
  const { toast } = useToast();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [activated, setActivated] = useState(!!initialSearchQuery);

  useEffect(() => {
    if (initialSearchQuery && initialSearchQuery !== searchQuery) {
      setSearchQuery(initialSearchQuery);
      setActivated(true);
    }
  }, [initialSearchQuery]);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const { data: stats } = useQuery<GraphStats>({
    queryKey: ["/api/graph/stats"],
    enabled: activated,
  });

  const { data: buildStatus } = useQuery<BuildStatus>({
    queryKey: ["/api/graph/build/status"],
    enabled: activated,
    refetchInterval: (query) => {
      const data = query.state.data as BuildStatus | undefined;
      return data?.status === "running" ? 3000 : false;
    },
  });

  const { data: searchResults } = useQuery<GraphNodeData[]>({
    queryKey: [`/api/graph/search?q=${encodeURIComponent(searchQuery)}`],
    enabled: activated && searchQuery.length >= 2,
  });

  const buildMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/graph/build"),
    onSuccess: () => {
      setActivated(true);
      toast({ title: "Graph build started", description: "Processing all leads to build relationship network..." });
      queryClient.invalidateQueries({ queryKey: ["/api/graph/build/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Build failed", description: err.message, variant: "destructive" });
    },
  });

  const loadNode = useCallback(async (nodeId: string, depth: number = 2) => {
    try {
      const res = await fetch(`/api/graph/node/${nodeId}?depth=${depth}`);
      const data: GraphData = await res.json();
      const formatted = formatGraphForForce(data);

      setGraphData(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.id));
        const existingLinkKeys = new Set(prev.links.map((l: any) => `${l.source?.id || l.source}:${l.target?.id || l.target}`));

        const newNodes = formatted.nodes.filter(n => !existingNodeIds.has(n.id));
        const newLinks = formatted.links.filter(l => {
          const key = `${l.source}:${l.target}`;
          return !existingLinkKeys.has(key);
        });

        return {
          nodes: [...prev.nodes, ...newNodes],
          links: [...prev.links, ...newLinks],
        };
      });
    } catch (err) {
      console.error("Failed to load node:", err);
    }
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
    loadNode(node.id, 1);
  }, [loadNode]);

  const handleSearchSelect = useCallback((node: GraphNodeData) => {
    setSearchQuery("");
    setGraphData({ nodes: [], links: [] });
    setSelectedNode(null);
    loadNode(node.id, 2);
  }, [loadNode]);

  const handleReset = useCallback(() => {
    setGraphData({ nodes: [], links: [] });
    setSelectedNode(null);
    setSearchQuery("");
  }, []);

  const isBuilding = buildStatus?.status === "running";
  const hasGraph = (stats?.totalNodes || 0) > 0;
  const buildProgress = isBuilding && buildStatus?.totalLeads
    ? Math.round(((buildStatus?.leadsProcessed || 0) / buildStatus.totalLeads) * 100)
    : 0;

  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = node.id === selectedNode?.id ? 8 : 6;
    const fontSize = Math.max(10 / globalScale, 1.5);

    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color || "#6b7280";
    ctx.fill();

    if (node.id === selectedNode?.id) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (globalScale > 0.8) {
      const label = node.label.length > 25 ? node.label.substring(0, 22) + "..." : node.label;
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = node.id === selectedNode?.id ? "#ffffff" : "rgba(255,255,255,0.8)";
      ctx.fillText(label, node.x, node.y + size + 2);
    }
  }, [selectedNode]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 180px)" }} data-testid="tab-network">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5 text-primary" />
          <p className="text-xs text-muted-foreground">
            {hasGraph
              ? `${stats?.totalNodes?.toLocaleString()} entities, ${stats?.totalEdges?.toLocaleString()} connections`
              : "Build a relationship graph to explore ownership networks"
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              data-testid="input-graph-search"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
            {searchResults && searchResults.length > 0 && searchQuery.length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-64 overflow-auto">
                {searchResults.map((node) => {
                  const Icon = NODE_ICONS[node.nodeType] || Share2;
                  return (
                    <button
                      key={node.id}
                      data-testid={`search-result-${node.id}`}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-accent transition-colors"
                      onClick={() => handleSearchSelect(node)}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: NODE_COLORS[node.nodeType] }} />
                      <span className="truncate font-medium">{node.label}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
                        {node.nodeType}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Button
            data-testid="button-build-graph"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => buildMutation.mutate()}
            disabled={isBuilding || buildMutation.isPending}
          >
            {isBuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {isBuilding ? `Building ${buildProgress}%` : "Build Graph"}
          </Button>
          {graphData.nodes.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleReset} data-testid="button-reset-graph">
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {isBuilding && (
        <div className="px-4 py-2 bg-primary/5 border-b">
          <div className="flex items-center gap-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            <div className="flex-1">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${buildProgress}%` }}
                />
              </div>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {buildStatus?.leadsProcessed?.toLocaleString()}/{buildStatus?.totalLeads?.toLocaleString()} leads
              {" | "}{buildStatus?.nodesCreated?.toLocaleString()} nodes
              {" | "}{buildStatus?.edgesCreated?.toLocaleString()} edges
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{buildStatus?.currentPhase}</p>
        </div>
      )}

      <div className="flex-1 flex">
        <div className="flex-1 relative bg-slate-950" ref={containerRef}>
          {graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width - (selectedNode ? 320 : 0)}
              height={dimensions.height}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath();
                ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={(link: any) => link.color || "#334155"}
              linkWidth={(link: any) => Math.max(0.5, link.weight * 1.5)}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={0.75}
              linkLabel={(link: any) => link.label || link.edgeType}
              onNodeClick={handleNodeClick}
              backgroundColor="#0f172a"
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              linkDirectionalParticles={1}
              linkDirectionalParticleWidth={1.5}
              linkDirectionalParticleSpeed={0.005}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {!activated ? (
                <div className="text-center space-y-4">
                  <Share2 className="w-16 h-16 text-slate-600 mx-auto" />
                  <div>
                    <h3 className="text-lg font-semibold text-slate-300" data-testid="text-empty-title">Network Explorer</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-md">
                      Visualize ownership networks, LLC chains, and decision-maker connections across your lead database.
                    </p>
                  </div>
                  <div className="flex gap-3 justify-center">
                    <Button
                      data-testid="button-start-explorer"
                      onClick={() => setActivated(true)}
                      variant="outline"
                      className="gap-2"
                    >
                      <Search className="w-4 h-4" />
                      Load Existing Graph
                    </Button>
                    <Button
                      data-testid="button-build-graph-empty"
                      onClick={() => buildMutation.mutate()}
                      disabled={buildMutation.isPending}
                      className="gap-2"
                    >
                      {buildMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Rebuild Graph
                    </Button>
                  </div>
                </div>
              ) : !hasGraph ? (
                <div className="text-center space-y-4">
                  <Share2 className="w-16 h-16 text-slate-600 mx-auto" />
                  <div>
                    <h3 className="text-lg font-semibold text-slate-300" data-testid="text-no-graph-title">No Relationship Graph Yet</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-md">
                      Build a graph from your lead database to visualize ownership networks, LLC chains, and decision-maker connections.
                    </p>
                  </div>
                  <Button
                    data-testid="button-build-graph-no-data"
                    onClick={() => buildMutation.mutate()}
                    disabled={isBuilding || buildMutation.isPending}
                    className="gap-2"
                  >
                    {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Build Relationship Graph
                  </Button>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <Search className="w-12 h-12 text-slate-600 mx-auto" />
                  <div>
                    <h3 className="text-base font-semibold text-slate-300" data-testid="text-search-prompt">Search to Explore</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Search for an owner, company, or address to start exploring the network.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {graphData.nodes.length > 0 && (
            <div className="absolute bottom-4 left-4 flex gap-1.5">
              <Button variant="secondary" size="icon" onClick={() => graphRef.current?.zoomIn(2)} data-testid="button-zoom-in">
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" onClick={() => graphRef.current?.zoomOut(2)} data-testid="button-zoom-out">
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" onClick={() => graphRef.current?.zoomToFit(400)} data-testid="button-zoom-fit">
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {graphData.nodes.length > 0 && (
            <div className="absolute top-4 left-4 bg-slate-800/80 backdrop-blur-sm rounded-lg p-3 space-y-1.5">
              {Object.entries(NODE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-slate-300 capitalize">{type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedNode && (
          <div className="w-80 border-l bg-background overflow-auto" data-testid="panel-node-detail">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = NODE_ICONS[selectedNode.nodeType] || Share2;
                    return <Icon className="w-4 h-4" style={{ color: NODE_COLORS[selectedNode.nodeType] }} />;
                  })()}
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 capitalize"
                    style={{ borderColor: NODE_COLORS[selectedNode.nodeType], color: NODE_COLORS[selectedNode.nodeType] }}
                  >
                    {selectedNode.nodeType}
                  </Badge>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)} data-testid="button-close-node-detail">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <h3 className="text-sm font-semibold mt-2" data-testid="text-selected-node-label">{selectedNode.label}</h3>
            </div>

            {selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0 && (
              <div className="p-4 border-b">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Details</h4>
                <div className="space-y-1.5">
                  {Object.entries(selectedNode.metadata).map(([key, value]) => {
                    if (!value || value === "null") return null;
                    return (
                      <div key={key} className="flex items-start justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                        <span className="text-[11px] font-medium text-right max-w-[160px] truncate">
                          {typeof value === "number" ? value.toLocaleString() : String(value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="p-4">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Connections</h4>
              <div className="space-y-1">
                {graphData.links
                  .filter((l: any) => {
                    const srcId = l.source?.id || l.source;
                    const tgtId = l.target?.id || l.target;
                    return srcId === selectedNode.id || tgtId === selectedNode.id;
                  })
                  .map((link: any, i: number) => {
                    const srcId = link.source?.id || link.source;
                    const tgtId = link.target?.id || link.target;
                    const otherId = srcId === selectedNode.id ? tgtId : srcId;
                    const otherNode = graphData.nodes.find(n => n.id === otherId);
                    return (
                      <button
                        key={i}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-left hover:bg-accent transition-colors text-xs"
                        onClick={() => {
                          if (otherNode) {
                            setSelectedNode(otherNode);
                            loadNode(otherNode.id, 1);
                          }
                        }}
                        data-testid={`button-connection-${i}`}
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: EDGE_COLORS[link.edgeType] || "#6b7280" }} />
                        <span className="truncate flex-1">{otherNode?.label || otherId}</span>
                        <span className="text-[10px] text-muted-foreground">{link.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            {selectedNode.entityId && (
              <div className="p-4 border-t">
                <a
                  href={`/leads/${selectedNode.entityId}`}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  data-testid="link-view-lead"
                >
                  <Info className="w-3 h-3" />
                  View Lead Details
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {hasGraph && graphData.nodes.length === 0 && !isBuilding && stats && (
        <div className="border-t bg-background/80">
          <div className="px-4 py-3">
            <div className="flex items-center gap-6">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Connected</h4>
              <div className="flex items-center gap-3 flex-1 overflow-x-auto">
                {stats.topConnected.slice(0, 8).map((node) => {
                  const Icon = NODE_ICONS[node.nodeType] || Share2;
                  return (
                    <button
                      key={node.id}
                      data-testid={`top-connected-${node.id}`}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 hover:bg-muted transition-colors whitespace-nowrap"
                      onClick={() => handleSearchSelect(node as any)}
                    >
                      <Icon className="w-3 h-3" style={{ color: NODE_COLORS[node.nodeType] }} />
                      <span className="text-[11px] font-medium truncate max-w-[120px]">{node.label}</span>
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{node.connections}</Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContractorRow({ contractor }: { contractor: Contractor }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = formatContractorName(contractor.contractor_name);
  const permitCount = parseInt(contractor.permit_count);
  const roofingCount = parseInt(contractor.roofing_permit_count);

  const { data: detail } = useQuery<{ permits: ContractorPermit[]; linkedLeads: LinkedLead[] }>({
    queryKey: ["/api/contractors", contractor.contractor_name, "permits"],
    queryFn: async () => {
      const res = await fetch(`/api/contractors/${encodeURIComponent(contractor.contractor_name)}/permits`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: expanded,
  });

  return (
    <div className="border-b last:border-b-0" data-testid={`contractor-row-${contractor.contractor_name.slice(0, 20).trim()}`}>
      <div
        className="flex items-center gap-4 py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <HardHat className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" data-testid="text-contractor-name">{displayName}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {contractor.city && contractor.state && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {contractor.city}, {contractor.state}
              </span>
            )}
            {contractor.most_recent_permit && (
              <span className="text-[11px] text-muted-foreground">
                Last: {formatDate(contractor.most_recent_permit)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          {contractor.phone && (
            <a
              href={`tel:${contractor.phone}`}
              className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              data-testid="link-contractor-phone"
            >
              <Phone className="w-3 h-3" />
              {contractor.phone}
            </a>
          )}
          {contractor.email && (
            <a
              href={`mailto:${contractor.email}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              data-testid="link-contractor-email"
            >
              <Mail className="w-3 h-3" />
              {contractor.email}
            </a>
          )}
          <Badge variant="secondary" className="text-[10px] tabular-nums">
            {permitCount} permit{permitCount !== 1 ? "s" : ""}
          </Badge>
          {roofingCount > 0 && (
            <Badge variant="outline" className="text-[10px] tabular-nums text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700">
              {roofingCount} roofing
            </Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {!detail ? (
            <div className="text-sm text-muted-foreground py-2">Loading permits...</div>
          ) : (
            <div className="space-y-4">
              {detail.linkedLeads.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Properties Worked On</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {detail.linkedLeads.map((lead) => (
                      <Link key={lead.id} href={`/leads/${lead.id}`}>
                        <div className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`link-lead-${lead.id}`}>
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{lead.address}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{lead.owner_name}</p>
                          </div>
                          <ExternalLink className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Permit History ({detail.permits.length})
                </p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {detail.permits.slice(0, 50).map((permit) => (
                    <div key={permit.id} className="flex items-start gap-3 py-1.5 text-xs">
                      <span className="text-muted-foreground tabular-nums flex-shrink-0 w-20">
                        {formatDate(permit.issued_date)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{permit.work_description || permit.permit_type}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                          <span>{permit.address}{permit.city ? `, ${permit.city}` : ""}</span>
                          {permit.estimated_value && (
                            <span className="flex items-center gap-0.5">
                              <DollarSign className="w-2.5 h-2.5" />
                              {formatCurrency(permit.estimated_value)}
                            </span>
                          )}
                          {permit.lead_id && (
                            <Link href={`/leads/${permit.lead_id}`}>
                              <span className="text-primary hover:underline cursor-pointer flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                View Lead <ExternalLink className="w-2.5 h-2.5" />
                              </span>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContractorsTab() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const urlSearch = urlParams.get("search") || "";

  const [search, setSearch] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearch);
  const [roofingOnly, setRoofingOnly] = useState(false);
  const [sortBy, setSortBy] = useState("permits");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (urlSearch && urlSearch !== debouncedSearch) {
      setSearch(urlSearch);
      setDebouncedSearch(urlSearch);
      setPage(1);
    }
  }, [urlSearch]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout((window as any).__contractorSearchTimeout);
    (window as any).__contractorSearchTimeout = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  const queryParams = new URLSearchParams();
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (roofingOnly) queryParams.set("roofingOnly", "true");
  if (sortBy) queryParams.set("sortBy", sortBy);
  queryParams.set("page", String(page));

  const { data, isLoading } = useQuery<ContractorsResponse>({
    queryKey: ["/api/contractors", debouncedSearch, roofingOnly, sortBy, page],
    queryFn: async () => {
      const res = await fetch(`/api/contractors?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  return (
    <div className="space-y-6" data-testid="tab-contractors">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search contractors..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
                data-testid="input-search-contractor"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="roofing-only"
                checked={roofingOnly}
                onCheckedChange={(v) => { setRoofingOnly(v); setPage(1); }}
                data-testid="switch-roofing-only"
              />
              <Label htmlFor="roofing-only" className="text-xs font-medium cursor-pointer">
                Roofing only
              </Label>
            </div>

            <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]" data-testid="select-sort">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="permits">Most Permits</SelectItem>
                <SelectItem value="recent">Most Recent</SelectItem>
                <SelectItem value="name">Name A-Z</SelectItem>
              </SelectContent>
            </Select>

            {data && (
              <Badge variant="secondary" className="text-xs">
                {data.pagination.total.toLocaleString()} contractors
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading contractors...</div>
          ) : !data || data.contractors.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No contractors found</div>
          ) : (
            <div className="divide-y divide-border">
              {data.contractors.map((c) => (
                <ContractorRow key={c.contractor_name} contractor={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))}
              disabled={page >= data.pagination.totalPages}
              data-testid="button-next-page"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Owners() {
  const [activeTab, setActiveTab] = useState("portfolios");
  const [networkSearchQuery, setNetworkSearchQuery] = useState("");

  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialTab = urlParams.get("tab");

  useEffect(() => {
    if (initialTab && ["portfolios", "network", "contractors"].includes(initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleViewInNetwork = useCallback((name: string) => {
    setNetworkSearchQuery(name);
    setActiveTab("network");
  }, []);

  return (
    <div className="p-8 space-y-6" data-testid="page-owners">
      <PageMeta
        title="Owners"
        description="Explore property owners, ownership networks, and contractor relationships across DFW commercial properties."
        path="/owners"
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Owners</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Portfolios, ownership networks, and contractor intelligence
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-owners">
          <TabsTrigger value="portfolios" data-testid="tab-trigger-portfolios">
            <Users className="w-4 h-4 mr-1.5" />
            Portfolios
          </TabsTrigger>
          <TabsTrigger value="network" data-testid="tab-trigger-network">
            <Share2 className="w-4 h-4 mr-1.5" />
            Network
          </TabsTrigger>
          <TabsTrigger value="contractors" data-testid="tab-trigger-contractors">
            <HardHat className="w-4 h-4 mr-1.5" />
            Contractors
          </TabsTrigger>
        </TabsList>

        <TabsContent value="portfolios">
          <PortfoliosTab onViewInNetwork={handleViewInNetwork} />
        </TabsContent>

        <TabsContent value="network">
          <NetworkTab initialSearchQuery={networkSearchQuery} />
        </TabsContent>

        <TabsContent value="contractors">
          <ContractorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
