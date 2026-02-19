import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreBadge, ScoreDot } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import {
  Building2,
  TrendingUp,
  CloudLightning,
  Target,
  ArrowRight,
  MapPin,
  Ruler,
  Calendar,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { Lead } from "@shared/schema";

interface DashboardStats {
  totalLeads: number;
  hotLeads: number;
  avgScore: number;
  totalHailEvents: number;
  scoreDistribution: { range: string; count: number }[];
  countyDistribution: { county: string; count: number }[];
  recentLeads: Lead[];
}

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
  trend?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold mt-1 tracking-tight" data-testid={`stat-${title.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            {trend && (
              <div className="flex items-center gap-1 mt-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{trend}</span>
              </div>
            )}
          </div>
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <Skeleton className="h-3 w-20 mb-2" />
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-3 w-28" />
      </CardContent>
    </Card>
  );
}

const CHART_COLORS = [
  "hsl(205, 90%, 48%)",
  "hsl(160, 65%, 42%)",
  "hsl(35, 92%, 52%)",
  "hsl(280, 60%, 55%)",
  "hsl(345, 75%, 50%)",
];

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Overview of your lead intelligence pipeline</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Overview of your lead intelligence pipeline</p>
        </div>
        <Link href="/leads">
          <Button data-testid="button-view-all-leads">
            View All Leads
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Leads"
          value={stats.totalLeads.toLocaleString()}
          icon={Building2}
          subtitle="Properties tracked"
        />
        <StatCard
          title="Hot Leads"
          value={stats.hotLeads}
          icon={Target}
          subtitle="Score 80+"
          trend="Ready for outreach"
        />
        <StatCard
          title="Avg Score"
          value={Math.round(stats.avgScore)}
          icon={TrendingUp}
          subtitle="Lead quality index"
        />
        <StatCard
          title="Hail Events"
          value={stats.totalHailEvents}
          icon={CloudLightning}
          subtitle="In tracked regions"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Score Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.scoreDistribution} barSize={28}>
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 11, fill: "hsl(215, 10%, 45%)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(215, 10%, 45%)" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="count" fill="hsl(205, 90%, 48%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Leads by County</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie
                    data={stats.countyDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="count"
                    nameKey="county"
                    paddingAngle={3}
                    stroke="none"
                  >
                    {stats.countyDistribution.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {stats.countyDistribution.map((entry, i) => (
                  <div key={entry.county} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-foreground">{entry.county}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-xs">{entry.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium">Top Scoring Leads</CardTitle>
          <Link href="/leads">
            <Button variant="ghost" size="sm" data-testid="button-see-all-leads">
              See all
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {stats.recentLeads.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`}>
                <div
                  className="flex items-center gap-4 p-3 rounded-md hover-elevate cursor-pointer"
                  data-testid={`lead-row-${lead.id}`}
                >
                  <ScoreDot score={lead.leadScore} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{lead.address}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {lead.city}, {lead.county}
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
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge status={lead.status} />
                    <ScoreBadge score={lead.leadScore} />
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
