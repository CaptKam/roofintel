import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert,
  FileText,
  Users,
  Building2,
  Phone,
  Mail,
  Fingerprint,
  ShieldCheck,
  Network,
  ChevronRight,
  Sparkles,
} from "lucide-react";

interface IntelBriefingData {
  claimWindows: number;
  permits: {
    total: number;
    dallas: number;
    fortWorth: number;
    other: number;
  };
  contactEvidence: {
    total: number;
    topSources: Array<{ name: string; count: number }>;
  };
  owners: {
    resolved: number;
    multiProperty: number;
  };
  coverage: {
    hasPhone: number;
    hasEmail: number;
    hasDecisionMaker: number;
    hasOwnership: number;
  };
  graph: {
    nodes: number;
    edges: number;
  };
}

function MetricRow({
  icon: Icon,
  label,
  value,
  sub,
  href,
  urgency,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  urgency?: boolean;
  testId: string;
}) {
  const content = (
    <div
      className={`flex items-center gap-3 py-2.5 px-3 rounded-md transition-colors ${href ? "cursor-pointer hover:bg-muted/30" : ""}`}
      data-testid={testId}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 ${urgency ? "text-red-500" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">{label}</span>
          {urgency && (
            <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">
              Act now
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-sm font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</span>
          {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
        </div>
      </div>
      {href && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export function IntelBriefing() {
  const { data, isLoading } = useQuery<IntelBriefingData>({
    queryKey: ["/api/ops/intel-briefing"],
  });

  if (isLoading) {
    return (
      <Card className="shadow-sm" data-testid="card-intel-briefing">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Daily Intelligence Briefing
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const permitSub = [
    data.permits.dallas > 0 ? `${data.permits.dallas.toLocaleString()} Dallas` : null,
    data.permits.fortWorth > 0 ? `${data.permits.fortWorth.toLocaleString()} Ft Worth` : null,
    data.permits.other > 0 ? `${data.permits.other.toLocaleString()} other` : null,
  ].filter(Boolean).join(" · ");

  const topSourcesSub = data.contactEvidence.topSources.slice(0, 3)
    .map(s => `${s.name} (${s.count.toLocaleString()})`)
    .join(" · ");

  return (
    <Card className="shadow-sm" data-testid="card-intel-briefing">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          Daily Intelligence Briefing
        </CardTitle>
        <Badge variant="outline" className="text-[10px]" data-testid="badge-intel-metrics-count">
          6 metrics
        </Badge>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
          <MetricRow
            icon={ShieldAlert}
            label="Open Claim Windows"
            value={data.claimWindows}
            urgency={data.claimWindows > 0}
            href="/leads?claimWindowOpen=true"
            testId="metric-claim-windows"
          />
          <MetricRow
            icon={FileText}
            label="Permits Tracked"
            value={data.permits.total}
            sub={permitSub}
            href="/data-management"
            testId="metric-permits"
          />
          <MetricRow
            icon={Users}
            label="Contact Evidence Records"
            value={data.contactEvidence.total}
            sub={topSourcesSub}
            href="/data-intelligence"
            testId="metric-evidence"
          />
          <MetricRow
            icon={Building2}
            label="Resolved Owners"
            value={data.owners.resolved}
            sub={`${data.owners.multiProperty} multi-property portfolios`}
            href="/owners"
            testId="metric-owners"
          />
          <MetricRow
            icon={Phone}
            label="Enrichment Coverage"
            value={`${data.coverage.hasPhone}% phone`}
            sub={`${data.coverage.hasEmail}% email · ${data.coverage.hasDecisionMaker}% DM · ${data.coverage.hasOwnership}% ownership`}
            testId="metric-coverage"
          />
          <MetricRow
            icon={Network}
            label="Graph Network"
            value={`${data.graph.nodes.toLocaleString()} nodes`}
            sub={`${data.graph.edges.toLocaleString()} edges`}
            href="/network"
            testId="metric-graph"
          />
        </div>
      </CardContent>
    </Card>
  );
}