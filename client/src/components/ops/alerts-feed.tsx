import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Zap,
  PhoneOff,
  Building2,
  FileText,
  Database,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Bell,
  ExternalLink,
} from "lucide-react";

interface OpsAlert {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  count: number;
  leadIds: string[];
  actionUrl: string;
  icon: string;
}

const iconMap: Record<string, React.ElementType> = {
  AlertTriangle,
  Zap,
  PhoneOff,
  Building2,
  FileText,
  Database,
  Clock,
};

function getAlertIcon(iconName: string) {
  return iconMap[iconName] || Bell;
}

const severityConfig = {
  critical: {
    border: "border-l-red-500",
    bg: "bg-red-50 dark:bg-red-950/20",
    badgeBg: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    iconColor: "text-red-600 dark:text-red-400",
    pulse: true,
  },
  warning: {
    border: "border-l-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/20",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    iconColor: "text-amber-600 dark:text-amber-400",
    pulse: false,
  },
  info: {
    border: "border-l-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/20",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    iconColor: "text-blue-600 dark:text-blue-400",
    pulse: false,
  },
};

export function AlertsFeed({ marketId }: { marketId?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const mq = marketId ? `?marketId=${marketId}` : "";

  const { data: alerts, isLoading } = useQuery<OpsAlert[]>({
    queryKey: ["/api/ops/alerts", marketId],
    queryFn: () => fetch(`/api/ops/alerts${mq}`).then(r => r.json()),
  });

  if (isLoading) {
    return (
      <Card className="shadow-sm" data-testid="card-alerts-feed">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Bell className="w-4 h-4 text-red-600" />
            Action Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!alerts || alerts.length === 0) return null;

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.filter((a) => a.severity === "info").length;

  return (
    <Card className="shadow-sm" data-testid="card-alerts-feed">
      <CardHeader
        className="flex flex-row items-center justify-between gap-2 pb-2 cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
        data-testid="button-toggle-alerts"
      >
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Bell className="w-4 h-4 text-red-600" />
          Action Alerts
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {criticalCount > 0 && (
            <Badge variant="destructive" data-testid="badge-critical-count">
              {criticalCount} critical
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 no-default-hover-elevate no-default-active-elevate" data-testid="badge-warning-count">
              {warningCount} warning{warningCount !== 1 ? "s" : ""}
            </Badge>
          )}
          {infoCount > 0 && (
            <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 no-default-hover-elevate no-default-active-elevate" data-testid="badge-info-count">
              {infoCount} info
            </Badge>
          )}
          {collapsed ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="p-6 pt-0 space-y-2" data-testid="alerts-list">
          {alerts.map((alert) => {
            const config = severityConfig[alert.severity];
            const Icon = getAlertIcon(alert.icon);
            const isExpanded = expandedAlert === alert.id;

            return (
              <div
                key={alert.id}
                className={`border-l-4 ${config.border} rounded-md ${config.bg} ${config.pulse ? "animate-pulse-subtle" : ""}`}
                data-testid={`alert-item-${alert.id}`}
              >
                <div
                  className="flex items-start gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                  data-testid={`button-expand-alert-${alert.id}`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{alert.title}</span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] no-default-hover-elevate no-default-active-elevate ${config.badgeBg}`}
                        data-testid={`badge-alert-count-${alert.id}`}
                      >
                        {alert.count.toLocaleString()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {alert.description}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 space-y-2" data-testid={`alert-details-${alert.id}`}>
                    <p className="text-xs text-muted-foreground">{alert.description}</p>

                    {alert.leadIds.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Top Affected Leads
                        </p>
                        <div className="space-y-1">
                          {alert.leadIds.slice(0, 5).map((leadId) => (
                            <Link key={leadId} href={`/leads/${leadId}`}>
                              <div
                                className="flex items-center gap-2 text-xs py-1 px-2 rounded hover-elevate cursor-pointer"
                                data-testid={`link-alert-lead-${leadId}`}
                              >
                                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                <span className="font-mono text-muted-foreground truncate">
                                  {leadId.slice(0, 8)}...
                                </span>
                                <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto flex-shrink-0" />
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    <Link href={alert.actionUrl}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-1"
                        data-testid={`button-view-leads-${alert.id}`}
                      >
                        View Leads
                        <ExternalLink className="w-3 h-3 ml-1.5" />
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
