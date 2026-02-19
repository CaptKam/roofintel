import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Radio, Phone, MapPin, Clock, Zap, Play, Square, RefreshCw, CheckCircle, CloudLightning, ArrowRight, Radar } from "lucide-react";
import type { StormRun, ResponseQueueItem, Lead } from "@shared/schema";

type EnrichedQueueItem = ResponseQueueItem & { lead?: Lead; stormRun?: StormRun };

interface HailThreat {
  id: string;
  centroidLat: number;
  centroidLon: number;
  maxSizeIN: number;
  maxSizeMM: number;
  probSevere: number;
  severe: boolean;
  stormMotionDeg: number | null;
  stormMotionMPH: number | null;
  forecastPath: [number, number][];
  threatPolygons: Array<{
    timestamp: number;
    dateTimeISO: string;
    polygon: [number, number][];
  }>;
  affectedLeads: Array<{
    leadId: string;
    address: string;
    city: string;
    leadScore: number;
    distanceMiles: number;
    etaMinutes: number | null;
    ownerName: string;
    ownerPhone: string | null;
    contactPhone: string | null;
  }>;
  placeName: string | null;
  fetchedAt: string;
}

interface XweatherStatus {
  running: boolean;
  configured: boolean;
  lastFetchedAt: string | null;
  activeThreats: number;
  totalAffectedLeads: number;
}

export default function StormResponse() {
  const { toast } = useToast();

  const { data: monitorStatus } = useQuery<{ running: boolean; lastHash: string }>({
    queryKey: ["/api/storm/status"],
    refetchInterval: 15000,
  });

  const { data: xweatherStatus } = useQuery<XweatherStatus>({
    queryKey: ["/api/xweather/status"],
    refetchInterval: 15000,
  });

  const { data: threats } = useQuery<HailThreat[]>({
    queryKey: ["/api/xweather/threats"],
    refetchInterval: 30000,
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

  const startXweather = useMutation({
    mutationFn: () => apiRequest("POST", "/api/xweather/monitor/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xweather/status"] });
      toast({ title: "Predictive hail monitor started" });
    },
  });

  const stopXweather = useMutation({
    mutationFn: () => apiRequest("POST", "/api/xweather/monitor/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xweather/status"] });
      toast({ title: "Predictive hail monitor stopped" });
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

  const scanXweather = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/xweather/scan");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/xweather/threats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/xweather/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/storm/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/storm/response-queue"] });
      toast({
        title: "Prediction scan complete",
        description: `Found ${data.threats?.length || 0} threats, ${data.totalAffectedLeads} leads in path`,
      });
    },
    onError: () => {
      toast({ title: "Prediction scan failed", variant: "destructive" });
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
  const activeThreats = threats?.filter(t => t.affectedLeads.length > 0) || [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Storm Response</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time storm monitoring, predictive hail alerts, and prioritized response queue</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={monitorStatus?.running ? "default" : "secondary"}
            data-testid="badge-monitor-status"
          >
            <Radio className="w-3 h-3 mr-1" />
            {monitorStatus?.running ? "NOAA Active" : "NOAA Off"}
          </Badge>
          <Badge
            variant={xweatherStatus?.running ? "default" : "secondary"}
            data-testid="badge-xweather-status"
          >
            <Zap className="w-3 h-3 mr-1" />
            {xweatherStatus?.running ? "Prediction Active" : xweatherStatus?.configured ? "Prediction Off" : "Not Configured"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Threats</CardTitle>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-threats">{xweatherStatus?.activeThreats || 0}</div>
            <p className="text-xs text-muted-foreground">Predicted hail</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Storms</CardTitle>
            <CloudLightning className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-storms">{activeRuns?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads in Path</CardTitle>
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-affected-leads">
              {(xweatherStatus?.totalAffectedLeads || 0) + (activeRuns?.reduce((s, r) => s + r.affectedLeadCount, 0) || 0)}
            </div>
            <p className="text-xs text-muted-foreground">In storm / threat zones</p>
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
            <Radar className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-detections">{recentRuns?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Storm runs logged</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="w-4 h-4" />
              NOAA Radar Monitor
            </CardTitle>
            <div className="flex items-center gap-2">
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
                  Start
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
                Scan
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Monitors NOAA SWDI radar for active hail signatures. Detects hail that is currently falling.
            </p>
            {activeRuns && activeRuns.length > 0 ? (
              <div className="mt-3 space-y-2">
                {activeRuns.slice(0, 5).map((run) => {
                  const swath = run.swathPolygon as any;
                  return (
                    <div key={run.id} className="flex items-center justify-between gap-3 p-2 border rounded-md text-sm flex-wrap" data-testid={`card-storm-run-${run.id}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={run.maxHailProb >= 80 ? "destructive" : "default"} className="text-xs">
                          {run.maxHailProb}%
                        </Badge>
                        <span className="text-xs">{run.radarSignatureCount} sigs</span>
                        <span className="text-xs text-muted-foreground">{run.affectedLeadCount} leads</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {run.detectedAt ? new Date(run.detectedAt).toLocaleTimeString() : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground text-center py-4">No active radar detections</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Predictive Hail Monitor
              <Badge variant="outline" className="text-[10px]">Xweather</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              {xweatherStatus?.configured ? (
                <>
                  {xweatherStatus?.running ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => stopXweather.mutate()}
                      disabled={stopXweather.isPending}
                      data-testid="button-stop-xweather"
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => startXweather.mutate()}
                      disabled={startXweather.isPending}
                      data-testid="button-start-xweather"
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Start
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => scanXweather.mutate()}
                    disabled={scanXweather.isPending}
                    data-testid="button-scan-xweather"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${scanXweather.isPending ? "animate-spin" : ""}`} />
                    Scan
                  </Button>
                </>
              ) : (
                <Badge variant="secondary" className="text-xs">API Keys Needed</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Lightning-based nowcasting predicts hail 30-60 minutes before radar detection. Pre-warms leads before competitors know storms happened.
            </p>
            {xweatherStatus?.lastFetchedAt && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Last checked: {new Date(xweatherStatus.lastFetchedAt).toLocaleString()}
              </p>
            )}
            {activeThreats.length > 0 ? (
              <div className="mt-3 space-y-2">
                {activeThreats.map((threat) => (
                  <div key={threat.id} className="p-3 border rounded-md" data-testid={`card-threat-${threat.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={threat.severe ? "destructive" : "default"} className="text-xs">
                          {threat.maxSizeIN}" hail
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {threat.probSevere}% severe
                        </Badge>
                        {threat.stormMotionMPH && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <ArrowRight className="w-3 h-3" />
                            {threat.stormMotionMPH} mph
                          </span>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {threat.affectedLeads.length} leads
                      </Badge>
                    </div>
                    {threat.affectedLeads.length > 0 && (
                      <div className="space-y-1">
                        {threat.affectedLeads.slice(0, 3).map((al) => (
                          <div key={al.leadId} className="text-xs flex items-center justify-between gap-2 text-muted-foreground">
                            <span className="truncate">{al.address}, {al.city}</span>
                            <span className="shrink-0">
                              {al.etaMinutes !== null ? `ETA ~${al.etaMinutes}min` : `${al.distanceMiles}mi`}
                            </span>
                          </div>
                        ))}
                        {threat.affectedLeads.length > 3 && (
                          <p className="text-[10px] text-muted-foreground">+{threat.affectedLeads.length - 3} more</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground text-center py-4">
                {xweatherStatus?.configured
                  ? "No active hail threats detected"
                  : "Add XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET to enable predictions"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

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
              No pending calls. Run a storm scan or prediction scan to detect hail near your leads.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingQueue.map((item, idx) => {
                const isPredicted = item.stormRun?.status === "predicted";
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 p-3 border rounded-md flex-wrap" data-testid={`card-queue-item-${item.id}`}>
                    <div className="flex items-center gap-3 flex-wrap min-w-0">
                      <span className="text-sm font-mono text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                      <Badge variant={item.priority >= 150 ? "destructive" : item.priority >= 100 ? "default" : "secondary"}>
                        P{item.priority}
                      </Badge>
                      {isPredicted && (
                        <Badge variant="outline" className="text-[10px]">
                          <Zap className="w-2.5 h-2.5 mr-0.5" />
                          Predicted
                        </Badge>
                      )}
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
                );
              })}
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
              {recentRuns.slice(0, 20).map((run) => {
                const isPredicted = run.status === "predicted";
                return (
                  <div key={run.id} className="flex items-center justify-between gap-4 p-2 border rounded-md text-sm flex-wrap" data-testid={`card-history-run-${run.id}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{run.status}</Badge>
                      {isPredicted && (
                        <Badge variant="outline" className="text-[10px]">
                          <Zap className="w-2.5 h-2.5 mr-0.5" />
                          Predicted
                        </Badge>
                      )}
                      <span>{run.radarSignatureCount} sigs</span>
                      <span className="text-muted-foreground">{run.affectedLeadCount} leads</span>
                      <span className="text-muted-foreground">{run.maxHailProb}% prob</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {run.detectedAt ? new Date(run.detectedAt).toLocaleString() : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
