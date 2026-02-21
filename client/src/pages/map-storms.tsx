import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Ruler, Calendar, CloudLightning, X, Radar, Zap,
  AlertTriangle, Radio, Phone, MapPin, Clock, Play, Square,
  RefreshCw, CheckCircle, ArrowRight,
  Bell, Plus, Trash2, Mail, Shield,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lead, StormRun, ResponseQueueItem, StormAlertConfig, AlertHistoryRecord } from "@shared/schema";

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

interface SwdiHailSignature {
  lat: number;
  lon: number;
  ztime: string;
  prob: number;
  sevprob: number;
  wsrId: string;
  cellId: string;
}

interface NwsAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  areaDesc: string;
  severity: string;
  onset: string;
  expires: string;
  polygon: [number, number][] | null;
}

interface HailTrackerData {
  radarSignatures: SwdiHailSignature[];
  alerts: NwsAlert[];
  fetchedAt: string;
}

interface HailThreat {
  id: string;
  centroidLat: number;
  centroidLon: number;
  maxSizeIN: number;
  maxSizeMM?: number;
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
    city?: string;
    leadScore?: number;
    distanceMiles: number;
    etaMinutes: number | null;
    ownerName?: string;
    ownerPhone?: string | null;
    contactPhone?: string | null;
  }>;
  placeName: string | null;
  fetchedAt?: string;
}

interface XweatherStatus {
  running: boolean;
  configured: boolean;
  lastFetchedAt: string | null;
  activeThreats: number;
  totalAffectedLeads: number;
}

type EnrichedQueueItem = ResponseQueueItem & { lead?: Lead; stormRun?: StormRun };

function getMarkerColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#9ca3af";
}

function createIcon(score: number) {
  const color = getMarkerColor(score);
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function getHailColor(sevprob: number, prob: number): string {
  if (sevprob >= 50) return "#dc2626";
  if (sevprob >= 25) return "#f97316";
  if (prob >= 75) return "#eab308";
  return "#60a5fa";
}

function getHailRadius(sevprob: number): number {
  if (sevprob >= 50) return 6;
  if (sevprob >= 25) return 5;
  return 4;
}

function getThreatColor(probSevere: number, severe: boolean): string {
  if (severe) return "#9333ea";
  if (probSevere >= 70) return "#dc2626";
  if (probSevere >= 40) return "#f97316";
  return "#eab308";
}

export default function MapStorms() {
  const { toast } = useToast();

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const hailLayerRef = useRef<L.LayerGroup | null>(null);
  const alertLayerRef = useRef<L.LayerGroup | null>(null);
  const swathLayerRef = useRef<L.LayerGroup | null>(null);
  const threatLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showHailTracker, setShowHailTracker] = useState(false);
  const [showSwathZones, setShowSwathZones] = useState(true);
  const [showThreatForecast, setShowThreatForecast] = useState(true);
  const [daysBack, setDaysBack] = useState("7");

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("Default Alert");
  const [newMinHailSize, setNewMinHailSize] = useState("1.0");
  const [newMinProbSevere, setNewMinProbSevere] = useState("40");
  const [newSms, setNewSms] = useState(true);
  const [newEmail, setNewEmail] = useState(false);
  const [newPredictiveAlerts, setNewPredictiveAlerts] = useState(true);
  const [recipientType, setRecipientType] = useState<"sms" | "email">("sms");
  const [recipientValue, setRecipientValue] = useState("");
  const [newRecipients, setNewRecipients] = useState<Array<{ type: string; value: string }>>([]);

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

  const { data: leadsData, isLoading: leadsLoading } = useQuery<LeadsResponse>({
    queryKey: ["/api/leads?limit=500"],
  });
  const leads = leadsData?.leads;

  const { data: hailData, isLoading: hailLoading } = useQuery<HailTrackerData>({
    queryKey: [`/api/hail-tracker?daysBack=${daysBack}`],
    enabled: showHailTracker,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stormRuns } = useQuery<StormRun[]>({
    queryKey: ["/api/storm/runs", { limit: 20 }],
    refetchInterval: 60000,
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

  const { data: configs, isLoading: configsLoading } = useQuery<StormAlertConfig[]>({
    queryKey: ["/api/storm/alert-configs"],
  });

  const { data: alertHistoryData } = useQuery<AlertHistoryRecord[]>({
    queryKey: ["/api/storm/alert-history"],
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

  const createConfig = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/storm/alert-configs", {
        name: newName,
        minHailSize: parseFloat(newMinHailSize) || 1.0,
        minProbSevere: parseInt(newMinProbSevere) || 40,
        predictiveAlerts: newPredictiveAlerts,
        notifySms: newSms,
        notifyEmail: newEmail,
        recipients: newRecipients,
        isActive: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/alert-configs"] });
      toast({ title: "Alert config created" });
      setShowCreate(false);
      setNewRecipients([]);
      setNewName("Default Alert");
    },
    onError: () => {
      toast({ title: "Failed to create config", variant: "destructive" });
    },
  });

  const toggleConfig = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/storm/alert-configs/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/alert-configs"] });
    },
  });

  const deleteConfig = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/storm/alert-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/alert-configs"] });
      toast({ title: "Alert config deleted" });
    },
  });

  const startNoaa = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "NOAA storm monitor started" });
    },
  });

  const stopNoaa = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "NOAA storm monitor stopped" });
    },
  });

  const addRecipient = () => {
    if (!recipientValue.trim()) return;
    setNewRecipients([...newRecipients, { type: recipientType, value: recipientValue.trim() }]);
    setRecipientValue("");
  };

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [32.78, -96.80],
      zoom: 10,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    hailLayerRef.current = L.layerGroup().addTo(map);
    alertLayerRef.current = L.layerGroup().addTo(map);
    swathLayerRef.current = L.layerGroup().addTo(map);
    threatLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !leads) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const validLeads = leads.filter((l) => l.latitude && l.longitude && isFinite(l.latitude) && isFinite(l.longitude));

    validLeads.forEach((lead) => {
      const marker = L.marker([lead.latitude, lead.longitude], {
        icon: createIcon(lead.leadScore),
      });

      marker.on("click", () => {
        setSelectedLead(lead);
      });

      marker.addTo(mapInstanceRef.current!);
      markersRef.current.push(marker);
    });

    if (validLeads.length > 0) {
      const bounds = L.latLngBounds(validLeads.map((l) => [l.latitude, l.longitude]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [leads]);

  useEffect(() => {
    if (!hailLayerRef.current || !alertLayerRef.current) return;

    hailLayerRef.current.clearLayers();
    alertLayerRef.current.clearLayers();

    if (!showHailTracker || !hailData) return;

    for (const sig of hailData.radarSignatures) {
      const color = getHailColor(sig.sevprob, sig.prob);
      const radius = getHailRadius(sig.sevprob);

      const circle = L.circleMarker([sig.lat, sig.lon], {
        radius,
        fillColor: color,
        fillOpacity: 0.6,
        color: color,
        weight: 1,
        opacity: 0.8,
      });

      const timeStr = sig.ztime ? new Date(sig.ztime.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:00Z")).toLocaleString() : "Unknown";
      circle.bindPopup(
        `<div style="font-size:12px;">
          <strong>Radar Hail Detection</strong><br/>
          Hail Prob: ${sig.prob}%<br/>
          Severe Prob: ${sig.sevprob}%<br/>
          Time (UTC): ${timeStr}<br/>
          Radar: ${sig.wsrId}
        </div>`
      );

      hailLayerRef.current!.addLayer(circle);
    }

    for (const alert of hailData.alerts) {
      if (alert.polygon && alert.polygon.length > 0) {
        const polygon = L.polygon(alert.polygon, {
          color: alert.severity === "Extreme" ? "#dc2626" : "#f59e0b",
          fillColor: alert.severity === "Extreme" ? "#dc2626" : "#f59e0b",
          fillOpacity: 0.15,
          weight: 2,
          dashArray: "5, 5",
        });

        polygon.bindPopup(
          `<div style="font-size:12px;">
            <strong>${alert.event}</strong><br/>
            ${alert.headline}<br/>
            <em>Expires: ${new Date(alert.expires).toLocaleString()}</em>
          </div>`
        );

        alertLayerRef.current!.addLayer(polygon);
      }
    }
  }, [hailData, showHailTracker]);

  useEffect(() => {
    if (!swathLayerRef.current) return;
    swathLayerRef.current.clearLayers();

    if (!showSwathZones || !stormRuns) return;

    for (const run of stormRuns) {
      const swath = run.swathPolygon as any;
      if (!swath?.coordinates || swath.coordinates.length < 3) continue;

      const severity = run.maxSevereProb >= 50 ? "high" : run.maxHailProb >= 60 ? "medium" : "low";
      const color = severity === "high" ? "#dc2626" : severity === "medium" ? "#f97316" : "#eab308";
      const isRecent = run.detectedAt && (Date.now() - new Date(run.detectedAt).getTime()) < 6 * 60 * 60 * 1000;
      const isPredicted = run.status === "predicted";

      const polygon = L.polygon(swath.coordinates as [number, number][], {
        color: isPredicted ? "#9333ea" : color,
        fillColor: isPredicted ? "#9333ea" : color,
        fillOpacity: isRecent ? 0.2 : 0.08,
        weight: isRecent ? 3 : 1.5,
        dashArray: isPredicted ? "8, 4, 2, 4" : isRecent ? undefined : "6, 4",
      });

      const timeStr = run.detectedAt ? new Date(run.detectedAt).toLocaleString() : "Unknown";
      const sourceLabel = isPredicted ? "Predicted Hail Zone (Xweather)" : "Hail Swath Zone";
      polygon.bindPopup(
        `<div style="font-size:12px;">
          <strong>${sourceLabel}</strong><br/>
          Hail Prob: ${run.maxHailProb}%<br/>
          Severe Prob: ${run.maxSevereProb}%<br/>
          ${isPredicted && swath.maxSizeIN ? `Max Size: ${swath.maxSizeIN}"<br/>` : ""}
          Radar Signatures: ${run.radarSignatureCount}<br/>
          Affected Leads: ${run.affectedLeadCount}<br/>
          Detected: ${timeStr}
        </div>`
      );

      swathLayerRef.current.addLayer(polygon);
    }
  }, [stormRuns, showSwathZones]);

  useEffect(() => {
    if (!threatLayerRef.current) return;
    threatLayerRef.current.clearLayers();

    if (!showThreatForecast || !threats || threats.length === 0) return;

    for (const threat of threats) {
      const color = getThreatColor(threat.probSevere, threat.severe);

      for (let i = 0; i < threat.threatPolygons.length; i++) {
        const tp = threat.threatPolygons[i];
        if (!tp.polygon || tp.polygon.length < 3) continue;

        const opacity = Math.max(0.05, 0.25 - (i * 0.03));
        const weight = i === 0 ? 3 : 1.5;

        const polygon = L.polygon(tp.polygon, {
          color,
          fillColor: color,
          fillOpacity: opacity,
          weight,
          dashArray: i > 0 ? "4, 4" : undefined,
        });

        const time = new Date(tp.dateTimeISO).toLocaleTimeString();
        polygon.bindPopup(
          `<div style="font-size:12px;">
            <strong>Hail Threat Forecast</strong><br/>
            Step ${i + 1} of ${threat.threatPolygons.length}<br/>
            Time: ${time}<br/>
            Max Size: ${threat.maxSizeIN}"<br/>
            Prob Severe: ${threat.probSevere}%<br/>
            ${threat.severe ? "<strong style='color:#dc2626;'>SEVERE</strong><br/>" : ""}
            ${threat.affectedLeads.length} leads in path
          </div>`
        );

        threatLayerRef.current!.addLayer(polygon);
      }

      if (threat.forecastPath.length >= 2) {
        const pathLine = L.polyline(threat.forecastPath, {
          color,
          weight: 3,
          opacity: 0.8,
          dashArray: "10, 6",
        });

        pathLine.bindPopup(
          `<div style="font-size:12px;">
            <strong>Storm Forecast Path</strong><br/>
            ${threat.stormMotionMPH ? `Speed: ${threat.stormMotionMPH} MPH<br/>` : ""}
            ${threat.stormMotionDeg !== null ? `Direction: ${threat.stormMotionDeg}&deg;<br/>` : ""}
            Max Hail: ${threat.maxSizeIN}"<br/>
            ${threat.affectedLeads.length} leads in path
          </div>`
        );

        threatLayerRef.current!.addLayer(pathLine);

        if (threat.forecastPath.length > 0) {
          const arrowEnd = threat.forecastPath[threat.forecastPath.length - 1];
          const arrowMarker = L.circleMarker(arrowEnd, {
            radius: 5,
            fillColor: color,
            fillOpacity: 1,
            color: "white",
            weight: 2,
          });
          threatLayerRef.current!.addLayer(arrowMarker);
        }
      }

      const centroidMarker = L.circleMarker([threat.centroidLat, threat.centroidLon], {
        radius: 8,
        fillColor: color,
        fillOpacity: 0.9,
        color: "white",
        weight: 2,
      });

      centroidMarker.bindPopup(
        `<div style="font-size:12px;">
          <strong>Hail Threat Center</strong><br/>
          ${threat.placeName ? `Near: ${threat.placeName}<br/>` : ""}
          Max Size: ${threat.maxSizeIN}"<br/>
          Prob Severe: ${threat.probSevere}%<br/>
          ${threat.severe ? "<strong style='color:#dc2626;'>SEVERE HAIL</strong><br/>" : ""}
          ${threat.stormMotionMPH ? `Moving: ${threat.stormMotionMPH} MPH<br/>` : ""}
          Affected Leads: ${threat.affectedLeads.length}
        </div>`
      );

      threatLayerRef.current!.addLayer(centroidMarker);
    }
  }, [threats, showThreatForecast]);

  const sigCount = hailData?.radarSignatures?.length || 0;
  const alertCount = hailData?.alerts?.length || 0;
  const threatCount = threats?.length || 0;
  const pendingQueue = responseQueue?.filter(q => q.status === "pending") || [];
  const activeThreats = threats?.filter(t => t.affectedLeads.length > 0) || [];

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <h2 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Map & Storms</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Interactive map, storm monitoring, and alert configuration</p>
      </div>
      <Tabs defaultValue="map" className="flex-1 flex flex-col">
        <div className="px-4 pt-2">
          <TabsList>
            <TabsTrigger value="map" data-testid="tab-map">Map</TabsTrigger>
            <TabsTrigger value="storms" data-testid="tab-storms">Storm Response</TabsTrigger>
            <TabsTrigger value="alerts" data-testid="tab-alerts">Alert Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="map" className="flex-1 mt-0 flex flex-col">
          <div className="p-4 pb-0 border-b flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground">
                {leadsData ? `Top ${leads?.length} of ${leadsData.total.toLocaleString()} properties` : "Loading..."} plotted by score
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant={showThreatForecast ? "default" : "outline"}
                size="sm"
                onClick={() => setShowThreatForecast(!showThreatForecast)}
                data-testid="button-toggle-threat-forecast"
              >
                <Zap className="w-4 h-4 mr-1.5" />
                Hail Forecast
                {showThreatForecast && threatCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">{threatCount}</Badge>
                )}
              </Button>
              <Button
                variant={showSwathZones ? "default" : "outline"}
                size="sm"
                onClick={() => setShowSwathZones(!showSwathZones)}
                data-testid="button-toggle-swath-zones"
              >
                <CloudLightning className="w-4 h-4 mr-1.5" />
                Hail Zones
                {showSwathZones && stormRuns && stormRuns.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">{stormRuns.length}</Badge>
                )}
              </Button>
              <Button
                variant={showHailTracker ? "default" : "outline"}
                size="sm"
                onClick={() => setShowHailTracker(!showHailTracker)}
                data-testid="button-toggle-hail-tracker"
              >
                <Radar className="w-4 h-4 mr-1.5" />
                Hail Tracker
                {showHailTracker && sigCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">{sigCount}</Badge>
                )}
              </Button>
              {showHailTracker && (
                <Select value={daysBack} onValueChange={setDaysBack}>
                  <SelectTrigger className="w-[120px]" data-testid="select-hail-days">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Last 24h</SelectItem>
                    <SelectItem value="3">Last 3 days</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="14">Last 14 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs text-muted-foreground">Hot (80+)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground">Warm (60+)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                <span className="text-xs text-muted-foreground">Cool (40+)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <span className="text-xs text-muted-foreground">Cold</span>
              </div>
            </div>
          </div>

          {(showHailTracker || (showThreatForecast && threatCount > 0)) && (
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-4 flex-wrap">
              {showThreatForecast && threatCount > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground">Forecast:</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-600" />
                    <span className="text-[10px] text-muted-foreground">Severe</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                    <span className="text-[10px] text-muted-foreground">High</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                    <span className="text-[10px] text-muted-foreground">Moderate</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    <span className="text-[10px] text-muted-foreground">Low</span>
                  </div>
                  <Badge variant="default" className="text-[10px]">
                    <Zap className="w-2.5 h-2.5 mr-1" />
                    {threatCount} Active Threat{threatCount > 1 ? "s" : ""}
                  </Badge>
                </div>
              )}
              {showHailTracker && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground">Radar Hail:</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                    <span className="text-[10px] text-muted-foreground">Severe 50%+</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                    <span className="text-[10px] text-muted-foreground">Severe 25%+</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    <span className="text-[10px] text-muted-foreground">Likely</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                    <span className="text-[10px] text-muted-foreground">Possible</span>
                  </div>
                  {alertCount > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {alertCount} Active Alert{alertCount > 1 ? "s" : ""}
                    </Badge>
                  )}
                  {hailLoading && (
                    <span className="text-[10px] text-muted-foreground animate-pulse">Loading radar data...</span>
                  )}
                  {hailData && !hailLoading && (
                    <span className="text-[10px] text-muted-foreground">
                      {sigCount} radar detections, updated {new Date(hailData.fetchedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 relative">
            {leadsLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                <div className="text-center">
                  <Skeleton className="w-12 h-12 rounded-full mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Loading map data...</p>
                </div>
              </div>
            )}
            <div ref={mapRef} className="absolute inset-0" data-testid="map-container" />

            {selectedLead && (
              <div className="absolute bottom-4 left-4 right-4 z-[1000] max-w-md">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" data-testid="text-selected-address">{selectedLead.address}</p>
                        <p className="text-xs text-muted-foreground">{selectedLead.city}, {selectedLead.county} Co.</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedLead(null)}
                        data-testid="button-close-popup"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap mb-3">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Ruler className="w-3 h-3" />
                        {selectedLead.sqft.toLocaleString()} sqft
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        {selectedLead.zoning}
                      </span>
                      {selectedLead.roofLastReplaced && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Roof: {selectedLead.roofLastReplaced}
                        </span>
                      )}
                      {selectedLead.hailEvents > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <CloudLightning className="w-3 h-3" />
                          {selectedLead.hailEvents} hail events
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={selectedLead.status} />
                        <ScoreBadge score={selectedLead.leadScore} />
                      </div>
                      <Link href={`/leads/${selectedLead.id}`}>
                        <Button size="sm" data-testid="button-view-lead-detail">View Details</Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="storms" className="p-4 overflow-auto">
          <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between gap-4 flex-wrap">
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
        </TabsContent>

        <TabsContent value="alerts" className="p-4 overflow-auto">
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-muted-foreground">Configure storm monitors, alert thresholds, and notification recipients</p>
              <Button size="sm" onClick={() => setShowCreate(!showCreate)} data-testid="button-new-config">
                <Plus className="w-3 h-3 mr-1" />
                New Alert Rule
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Radio className="w-4 h-4" />
                    NOAA Storm Monitor
                  </CardTitle>
                  <Badge variant={monitorStatus?.running ? "default" : "secondary"} className="text-xs">
                    {monitorStatus?.running ? "Active" : "Off"}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Polls NOAA SWDI radar every 10 minutes for active hail signatures in your market area. Triggers alerts when hail is currently falling near leads.
                  </p>
                  <div className="flex items-center gap-2">
                    {monitorStatus?.running ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => stopNoaa.mutate()}
                        disabled={stopNoaa.isPending}
                        data-testid="button-stop-noaa"
                      >
                        Stop Monitor
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => startNoaa.mutate()}
                        disabled={startNoaa.isPending}
                        data-testid="button-start-noaa"
                      >
                        Start Monitor
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Predictive Hail Monitor
                    <Badge variant="outline" className="text-[10px]">Xweather</Badge>
                  </CardTitle>
                  <Badge variant={xweatherStatus?.running ? "default" : "secondary"} className="text-xs">
                    {xweatherStatus?.running ? "Active" : xweatherStatus?.configured ? "Off" : "Not Configured"}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Lightning-based nowcasting predicts hail 30-60 minutes before radar detection. Polls every 2 minutes for threat polygons and sends pre-storm alerts to give your team a head start.
                  </p>
                  {!xweatherStatus?.configured ? (
                    <div className="text-xs text-muted-foreground p-3 border rounded-md bg-muted/30">
                      Add <code className="text-[11px] bg-muted px-1 rounded">XWEATHER_CLIENT_ID</code> and <code className="text-[11px] bg-muted px-1 rounded">XWEATHER_CLIENT_SECRET</code> secrets to enable predictive monitoring.
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {xweatherStatus?.running ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => stopXweather.mutate()}
                          disabled={stopXweather.isPending}
                          data-testid="button-stop-xweather"
                        >
                          Stop Monitor
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => startXweather.mutate()}
                          disabled={startXweather.isPending}
                          data-testid="button-start-xweather"
                        >
                          Start Monitor
                        </Button>
                      )}
                    </div>
                  )}
                  {xweatherStatus?.lastFetchedAt && (
                    <p className="text-[10px] text-muted-foreground">
                      Last checked: {new Date(xweatherStatus.lastFetchedAt).toLocaleString()}
                      {xweatherStatus.activeThreats > 0 && ` | ${xweatherStatus.activeThreats} active threats`}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {showCreate && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create Alert Rule</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Rule Name</Label>
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="e.g., Sales Team DFW"
                        data-testid="input-config-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Min Hail Size (inches)</Label>
                      <Input
                        type="number"
                        value={newMinHailSize}
                        onChange={(e) => setNewMinHailSize(e.target.value)}
                        placeholder="1.0"
                        min="0.5"
                        max="5"
                        step="0.25"
                        data-testid="input-min-hail-size"
                      />
                      <p className="text-[10px] text-muted-foreground">Min predicted hail size to trigger alert</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Min Severe Probability (%)</Label>
                      <Input
                        type="number"
                        value={newMinProbSevere}
                        onChange={(e) => setNewMinProbSevere(e.target.value)}
                        placeholder="40"
                        min="10"
                        max="100"
                        step="5"
                        data-testid="input-min-prob-severe"
                      />
                      <p className="text-[10px] text-muted-foreground">Min probability for Xweather prediction alerts</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Switch checked={newSms} onCheckedChange={setNewSms} data-testid="switch-sms" />
                      <Label>SMS Alerts</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={newEmail} onCheckedChange={setNewEmail} data-testid="switch-email" />
                      <Label>Email Alerts</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={newPredictiveAlerts} onCheckedChange={setNewPredictiveAlerts} data-testid="switch-predictive" />
                      <Label>Pre-Storm Alerts</Label>
                      <Badge variant="outline" className="text-[10px]">Xweather</Badge>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Recipients</Label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={recipientType}
                        onChange={(e) => setRecipientType(e.target.value as "sms" | "email")}
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                        data-testid="select-recipient-type"
                      >
                        <option value="sms">SMS</option>
                        <option value="email">Email</option>
                      </select>
                      <Input
                        value={recipientValue}
                        onChange={(e) => setRecipientValue(e.target.value)}
                        placeholder={recipientType === "sms" ? "+1234567890" : "team@company.com"}
                        className="flex-1"
                        data-testid="input-recipient-value"
                        onKeyDown={(e) => e.key === "Enter" && addRecipient()}
                      />
                      <Button size="sm" variant="outline" onClick={addRecipient} data-testid="button-add-recipient">Add</Button>
                    </div>
                    {newRecipients.length > 0 && (
                      <div className="flex gap-2 flex-wrap mt-2">
                        {newRecipients.map((r, i) => (
                          <Badge key={i} variant="secondary" className="gap-1">
                            {r.type === "sms" ? <Phone className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                            {r.value}
                            <button onClick={() => setNewRecipients(newRecipients.filter((_, j) => j !== i))} className="ml-1 opacity-60 hover:opacity-100">
                              x
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={() => createConfig.mutate()} disabled={createConfig.isPending || newRecipients.length === 0} data-testid="button-save-config">
                      Save Alert Rule
                    </Button>
                    <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {configsLoading ? (
                <div className="text-sm text-muted-foreground text-center py-8">Loading alert configs...</div>
              ) : !configs || configs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Shield className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No alert rules configured yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Create one to get notified when storms hit your lead zones.</p>
                  </CardContent>
                </Card>
              ) : (
                configs.map((config) => {
                  const recipients = (config.recipients as Array<{ type: string; value: string }>) || [];
                  return (
                    <Card key={config.id} data-testid={`card-config-${config.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div>
                              <div className="font-medium text-sm">{config.name}</div>
                              <div className="text-xs text-muted-foreground">
                                Min hail: {config.minHailSize}" | Min severe: {config.minProbSevere || 40}%
                                {config.notifySms && " | SMS"}
                                {config.notifyEmail && " | Email"}
                                {config.predictiveAlerts !== false && " | Pre-storm"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {recipients.map((r, i) => (
                              <Badge key={i} variant="outline" className="text-xs gap-1">
                                {r.type === "sms" ? <Phone className="w-2.5 h-2.5" /> : <Mail className="w-2.5 h-2.5" />}
                                {r.value}
                              </Badge>
                            ))}
                            <Switch
                              checked={config.isActive}
                              onCheckedChange={(checked) => toggleConfig.mutate({ id: config.id, isActive: checked })}
                              data-testid={`switch-toggle-${config.id}`}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteConfig.mutate(config.id)}
                              disabled={deleteConfig.isPending}
                              data-testid={`button-delete-${config.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            {alertHistoryData && alertHistoryData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Alert History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {alertHistoryData.slice(0, 20).map((alert) => (
                      <div key={alert.id} className="flex items-center justify-between gap-4 p-2 border rounded-md text-sm flex-wrap" data-testid={`card-alert-history-${alert.id}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={alert.status === "sent" ? "default" : alert.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                            {alert.status}
                          </Badge>
                          <span className="text-muted-foreground">{alert.channel}</span>
                          <span className="truncate max-w-[200px]">{alert.recipient}</span>
                          {alert.message && alert.message.includes("PREDICTED") && (
                            <Badge variant="outline" className="text-[10px]">
                              <Zap className="w-2.5 h-2.5 mr-0.5" />
                              Predictive
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {alert.sentAt ? new Date(alert.sentAt).toLocaleString() : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
