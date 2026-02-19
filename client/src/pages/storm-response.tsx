import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Radio, Phone, MapPin, Clock, Zap, Play, Square, RefreshCw, CheckCircle } from "lucide-react";
import type { StormRun, ResponseQueueItem, Lead } from "@shared/schema";

type EnrichedQueueItem = ResponseQueueItem & { lead?: Lead; stormRun?: StormRun };

export default function StormResponse() {
  const { toast } = useToast();

  const { data: monitorStatus } = useQuery<{ running: boolean; lastHash: string }>({
    queryKey: ["/api/storm/status"],
    refetchInterval: 15000,
  });

  const { data: activeRuns, isLoading: runsLoading } = useQuery<StormRun[]>({
    queryKey: ["/api/storm/runs/active"],
    refetchInterval: 30000,
  });

  const { data: recentRuns } = useQuery<StormRun[]>({
    queryKey: ["/api/storm/runs"],
  });

  const { data: responseQueue, isLoading: queueLoading } = useQuery<EnrichedQueueItem[]>({
    queryKey: ["/api/storm/response-queue"],
    refetchInterval: 30000,
  });

  const startMonitor = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "Storm monitor started" });
    },
  });

  const stopMonitor = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "Storm monitor stopped" });
    },
  });

  const scanNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/storm/scan");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/storm/runs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/storm/response-queue"] });
      toast({
        title: "Storm scan complete",
        description: `Found ${data.newStormRuns} storms, ${data.totalAffectedLeads} affected leads`,
      });
    },
    onError: () => {
      toast({ title: "Scan failed", variant: "destructive" });
    },
  });

  const markCalled = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/storm/response-queue/${id}`, { status: "called" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/response-queue"] });
    },
  });

  const markSkipped = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/storm/response-queue/${id}`, { status: "skipped" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/response-queue"] });
    },
  });

  const pendingQueue = responseQueue?.filter(q => q.status === "pending") || [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Storm Response</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time storm monitoring and prioritized response queue</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={monitorStatus?.running ? "default" : "secondary"}
            data-testid="badge-monitor-status"
          >
            <Radio className="w-3 h-3 mr-1" />
            {monitorStatus?.running ? "Monitor Active" : "Monitor Off"}
          </Badge>
          {monitorStatus?.running ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => stopMonitor.mutate()}
              disabled={stopMonitor.isPending}
              data-testid="button-stop-monitor"
            >
              <Square className="w-3 h-3 mr-1" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => startMonitor.mutate()}
              disabled={startMonitor.isPending}
              data-testid="button-start-monitor"
            >
              <Play className="w-3 h-3 mr-1" />
              Start Monitor
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => scanNow.mutate()}
            disabled={scanNow.isPending}
            data-testid="button-scan-now"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${scanNow.isPending ? "animate-spin" : ""}`} />
            Scan Now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Storms</CardTitle>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-storms">{activeRuns?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Affected Leads</CardTitle>
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-affected-leads">
              {activeRuns?.reduce((s, r) => s + r.affectedLeadCount, 0) || 0}
            </div>
            <p className="text-xs text-muted-foreground">In storm zones</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Calls</CardTitle>
            <Phone className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pending-calls">{pendingQueue.length}</div>
            <p className="text-xs text-muted-foreground">Ready to contact</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Detections</CardTitle>
            <Radio className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-detections">{recentRuns?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Storm runs logged</p>
          </CardContent>
        </Card>
      </div>

      {activeRuns && activeRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Active Storms
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeRuns.map((run) => {
                const swath = run.swathPolygon as any;
                return (
                  <div key={run.id} className="flex items-center justify-between gap-4 p-3 border rounded-md flex-wrap" data-testid={`card-storm-run-${run.id}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge variant={run.maxHailProb >= 80 ? "destructive" : "default"}>
                        {run.maxHailProb}% prob
                      </Badge>
                      <span className="text-sm font-medium">{run.radarSignatureCount} radar signatures</span>
                      <span className="text-sm text-muted-foreground">{run.affectedLeadCount} leads affected</span>
                      {swath?.centroid && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {swath.centroid.lat?.toFixed(3)}, {swath.centroid.lon?.toFixed(3)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {run.detectedAt ? new Date(run.detectedAt).toLocaleTimeString() : ""}
                      </span>
                      <Badge variant="outline">{run.status}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Priority Call Queue
            {pendingQueue.length > 0 && (
              <Badge variant="secondary">{pendingQueue.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queueLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading response queue...</div>
          ) : pendingQueue.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No pending calls. Run a storm scan to detect hail near your leads.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingQueue.map((item, idx) => (
                <div key={item.id} className="flex items-center justify-between gap-3 p-3 border rounded-md flex-wrap" data-testid={`card-queue-item-${item.id}`}>
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <span className="text-sm font-mono text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                    <Badge variant={item.priority >= 150 ? "destructive" : item.priority >= 100 ? "default" : "secondary"}>
                      P{item.priority}
                    </Badge>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.lead?.address || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.lead?.ownerName} | {item.lead?.city?.trim()}, {item.lead?.county}
                        {item.distanceMiles != null && ` | ${item.distanceMiles}mi from storm`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(item.lead?.ownerPhone || item.lead?.contactPhone) && (
                      <a href={`tel:${item.lead?.contactPhone || item.lead?.ownerPhone}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {item.lead?.contactPhone || item.lead?.ownerPhone}
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markCalled.mutate(item.id)}
                      disabled={markCalled.isPending}
                      data-testid={`button-mark-called-${item.id}`}
                    >
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Called
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markSkipped.mutate(item.id)}
                      disabled={markSkipped.isPending}
                      data-testid={`button-mark-skipped-${item.id}`}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {recentRuns && recentRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Storm Detection History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentRuns.slice(0, 20).map((run) => (
                <div key={run.id} className="flex items-center justify-between gap-4 p-2 border rounded-md text-sm flex-wrap" data-testid={`card-history-run-${run.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">{run.status}</Badge>
                    <span>{run.radarSignatureCount} sigs</span>
                    <span className="text-muted-foreground">{run.affectedLeadCount} leads</span>
                    <span className="text-muted-foreground">{run.maxHailProb}% prob</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {run.detectedAt ? new Date(run.detectedAt).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
