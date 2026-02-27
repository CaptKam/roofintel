import { useState } from "react";
import { PageMeta } from "@/components/page-meta";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";
import { ROIEnginePanel } from "@/components/admin/roi-engine-panel";
import { AnalyticsKPIsPanel } from "@/components/admin/analytics-kpis-panel";

export default function OpsCenter() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

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
    queryKey: ["/api/enrichment/pipeline-stats"],
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

  const { data: kpiCurrent } = useQuery<{
    totalLeads: number;
    contactableLeads: number;
    contactableRate: number;
    conversionRate: number;
    costPerLead: number;
    roi: number;
  }>({
    queryKey: ["/api/admin/kpis/current"],
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
    { id: "budget", label: "Budget" },
    { id: "roi", label: "ROI Engine" },
    { id: "zip", label: "ZIP Tiles" },
    { id: "pipeline", label: "Pipeline" },
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
            Daily command center for ROI, pipeline, and storm operations
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
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search cards... (budget, roi, zip, pipeline, analytics, storm)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-ops-search"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {visibleIds.has("budget") && (
          <Card className="shadow-sm border-l-4 border-l-emerald-500" data-testid="card-ops-budget">
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
          <Card className="shadow-sm border-l-4 border-l-blue-500" data-testid="card-ops-pipeline">
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
        <Card className="shadow-sm border-l-4 border-l-purple-500" data-testid="card-ops-roi">
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
                  <div className="text-lg font-bold text-blue-600" data-testid="text-roi-kpi-contactable">{kpiCurrent ? `${Math.round((kpiCurrent.contactableRate || 0) * 100)}%` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Contactable</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-emerald-600">${spentToday.toFixed(2)}</div>
                  <div className="text-[11px] text-muted-foreground">Spent Today</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-purple-600">{kpiCurrent ? `${(kpiCurrent.roi || 0).toFixed(1)}x` : "—"}</div>
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
          <Card className="shadow-sm border-l-4 border-l-amber-500" data-testid="card-ops-zip">
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
          <Card className="shadow-sm border-l-4 border-l-red-500" data-testid="card-ops-storm-phone">
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
        <Card className="shadow-sm border-l-4 border-l-indigo-500" data-testid="card-ops-analytics">
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
                  <div className="text-lg font-bold" data-testid="text-analytics-contactable">{kpiCurrent ? `${Math.round((kpiCurrent.contactableRate || 0) * 100)}%` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Contactable Rate</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-emerald-600">{kpiCurrent ? `${Math.round((kpiCurrent.conversionRate || 0) * 10000) / 100}%` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Conversion Rate</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-amber-600">{kpiCurrent ? `$${(kpiCurrent.costPerLead || 0).toFixed(2)}` : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">Cost / Lead</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <div className="text-lg font-bold text-purple-600">{kpiCurrent ? `${(kpiCurrent.roi || 0).toFixed(1)}x` : "—"}</div>
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
