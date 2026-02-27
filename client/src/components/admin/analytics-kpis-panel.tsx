import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Loader2,
  Activity,
  Target,
  DollarSign,
  TrendingUp,
  BarChart3,
  Sparkles,
  Gauge,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";

const FUNNEL_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#22c55e"];
const KPI_CHART_COLORS = {
  contactableRate: "#3b82f6",
  conversionRate: "#22c55e",
  costPerLead: "#f59e0b",
  roi: "#8b5cf6",
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AnalyticsKPIsPanel({ marketId }: { marketId?: string }) {
  const { toast } = useToast();
  const DFW_MARKET_ID = marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";

  const { data: currentKpi, isLoading: kpiLoading } = useQuery<any>({
    queryKey: [`/api/admin/kpis/current?marketId=${DFW_MARKET_ID}`],
  });

  const { data: timeSeries, isLoading: timeSeriesLoading } = useQuery<any[]>({
    queryKey: [`/api/admin/kpis/timeseries?marketId=${DFW_MARKET_ID}&days=90`],
  });

  const { data: funnel, isLoading: funnelLoading } = useQuery<any>({
    queryKey: [`/api/admin/kpis/funnel?marketId=${DFW_MARKET_ID}`],
  });

  const { data: traceCosts, isLoading: traceCostsLoading } = useQuery<any[]>({
    queryKey: [`/api/admin/trace-costs?marketId=${DFW_MARKET_ID}&days=90`],
  });

  const snapshotMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/kpis/snapshot", { marketId: DFW_MARKET_ID });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "KPI snapshot computed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kpis/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kpis/timeseries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kpis/funnel"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to compute snapshot", description: err.message, variant: "destructive" });
    },
  });

  const retrainMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/kpis/retrain-weights", { marketId: DFW_MARKET_ID });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Weight analysis complete" });
      setRetrainResult(data);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to retrain", description: err.message, variant: "destructive" });
    },
  });

  const [retrainResult, setRetrainResult] = useState<any>(null);

  const funnelData = funnel?.stages?.map((s: any, i: number) => ({
    name: s.stage.charAt(0).toUpperCase() + s.stage.slice(1),
    value: s.count,
    fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
    conversionFromPrev: s.conversionFromPrev,
    pctOfTotal: s.pctOfTotal,
  })) || [];

  const trendData = (timeSeries || []).map((s: any) => ({
    date: new Date(s.snapshotDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    contactableRate: Math.round((s.contactableRate || 0) * 100),
    conversionRate: Math.round((s.conversionRate || 0) * 10000) / 100,
    costPerLead: Math.round((s.costPerLead || 0) * 100) / 100,
    roi: Math.round((s.roi || 0) * 100) / 100,
  })).reverse();

  const costData = (traceCosts || []).map((t: any) => ({
    provider: t.provider,
    totalSpend: t.totalSpend,
    traceCount: t.traceCount,
    matchCount: t.matchCount,
    matchRate: Math.round((t.matchRate || 0) * 100),
    avgCostPerMatch: t.avgCostPerMatch,
  }));

  return (
    <div className="space-y-6">
      <Card className="shadow-sm" data-testid="card-snapshot-controls">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4" />
            Snapshot Controls
          </CardTitle>
          {currentKpi && (
            <Badge variant="outline" className="text-xs" data-testid="badge-last-snapshot">
              <Clock className="w-3 h-3 mr-1" />
              Last: {formatDate(currentKpi.createdAt)}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={() => snapshotMutation.mutate()}
              disabled={snapshotMutation.isPending}
              data-testid="button-compute-snapshot"
            >
              {snapshotMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Activity className="w-4 h-4 mr-2" />
              )}
              Compute Snapshot Now
            </Button>
            {currentKpi && (
              <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                <span data-testid="text-kpi-total-leads">Leads: <span className="font-medium text-foreground">{currentKpi.totalLeads?.toLocaleString()}</span></span>
                <span data-testid="text-kpi-contactable">Contactable: <span className="font-medium text-foreground">{Math.round((currentKpi.contactableRate || 0) * 100)}%</span></span>
                <span data-testid="text-kpi-conversion">Conversion: <span className="font-medium text-foreground">{Math.round((currentKpi.conversionRate || 0) * 10000) / 100}%</span></span>
                <span data-testid="text-kpi-roi">ROI: <span className="font-medium text-foreground">{(currentKpi.roi || 0).toFixed(2)}x</span></span>
              </div>
            )}
          </div>
          {!currentKpi && !kpiLoading && (
            <p className="text-sm text-muted-foreground">No snapshots yet. Click "Compute Snapshot Now" to generate your first KPI snapshot.</p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm" data-testid="card-conversion-funnel">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Conversion Funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          {funnelLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : funnelData.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-end gap-2" style={{ height: 200 }}>
                {funnelData.map((stage: any, i: number) => {
                  const maxVal = Math.max(...funnelData.map((d: any) => d.value), 1);
                  const barHeight = Math.max(10, (stage.value / maxVal) * 180);
                  return (
                    <div key={stage.name} className="flex-1 flex flex-col items-center gap-1" data-testid={`funnel-stage-${stage.name.toLowerCase()}`}>
                      <span className="text-xs font-medium">{stage.value.toLocaleString()}</span>
                      <div
                        className="w-full rounded-md transition-all"
                        style={{ height: barHeight, backgroundColor: stage.fill }}
                      />
                      <span className="text-[11px] text-muted-foreground text-center">{stage.name}</span>
                      {i > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(stage.conversionFromPrev * 100)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {funnel && (
                <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                  <span>Total: <span className="font-medium text-foreground">{funnel.totalLeads?.toLocaleString()}</span></span>
                  <span>Won: <span className="font-medium text-emerald-600">{funnel.closedWon}</span></span>
                  <span>Lost: <span className="font-medium text-red-500">{funnel.closedLost}</span></span>
                  <span>Win Rate: <span className="font-medium text-foreground">{Math.round((funnel.winRate || 0) * 100)}%</span></span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No funnel data available. Record outcomes to populate the funnel.</p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm" data-testid="card-kpi-trends">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            KPI Trends
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          {timeSeriesLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : trendData.length > 1 ? (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Contactable Rate & Conversion Rate (%)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="contactableRate" stroke={KPI_CHART_COLORS.contactableRate} name="Contactable %" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="conversionRate" stroke={KPI_CHART_COLORS.conversionRate} name="Conversion %" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Cost per Lead ($) & ROI (x)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="costPerLead" stroke={KPI_CHART_COLORS.costPerLead} name="Cost/Lead $" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="roi" stroke={KPI_CHART_COLORS.roi} name="ROI x" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              {trendData.length === 1 ? "Only 1 snapshot. Compute more snapshots over time to see trends." : "No trend data yet. Compute snapshots to generate trend charts."}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm" data-testid="card-cost-breakdown">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Cost Breakdown by Provider
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {traceCostsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : costData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={costData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="provider" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(val: number) => `$${val.toFixed(2)}`} />
                  <Bar dataKey="totalSpend" name="Total Spend" radius={[4, 4, 0, 0]}>
                    {costData.map((_: any, i: number) => (
                      <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No trace cost data available.</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="card-match-rate-table">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Target className="w-4 h-4" />
              Match Rate by Provider
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {traceCostsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : costData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Provider</th>
                      <th className="text-right py-2 px-2">Traces</th>
                      <th className="text-right py-2 px-2">Matches</th>
                      <th className="text-right py-2 px-2">Match %</th>
                      <th className="text-right py-2 px-2">Avg $/Match</th>
                      <th className="text-right py-2 px-2">Total $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costData.map((row: any) => (
                      <tr key={row.provider} className="border-b border-muted/50" data-testid={`provider-row-${row.provider}`}>
                        <td className="py-2 px-2 font-medium">{row.provider}</td>
                        <td className="py-2 px-2 text-right">{row.traceCount.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right">{row.matchCount.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant={row.matchRate >= 50 ? "default" : row.matchRate >= 20 ? "secondary" : "outline"} className="text-[10px]">
                            {row.matchRate}%
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-right">${row.avgCostPerMatch.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right font-medium">${row.totalSpend.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No provider data available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm" data-testid="card-weight-retraining">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Weight Retraining
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          <p className="text-xs text-muted-foreground">
            Analyze closed-won vs closed-lost outcomes to identify which lead attributes correlate with wins. Results are recommendations for admin review, not auto-applied.
          </p>
          <Button
            onClick={() => retrainMutation.mutate()}
            disabled={retrainMutation.isPending}
            data-testid="button-retrain-weights"
          >
            {retrainMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            Run Weight Analysis
          </Button>

          {retrainResult && (
            <div className="space-y-3 pt-3 border-t" data-testid="retrain-results">
              <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                <span>Won samples: <span className="font-medium text-foreground">{retrainResult.sampleSize?.won}</span></span>
                <span>Lost samples: <span className="font-medium text-foreground">{retrainResult.sampleSize?.lost}</span></span>
                <span>Generated: <span className="font-medium text-foreground">{formatDate(retrainResult.generatedAt)}</span></span>
              </div>
              {retrainResult.note && (
                <div className="text-xs p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300" data-testid="text-retrain-note">
                  {retrainResult.note}
                </div>
              )}
              {retrainResult.recommendations && Object.keys(retrainResult.recommendations).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(retrainResult.recommendations).map(([attr, rec]: [string, any]) => (
                    <div key={attr} className="border rounded-md p-3 space-y-1" data-testid={`retrain-attr-${attr}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium">{attr.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</span>
                        {rec.suggestion && rec.suggestion !== "review_manually" && (
                          <Badge
                            variant={rec.suggestion === "increase_weight" ? "default" : rec.suggestion === "decrease_weight" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {rec.suggestion === "increase_weight" ? "Increase" : rec.suggestion === "decrease_weight" ? "Decrease" : "No Change"}
                          </Badge>
                        )}
                        {rec.suggestion === "review_manually" && (
                          <Badge variant="outline" className="text-[10px]">Manual Review</Badge>
                        )}
                      </div>
                      {rec.wonAvg !== undefined && (
                        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                          <span>Won avg: <span className="font-medium text-foreground">{rec.wonAvg}</span></span>
                          <span>Lost avg: <span className="font-medium text-foreground">{rec.lostAvg}</span></span>
                          <span>Impact: <span className="font-medium text-foreground">{rec.impact}</span></span>
                          {rec.recommendedMultiplier && (
                            <span>Multiplier: <span className="font-medium text-foreground">{rec.recommendedMultiplier}x</span></span>
                          )}
                        </div>
                      )}
                      {rec.wonBreakdown && (
                        <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                          <div>
                            <span className="text-muted-foreground">Won breakdown:</span>
                            {Object.entries(rec.wonBreakdown).map(([k, v]: [string, any]) => (
                              <span key={k} className="ml-2">{k}: {v}</span>
                            ))}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Lost breakdown:</span>
                            {Object.entries(rec.lostBreakdown || {}).map(([k, v]: [string, any]) => (
                              <span key={k} className="ml-2">{k}: {v}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
