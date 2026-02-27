import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Maximize2, Minimize2, Layers, Satellite, Map as MapIcon, Clock, ScanSearch, ArrowRight, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface RoofIntelligenceProps {
  leadId: string;
  latitude: number;
  longitude: number;
  address: string;
  existingRoofArea?: number | null;
  yearBuilt?: number | null;
  roofMaterial?: string | null;
  roofType?: string | null;
  roofLastReplaced?: number | null;
}

interface FootprintData {
  found: boolean;
  polygon?: number[][];
  roofAreaSqft?: number;
  source?: string;
  cached?: boolean;
  message?: string;
}

interface NAIPSnapshot {
  id: string;
  lead_id: string;
  capture_year: number;
  capture_date: string;
  mean_brightness: number;
  mean_r: number;
  mean_g: number;
  mean_b: number;
  std_brightness: number;
  color_class: string;
  color_stats: any;
}

interface NAIPChange {
  id: string;
  lead_id: string;
  estimated_year: number;
  confidence: number;
  change_type: string;
  brightness_delta: number;
  from_color: string;
  to_color: string;
  from_year: number;
  to_year: number;
  applied: boolean;
}

interface NAIPHistory {
  leadId: string;
  snapshots: NAIPSnapshot[];
  changes: NAIPChange[];
  hasData: boolean;
}

function colorClassToHex(colorClass: string): string {
  switch (colorClass) {
    case "dark": return "#374151";
    case "medium": return "#9ca3af";
    case "light": return "#d1d5db";
    case "white": return "#f3f4f6";
    default: return "#6b7280";
  }
}

function colorClassLabel(colorClass: string): string {
  switch (colorClass) {
    case "dark": return "Dark (BUR/EPDM)";
    case "medium": return "Medium";
    case "light": return "Light";
    case "white": return "White (TPO/PVC)";
    default: return colorClass;
  }
}

function changeTypeLabel(type: string): string {
  switch (type) {
    case "dark_to_white_reroof": return "Dark → White Reroof";
    case "medium_to_white_reroof": return "Medium → White Reroof";
    case "dark_to_light": return "Dark → Light";
    case "light_to_dark": return "Light → Dark";
    case "moderate_change": return "Moderate Change";
    case "color_shift": return "Color Shift";
    default: return type;
  }
}

function confidenceBadge(confidence: number) {
  if (confidence >= 70) return <Badge className="bg-green-600 text-white text-[10px]" data-testid="badge-confidence-high">{confidence}%</Badge>;
  if (confidence >= 40) return <Badge className="bg-yellow-500 text-white text-[10px]" data-testid="badge-confidence-medium">{confidence}%</Badge>;
  return <Badge variant="secondary" className="text-[10px]" data-testid="badge-confidence-low">{confidence}%</Badge>;
}

export function RoofIntelligence({
  leadId,
  latitude,
  longitude,
  address,
  existingRoofArea,
  yearBuilt,
  roofMaterial,
  roofType,
  roofLastReplaced,
}: RoofIntelligenceProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showSatellite, setShowSatellite] = useState(true);

  const { data: footprint, isLoading } = useQuery<FootprintData>({
    queryKey: ["/api/leads", leadId, "building-footprint"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/building-footprint`);
      if (!res.ok) throw new Error("Failed to fetch footprint");
      return res.json();
    },
  });

  const { data: naipHistory, isLoading: naipLoading } = useQuery<NAIPHistory>({
    queryKey: ["/api/leads", leadId, "naip-history"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/naip-history`);
      if (!res.ok) throw new Error("Failed to fetch NAIP history");
      return res.json();
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/naip-analyze`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "naip-history"] });
    },
  });

  useEffect(() => {
    if (!mapRef.current || !latitude || !longitude) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapRef.current, {
      center: [latitude, longitude],
      zoom: 18,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    const satelliteTiles = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
        maxZoom: 20,
      }
    );

    const streetTiles = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }
    );

    if (showSatellite) {
      satelliteTiles.addTo(map);
    } else {
      streetTiles.addTo(map);
    }

    L.marker([latitude, longitude], {
      icon: L.divIcon({
        className: "custom-marker",
        html: `<div style="width:10px;height:10px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
    }).addTo(map);

    if (footprint?.found && footprint.polygon && footprint.polygon.length > 0) {
      const latlngs = footprint.polygon.map(coord => [coord[1], coord[0]] as [number, number]);
      const poly = L.polygon(latlngs, {
        color: "#f59e0b",
        weight: 2,
        fillColor: "#f59e0b",
        fillOpacity: 0.2,
        dashArray: "4 4",
      }).addTo(map);

      poly.bindPopup(
        `<div style="font-family:Inter,sans-serif;font-size:12px;">
          <strong>Building Footprint</strong><br/>
          Roof Area: ${footprint.roofAreaSqft?.toLocaleString() || "N/A"} sqft<br/>
          Source: ${footprint.source || "OpenStreetMap"}
        </div>`
      );

      map.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 19 });
    }

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [latitude, longitude, footprint, showSatellite, expanded]);

  const roofAge = yearBuilt ? new Date().getFullYear() - yearBuilt : null;
  const displayArea = footprint?.roofAreaSqft || existingRoofArea;

  const bestChange = naipHistory?.changes?.[0];
  const hasNaipDetection = bestChange && bestChange.confidence >= 30;
  const naipApplied = bestChange && bestChange.applied;

  let ageSourceLabel = "Year Built";
  if (roofLastReplaced && roofLastReplaced !== yearBuilt) {
    ageSourceLabel = "Record";
  }
  if (hasNaipDetection && naipApplied) {
    ageSourceLabel = `Satellite Imagery (${bestChange.estimated_year})`;
  }

  return (
    <Card className="shadow-sm overflow-hidden" data-testid="card-roof-intelligence">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Satellite className="w-4 h-4 text-primary" />
            Roof Intelligence
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowSatellite(!showSatellite)}
              data-testid="button-toggle-satellite"
            >
              {showSatellite ? <MapIcon className="w-3 h-3 mr-1" /> : <Satellite className="w-3 h-3 mr-1" />}
              {showSatellite ? "Street" : "Satellite"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setExpanded(!expanded)}
              data-testid="button-expand-map"
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <Skeleton className={`w-full ${expanded ? "h-96" : "h-56"}`} />
        ) : (
          <div
            ref={mapRef}
            className={`w-full ${expanded ? "h-96" : "h-56"} transition-all duration-300`}
            data-testid="map-roof-satellite"
          />
        )}

        <div className="px-4 py-3 border-t space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Roof Area</span>
              <span className="font-medium" data-testid="text-roof-area">
                {displayArea ? `${displayArea.toLocaleString()} sqft` : "—"}
              </span>
              {footprint?.found && footprint.roofAreaSqft && (
                <Badge variant="outline" className="text-[10px] ml-1 px-1 py-0" data-testid="badge-footprint-source">
                  GIS
                </Badge>
              )}
            </div>
            <div>
              <span className="text-muted-foreground block">Roof Age</span>
              <span className="font-medium" data-testid="text-roof-age">
                {roofLastReplaced
                  ? `${new Date().getFullYear() - roofLastReplaced} yrs`
                  : roofAge
                    ? `${roofAge} yrs (from build)`
                    : "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Material</span>
              <span className="font-medium" data-testid="text-roof-material">
                {roofMaterial || "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Age Source</span>
              <span className="font-medium" data-testid="text-roof-age-source">
                {ageSourceLabel}
              </span>
              {hasNaipDetection && (
                <Badge variant="outline" className="text-[10px] ml-1 px-1 py-0 border-blue-500 text-blue-600">
                  NAIP
                </Badge>
              )}
            </div>
          </div>

          {footprint?.found && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-1">
              <Layers className="w-3 h-3" />
              <span>Building footprint from {footprint.source || "OpenStreetMap"}</span>
              {footprint.cached && <Badge variant="secondary" className="text-[9px] px-1 py-0">cached</Badge>}
            </div>
          )}
          {footprint && !footprint.found && (
            <div className="text-[10px] text-muted-foreground pt-1">
              No building footprint available for this location
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold flex items-center gap-1.5" data-testid="heading-roof-history">
              <Clock className="w-3.5 h-3.5 text-primary" />
              NAIP Roof History
            </h4>
            {!naipHistory?.hasData && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                data-testid="button-analyze-naip"
              >
                <ScanSearch className="w-3 h-3 mr-1" />
                {analyzeMutation.isPending ? "Analyzing..." : "Analyze Imagery"}
              </Button>
            )}
          </div>

          {naipLoading ? (
            <div className="flex gap-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-20 rounded" />)}
            </div>
          ) : naipHistory?.hasData ? (
            <div className="space-y-3">
              <div className="flex gap-2 overflow-x-auto pb-2" data-testid="timeline-naip-snapshots">
                {naipHistory.snapshots.map((snap, idx) => {
                  const isChangeYear = bestChange &&
                    snap.capture_year >= bestChange.from_year &&
                    snap.capture_year <= bestChange.to_year;
                  const isDetectionYear = bestChange &&
                    snap.capture_year === bestChange.to_year;

                  return (
                    <div key={snap.id} className="flex flex-col items-center gap-1 flex-shrink-0" data-testid={`snapshot-year-${snap.capture_year}`}>
                      <div
                        className={`w-16 h-16 rounded-md border-2 flex items-center justify-center relative ${
                          isDetectionYear
                            ? "border-amber-500 ring-2 ring-amber-200"
                            : isChangeYear
                              ? "border-blue-400"
                              : "border-border"
                        }`}
                        style={{
                          background: `rgb(${snap.mean_r}, ${snap.mean_g}, ${snap.mean_b})`,
                        }}
                      >
                        {isDetectionYear && (
                          <div className="absolute -top-1.5 -right-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 fill-amber-100" />
                          </div>
                        )}
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                          snap.mean_brightness > 140 ? "bg-black/20 text-black" : "bg-white/30 text-white"
                        }`}>
                          B:{Math.round(snap.mean_brightness)}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium" data-testid={`text-snapshot-year-${snap.capture_year}`}>
                        {snap.capture_year}
                      </span>
                      <span className="text-[9px] text-muted-foreground capitalize">
                        {snap.color_class}
                      </span>
                      {idx < naipHistory.snapshots.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-muted-foreground absolute" style={{ display: "none" }} />
                      )}
                    </div>
                  );
                })}
              </div>

              {hasNaipDetection && bestChange && (
                <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1.5" data-testid="section-change-detection">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">Change Detected</span>
                    {confidenceBadge(bestChange.confidence)}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded border"
                      style={{ backgroundColor: colorClassToHex(bestChange.from_color) }}
                      title={colorClassLabel(bestChange.from_color)}
                    />
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <div
                      className="w-5 h-5 rounded border"
                      style={{ backgroundColor: colorClassToHex(bestChange.to_color) }}
                      title={colorClassLabel(bestChange.to_color)}
                    />
                    <span className="text-muted-foreground ml-1">
                      {changeTypeLabel(bestChange.change_type)}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Between {bestChange.from_year} – {bestChange.to_year}
                    {bestChange.estimated_year && (
                      <span> · Est. replacement: <strong className="text-foreground">{bestChange.estimated_year}</strong></span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    Brightness delta: {bestChange.brightness_delta > 0 ? "+" : ""}{bestChange.brightness_delta.toFixed(1)}
                    {naipApplied && (
                      <Badge className="ml-2 text-[9px] bg-green-600 text-white">Applied to Lead</Badge>
                    )}
                  </div>
                </div>
              )}

              {!hasNaipDetection && naipHistory.snapshots.length >= 2 && (
                <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
                  No significant roof changes detected across {naipHistory.snapshots.length} NAIP capture years.
                  The roof color has remained consistent.
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground" data-testid="text-no-naip-data">
              {analyzeMutation.isPending ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
                  Fetching NAIP satellite imagery (2012–2022)...
                </div>
              ) : analyzeMutation.isSuccess ? (
                <span>Analysis complete. Refresh to see results.</span>
              ) : (
                <span>Click "Analyze Imagery" to fetch NAIP satellite data for this property.</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
