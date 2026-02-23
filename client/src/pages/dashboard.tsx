import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreBadge } from "@/components/score-badge";
import {
  Building2,
  TrendingUp,
  CloudLightning,
  Target,
  ArrowRight,
  Phone,
  Mail,
  Fingerprint,
  DollarSign,
  ShieldCheck,
  HardHat,
  Zap,
  ChevronRight,
  Users,
  BarChart3,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

function PipelineStep({ label, count, total, isLast }: { label: string; count: number; total: number; isLast?: boolean }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" data-testid={`pipeline-${label.toLowerCase()}`}>
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
  );
}

function SkeletonDashboard() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-3 w-20 mb-3" /><Skeleton className="h-10 w-24 mb-2" /><Skeleton className="h-3 w-16" /></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2"><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
        <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery<CommandCenter>({
    queryKey: ["/api/dashboard/command-center"],
  });

  if (isLoading || !data) return <SkeletonDashboard />;

  const totalPipeline = data.pipeline.new + data.pipeline.contacted + data.pipeline.qualified + data.pipeline.proposal + data.pipeline.closed;

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">Command Center</h2>
          <p className="text-sm text-muted-foreground mt-1">{data.totalLeads.toLocaleString()} properties under intelligence</p>
        </div>
        <Link href="/leads">
          <Button variant="outline" data-testid="button-view-all-leads">
            View All Leads
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Pipeline Value</p>
                <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-pipeline-value">{formatCurrency(data.totalPipelineValue)}</p>
                <p className="text-xs text-muted-foreground mt-1">{data.totalLeads.toLocaleString()} properties</p>
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
                <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-actionable">{data.actionableLeads}</p>
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
                <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-avg-score">{Math.round(data.avgScore)}</p>
                <p className="text-xs text-muted-foreground mt-1">{data.hotLeads} leads score 80+</p>
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
                <p className="text-3xl font-bold mt-2 tracking-tight" data-testid="stat-storm-pulse">{data.stormPulse.recentEvents30d}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.stormPulse.recentEvents7d > 0
                    ? `${data.stormPulse.recentEvents7d} this week`
                    : "Hail events (30d)"}
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <CloudLightning className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">Priority Actions</CardTitle>
            <Badge variant="secondary">{data.priorityActions.length} ready</Badge>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {data.priorityActions.length > 0 ? (
              <div className="divide-y divide-border">
                {data.priorityActions.map((lead) => (
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

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Intelligence Coverage</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <CoverageGauge label="Has Phone" value={data.coverage.hasPhone} icon={Phone} />
              <CoverageGauge label="Has Email" value={data.coverage.hasEmail} icon={Mail} />
              <CoverageGauge label="Decision Maker" value={data.coverage.hasDecisionMaker} icon={Fingerprint} />
              <CoverageGauge label="Ownership Classified" value={data.coverage.hasOwnershipClassified} icon={ShieldCheck} />
              <CoverageGauge label="Enriched" value={data.coverage.enriched} icon={Zap} />
              <CoverageGauge label="Permit Data" value={data.coverage.hasPermitData} icon={HardHat} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-3">
              <PipelineStep label="New" count={data.pipeline.new} total={totalPipeline} />
              <PipelineStep label="Contacted" count={data.pipeline.contacted} total={totalPipeline} />
              <PipelineStep label="Qualified" count={data.pipeline.qualified} total={totalPipeline} />
              <PipelineStep label="Proposal" count={data.pipeline.proposal} total={totalPipeline} />
              <PipelineStep label="Closed" count={data.pipeline.closed} total={totalPipeline} isLast />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-0">
            <CardTitle className="text-base font-semibold">Score Distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.scoreDistribution} barSize={32}>
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">Competitor Activity</CardTitle>
            <Badge variant="secondary">{data.competitors.length} contractors</Badge>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {data.competitors.length > 0 ? (
              <div className="space-y-2.5">
                {data.competitors.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-3" data-testid={`competitor-${i}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                        <HardHat className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <span className="text-sm truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="outline" className="text-[10px] tabular-nums">{c.permitCount} permits</Badge>
                    </div>
                  </div>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
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
            {data.topValueLeads.map((lead) => (
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
    </div>
  );
}
