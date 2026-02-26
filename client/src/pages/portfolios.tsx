import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageMeta } from "@/components/page-meta";
import { Building2, Users, ChevronRight, TrendingUp, Search, Loader2, Network, RefreshCw, ChevronDown, AlertCircle, MapPin, ShieldAlert, Clock, Layers, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ScoreBadge } from "@/components/score-badge";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

export default function Portfolios() {
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
    <div className="p-8 space-y-6" data-testid="page-portfolios">
      <PageMeta
        title="Portfolios"
        description="Discover multi-property owners and investment portfolios across DFW commercial properties. View ownership networks and portfolio intelligence."
        path="/portfolios"
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Portfolios</h1>
          <p className="text-sm text-muted-foreground mt-1">
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
            />
          ))}
        </div>
      )}
    </div>
  );
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

function OwnerRow({ owner, isExpanded, onToggle }: { owner: RooftopOwnerSummary; isExpanded: boolean; onToggle: () => void }) {
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
              {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="portfolio-summary">
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
