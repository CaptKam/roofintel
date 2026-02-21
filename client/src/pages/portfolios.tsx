import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, Users, ChevronRight, TrendingUp, Zap, Phone, Mail, Search, ArrowUpDown, Loader2, Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMarket } from "@/hooks/use-market";
import { useToast } from "@/hooks/use-toast";
import { ScoreBadge } from "@/components/score-badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Lead } from "@shared/schema";

interface Portfolio {
  id: string;
  name: string;
  keyOwner: string;
  ownerType: string;
  propertyCount: number;
  totalSqft: number;
  totalRoofArea: number;
  totalValue: number;
  avgLeadScore: number;
  totalHailEvents: number;
  claimWindowCount: number;
  portfolioScore: number;
  keyDecisionMaker: string | null;
  keyDecisionMakerTitle: string | null;
  keyPhone: string | null;
  keyEmail: string | null;
  linkageType: string;
  linkageKeys: string[] | null;
  registeredAgent: string | null;
  managingMember: string | null;
  llcEntities: string[] | null;
  analyzedAt: string;
}

interface NetworkStats {
  totalPortfolios: number;
  totalLinkedLeads: number;
  totalUnlinkedLeads: number;
  avgPortfolioSize: number;
  largestPortfolio: number;
  topPortfolios: Portfolio[];
}

interface PortfolioDetail {
  portfolio: Portfolio;
  leads: Lead[];
  linkReasons: Record<string, string>;
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

function getLinkageLabel(type: string): string {
  switch (type) {
    case "taxpayer_id": return "Taxpayer ID";
    case "sos_file_number": return "SOS File #";
    case "registered_agent": return "Registered Agent";
    case "llc_chain": return "LLC Chain";
    case "managing_member": return "Managing Member";
    case "owner_name": return "Owner Name";
    default: return type;
  }
}

function PortfolioScoreBadge({ score }: { score: number }) {
  const getColor = (s: number) => {
    if (s >= 80) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    if (s >= 60) return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    if (s >= 40) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    return "bg-muted text-muted-foreground";
  };

  return (
    <Badge variant="secondary" className={`font-mono text-xs ${getColor(score)}`}>
      {score}
    </Badge>
  );
}

export default function Portfolios() {
  const { activeMarket } = useMarket();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const marketId = activeMarket?.id;

  const statsUrl = `/api/network/stats${marketId ? `?marketId=${marketId}` : ""}`;
  const { data: stats, isLoading: statsLoading } = useQuery<NetworkStats>({
    queryKey: ["/api/network/stats", marketId],
    queryFn: () => fetch(statsUrl, { credentials: "include" }).then(r => r.json()),
  });

  const portfoliosUrl = `/api/portfolios?${marketId ? `marketId=${marketId}&` : ""}sortBy=${sortBy}`;
  const { data: allPortfolios, isLoading: portfoliosLoading } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolios", marketId, sortBy],
    queryFn: () => fetch(portfoliosUrl, { credentials: "include" }).then(r => r.json()),
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/network/analyze", { marketId });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Network Analysis Complete", description: `Created ${data.portfoliosCreated} portfolios linking ${data.leadsLinked} properties` });
      queryClient.invalidateQueries({ queryKey: ["/api/network/stats", marketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios", marketId] });
    },
    onError: (error: any) => {
      toast({ title: "Analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  const filteredPortfolios = (allPortfolios || []).filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.keyOwner.toLowerCase().includes(s) ||
      p.name.toLowerCase().includes(s) ||
      (p.keyDecisionMaker?.toLowerCase().includes(s)) ||
      (p.registeredAgent?.toLowerCase().includes(s)) ||
      (p.llcEntities?.some((e) => e.toLowerCase().includes(s)))
    );
  });

  return (
    <div className="p-8 space-y-6" data-testid="page-portfolios">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Portfolios</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Relationship network mapping — discover portfolio owners controlling multiple properties
          </p>
        </div>
        <Button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
          data-testid="button-analyze-network"
        >
          {analyzeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Network className="w-4 h-4 mr-2" />
          )}
          Analyze Network
        </Button>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Portfolios", value: stats.totalPortfolios, icon: Users },
            { label: "Linked Properties", value: stats.totalLinkedLeads, icon: Building2 },
            { label: "Standalone", value: stats.totalUnlinkedLeads, icon: Building2 },
            { label: "Avg Size", value: stats.avgPortfolioSize, icon: TrendingUp },
            { label: "Largest", value: stats.largestPortfolio, icon: Zap },
          ].map((stat) => (
            <Card key={stat.label} className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center">
                    <stat.icon className="w-[18px] h-[18px] text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>{stat.value}</p>
                    <p className="text-[11px] text-muted-foreground font-medium">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="py-16 text-center">
            <Network className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-base font-medium">No Network Data Yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Click "Analyze Network" to discover portfolio relationships</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input
            placeholder="Search portfolios..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 rounded-lg"
            data-testid="input-search-portfolios"
          />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[180px] h-10" data-testid="select-sort-portfolios">
            <ArrowUpDown className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Portfolio Score</SelectItem>
            <SelectItem value="properties">Property Count</SelectItem>
            <SelectItem value="value">Total Value</SelectItem>
            <SelectItem value="roofArea">Total Roof Area</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {portfoliosLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : filteredPortfolios.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-base font-medium">No portfolios found</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {(allPortfolios || []).length === 0
              ? "Run network analysis to discover portfolio relationships"
              : "No portfolios match your search"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPortfolios.map((portfolio) => (
            <PortfolioRow
              key={portfolio.id}
              portfolio={portfolio}
              isExpanded={expandedId === portfolio.id}
              onToggle={() => setExpandedId(expandedId === portfolio.id ? null : portfolio.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioRow({ portfolio, isExpanded, onToggle }: { portfolio: Portfolio; isExpanded: boolean; onToggle: () => void }) {
  const { data: detail, isLoading: detailLoading } = useQuery<PortfolioDetail>({
    queryKey: ["/api/portfolios", portfolio.id],
    queryFn: () => fetch(`/api/portfolios/${portfolio.id}`).then(r => r.json()),
    enabled: isExpanded,
  });

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden transition-all" data-testid={`portfolio-${portfolio.id}`}>
      <button
        onClick={onToggle}
        className="w-full text-left p-5 hover:bg-muted/30 transition-colors flex items-center gap-4"
        data-testid={`button-toggle-portfolio-${portfolio.id}`}
      >
        <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
          <Users className="w-5 h-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold truncate">{portfolio.keyOwner}</span>
            <Badge variant="outline" className="text-[10px] font-normal">{portfolio.ownerType}</Badge>
            <Badge variant="outline" className="text-[10px] font-normal">{getLinkageLabel(portfolio.linkageType)}</Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{portfolio.propertyCount} properties</span>
            <span>{formatSqft(portfolio.totalRoofArea)}</span>
            <span>{formatValue(portfolio.totalValue)}</span>
            <span>{portfolio.totalHailEvents} hail events</span>
            {portfolio.claimWindowCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400">{portfolio.claimWindowCount} claim window open</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {portfolio.keyDecisionMaker && (
            <div className="text-right hidden lg:block">
              <p className="text-xs font-medium">{portfolio.keyDecisionMaker}</p>
              <p className="text-[10px] text-muted-foreground">{portfolio.keyDecisionMakerTitle}</p>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {portfolio.keyPhone && <Phone className="w-3.5 h-3.5 text-emerald-500" />}
            {portfolio.keyEmail && <Mail className="w-3.5 h-3.5 text-blue-500" />}
          </div>
          <PortfolioScoreBadge score={portfolio.portfolioScore} />
          <ChevronRight className={`w-4 h-4 text-muted-foreground/30 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border/50 bg-muted/10 p-5">
          {detailLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Avg Lead Score</p>
                  <p className="text-lg font-bold mt-0.5">{portfolio.avgLeadScore}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Roof Area</p>
                  <p className="text-lg font-bold mt-0.5">{formatSqft(portfolio.totalRoofArea)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Combined Value</p>
                  <p className="text-lg font-bold mt-0.5">{formatValue(portfolio.totalValue)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Decision Maker</p>
                  <p className="text-lg font-bold mt-0.5">{portfolio.keyDecisionMaker || "Unknown"}</p>
                </div>
              </div>

              {portfolio.keyPhone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{portfolio.keyPhone}</span>
                  {portfolio.keyEmail && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium">{portfolio.keyEmail}</span>
                    </>
                  )}
                </div>
              )}

              {portfolio.registeredAgent && (
                <div className="text-xs text-muted-foreground">
                  Registered Agent: <span className="font-medium text-foreground">{portfolio.registeredAgent}</span>
                </div>
              )}

              {portfolio.llcEntities && portfolio.llcEntities.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Connected Entities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {portfolio.llcEntities.slice(0, 10).map((entity, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] font-normal">{entity}</Badge>
                    ))}
                    {portfolio.llcEntities.length > 10 && (
                      <Badge variant="outline" className="text-[10px] font-normal">+{portfolio.llcEntities.length - 10} more</Badge>
                    )}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Properties in Portfolio</p>
                <div className="divide-y divide-border/50">
                  {detail.leads.map((lead) => (
                    <Link key={lead.id} href={`/leads/${lead.id}`}>
                      <div className="py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors cursor-pointer rounded-lg px-2 -mx-2" data-testid={`portfolio-lead-${lead.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{lead.address}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span>{lead.city}, {lead.state}</span>
                            <span>{(lead.sqft || 0).toLocaleString()} sqft</span>
                            {lead.totalValue && <span>{formatValue(lead.totalValue)}</span>}
                            <span className="text-[10px] text-muted-foreground/60">{detail.linkReasons[lead.id]}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {lead.hailEvents > 0 && (
                            <span className="text-[10px] text-muted-foreground">{lead.hailEvents} hail</span>
                          )}
                          <ScoreBadge score={lead.leadScore} />
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
