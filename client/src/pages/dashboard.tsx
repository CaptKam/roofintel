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
  Fingerprint,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { Lead } from "@shared/schema";

interface DashboardStats {
  totalLeads: number;
  hotLeads: number;
  avgScore: number;
  totalHailEvents: number;
  ownersUnmasked: number;
  scoreDistribution: { range: string; count: number }[];
  countyDistribution: { county: string; count: number }[];
  recentLeads: Lead[];
}

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-3xl font-bold mt-2 tracking-tight" data-testid={`stat-${title.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>}
          </div>
          <div className="w-10 h-10 rounded-full bg-primary/8 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4.5 h-4.5 text-primary/70" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <Skeleton className="h-3 w-20 mb-3" />
        <Skeleton className="h-9 w-16 mb-2" />
        <Skeleton className="h-3 w-28" />
      </CardContent>
    </Card>
  );
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Overview of your lead intelligence pipeline</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card><CardContent className="p-6"><Skeleton className="h-56 w-full" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-56 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Overview of your lead intelligence pipeline</p>
        </div>
        <Link href="/leads">
          <Button variant="ghost" className="text-primary transition-colors" data-testid="button-view-all-leads">
            View All Leads
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
        <StatCard
          title="Owners Unmasked"
          value={stats.ownersUnmasked}
          icon={Fingerprint}
          subtitle="Intelligence score 70+"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
            <CardTitle className="text-base font-semibold">Score Distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.scoreDistribution} barSize={32}>
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
            <CardTitle className="text-base font-semibold">Leads by County</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-4">
            <div className="flex items-center gap-8">
              <ResponsiveContainer width="45%" height={240}>
                <PieChart>
                  <Pie
                    data={stats.countyDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="count"
                    nameKey="county"
                    paddingAngle={2}
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
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3">
                {stats.countyDistribution.map((entry, i) => (
                  <div key={entry.county} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-sm text-foreground">{entry.county}</span>
                    </div>
                    <span className="text-sm text-muted-foreground font-mono">{entry.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Top Scoring Leads</CardTitle>
          <Link href="/leads">
            <Button variant="ghost" className="text-primary transition-colors" data-testid="button-see-all-leads">
              See all
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {stats.recentLeads.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`}>
                <div
                  className="flex items-center gap-4 py-3.5 px-2 rounded-md transition-colors cursor-pointer hover:bg-muted/50"
                  data-testid={`lead-row-${lead.id}`}
                >
                  <ScoreDot score={lead.leadScore} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{lead.address}</p>
                      {lead.managingMember && lead.intelligenceScore >= 70 && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Fingerprint className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-medium text-primary">{lead.managingMember}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
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
                    {lead.intelligenceScore >= 70 && (
                      <Badge variant="secondary" className="text-xs">
                        <Fingerprint className="w-3 h-3 mr-1" />
                        {lead.intelligenceScore}
                      </Badge>
                    )}
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
