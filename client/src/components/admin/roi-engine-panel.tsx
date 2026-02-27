import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Play,
  DollarSign,
  TrendingUp,
  BarChart3,
  Gauge,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface RoiDecisionRow {
  id: string;
  leadId: string;
  marketId: string;
  decisionType: string;
  roiScore: number | null;
  expectedValue: number | null;
  enrichmentCost: number | null;
  recommendedApis: string[] | null;
  confidence: number | null;
  reasonSummary: string | null;
  createdAt: string | null;
  address: string | null;
  leadScore: number | null;
}

interface RoiTierStat {
  tier: string;
  count: number;
  totalEv: number;
  totalCost: number;
  avgRoi: number;
}

interface RoiStatsResponse {
  stats: RoiTierStat[];
  budget: {
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    spentTodayUsd: number;
    spentThisMonthUsd: number;
    dailyRemaining: number;
  };
}

interface BudgetConfig {
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  hailSeasonMultiplier: number;
  minRoiThreshold: number;
  avgDealSize: number;
  baseCloseRate: number;
  spentTodayUsd: number;
  spentThisMonthUsd: number;
}

const TIER_COLORS: Record<string, string> = {
  skip: "#94a3b8",
  tier1: "#60a5fa",
  tier2: "#34d399",
  tier3: "#fbbf24",
  premium: "#a78bfa",
  free_only: "#f87171",
};

export function ROIEnginePanel() {
  const { toast } = useToast();
  const [batchMarketId, setBatchMarketId] = useState("");
  const [batchZip, setBatchZip] = useState("");

  const { data: budgetConfig, isLoading: budgetLoading } = useQuery<BudgetConfig>({
    queryKey: ["/api/admin/budgets"],
  });

  const [budgetForm, setBudgetForm] = useState<Partial<BudgetConfig>>({});

  const effectiveBudget = { ...budgetConfig, ...budgetForm };

  const budgetMutation = useMutation({
    mutationFn: async (updates: Partial<BudgetConfig>) => {
      const res = await apiRequest("PATCH", "/api/admin/budgets", updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Budget config updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/budgets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roi/stats"] });
      setBudgetForm({});
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update budget", description: err.message, variant: "destructive" });
    },
  });

  const { data: batchStatus } = useQuery<{ processed: number; total: number; running: boolean }>({
    queryKey: ["/api/admin/roi/status"],
    refetchInterval: (query) => {
      const d = query.state.data as { running: boolean } | undefined;
      return d?.running ? 2000 : false;
    },
  });

  const startBatchMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (batchMarketId) body.marketId = batchMarketId;
      if (batchZip) body.zipCode = batchZip;
      const res = await apiRequest("POST", "/api/admin/roi/run-batch", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "ROI batch started" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roi/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start ROI batch", description: err.message, variant: "destructive" });
    },
  });

  const { data: roiStats, isLoading: statsLoading } = useQuery<RoiStatsResponse>({
    queryKey: ["/api/admin/roi/stats"],
  });

  const { data: topDecisions, isLoading: decisionsLoading } = useQuery<RoiDecisionRow[]>({
    queryKey: ["/api/admin/roi/decisions", "limit=20"],
    queryFn: async () => {
      const res = await fetch("/api/admin/roi/decisions?limit=20");
      if (!res.ok) throw new Error("Failed to fetch decisions");
      return res.json();
    },
  });

  const batchRunning = batchStatus?.running || false;
  const tierData = (roiStats?.stats || []).map(s => ({
    name: s.tier,
    count: s.count,
    fill: TIER_COLORS[s.tier] || "#94a3b8",
  }));

  const totalScored = (roiStats?.stats || []).reduce((s, t) => s + t.count, 0);
  const projectedSpend = (roiStats?.stats || []).reduce((s, t) => s + Number(t.totalCost || 0), 0);
  const projectedEV = (roiStats?.stats || []).reduce((s, t) => s + Number(t.totalEv || 0), 0);
  const avgRoi = projectedSpend > 0 ? projectedEV / projectedSpend : 0;

  const dailyBudget = roiStats?.budget?.dailyBudgetUsd || budgetConfig?.dailyBudgetUsd || 500;
  const spentToday = roiStats?.budget?.spentTodayUsd || budgetConfig?.spentTodayUsd || 0;
  const dailyPct = dailyBudget > 0 ? Math.min(100, Math.round((spentToday / dailyBudget) * 100)) : 0;
  const budgetColor = dailyPct >= 90 ? "bg-red-500" : dailyPct >= 60 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm" data-testid="roi-summary-total-scored">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{totalScored.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Scored</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm" data-testid="roi-summary-projected-spend">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">${projectedSpend.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Projected Spend</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm" data-testid="roi-summary-projected-ev">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600">${projectedEV.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Projected EV</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm" data-testid="roi-summary-avg-roi">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{avgRoi.toFixed(1)}x</div>
            <div className="text-xs text-muted-foreground">Avg ROI</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm" data-testid="card-budget-config">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Budget Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            {budgetLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Daily Budget ($)</Label>
                    <Input
                      type="number"
                      value={effectiveBudget.dailyBudgetUsd ?? 500}
                      onChange={e => setBudgetForm(p => ({ ...p, dailyBudgetUsd: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-daily-budget"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monthly Budget ($)</Label>
                    <Input
                      type="number"
                      value={effectiveBudget.monthlyBudgetUsd ?? 12000}
                      onChange={e => setBudgetForm(p => ({ ...p, monthlyBudgetUsd: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-monthly-budget"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ROI Threshold</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={effectiveBudget.minRoiThreshold ?? 8.0}
                      onChange={e => setBudgetForm(p => ({ ...p, minRoiThreshold: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-roi-threshold"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Avg Deal Size ($)</Label>
                    <Input
                      type="number"
                      value={effectiveBudget.avgDealSize ?? 28500}
                      onChange={e => setBudgetForm(p => ({ ...p, avgDealSize: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-avg-deal-size"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Hail Season Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={effectiveBudget.hailSeasonMultiplier ?? 1.8}
                      onChange={e => setBudgetForm(p => ({ ...p, hailSeasonMultiplier: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-hail-multiplier"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Base Close Rate</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={effectiveBudget.baseCloseRate ?? 0.09}
                      onChange={e => setBudgetForm(p => ({ ...p, baseCloseRate: parseFloat(e.target.value) || 0 }))}
                      data-testid="input-close-rate"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => budgetMutation.mutate(budgetForm)}
                  disabled={budgetMutation.isPending || Object.keys(budgetForm).length === 0}
                  data-testid="btn-save-budget"
                >
                  {budgetMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DollarSign className="w-4 h-4 mr-2" />}
                  Save Budget Config
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="card-run-roi-batch">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Run ROI Batch
            </CardTitle>
            {batchRunning && <Badge variant="secondary" className="animate-pulse">Running</Badge>}
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            <p className="text-xs text-muted-foreground">Score all qualifying leads for enrichment ROI. Leads with score 40+ are evaluated against budget thresholds.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Market ID (optional)</Label>
                <Input
                  placeholder="Leave blank for default"
                  value={batchMarketId}
                  onChange={e => setBatchMarketId(e.target.value)}
                  disabled={batchRunning}
                  data-testid="input-batch-market"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">ZIP Code (optional)</Label>
                <Input
                  placeholder="e.g. 75201"
                  value={batchZip}
                  onChange={e => setBatchZip(e.target.value)}
                  disabled={batchRunning}
                  data-testid="input-batch-zip"
                />
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => startBatchMutation.mutate()}
              disabled={batchRunning || startBatchMutation.isPending}
              data-testid="btn-start-roi-batch"
            >
              {batchRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {batchRunning ? "Running ROI Batch..." : "Start ROI Batch"}
            </Button>
            {batchStatus && batchStatus.total > 0 && (
              <div className="space-y-2 pt-2 border-t text-xs">
                <div className="flex justify-between">
                  <span>Progress</span>
                  <span>{batchStatus.processed} / {batchStatus.total}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${batchStatus.total > 0 ? Math.round((batchStatus.processed / batchStatus.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm" data-testid="card-budget-meter">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4" />
            Daily Budget Meter
          </CardTitle>
          <span className="text-xs text-muted-foreground">${spentToday.toFixed(2)} / ${dailyBudget.toFixed(2)}</span>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <div className="h-4 bg-muted rounded-full overflow-hidden" data-testid="budget-meter-bar">
            <div
              className={`h-full rounded-full transition-all ${budgetColor}`}
              style={{ width: `${dailyPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{dailyPct}% used</span>
            <span>${(dailyBudget - spentToday).toFixed(2)} remaining</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm" data-testid="card-tier-distribution">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Tier Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {statsLoading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : tierData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tierData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {tierData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No tier data yet. Run an ROI batch to generate distribution.</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="card-tier-stats">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Tier Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {statsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (roiStats?.stats || []).length > 0 ? (
              <div className="space-y-2">
                {(roiStats?.stats || []).map(s => (
                  <div key={s.tier} className="flex items-center justify-between text-sm py-1.5 border-b border-muted/50">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: TIER_COLORS[s.tier] || "#94a3b8" }} />
                      <span className="font-medium">{s.tier}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{s.count} leads</span>
                      <span>${Number(s.totalCost || 0).toFixed(2)} cost</span>
                      <span>${Number(s.totalEv || 0).toLocaleString()} EV</span>
                      <span>{Number(s.avgRoi || 0).toFixed(1)}x ROI</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No stats available</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm" data-testid="card-top-roi-leads">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Top ROI Leads
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          {decisionsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : topDecisions && topDecisions.length > 0 ? (
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-2 px-1">Address</th>
                    <th className="text-right py-2 px-1">Lead Score</th>
                    <th className="text-right py-2 px-1">ROI Score</th>
                    <th className="text-left py-2 px-1">Tier</th>
                    <th className="text-right py-2 px-1">EV</th>
                    <th className="text-right py-2 px-1">Cost</th>
                    <th className="text-left py-2 px-1">APIs</th>
                    <th className="text-left py-2 px-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {topDecisions.map((d, i) => (
                    <tr key={d.id || i} className="border-b border-muted/50 hover:bg-muted/30" data-testid={`roi-decision-row-${i}`}>
                      <td className="py-1.5 px-1 truncate max-w-[180px]">{d.address || d.leadId}</td>
                      <td className="py-1.5 px-1 text-right">{d.leadScore ?? "-"}</td>
                      <td className="py-1.5 px-1 text-right font-medium">{d.roiScore != null ? Number(d.roiScore).toFixed(1) : "-"}x</td>
                      <td className="py-1.5 px-1">
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{ borderColor: TIER_COLORS[d.decisionType] || "#94a3b8", color: TIER_COLORS[d.decisionType] || "#94a3b8" }}
                        >
                          {d.decisionType}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-1 text-right text-emerald-600">${d.expectedValue != null ? Number(d.expectedValue).toLocaleString() : "-"}</td>
                      <td className="py-1.5 px-1 text-right">${d.enrichmentCost != null ? Number(d.enrichmentCost).toFixed(2) : "-"}</td>
                      <td className="py-1.5 px-1 truncate max-w-[120px]">{(d.recommendedApis || []).join(", ") || "-"}</td>
                      <td className="py-1.5 px-1 truncate max-w-[150px] text-muted-foreground">{d.reasonSummary || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No ROI decisions yet. Run an ROI batch to see top leads.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
