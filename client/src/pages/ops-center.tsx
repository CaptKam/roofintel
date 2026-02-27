import { useState } from "react";
import { Link, useLocation } from "wouter";
import { PageMeta } from "@/components/page-meta";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMarket } from "@/hooks/use-market";
import { ScoreBadge } from "@/components/score-badge";
import {
  Zap,
  DollarSign,
  TrendingUp,
  Layers,
  Play,
  Activity,
  CloudLightning,
  Phone,
  Loader2,
  CheckCircle2,
  Search,
  Gauge,
  BarChart3,
  RefreshCw,
  MapPin,
  Target,
  Fingerprint,
  Mail,
  ShieldCheck,
  HardHat,
  ChevronRight,
  Building2,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Percent,
  ShieldAlert,
  CircleCheck,
  CircleMinus,
  CircleAlert,
  AlertTriangle,
  User,
  Database,
  ChevronDown,
  Sparkles,
  Clock,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ROIEnginePanel } from "@/components/admin/roi-engine-panel";
import { AnalyticsKPIsPanel } from "@/components/admin/analytics-kpis-panel";
import { NaturalLanguageBar } from "@/components/ops/natural-language-bar";
import { IntelBriefing } from "@/components/ops/intel-briefing";
import { AlertsFeed } from "@/components/ops/alerts-feed";

interface CommandCenter {
  totalLeads: number;
  totalPipelineValue: number;
  actionableLeads: number;
  avgScore: number;
  hotLeads: number;
  pipeline: { new: number; contacted: number; qualified: number; proposal: number; closed: number };
  coverage: {
    hasPhone: number;
    hasEmail: number;
    hasDecisionMaker: number;
    hasOwnershipClassified: number;
    enriched: number;
    hasPermitData: number;
  };
  priorityActions: Array<{
    id: string;
    address: string;
    city: string;
    leadScore: number;
    roofAge: number | null;
    hailEvents: number;
    lastHailDate: string | null;
    claimWindowOpen: boolean;
    ownerName: string;
    contactName: string | null;
    contactPhone: string | null;
    totalValue: number | null;
    reason: string;
    evidenceCount: number;
    permitCount: number;
    claimWindowDays: number | null;
    portfolioSize: number;
  }>;
  stormPulse: {
    recentEvents30d: number;
    recentEvents7d: number;
    avgHailSize30d: number | null;
    affectedLeads30d: number;
  };
  competitors: Array<{ name: string; permitCount: number; recentPermit: string | null }>;
  scoreDistribution: Array<{ range: string; count: number }>;
  topValueLeads: Array<{ id: string; address: string; totalValue: number; leadScore: number; ownerName: string }>;
}

interface RoofRiskSummary {
  distribution: { critical: number; high: number; moderate: number; low: number };
  total: number;
  avgScore: number;
  topRisk: Array<{
    id: string;
    address: string;
    city: string;
    roof_risk_index: number;
    roof_type: string | null;
    year_built: number;
    tier: string | null;
    exposure_window: string | null;
  }>;
}

interface QualitySummary {
  tiers: {
    high: { count: number; pct: number };
    medium: { count: number; pct: number };
    low: { count: number; pct: number };
  };
  metrics: {
    total: number;
    hasPhone: number;
    hasContactName: number;
    hasDecisionMaker: number;
    enriched: number;
    hasEmail: number;
    hasOwnership: number;
  };
  gaps: Array<{ field: string; label: string; count: number; pct: number }>;
}

interface FunnelData {
  stages: Array<{ stage: string; count: number; conversionFromPrev: number; pctOfTotal: number }>;
  totalLeads: number;
  closedWon: number;
  closedLost: number;
  winRate: number;
}

interface KpiData {
  totalLeads: number | null;
  contactableLeads: number | null;
  contactableRate: number | null;
  conversionRate: number | null;
  costPerLead: number | null;
  costPerSale: number | null;
  roi: number | null;
  totalRevenue: number | null;
  totalEnrichmentSpend: number | null;
  closedWon: number | null;
  closedLost: number | null;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function CoverageGauge({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  const clampedValue = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-3" data-testid={`coverage-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-xs font-medium tabular-nums">{clampedValue}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground/70 rounded-full transition-all duration-700"
            style={{ width: `${clampedValue}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function PipelineStep({ label, count, total, conversionRate, isLast }: { label: string; count: number; total: number; conversionRate?: number; isLast?: boolean }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div data-testid={`pipeline-${label.toLowerCase()}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs font-medium">{label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/60 rounded-full transition-all duration-700"
              style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
            />
          </div>
        </div>
        {!isLast && <ChevronRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />}
      </div>
      {conversionRate !== undefined && !isLast && (
        <div className="flex items-center gap-1 ml-1 mt-0.5" data-testid={`pipeline-conversion-${label.toLowerCase()}`}>
          <ArrowDownRight className="w-3 h-3 text-muted-foreground/50" />
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">{(conversionRate * 100).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

export default function OpsCenter() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const { activeMarket } = useMarket();
  const mq = activeMarket?.id ? `?marketId=${activeMarket.id}` : "";

  const { data: commandCenter, isLoading: commandCenterLoading } = useQuery<CommandCenter>({
    queryKey: ["/api/dashboard/command-center", activeMarket?.id],
    queryFn: () => fetch(`/api/dashboard/command-center${mq}`).then(r => r.json()),
  });

  const { data: qualityData } = useQuery<QualitySummary>({
    queryKey: ["/api/data/quality-summary", activeMarket?.id],
    queryFn: () => fetch(`/api/data/quality-summary${mq}`).then(r => r.json()),
  });

  const { data: roofRiskData } = useQuery<RoofRiskSummary>({
    queryKey: ["/api/dashboard/roof-risk-summary", activeMarket?.id],
    queryFn: () => fetch(`/api/dashboard/roof-risk-summary${mq}`).then(r => r.json()),
  });

  const { data: funnelData } = useQuery<FunnelData>({
    queryKey: ["/api/admin/kpis/funnel"],
  });

  const { data: stormStatus } = useQuery<{ running: boolean; lastHash: string }>({
    queryKey: ["/api/storm/status"],
    refetchInterval: 30000,
  });

  const { data: xweatherStatus } = useQuery<{
    running: boolean;
    configured: boolean;
    activeThreats: number;
    totalAffectedLeads: number;
  }>({
    queryKey: ["/api/xweather/status"],
    refetchInterval: 30000,
  });

  const { data: budgetConfig } = useQuery<{
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    spentTodayUsd: number;
    spentThisMonthUsd: number;
    hailSeasonMultiplier: number;
  }>({
    queryKey: ["/api/admin/budgets"],
  });

  const { data: pipelinePhases } = useQuery<{
    total: number;
    withOwner: number;
    withTxFilingData: number;
    withPhone: number;
    withBusinessWebsite: number;
    withContactPerson: number;
    withEmail: number;
    fullyEnriched: number;
  }>({
    queryKey: ["/api/enrichment/pipeline-stats", activeMarket?.id],
    queryFn: () => fetch(`/api/enrichment/pipeline-stats${mq}`).then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: zipTileStatus } = useQuery<{ processed: number; total: number; running: boolean }>({
    queryKey: ["/api/admin/zip-tiles/status"],
    refetchInterval: (query) => {
      const d = query.state.data as { running: boolean } | undefined;
      return d?.running ? 2000 : false;
    },
  });

  const { data: phoneValidationSummary } = useQuery<{
    totalPhones: number;
    validatedCount: number;
    mobileCount: number;
    invalidCount: number;
    validatedPct: number;
  }>({
    queryKey: ["/api/admin/phone-validation/summary"],
  });

  const { data: kpiCurrent } = useQuery<KpiData>({
    queryKey: ["/api/admin/kpis/current"],
  });

  const { data: grokCosts } = useQuery<{
    last24h: { calls: number; tokens: number; costUsd: number };
    last7d: { calls: number; tokens: number; costUsd: number };
    allTime: { calls: number; tokens: number; costUsd: number };
  }>({
    queryKey: ["/api/ops/grok-cost-summary"],
    refetchInterval: 60000,
  });

  const computeZipMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/zip-tiles/compute", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "ZIP tile computation started" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/zip-tiles/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to compute ZIP tiles", description: err.message, variant: "destructive" });
    },
  });

  const runPipelineMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/batch-reprocess", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline batch started" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start pipeline", description: err.message, variant: "destructive" });
    },
  });

  const startBatchPhoneMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/phone-validation/batch", { limit: 100 });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Batch phone validation started" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const dailyBudget = budgetConfig?.dailyBudgetUsd || 500;
  const spentToday = budgetConfig?.spentTodayUsd || 0;
  const monthlyBudget = budgetConfig?.monthlyBudgetUsd || 12000;
  const spentMonth = budgetConfig?.spentThisMonthUsd || 0;
  const dailyPct = dailyBudget > 0 ? Math.min(100, Math.round((spentToday / dailyBudget) * 100)) : 0;
  const monthlyPct = monthlyBudget > 0 ? Math.min(100, Math.round((spentMonth / monthlyBudget) * 100)) : 0;
  const dailyColor = dailyPct >= 90 ? "bg-red-500" : dailyPct >= 60 ? "bg-amber-500" : "bg-emerald-500";
  const monthlyColor = monthlyPct >= 90 ? "bg-red-500" : monthlyPct >= 60 ? "bg-amber-500" : "bg-emerald-500";

  const hasActiveStorm = (xweatherStatus?.activeThreats || 0) > 0;
  const zipRunning = zipTileStatus?.running || false;

  const cards = [
    { id: "kpi-hero", label: "KPI Hero" },
    { id: "intel-briefing", label: "Intelligence Briefing" },
    { id: "performance", label: "Performance Metrics" },
    { id: "grok", label: "Grok Intelligence" },
    { id: "priority-actions", label: "Priority Actions" },
    { id: "pipeline-coverage", label: "Pipeline & Coverage" },
    { id: "market-intelligence", label: "Market Intelligence" },
    { id: "data-quality", label: "Data Quality" },
    { id: "roof-risk", label: "Roof Risk" },
    { id: "budget", label: "Budget" },
    { id: "roi", label: "ROI Engine" },
    { id: "zip", label: "ZIP Tiles" },
    { id: "pipeline", label: "Pipeline Control" },
    { id: "analytics", label: "Analytics" },
    { id: "storm-phone", label: "Storm & Phone" },
  ];

  const filteredCards = searchQuery.trim()
    ? cards.filter(c => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : cards;
  const visibleIds = new Set(filteredCards.map(c => c.id));

  const toggleExpand = (cardId: string) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
  };

  const totalPipeline = commandCenter
    ? commandCenter.pipeline.new + commandCenter.pipeline.contacted + commandCenter.pipeline.qualified + commandCenter.pipeline.proposal + commandCenter.pipeline.closed
    : 0;

  return (
    <div className="p-8 space-y-6">
      <PageMeta
        title="Ops Center"
        description="RoofIntel Operations Center — daily command center for ROI, pipeline, budget, and storm operations."
        path="/ops"
      />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-ops-title">
            <Zap className="w-6 h-6 text-amber-500" />
            Operations Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {commandCenter ? `${commandCenter.totalLeads.toLocaleString()} properties under intelligence` : "Daily command center for ROI, pipeline, and storm operations"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasActiveStorm && (
            <Badge variant="destructive" className="animate-pulse" data-testid="badge-active-storm">
              <CloudLightning className="w-3 h-3 mr-1" />
              {xweatherStatus?.activeThreats} Active Threat{(xweatherStatus?.activeThreats || 0) > 1 ? "s" : ""}
            </Badge>
          )}
          {stormStatus?.running && (
            <Badge variant="secondary" data-testid="badge-storm-monitor">
              <Activity className="w-3 h-3 mr-1" />
              Storm Monitor Active
            </Badge>
          )}
          <Link href="/leads">
            <Button variant="outline" data-testid="button-view-all-leads">
              View All Leads
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search cards... (kpi, performance, priority, pipeline, market, quality, risk, budget, roi, zip, analytics, storm)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-ops-search"
        />
      </div>

      {visibleIds.has("kpi-hero") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="card-kpi-hero">
          {commandCenterLoading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Card key={i}><CardContent className="p-6"><Skeleton className="h-3 w-20 mb-3" /><Skeleton className="h-10 w-24 mb-2" /><Skeleton className="h-3 w-16" /></CardContent></Card>
              ))}
            </>
          ) : commandCenter ? (
            <>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Pipeline Value</p>
                      <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-pipeline-value">{formatCurrency(commandCenter.totalPipelineValue)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{commandCenter.totalLeads.toLocaleString()} properties</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Actionable Now</p>
                      <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-actionable">{commandCenter.actionableLeads}</p>
                      <p className="text-xs text-muted-foreground mt-1">Hail + phone + score 60+</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <Target className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Avg Score</p>
                      <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-avg-score">{Math.round(commandCenter.avgScore)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{commandCenter.hotLeads} leads score 80+</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Storm Pulse</p>
                      <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-storm-pulse">{commandCenter.stormPulse.recentEvents30d}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {commandCenter.stormPulse.recentEvents7d > 0
                          ? `${commandCenter.stormPulse.recentEvents7d} this week`
                          : "Hail events (30d)"}
                      </p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <CloudLightning className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      )}

      <AlertsFeed marketId={activeMarket?.id} />

      {visibleIds.has("intel-briefing") && <IntelBriefing marketId={activeMarket?.id} />}

      {visibleIds.has("performance") && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="card-performance-metrics">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Conversion Rate</p>
                  {kpiCurrent ? (
                    <>
                      <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-conversion-rate">
                        {((kpiCurrent.conversionRate ?? 0) * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {kpiCurrent.closedWon ?? 0} won / {(kpiCurrent.closedWon ?? 0) + (kpiCurrent.closedLost ?? 0)} decided
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-medium mt-2 text-muted-foreground" data-testid="stat-conversion-rate">No data yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Record outcomes to track</p>
                    </>
                  )}
                </div>
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Percent className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Cost per Lead / Sale</p>
                  {kpiCurrent ? (
                    <>
                      <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-cost-per-lead">
                        {formatCurrency(kpiCurrent.costPerLead ?? 0)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1" data-testid="stat-cost-per-sale">
                        {formatCurrency(kpiCurrent.costPerSale ?? 0)} per sale
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-medium mt-2 text-muted-foreground" data-testid="stat-cost-per-lead">No data yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Enrichment costs will appear here</p>
                    </>
                  )}
                </div>
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Enrichment ROI</p>
                  {kpiCurrent ? (
                    <>
                      <div className="flex items-center gap-2 mt-2">
                        <p className="text-3xl font-bold tracking-tight" data-testid="stat-roi">
                          {((kpiCurrent.roi ?? 0) * 100).toFixed(0)}%
                        </p>
                        {(kpiCurrent.roi ?? 0) > 0 ? (
                          <ArrowUpRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (kpiCurrent.roi ?? 0) < 0 ? (
                          <ArrowDownRight className="w-5 h-5 text-red-600 dark:text-red-400" />
                        ) : (
                          <Minus className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatCurrency(kpiCurrent.totalRevenue ?? 0)} rev / {formatCurrency(kpiCurrent.totalEnrichmentSpend ?? 0)} spend
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-medium mt-2 text-muted-foreground" data-testid="stat-roi">No data yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Revenue vs enrichment spend</p>
                    </>
                  )}
                </div>
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {visibleIds.has("grok") && (
        <Card className="shadow-sm" data-testid="card-ops-grok">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              Grok Intelligence Core
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-lg font-bold" data-testid="text-grok-calls-24h">{grokCosts?.last24h?.calls ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">Calls (24h)</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-lg font-bold" data-testid="text-grok-tokens-24h">{grokCosts?.last24h?.tokens?.toLocaleString() ?? "0"}</div>
                <div className="text-[11px] text-muted-foreground">Tokens (24h)</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-purple-600" data-testid="text-grok-cost-24h">${(grokCosts?.last24h?.costUsd ?? 0).toFixed(4)}</div>
                <div className="text-[11px] text-muted-foreground">Cost (24h)</div>
              </div>
            </div>
            <NaturalLanguageBar />
          </CardContent>
        </Card>
      )}

      {visibleIds.has("priority-actions") && commandCenter && (
        <Card className="shadow-sm" data-testid="card-priority-actions">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-600" />
              Priority Actions
            </CardTitle>
            <Badge variant="secondary">{commandCenter.priorityActions.length} ready</Badge>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {commandCenter.priorityActions.length > 0 ? (
              <div className="divide-y divide-border">
                {commandCenter.priorityActions.map((lead) => (
                  <Link key={lead.id} href={`/leads/${lead.id}`}>
                    <div
                      className="flex items-center gap-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-md px-2 -mx-2"
                      data-testid={`priority-lead-${lead.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{lead.address}</p>
                          {lead.claimWindowOpen && <Badge variant="default" className="text-[9px]">Claimable</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">{lead.city}</span>
                          {lead.contactName && (
                            <span className="text-xs text-foreground flex items-center gap-1">
                              <Fingerprint className="w-3 h-3" />
                              {lead.contactName}
                            </span>
                          )}
                          {lead.contactPhone && (
                            <span className="text-xs text-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {lead.contactPhone}
                            </span>
                          )}
                          {lead.totalValue && (
                            <span className="text-xs text-muted-foreground">{formatCurrency(lead.totalValue)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {lead.evidenceCount > 0 && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0" data-testid={`badge-evidence-${lead.id}`}>
                              <Database className="w-2.5 h-2.5 mr-0.5" />
                              {lead.evidenceCount} source{lead.evidenceCount !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {lead.permitCount > 0 && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0" data-testid={`badge-permits-${lead.id}`}>
                              <HardHat className="w-2.5 h-2.5 mr-0.5" />
                              {lead.permitCount} permit{lead.permitCount !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {lead.claimWindowDays !== null && lead.claimWindowDays > 0 && (
                            <Badge variant="default" className="text-[9px] px-1.5 py-0" data-testid={`badge-claim-${lead.id}`}>
                              <Clock className="w-2.5 h-2.5 mr-0.5" />
                              Claim Open · {lead.claimWindowDays}d
                            </Badge>
                          )}
                          {lead.portfolioSize > 1 && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0" data-testid={`badge-portfolio-${lead.id}`}>
                              <Building2 className="w-2.5 h-2.5 mr-0.5" />
                              {lead.portfolioSize} properties
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{lead.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <ScoreBadge score={lead.leadScore} />
                        <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <Target className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No priority actions right now</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Leads with hail damage, high scores, and contact info will appear here</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {visibleIds.has("pipeline-coverage") && commandCenter && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="card-pipeline-coverage">
          <div className="space-y-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Pipeline</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-3">
                {(() => {
                  const stageNames = ["new", "contacted", "qualified", "proposal", "closed"];
                  const stageLabelMap: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", proposal: "Proposal", closed: "Closed" };
                  const funnelMap: Record<string, number> = {};
                  if (funnelData?.stages) {
                    for (const s of funnelData.stages) {
                      funnelMap[s.stage] = s.conversionFromPrev;
                    }
                  }
                  const pipelineCounts: Record<string, number> = commandCenter.pipeline;
                  return stageNames.map((stage, idx) => (
                    <PipelineStep
                      key={stage}
                      label={stageLabelMap[stage]}
                      count={pipelineCounts[stage] || 0}
                      total={totalPipeline}
                      conversionRate={idx > 0 ? funnelMap[stage] : undefined}
                      isLast={idx === stageNames.length - 1}
                    />
                  ));
                })()}
                {funnelData && funnelData.winRate > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-border" data-testid="stat-win-rate">
                    <span className="text-xs font-medium text-muted-foreground">Win Rate</span>
                    <span className="text-xs font-semibold tabular-nums">{(funnelData.winRate * 100).toFixed(1)}%</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Intelligence Coverage</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <CoverageGauge label="Has Phone" value={commandCenter.coverage.hasPhone} icon={Phone} />
              <CoverageGauge label="Has Email" value={commandCenter.coverage.hasEmail} icon={Mail} />
              <CoverageGauge label="Decision Maker" value={commandCenter.coverage.hasDecisionMaker} icon={Fingerprint} />
              <CoverageGauge label="Ownership Classified" value={commandCenter.coverage.hasOwnershipClassified} icon={ShieldCheck} />
              <CoverageGauge label="Enriched" value={commandCenter.coverage.enriched} icon={Zap} />
              <CoverageGauge label="Permit Data" value={commandCenter.coverage.hasPermitData} icon={HardHat} />
            </CardContent>
          </Card>
        </div>
      )}

      {visibleIds.has("market-intelligence") && commandCenter && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="card-market-intelligence">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
              <CardTitle className="text-base font-semibold">Score Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={commandCenter.scoreDistribution} barSize={32}>
                  <XAxis
                    dataKey="range"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--foreground))" opacity={0.7} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">Competitor Activity</CardTitle>
              <Badge variant="secondary">{commandCenter.competitors.length} contractors</Badge>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              {commandCenter.competitors.length > 0 ? (
                <div className="space-y-2.5">
                  {commandCenter.competitors.map((c, i) => (
                    <Link key={i} href={`/owners?search=${encodeURIComponent(c.name)}`}>
                      <div className="flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-md px-2 py-1.5 -mx-2" data-testid={`competitor-${i}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                            <HardHat className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <span className="text-sm truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className="text-[10px] tabular-nums">{c.permitCount} permits</Badge>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <HardHat className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No competitor data yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {visibleIds.has("market-intelligence") && commandCenter && commandCenter.topValueLeads.length > 0 && (
        <Card className="shadow-sm" data-testid="card-top-value-leads">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">Highest Value Properties</CardTitle>
            <Link href="/leads">
              <Button variant="ghost" size="sm" data-testid="button-see-all-value">
                See all
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {commandCenter.topValueLeads.map((lead) => (
                <Link key={lead.id} href={`/leads/${lead.id}`}>
                  <div
                    className="flex items-center gap-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-md px-2 -mx-2"
                    data-testid={`value-lead-${lead.id}`}
                  >
                    <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{lead.address}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{lead.ownerName}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-medium tabular-nums">{formatCurrency(lead.totalValue)}</span>
                      <ScoreBadge score={lead.leadScore} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {visibleIds.has("data-quality") && qualityData && (
        <Card className="shadow-sm" data-testid="card-data-quality">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600" />
              Data Quality
            </CardTitle>
            <Badge variant="secondary">{qualityData.metrics.total.toLocaleString()} leads</Badge>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Confidence Tiers</p>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3" data-testid="quality-tier-high">
                    <CircleCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">High</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{qualityData.tiers.high.count.toLocaleString()} ({qualityData.tiers.high.pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${qualityData.tiers.high.pct}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" data-testid="quality-tier-medium">
                    <CircleMinus className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">Medium</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{qualityData.tiers.medium.count.toLocaleString()} ({qualityData.tiers.medium.pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full transition-all duration-700" style={{ width: `${qualityData.tiers.medium.pct}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" data-testid="quality-tier-low">
                    <CircleAlert className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">Low</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{qualityData.tiers.low.count.toLocaleString()} ({qualityData.tiers.low.pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full transition-all duration-700" style={{ width: `${qualityData.tiers.low.pct}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Key Metrics</p>
                <div className="space-y-2.5">
                  <CoverageGauge label="Verified Phones" value={qualityData.metrics.hasPhone} icon={Phone} />
                  <CoverageGauge label="Real Person Contacts" value={qualityData.metrics.hasContactName} icon={User} />
                  <CoverageGauge label="Decision Makers" value={qualityData.metrics.hasDecisionMaker} icon={Fingerprint} />
                  <CoverageGauge label="Enriched" value={qualityData.metrics.enriched} icon={Zap} />
                  <CoverageGauge label="Has Email" value={qualityData.metrics.hasEmail} icon={Mail} />
                  <CoverageGauge label="Ownership Classified" value={qualityData.metrics.hasOwnership} icon={Layers} />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Top Data Gaps</p>
                <div className="space-y-2.5">
                  {qualityData.gaps.map((gap, i) => (
                    <div key={gap.field} className="flex items-center gap-2.5" data-testid={`quality-gap-${i}`}>
                      <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground truncate">{gap.label}</span>
                          <span className="text-xs font-medium tabular-nums ml-2">{gap.pct}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {visibleIds.has("roof-risk") && roofRiskData && roofRiskData.total > 0 && (
        <Card className="shadow-sm" data-testid="card-roof-risk">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              Roof Risk Overview
            </CardTitle>
            <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">{roofRiskData.total.toLocaleString()} scored</Badge>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <ShieldAlert className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums" data-testid="text-avg-risk-score">{roofRiskData.avgScore}</p>
                    <p className="text-xs text-muted-foreground">Avg Risk Score</p>
                  </div>
                </div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Risk Distribution</p>
                {[
                  { label: "Critical", count: roofRiskData.distribution.critical, color: "bg-red-500", textColor: "text-red-700 dark:text-red-400" },
                  { label: "High", count: roofRiskData.distribution.high, color: "bg-orange-500", textColor: "text-orange-700 dark:text-orange-400" },
                  { label: "Moderate", count: roofRiskData.distribution.moderate, color: "bg-amber-500", textColor: "text-amber-700 dark:text-amber-400" },
                  { label: "Low", count: roofRiskData.distribution.low, color: "bg-emerald-500", textColor: "text-emerald-700 dark:text-emerald-400" },
                ].map((tier) => {
                  const pct = roofRiskData.total > 0 ? Math.round((tier.count / roofRiskData.total) * 100) : 0;
                  return (
                    <div
                      key={tier.label}
                      className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-md px-2 py-1 -mx-2"
                      onClick={() => navigate(`/leads?riskTier=${tier.label.toLowerCase()}`)}
                      data-testid={`risk-tier-${tier.label.toLowerCase()}`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${tier.color} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${tier.textColor}`}>{tier.label}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{tier.count.toLocaleString()} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${tier.color} rounded-full transition-all duration-700`} style={{ width: `${Math.max(pct, tier.count > 0 ? 2 : 0)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="lg:col-span-2 space-y-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Highest Risk Properties</p>
                <div className="divide-y divide-border">
                  {roofRiskData.topRisk.slice(0, 5).map((prop) => {
                    const riskColor = prop.roof_risk_index >= 81
                      ? "bg-red-500/15 text-red-700 dark:text-red-400"
                      : prop.roof_risk_index >= 61
                      ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
                      : prop.roof_risk_index >= 31
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
                    return (
                      <Link key={prop.id} href={`/leads/${prop.id}`}>
                        <div
                          className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors rounded-md px-2 -mx-2"
                          data-testid={`top-risk-${prop.id}`}
                        >
                          <Badge
                            variant="secondary"
                            className={`no-default-hover-elevate no-default-active-elevate font-mono text-xs min-w-[3rem] justify-center ${riskColor}`}
                          >
                            {prop.roof_risk_index}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{prop.address}</p>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              <span className="text-xs text-muted-foreground">{prop.city}</span>
                              {prop.roof_type && <span className="text-xs text-muted-foreground">{prop.roof_type}</span>}
                              {prop.year_built && <span className="text-xs text-muted-foreground">Built {prop.year_built}</span>}
                            </div>
                            {prop.exposure_window && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">{prop.exposure_window}</p>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/30 flex-shrink-0" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {roofRiskData.topRisk.length > 0 && (
                  <Link href="/leads?riskTier=critical&sortBy=roofRiskIndex">
                    <Button variant="ghost" size="sm" className="w-full" data-testid="button-view-all-risk">
                      View all high-risk properties
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {visibleIds.has("budget") && (
          <Card className="shadow-sm" data-testid="card-ops-budget">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Live Budget Guardrails
              </CardTitle>
              {budgetConfig?.hailSeasonMultiplier && budgetConfig.hailSeasonMultiplier > 1 && (
                <Badge variant="outline" className="text-[10px]" data-testid="badge-hail-multiplier">
                  Hail Season {budgetConfig.hailSeasonMultiplier}x
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Daily</span>
                    <span className="font-medium">${spentToday.toFixed(2)} / ${dailyBudget.toFixed(2)}</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden" data-testid="budget-daily-bar">
                    <div className={`h-full rounded-full transition-all ${dailyColor}`} style={{ width: `${dailyPct}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{dailyPct}% used</span>
                    <span>${(dailyBudget - spentToday).toFixed(2)} remaining</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Monthly</span>
                    <span className="font-medium">${spentMonth.toFixed(2)} / ${monthlyBudget.toFixed(2)}</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden" data-testid="budget-monthly-bar">
                    <div className={`h-full rounded-full transition-all ${monthlyColor}`} style={{ width: `${monthlyPct}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{monthlyPct}% used</span>
                    <span>${(monthlyBudget - spentMonth).toFixed(2)} remaining</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {visibleIds.has("pipeline") && (
          <Card className="shadow-sm" data-testid="card-ops-pipeline">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                Pipeline Control
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              {pipelinePhases ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between p-2 bg-muted/30 rounded-md">
                    <span className="text-muted-foreground">Total Leads</span>
                    <span className="font-medium" data-testid="text-pipeline-total">{pipelinePhases.total?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-md">
                    <span className="text-muted-foreground">With Owner</span>
                    <span className="font-medium">{pipelinePhases.withOwner?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-md">
                    <span className="text-muted-foreground">With Phone</span>
                    <span className="font-medium">{pipelinePhases.withPhone?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-md">
                    <span className="text-muted-foreground">TX Filing</span>
                    <span className="font-medium">{pipelinePhases.withTxFilingData?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-md">
                    <span className="text-muted-foreground">Contact Person</span>
                    <span className="font-medium">{pipelinePhases.withContactPerson?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-muted/30 rounded-md">
                    <span className="text-muted-foreground">Fully Enriched</span>
                    <span className="font-medium text-emerald-600">{pipelinePhases.fullyEnriched?.toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
              <Button
                className="w-full"
                onClick={() => runPipelineMutation.mutate()}
                disabled={runPipelineMutation.isPending}
                data-testid="btn-run-pipeline"
              >
                {runPipelineMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Run Full Pipeline
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {visibleIds.has("roi") && (
        <Card className="shadow-sm" data-testid="card-ops-roi">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 cursor-pointer" onClick={() => toggleExpand("roi")}>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              ROI Engine
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {expandedCard === "roi" ? "Collapse" : "Expand Full Controls"}
            </Badge>
          </CardHeader>
          {expandedCard === "roi" && (
            <CardContent className="p-6 pt-0">
              <ROIEnginePanel />
            </CardContent>
          )}
          {expandedCard !== "roi" && (
            <CardContent className="p-6 pt-0">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold" data-testid="text-roi-kpi-leads">{kpiCurrent?.totalLeads?.toLocaleString() || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Total Leads</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-blue-600" data-testid="text-roi-kpi-contactable">{kpiCurrent ? `${Math.round((kpiCurrent.contactableRate ?? 0) * 100)}%` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Contactable</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-emerald-600">${spentToday.toFixed(2)}</div>
                  <div className="text-[11px] text-muted-foreground">Spent Today</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-purple-600">{kpiCurrent ? `${(kpiCurrent.roi ?? 0).toFixed(1)}x` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">ROI</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">Click header to expand full ROI controls</p>
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {visibleIds.has("zip") && (
          <Card className="shadow-sm" data-testid="card-ops-zip">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-600" />
                ZIP Priority Tiles
              </CardTitle>
              {zipRunning && <Badge variant="secondary" className="animate-pulse">Computing...</Badge>}
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Recompute ZIP-level composite scores based on storm risk, roof age, data gaps, property value, and lead density.
              </p>
              <Button
                className="w-full"
                onClick={() => computeZipMutation.mutate()}
                disabled={zipRunning || computeZipMutation.isPending}
                data-testid="btn-compute-zips"
              >
                {zipRunning || computeZipMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                {zipRunning ? "Computing ZIP Tiles..." : "Recompute All ZIPs"}
              </Button>
              {zipTileStatus && zipTileStatus.total > 0 && (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Progress</span>
                    <span>{zipTileStatus.processed} / {zipTileStatus.total}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{ width: `${Math.round((zipTileStatus.processed / zipTileStatus.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {visibleIds.has("storm-phone") && (
          <Card className="shadow-sm" data-testid="card-ops-storm-phone">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CloudLightning className="w-4 h-4 text-red-600" />
                Storm & Phone Ops
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <div className={`w-2 h-2 rounded-full ${stormStatus?.running ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="text-[11px] text-muted-foreground">Storm Monitor</span>
                  </div>
                  <div className="text-sm font-medium" data-testid="text-storm-status">{stormStatus?.running ? "Active" : "Inactive"}</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <div className={`w-2 h-2 rounded-full ${hasActiveStorm ? "bg-red-500 animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="text-[11px] text-muted-foreground">Active Threats</span>
                  </div>
                  <div className="text-sm font-medium" data-testid="text-active-threats">{xweatherStatus?.activeThreats || 0}</div>
                </div>
              </div>

              <div className="border-t pt-3 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-blue-500" />
                    Phone Validation
                  </span>
                  <span className="text-muted-foreground">
                    {phoneValidationSummary?.validatedPct || 0}% validated ({phoneValidationSummary?.totalPhones || 0} total)
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded p-2">
                    <div className="font-bold text-emerald-600">{phoneValidationSummary?.mobileCount || 0}</div>
                    <div className="text-muted-foreground">Mobile</div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-2">
                    <div className="font-bold text-blue-600">{phoneValidationSummary?.validatedCount || 0}</div>
                    <div className="text-muted-foreground">Validated</div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 rounded p-2">
                    <div className="font-bold text-red-600">{phoneValidationSummary?.invalidCount || 0}</div>
                    <div className="text-muted-foreground">Invalid</div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => startBatchPhoneMutation.mutate()}
                  disabled={startBatchPhoneMutation.isPending}
                  data-testid="btn-batch-phones"
                >
                  {startBatchPhoneMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Phone className="w-4 h-4 mr-2" />
                  )}
                  Batch Validate Phones
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {visibleIds.has("analytics") && (
        <Card className="shadow-sm" data-testid="card-ops-analytics">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 cursor-pointer" onClick={() => toggleExpand("analytics")}>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              Analytics & KPIs
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {expandedCard === "analytics" ? "Collapse" : "Expand Full View"}
            </Badge>
          </CardHeader>
          {expandedCard === "analytics" && (
            <CardContent className="p-6 pt-0">
              <AnalyticsKPIsPanel />
            </CardContent>
          )}
          {expandedCard !== "analytics" && (
            <CardContent className="p-6 pt-0">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold" data-testid="text-analytics-contactable">{kpiCurrent ? `${Math.round((kpiCurrent.contactableRate ?? 0) * 100)}%` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Contactable Rate</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-emerald-600">{kpiCurrent ? `${Math.round((kpiCurrent.conversionRate ?? 0) * 10000) / 100}%` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Conversion Rate</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-amber-600">{kpiCurrent ? `$${(kpiCurrent.costPerLead ?? 0).toFixed(2)}` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Cost / Lead</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-purple-600">{kpiCurrent ? `${(kpiCurrent.roi ?? 0).toFixed(1)}x` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">ROI</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">Click header to expand full analytics with funnel, trends, and weight retraining</p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
