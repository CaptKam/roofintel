import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CloudLightning, Phone, Mail, ExternalLink, ChevronLeft, ChevronRight,
  Zap, AlertTriangle, Target, DollarSign, Building2, X, Copy, ArrowRight,
  Radar, Play, Square, RefreshCw, CheckCircle, Bell, Plus, Trash2, Shield,
  ChevronDown, Settings2, Radio
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lead, StormRun, ResponseQueueItem, StormAlertConfig, AlertHistoryRecord } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Helmet } from "react-helmet-async";

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

interface RoiDecision {
  id: string;
  leadId: string;
  decisionType: string;
  roiScore: number;
  expectedValue: number;
  enrichmentCost: number;
  recommendedApis: string[];
  reasonSummary: string;
  confidence: number;
}

interface ZipTile {
  zipCode: string;
  zipScore: number;
  boundingBox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  stormRiskScore: number;
  roofAgeScore: number;
  dataGapScore: number;
  propertyValueScore: number;
  leadDensityScore: number;
  leadCount: number;
  recommendedSpend: number;
  projectedEv: number;
  avgLeadScore: number;
  avgHailEvents: number;
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

interface XweatherStatus {
  running: boolean;
  configured: boolean;
  lastFetchedAt: string | null;
  activeThreats: number;
  totalAffectedLeads: number;
}

type EnrichedQueueItem = ResponseQueueItem & { lead?: Lead; stormRun?: StormRun };

function getTierColor(tier: string): string {
  switch (tier) {
    case "premium": return "#9333ea";
    case "tier3": return "#dc2626";
    case "tier2": return "#f97316";
    case "tier1": return "#eab308";
    case "free_only": return "#3b82f6";
    default: return "#9ca3af";
  }
}

function getTierBg(tier: string): string {
  switch (tier) {
    case "premium": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "tier3": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "tier2": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "tier1": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "free_only": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
  }
}

function getZipTileColor(score: number): string {
  if (score > 75) return "#b91c1c";
  if (score > 55) return "#f59e0b";
  if (score > 35) return "#eab308";
  return "#3b82f6";
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

function createMarkerIcon(tier: string) {
  const color = getTierColor(tier);
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function createDefaultIcon(score: number) {
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#9ca3af";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export default function HailChaser() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const zipLayerRef = useRef<L.LayerGroup | null>(null);
  const threatLayerRef = useRef<L.LayerGroup | null>(null);
  const hailLayerRef = useRef<L.LayerGroup | null>(null);
  const alertLayerRef = useRef<L.LayerGroup | null>(null);
  const swathLayerRef = useRef<L.LayerGroup | null>(null);
  const footprintLayerRef = useRef<L.LayerGroup | null>(null);
  const footprintCacheRef = useRef<Map<string, any>>(new Map());

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showHailTracker, setShowHailTracker] = useState(false);
  const [showSwathZones, setShowSwathZones] = useState(true);
  const [showThreatForecast, setShowThreatForecast] = useState(true);
  const [showFootprints, setShowFootprints] = useState(false);
  const [showAlertNws, setShowAlertNws] = useState(true);
  const [footprintLoading, setFootprintLoading] = useState(false);
  const [daysBack, setDaysBack] = useState("7");
  const [alertConfigOpen, setAlertConfigOpen] = useState(false);
  const [monitorControlsOpen, setMonitorControlsOpen] = useState(false);

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

  const { toast } = useToast();

  const { data: leadsData } = useQuery<LeadsResponse>({
    queryKey: ["/api/leads?limit=2000"],
  });

  const { data: zipTiles } = useQuery<ZipTile[]>({
    queryKey: ["/api/zip-tiles"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: threats } = useQuery<HailThreat[]>({
    queryKey: ["/api/xweather/threats"],
    refetchInterval: 30000,
  });

  const { data: stormStatus } = useQuery<{ running: boolean; lastScan?: string }>({
    queryKey: ["/api/storm/status"],
    refetchInterval: 30000,
  });

  const { data: xweatherStatus } = useQuery<XweatherStatus>({
    queryKey: ["/api/xweather/status"],
    refetchInterval: 15000,
  });

  const { data: responseQueue, isLoading: queueLoading } = useQuery<EnrichedQueueItem[]>({
    queryKey: ["/api/storm/response-queue"],
    refetchInterval: 15000,
  });

  const { data: roiDecisions } = useQuery<RoiDecision[]>({
    queryKey: ["/api/admin/roi/decisions", { limit: 2000 }],
    staleTime: 5 * 60 * 1000,
  });

  const { data: hailData, isLoading: hailLoading } = useQuery<HailTrackerData>({
    queryKey: [`/api/hail-tracker?daysBack=${daysBack}`],
    enabled: showHailTracker,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stormRuns } = useQuery<StormRun[]>({
    queryKey: ["/api/storm/runs", { limit: 20 }],
    refetchInterval: 60000,
  });

  const { data: activeRuns } = useQuery<StormRun[]>({
    queryKey: ["/api/storm/runs/active"],
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
      toast({ title: "NOAA storm monitor started" });
    },
  });

  const stopMonitor = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "NOAA storm monitor stopped" });
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

  const addRecipient = () => {
    if (!recipientValue.trim()) return;
    setNewRecipients([...newRecipients, { type: recipientType, value: recipientValue.trim() }]);
    setRecipientValue("");
  };

  const roiMap = new Map<string, RoiDecision>();
  if (roiDecisions) {
    for (const d of roiDecisions) {
      if (!roiMap.has(d.leadId)) roiMap.set(d.leadId, d);
    }
  }

  const leads = leadsData?.leads || [];

  const activeThreats = threats?.filter(t => t.severe || t.probSevere >= 40) || [];
  const leadsInPath = new Set<string>();
  activeThreats.forEach(t => t.affectedLeads?.forEach(al => leadsInPath.add(al.leadId)));

  const pendingQueue = responseQueue?.filter(q => q.status === "pending") || [];

  const priorityLeads = leads
    .filter(l => leadsInPath.has(l.id) || (roiMap.get(l.id)?.roiScore || 0) > 10)
    .sort((a, b) => {
      const aInPath = leadsInPath.has(a.id) ? 1000 : 0;
      const bInPath = leadsInPath.has(b.id) ? 1000 : 0;
      const aRoi = roiMap.get(a.id)?.roiScore || 0;
      const bRoi = roiMap.get(b.id)?.roiScore || 0;
      return (bInPath + bRoi) - (aInPath + aRoi);
    })
    .slice(0, 15);

  const projectedStormRevenue = activeThreats.reduce((sum, t) => {
    return sum + (t.affectedLeads?.length || 0) * 28500 * 0.09;
  }, 0);

  const sigCount = hailData?.radarSignatures?.length || 0;
  const alertCount = hailData?.alerts?.length || 0;
  const threatCount = threats?.length || 0;

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [32.78, -96.80],
      zoom: 10,
      zoomControl: false,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const zipLayer = L.layerGroup().addTo(map);
    const threatLayer = L.layerGroup().addTo(map);
    const hailLayer = L.layerGroup().addTo(map);
    const alertLayer = L.layerGroup().addTo(map);
    const swathLayer = L.layerGroup().addTo(map);
    const footprintLayer = L.layerGroup().addTo(map);

    zipLayerRef.current = zipLayer;
    threatLayerRef.current = threatLayer;
    hailLayerRef.current = hailLayer;
    alertLayerRef.current = alertLayer;
    swathLayerRef.current = swathLayer;
    footprintLayerRef.current = footprintLayer;

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !leads.length) return;

    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    leads.forEach(lead => {
      if (!lead.latitude || !lead.longitude) return;
      const decision = roiMap.get(lead.id);
      const icon = decision ? createMarkerIcon(decision.decisionType) : createDefaultIcon(lead.leadScore || 0);
      const marker = L.marker([lead.latitude, lead.longitude], { icon })
        .addTo(map)
        .on("click", () => setSelectedLead(lead));
      markersRef.current.push(marker);
    });
  }, [leads, roiDecisions]);

  useEffect(() => {
    const layer = zipLayerRef.current;
    if (!layer || !zipTiles) return;
    layer.clearLayers();

    zipTiles.forEach(tile => {
      if (!tile.boundingBox) return;
      const { minLat, maxLat, minLng, maxLng } = tile.boundingBox;
      const bounds: L.LatLngBoundsExpression = [[minLat, minLng], [maxLat, maxLng]];
      const color = getZipTileColor(tile.zipScore);

      const rect = L.rectangle(bounds, {
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.15,
        dashArray: "4 2",
      });

      rect.bindPopup(`
        <div style="min-width:200px">
          <strong>ZIP ${tile.zipCode}</strong> — Score: <strong>${tile.zipScore}</strong><br/>
          <hr style="margin:4px 0"/>
          <div style="font-size:12px">
            Storm Risk: ${tile.stormRiskScore?.toFixed(0) || 0}<br/>
            Roof Age: ${tile.roofAgeScore?.toFixed(0) || 0}<br/>
            Data Gaps: ${tile.dataGapScore?.toFixed(0) || 0}<br/>
            Value: ${tile.propertyValueScore?.toFixed(0) || 0}<br/>
            Density: ${tile.leadDensityScore?.toFixed(0) || 0}<br/>
          </div>
          <hr style="margin:4px 0"/>
          Leads: ${tile.leadCount} | Spend: $${tile.recommendedSpend}<br/>
          Projected EV: $${tile.projectedEv?.toLocaleString() || 0}
        </div>
      `);

      rect.addTo(layer);
    });
  }, [zipTiles]);

  useEffect(() => {
    const layer = threatLayerRef.current;
    if (!layer || !threats) return;
    layer.clearLayers();

    if (!showThreatForecast) return;

    threats.forEach(threat => {
      if (!threat.severe && threat.probSevere < 30) return;

      const color = getThreatColor(threat.probSevere, threat.severe);

      L.circleMarker([threat.centroidLat, threat.centroidLon], {
        radius: 8,
        color: "white",
        fillColor: color,
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindPopup(`<div style="font-size:12px;">
          <strong>Hail Threat Center</strong><br/>
          ${threat.placeName ? `Near: ${threat.placeName}<br/>` : ""}
          Max Size: ${threat.maxSizeIN}"<br/>
          Prob Severe: ${threat.probSevere}%<br/>
          ${threat.severe ? "<strong style='color:#dc2626;'>SEVERE HAIL</strong><br/>" : ""}
          ${threat.stormMotionMPH ? `Moving: ${threat.stormMotionMPH} MPH<br/>` : ""}
          Affected Leads: ${threat.affectedLeads?.length || 0}
        </div>`)
        .addTo(layer);

      if (threat.threatPolygons) {
        threat.threatPolygons.forEach((tp, i) => {
          if (tp.polygon && tp.polygon.length >= 3) {
            const opacity = Math.max(0.05, 0.25 - (i * 0.03));
            const weight = i === 0 ? 3 : 1.5;

            const polygon = L.polygon(tp.polygon, {
              color,
              fillColor: color,
              fillOpacity: opacity,
              weight,
              dashArray: i > 0 ? "4 4" : undefined,
            });

            const time = new Date(tp.dateTimeISO).toLocaleTimeString();
            polygon.bindPopup(`<div style="font-size:12px;">
              <strong>Hail Threat Forecast</strong><br/>
              Step ${i + 1} of ${threat.threatPolygons.length}<br/>
              Time: ${time}<br/>
              Max Size: ${threat.maxSizeIN}"<br/>
              Prob Severe: ${threat.probSevere}%<br/>
              ${threat.severe ? "<strong style='color:#dc2626;'>SEVERE</strong><br/>" : ""}
              ${threat.affectedLeads.length} leads in path
            </div>`);

            polygon.addTo(layer);
          }
        });
      }

      if (threat.forecastPath && threat.forecastPath.length > 1) {
        L.polyline(threat.forecastPath, {
          color,
          weight: 3,
          dashArray: "10 6",
          opacity: 0.8,
        }).addTo(layer);

        const arrowEnd = threat.forecastPath[threat.forecastPath.length - 1];
        L.circleMarker(arrowEnd, {
          radius: 5,
          fillColor: color,
          fillOpacity: 1,
          color: "white",
          weight: 2,
        }).addTo(layer);
      }
    });
  }, [threats, showThreatForecast]);

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

    if (showAlertNws) {
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
    }
  }, [hailData, showHailTracker, showAlertNws]);

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
    if (!footprintLayerRef.current) return;
    footprintLayerRef.current.clearLayers();

    if (!showFootprints || !leads.length || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    const bounds = map.getBounds();
    const zoom = map.getZoom();

    if (zoom < 14) return;

    const visibleLeads = leads.filter(l =>
      l.latitude && l.longitude &&
      bounds.contains([l.latitude, l.longitude])
    );

    const uncachedIds = visibleLeads
      .filter(l => !footprintCacheRef.current.has(l.id))
      .map(l => l.id)
      .slice(0, 50);

    const renderCached = () => {
      if (!footprintLayerRef.current) return;
      for (const lead of visibleLeads) {
        const fp = footprintCacheRef.current.get(lead.id);
        if (!fp?.found || !fp.polygon || fp.polygon.length < 3) continue;

        const latlngs = fp.polygon.map((c: number[]) => [c[1], c[0]] as [number, number]);
        const poly = L.polygon(latlngs, {
          color: "#f59e0b",
          weight: 2,
          fillColor: "#f59e0b",
          fillOpacity: 0.15,
          dashArray: "4 4",
        });
        poly.bindPopup(
          `<div style="font-size:12px;">
            <strong>${lead.address}</strong><br/>
            Roof Area: ${fp.roofAreaSqft?.toLocaleString() || "N/A"} sqft<br/>
            Source: ${fp.source || "OpenStreetMap"}
          </div>`
        );
        footprintLayerRef.current!.addLayer(poly);
      }
    };

    renderCached();

    if (uncachedIds.length > 0) {
      setFootprintLoading(true);
      fetch("/api/building-footprints/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: uncachedIds }),
      })
        .then(r => r.json())
        .then((data: Record<string, any>) => {
          for (const [id, fp] of Object.entries(data)) {
            footprintCacheRef.current.set(id, fp);
          }
          footprintLayerRef.current?.clearLayers();
          renderCached();
        })
        .catch(() => {})
        .finally(() => setFootprintLoading(false));
    }
  }, [leads, showFootprints]);

  useEffect(() => {
    if (!mapInstanceRef.current || !showFootprints) return;

    const handler = () => {
      if (!footprintLayerRef.current || !leads.length) return;
      footprintLayerRef.current.clearLayers();

      const map = mapInstanceRef.current!;
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (zoom < 14) return;

      const visibleLeads = leads.filter(l =>
        l.latitude && l.longitude &&
        bounds.contains([l.latitude, l.longitude])
      );

      const uncachedIds = visibleLeads
        .filter(l => !footprintCacheRef.current.has(l.id))
        .map(l => l.id)
        .slice(0, 50);

      for (const lead of visibleLeads) {
        const fp = footprintCacheRef.current.get(lead.id);
        if (!fp?.found || !fp.polygon || fp.polygon.length < 3) continue;

        const latlngs = fp.polygon.map((c: number[]) => [c[1], c[0]] as [number, number]);
        const poly = L.polygon(latlngs, {
          color: "#f59e0b",
          weight: 2,
          fillColor: "#f59e0b",
          fillOpacity: 0.15,
          dashArray: "4 4",
        });
        poly.bindPopup(`<div style="font-size:12px;"><strong>${lead.address}</strong><br/>Roof: ${fp.roofAreaSqft?.toLocaleString() || "N/A"} sqft</div>`);
        footprintLayerRef.current!.addLayer(poly);
      }

      if (uncachedIds.length > 0) {
        setFootprintLoading(true);
        fetch("/api/building-footprints/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadIds: uncachedIds }),
        })
          .then(r => r.json())
          .then((data: Record<string, any>) => {
            for (const [id, fp] of Object.entries(data)) {
              footprintCacheRef.current.set(id, fp);
            }
            footprintLayerRef.current?.clearLayers();
            const bds = map.getBounds();
            for (const lead of leads.filter(l => l.latitude && l.longitude && bds.contains([l.latitude, l.longitude]))) {
              const f = footprintCacheRef.current.get(lead.id);
              if (!f?.found || !f.polygon || f.polygon.length < 3) continue;
              const ll = f.polygon.map((c: number[]) => [c[1], c[0]] as [number, number]);
              const p = L.polygon(ll, { color: "#f59e0b", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.15, dashArray: "4 4" });
              p.bindPopup(`<div style="font-size:12px;"><strong>${lead.address}</strong><br/>Roof: ${f.roofAreaSqft?.toLocaleString() || "N/A"} sqft</div>`);
              footprintLayerRef.current!.addLayer(p);
            }
          })
          .catch(() => {})
          .finally(() => setFootprintLoading(false));
      }
    };

    mapInstanceRef.current.on("moveend", handler);
    return () => { mapInstanceRef.current?.off("moveend", handler); };
  }, [leads, showFootprints]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: text });
  }, [toast]);

  const selectedDecision = selectedLead ? roiMap.get(selectedLead.id) : null;

  return (
    <>
      <Helmet>
        <title>Hail Chaser | RoofIntel</title>
        <meta name="description" content="Real-time storm tracking and lead response for commercial roofing" />
      </Helmet>
      <div className="flex h-[calc(100vh-3rem)] relative" data-testid="hail-chaser-page">
        {sidebarOpen && (
          <div className="w-80 flex-shrink-0 bg-background border-r flex flex-col h-full z-10">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CloudLightning className="w-5 h-5 text-purple-500" />
                <h2 className="text-sm font-semibold">Hail Chaser</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} data-testid="button-close-sidebar">
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Card className="p-2 text-center">
                    <div className="text-lg font-bold text-purple-600" data-testid="text-active-threats">{xweatherStatus?.activeThreats || activeThreats.length}</div>
                    <div className="text-[10px] text-muted-foreground">Active Threats</div>
                  </Card>
                  <Card className="p-2 text-center">
                    <div className="text-lg font-bold text-orange-600" data-testid="text-active-storms">{activeRuns?.length || 0}</div>
                    <div className="text-[10px] text-muted-foreground">Active Storms</div>
                  </Card>
                  <Card className="p-2 text-center">
                    <div className="text-lg font-bold text-red-600" data-testid="text-leads-in-path">{leadsInPath.size}</div>
                    <div className="text-[10px] text-muted-foreground">Leads in Path</div>
                  </Card>
                  <Card className="p-2 text-center">
                    <div className="text-lg font-bold text-blue-600" data-testid="text-pending-calls">{pendingQueue.length}</div>
                    <div className="text-[10px] text-muted-foreground">Pending Calls</div>
                  </Card>
                </div>

                <Collapsible open={monitorControlsOpen} onOpenChange={setMonitorControlsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between text-xs" data-testid="button-toggle-monitors">
                      <span className="flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5" />
                        Monitor Controls
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${stormStatus?.running ? "bg-emerald-500" : "bg-gray-400"}`} />
                        <div className={`w-1.5 h-1.5 rounded-full ${xweatherStatus?.running ? "bg-emerald-500" : "bg-gray-400"}`} />
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${monitorControlsOpen ? "rotate-180" : ""}`} />
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-2">
                    <Card className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">NOAA Radar</span>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${stormStatus?.running ? "bg-emerald-500" : "bg-gray-400"}`} />
                          <span className="text-[10px] text-muted-foreground">{stormStatus?.running ? "Active" : "Off"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {stormStatus?.running ? (
                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => stopMonitor.mutate()} disabled={stopMonitor.isPending} data-testid="button-stop-noaa">
                            <Square className="w-3 h-3 mr-1" />Stop
                          </Button>
                        ) : (
                          <Button size="sm" className="flex-1 text-xs" onClick={() => startMonitor.mutate()} disabled={startMonitor.isPending} data-testid="button-start-noaa">
                            <Play className="w-3 h-3 mr-1" />Start
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => scanNow.mutate()} disabled={scanNow.isPending} data-testid="button-scan-noaa">
                          <RefreshCw className={`w-3 h-3 ${scanNow.isPending ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </Card>
                    <Card className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Xweather Prediction</span>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${xweatherStatus?.running ? "bg-emerald-500" : "bg-gray-400"}`} />
                          <span className="text-[10px] text-muted-foreground">
                            {xweatherStatus?.running ? "Active" : xweatherStatus?.configured ? "Off" : "N/A"}
                          </span>
                        </div>
                      </div>
                      {xweatherStatus?.configured ? (
                        <div className="flex items-center gap-1.5">
                          {xweatherStatus?.running ? (
                            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => stopXweather.mutate()} disabled={stopXweather.isPending} data-testid="button-stop-xweather">
                              <Square className="w-3 h-3 mr-1" />Stop
                            </Button>
                          ) : (
                            <Button size="sm" className="flex-1 text-xs" onClick={() => startXweather.mutate()} disabled={startXweather.isPending} data-testid="button-start-xweather">
                              <Play className="w-3 h-3 mr-1" />Start
                            </Button>
                          )}
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => scanXweather.mutate()} disabled={scanXweather.isPending} data-testid="button-scan-xweather">
                            <RefreshCw className={`w-3 h-3 ${scanXweather.isPending ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">API keys needed</p>
                      )}
                      {xweatherStatus?.lastFetchedAt && (
                        <p className="text-[10px] text-muted-foreground">
                          Last: {new Date(xweatherStatus.lastFetchedAt).toLocaleTimeString()}
                        </p>
                      )}
                    </Card>
                  </CollapsibleContent>
                </Collapsible>

                {activeThreats.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active Storms</h3>
                    <div className="space-y-1.5">
                      {activeThreats.slice(0, 5).map(threat => (
                        <Card key={threat.id} className="p-2 cursor-pointer hover-elevate" data-testid={`card-threat-${threat.id}`}
                          onClick={() => {
                            mapInstanceRef.current?.setView([threat.centroidLat, threat.centroidLon], 12);
                          }}>
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                              <span className="text-xs font-medium">{threat.placeName || "Storm Cell"}</span>
                            </div>
                            <Badge variant="destructive" className="text-[10px]">
                              {threat.maxSizeIN}"
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {threat.affectedLeads?.length || 0} leads | {threat.probSevere}% severe
                            {threat.stormMotionMPH && ` | ${threat.stormMotionMPH} mph`}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Priority Response Queue
                    {pendingQueue.length > 0 && <span className="ml-1 text-muted-foreground">({pendingQueue.length})</span>}
                  </h3>
                  <div className="space-y-1.5">
                    {pendingQueue.length === 0 && priorityLeads.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No priority leads right now</p>
                    )}
                    {pendingQueue.length > 0 ? (
                      pendingQueue.slice(0, 15).map((item, idx) => {
                        const isPredicted = item.stormRun?.status === "predicted";
                        return (
                          <Card
                            key={item.id}
                            className="p-2 cursor-pointer hover-elevate"
                            onClick={() => {
                              if (item.lead) {
                                setSelectedLead(item.lead);
                                if (item.lead.latitude && item.lead.longitude) {
                                  mapInstanceRef.current?.setView([item.lead.latitude, item.lead.longitude], 15);
                                }
                              }
                            }}
                            data-testid={`card-queue-item-${item.id}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium truncate">{item.lead?.address || "Unknown"}</div>
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {item.lead?.ownerName} · {item.lead?.city}
                                  {item.distanceMiles != null && ` · ${item.distanceMiles}mi`}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span className="text-[10px] font-semibold">P{item.priority}</span>
                                {isPredicted && <Zap className="w-2.5 h-2.5 text-muted-foreground" />}
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-1 mt-1.5">
                              <div className="flex items-center gap-1">
                                {(item.lead?.ownerPhone || item.lead?.contactPhone) && (
                                  <a
                                    href={`tel:${item.lead?.contactPhone || item.lead?.ownerPhone}`}
                                    className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`link-call-${item.id}`}
                                  >
                                    <Phone className="w-2.5 h-2.5" />
                                    {item.lead?.contactPhone || item.lead?.ownerPhone}
                                  </a>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[10px] px-1.5"
                                  onClick={(e) => { e.stopPropagation(); markCalled.mutate(item.id); }}
                                  disabled={markCalled.isPending}
                                  data-testid={`button-mark-called-${item.id}`}
                                >
                                  <CheckCircle className="w-2.5 h-2.5 mr-0.5" />
                                  Called
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] px-1.5"
                                  onClick={(e) => { e.stopPropagation(); markSkipped.mutate(item.id); }}
                                  disabled={markSkipped.isPending}
                                  data-testid={`button-mark-skipped-${item.id}`}
                                >
                                  Skip
                                </Button>
                              </div>
                            </div>
                          </Card>
                        );
                      })
                    ) : (
                      priorityLeads.map(lead => {
                        const decision = roiMap.get(lead.id);
                        const inPath = leadsInPath.has(lead.id);
                        return (
                          <Card
                            key={lead.id}
                            className={`p-2 cursor-pointer ${selectedLead?.id === lead.id ? "ring-2 ring-primary" : "hover-elevate"}`}
                            onClick={() => {
                              setSelectedLead(lead);
                              if (lead.latitude && lead.longitude) {
                                mapInstanceRef.current?.setView([lead.latitude, lead.longitude], 15);
                              }
                            }}
                            data-testid={`card-priority-lead-${lead.id}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium truncate">{lead.address}</div>
                                <div className="text-[10px] text-muted-foreground">{lead.city}</div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {inPath && (
                                  <Badge variant="destructive" className="text-[10px]">STORM</Badge>
                                )}
                                {decision && (
                                  <Badge className={`text-[10px] ${getTierBg(decision.decisionType)}`}>
                                    {decision.decisionType}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {lead.ownerPhone && (
                                <button
                                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(lead.ownerPhone!); }}
                                  data-testid={`button-copy-phone-${lead.id}`}
                                >
                                  <Phone className="w-2.5 h-2.5" />
                                  {lead.ownerPhone}
                                </button>
                              )}
                              {!lead.ownerPhone && (
                                <span className="text-[10px] text-muted-foreground">No phone</span>
                              )}
                            </div>
                          </Card>
                        );
                      })
                    )}
                  </div>
                </div>

                <Collapsible open={alertConfigOpen} onOpenChange={setAlertConfigOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between text-xs" data-testid="button-toggle-alert-config">
                      <span className="flex items-center gap-1.5">
                        <Settings2 className="w-3.5 h-3.5" />
                        Alert Configuration
                      </span>
                      <div className="flex items-center gap-1.5">
                        {configs && configs.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">{configs.length} rules</span>
                        )}
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${alertConfigOpen ? "rotate-180" : ""}`} />
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Storm alert rules</span>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setShowCreate(!showCreate)} data-testid="button-new-config">
                        <Plus className="w-3 h-3 mr-0.5" />New
                      </Button>
                    </div>

                    {showCreate && (
                      <Card className="p-3 space-y-3">
                        <h4 className="text-xs font-semibold">Create Alert Rule</h4>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label className="text-[10px]">Rule Name</Label>
                            <Input
                              value={newName}
                              onChange={(e) => setNewName(e.target.value)}
                              placeholder="e.g., Sales Team DFW"
                              className="text-xs"
                              data-testid="input-config-name"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px]">Min Hail (in)</Label>
                              <Input
                                type="number"
                                value={newMinHailSize}
                                onChange={(e) => setNewMinHailSize(e.target.value)}
                                placeholder="1.0"
                                min="0.5"
                                max="5"
                                step="0.25"
                                className="text-xs"
                                data-testid="input-min-hail-size"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px]">Min Severe %</Label>
                              <Input
                                type="number"
                                value={newMinProbSevere}
                                onChange={(e) => setNewMinProbSevere(e.target.value)}
                                placeholder="40"
                                min="10"
                                max="100"
                                step="5"
                                className="text-xs"
                                data-testid="input-min-prob-severe"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <Switch checked={newSms} onCheckedChange={setNewSms} data-testid="switch-sms" />
                              <Label className="text-[10px]">SMS</Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Switch checked={newEmail} onCheckedChange={setNewEmail} data-testid="switch-email" />
                              <Label className="text-[10px]">Email</Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Switch checked={newPredictiveAlerts} onCheckedChange={setNewPredictiveAlerts} data-testid="switch-predictive" />
                              <Label className="text-[10px]">Pre-Storm</Label>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px]">Recipients</Label>
                            <div className="flex items-center gap-1.5">
                              <select
                                value={recipientType}
                                onChange={(e) => setRecipientType(e.target.value as "sms" | "email")}
                                className="h-8 rounded-md border bg-background px-2 text-xs"
                                data-testid="select-recipient-type"
                              >
                                <option value="sms">SMS</option>
                                <option value="email">Email</option>
                              </select>
                              <Input
                                value={recipientValue}
                                onChange={(e) => setRecipientValue(e.target.value)}
                                placeholder={recipientType === "sms" ? "+1234567890" : "team@co.com"}
                                className="flex-1 text-xs"
                                data-testid="input-recipient-value"
                                onKeyDown={(e) => e.key === "Enter" && addRecipient()}
                              />
                              <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={addRecipient} data-testid="button-add-recipient">Add</Button>
                            </div>
                            {newRecipients.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-1">
                                {newRecipients.map((r, i) => (
                                  <Badge key={i} variant="secondary" className="gap-0.5 text-[10px]">
                                    {r.type === "sms" ? <Phone className="w-2.5 h-2.5" /> : <Mail className="w-2.5 h-2.5" />}
                                    {r.value}
                                    <button onClick={() => setNewRecipients(newRecipients.filter((_, j) => j !== i))} className="ml-0.5 opacity-60 hover:opacity-100">x</button>
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            <Button size="sm" className="text-xs" onClick={() => createConfig.mutate()} disabled={createConfig.isPending || newRecipients.length === 0} data-testid="button-save-config">
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
                          </div>
                        </div>
                      </Card>
                    )}

                    {configsLoading ? (
                      <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
                    ) : !configs || configs.length === 0 ? (
                      <Card className="p-4 text-center">
                        <Shield className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                        <p className="text-xs text-muted-foreground">No alert rules configured.</p>
                      </Card>
                    ) : (
                      configs.map((config) => {
                        const recipients = (config.recipients as Array<{ type: string; value: string }>) || [];
                        return (
                          <Card key={config.id} className="p-2" data-testid={`card-config-${config.id}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium truncate">{config.name}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {config.minHailSize}" · {config.minProbSevere || 40}%
                                  {config.notifySms && " · SMS"}
                                  {config.notifyEmail && " · Email"}
                                </div>
                                {recipients.length > 0 && (
                                  <div className="flex gap-1 flex-wrap mt-1">
                                    {recipients.map((r, i) => (
                                      <span key={i} className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                        {r.type === "sms" ? <Phone className="w-2 h-2" /> : <Mail className="w-2 h-2" />}
                                        {r.value}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
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
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </Card>
                        );
                      })
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ScrollArea>
          </div>
        )}

        <div className="flex-1 relative">
          <div ref={mapRef} className="w-full h-full" data-testid="hail-chaser-map" />

          {!sidebarOpen && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-3 left-3 z-[1000] shadow-md"
              onClick={() => setSidebarOpen(true)}
              data-testid="button-open-sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}

          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1.5 flex-wrap justify-center">
            <Button
              variant={showThreatForecast ? "default" : "outline"}
              size="sm"
              className="shadow-md bg-background/90 backdrop-blur-sm text-xs"
              onClick={() => setShowThreatForecast(!showThreatForecast)}
              data-testid="button-toggle-forecast"
            >
              <Zap className="w-3 h-3 mr-1" />
              Forecast
              {showThreatForecast && threatCount > 0 && (
                <span className="ml-1 text-[10px] opacity-70">{threatCount}</span>
              )}
            </Button>
            <Button
              variant={showSwathZones ? "default" : "outline"}
              size="sm"
              className="shadow-md bg-background/90 backdrop-blur-sm text-xs"
              onClick={() => setShowSwathZones(!showSwathZones)}
              data-testid="button-toggle-zones"
            >
              <CloudLightning className="w-3 h-3 mr-1" />
              Zones
              {showSwathZones && stormRuns && stormRuns.length > 0 && (
                <span className="ml-1 text-[10px] opacity-70">{stormRuns.length}</span>
              )}
            </Button>
            <Button
              variant={showHailTracker ? "default" : "outline"}
              size="sm"
              className="shadow-md bg-background/90 backdrop-blur-sm text-xs"
              onClick={() => setShowHailTracker(!showHailTracker)}
              data-testid="button-toggle-tracker"
            >
              <Radar className="w-3 h-3 mr-1" />
              Tracker
              {showHailTracker && sigCount > 0 && (
                <span className="ml-1 text-[10px] opacity-70">{sigCount}</span>
              )}
            </Button>
            <Button
              variant={showFootprints ? "default" : "outline"}
              size="sm"
              className="shadow-md bg-background/90 backdrop-blur-sm text-xs"
              onClick={() => setShowFootprints(!showFootprints)}
              data-testid="button-toggle-roofs"
            >
              <Building2 className="w-3 h-3 mr-1" />
              Roofs
              {footprintLoading && (
                <RefreshCw className="w-3 h-3 ml-1 animate-spin" />
              )}
            </Button>
            <Button
              variant={showAlertNws ? "default" : "outline"}
              size="sm"
              className="shadow-md bg-background/90 backdrop-blur-sm text-xs"
              onClick={() => setShowAlertNws(!showAlertNws)}
              data-testid="button-toggle-alerts"
            >
              <AlertTriangle className="w-3 h-3 mr-1" />
              Alerts
              {showAlertNws && alertCount > 0 && (
                <span className="ml-1 text-[10px] opacity-70">{alertCount}</span>
              )}
            </Button>
            {showHailTracker && (
              <Select value={daysBack} onValueChange={setDaysBack}>
                <SelectTrigger className="w-[100px] shadow-md bg-background/90 backdrop-blur-sm text-xs" data-testid="select-days-back">
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
          </div>

          <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-background/90 backdrop-blur-sm text-[10px] px-2 py-1">
              {leads.length.toLocaleString()} leads
            </Badge>
            {stormStatus?.running && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur-sm text-[10px] px-2 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
                NOAA Active
              </Badge>
            )}
            {xweatherStatus?.running && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur-sm text-[10px] px-2 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse mr-1" />
                Xweather Active
              </Badge>
            )}
            {showFootprints && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur-sm text-[10px] px-2 py-1">
                <Building2 className="w-3 h-3 mr-1" />
                Zoom 14+ for roofs
              </Badge>
            )}
          </div>

          {(showHailTracker || (showThreatForecast && threatCount > 0)) && (
            <div className="absolute bottom-3 right-3 z-[1000] bg-background/90 backdrop-blur-sm rounded-md p-2 text-[10px] text-muted-foreground space-y-1">
              {showThreatForecast && threatCount > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">Forecast:</span>
                  <div className="flex items-center gap-0.5"><div className="w-2 h-2 rounded-full bg-purple-600" /><span>Severe</span></div>
                  <div className="flex items-center gap-0.5"><div className="w-2 h-2 rounded-full bg-red-600" /><span>High</span></div>
                  <div className="flex items-center gap-0.5"><div className="w-2 h-2 rounded-full bg-orange-500" /><span>Mod</span></div>
                </div>
              )}
              {showHailTracker && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">Radar:</span>
                  <div className="flex items-center gap-0.5"><div className="w-2 h-2 rounded-full bg-red-600" /><span>50%+</span></div>
                  <div className="flex items-center gap-0.5"><div className="w-2 h-2 rounded-full bg-orange-500" /><span>25%+</span></div>
                  <div className="flex items-center gap-0.5"><div className="w-2 h-2 rounded-full bg-blue-400" /><span>Pos</span></div>
                  {hailLoading && <span className="animate-pulse">Loading...</span>}
                  {hailData && !hailLoading && <span>{sigCount} detections</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedLead && (
          <div className="w-80 flex-shrink-0 bg-background border-l flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold truncate flex-1">{selectedLead.address}</h3>
              <Button variant="ghost" size="icon" onClick={() => setSelectedLead(null)} data-testid="button-close-detail">
                <X className="w-4 h-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground">Owner</div>
                  <div className="text-sm font-medium">{selectedLead.ownerName}</div>
                  <div className="text-xs text-muted-foreground mt-1">{selectedLead.city}, {selectedLead.state} {selectedLead.zipCode}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Lead Score</div>
                    <div className="text-lg font-bold">{selectedLead.leadScore}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">ROI Tier</div>
                    {selectedDecision ? (
                      <Badge className={`text-xs mt-0.5 ${getTierBg(selectedDecision.decisionType)}`}>
                        {selectedDecision.decisionType} ({selectedDecision.roiScore?.toFixed(1)}x)
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not scored</span>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Sqft</div>
                    <div className="text-sm font-medium">{selectedLead.sqft?.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Hail Hits</div>
                    <div className="text-sm font-medium">{selectedLead.hailEvents || 0}</div>
                  </div>
                </div>

                {selectedDecision && (
                  <Card className="bg-accent/30">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="text-[10px] text-muted-foreground uppercase font-semibold">ROI Analysis</div>
                      <div className="flex justify-between text-xs">
                        <span>Expected Value</span>
                        <span className="font-medium">${selectedDecision.expectedValue?.toFixed(0)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Enrichment Cost</span>
                        <span className="font-medium">${selectedDecision.enrichmentCost?.toFixed(2)}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{selectedDecision.reasonSummary}</div>
                      {selectedDecision.recommendedApis?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedDecision.recommendedApis.map(api => (
                            <Badge key={api} variant="outline" className="text-[9px] px-1">{api}</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2">
                  <div className="text-[10px] text-muted-foreground uppercase font-semibold">Contact Info</div>
                  {selectedLead.ownerPhone && (
                    <button
                      className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline w-full"
                      onClick={() => copyToClipboard(selectedLead.ownerPhone!)}
                      data-testid="button-copy-detail-phone"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      {selectedLead.ownerPhone}
                      <Copy className="w-3 h-3 ml-auto opacity-50" />
                    </button>
                  )}
                  {selectedLead.ownerEmail && (
                    <button
                      className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline w-full"
                      onClick={() => copyToClipboard(selectedLead.ownerEmail!)}
                      data-testid="button-copy-detail-email"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      {selectedLead.ownerEmail}
                      <Copy className="w-3 h-3 ml-auto opacity-50" />
                    </button>
                  )}
                  {selectedLead.contactName && (
                    <div className="text-xs text-muted-foreground">
                      Contact: {selectedLead.contactName} {selectedLead.contactTitle && `(${selectedLead.contactTitle})`}
                    </div>
                  )}
                  {!selectedLead.ownerPhone && !selectedLead.ownerEmail && (
                    <p className="text-xs text-muted-foreground">No contact info available</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Link href={`/leads/${selectedLead.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs" data-testid="link-view-full-detail">
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />
                      Full Detail
                    </Button>
                  </Link>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </>
  );
}
