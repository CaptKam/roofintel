import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import { Building2, Ruler, Calendar, CloudLightning, X, Radar } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lead, StormRun } from "@shared/schema";

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

export default function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const hailLayerRef = useRef<L.LayerGroup | null>(null);
  const alertLayerRef = useRef<L.LayerGroup | null>(null);
  const swathLayerRef = useRef<L.LayerGroup | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showHailTracker, setShowHailTracker] = useState(false);
  const [showSwathZones, setShowSwathZones] = useState(true);
  const [daysBack, setDaysBack] = useState("7");

  const { data: leadsData, isLoading } = useQuery<LeadsResponse>({
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

      const polygon = L.polygon(swath.coordinates as [number, number][], {
        color,
        fillColor: color,
        fillOpacity: isRecent ? 0.2 : 0.08,
        weight: isRecent ? 3 : 1.5,
        dashArray: isRecent ? undefined : "6, 4",
      });

      const timeStr = run.detectedAt ? new Date(run.detectedAt).toLocaleString() : "Unknown";
      polygon.bindPopup(
        `<div style="font-size:12px;">
          <strong>Hail Swath Zone</strong><br/>
          Hail Prob: ${run.maxHailProb}%<br/>
          Severe Prob: ${run.maxSevereProb}%<br/>
          Radar Signatures: ${run.radarSignatureCount}<br/>
          Affected Leads: ${run.affectedLeadCount}<br/>
          Detected: ${timeStr}
        </div>`
      );

      swathLayerRef.current.addLayer(polygon);
    }
  }, [stormRuns, showSwathZones]);

  const sigCount = hailData?.radarSignatures?.length || 0;
  const alertCount = hailData?.alerts?.length || 0;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Map View</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {leadsData ? `Top ${leads?.length} of ${leadsData.total.toLocaleString()} properties` : "Loading..."} plotted by score
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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

      {showHailTracker && (
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-4 flex-wrap">
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

      <div className="flex-1 relative">
        {isLoading && (
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
    </div>
  );
}
