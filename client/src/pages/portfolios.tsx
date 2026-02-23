import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, Users, ChevronRight, TrendingUp, Search, Loader2, Network, RefreshCw, ChevronDown, AlertCircle, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Portfolios</h2>
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

function OwnerRow({ owner, isExpanded, onToggle }: { owner: RooftopOwnerSummary; isExpanded: boolean; onToggle: () => void }) {
  const { data: properties, isLoading, isError } = useQuery<PortfolioProperty[]>({
    queryKey: ["/api/portfolio/owner", owner.normalizedName],
    queryFn: () => fetch(`/api/portfolio/owner/${encodeURIComponent(owner.normalizedName)}`).then(r => r.json()),
    enabled: isExpanded,
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
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" data-testid="text-owner-name">{owner.personName}</span>
            {count > 1 && (
              <span className="text-[10px] text-primary font-medium" data-testid="text-property-count">{count} properties</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-0.5">
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
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                          <span>{prop.city}, {prop.county}</span>
                          <span>{prop.sqft.toLocaleString()} sqft</span>
                          {prop.totalValue > 0 && <span>{formatValue(prop.totalValue)}</span>}
                          {prop.roofType && <span>{prop.roofType}</span>}
                          {prop.hailEvents > 0 && <span>{prop.hailEvents} hail</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
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
