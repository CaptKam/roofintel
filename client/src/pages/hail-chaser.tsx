import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CloudLightning, Phone, Mail, ExternalLink, ChevronLeft, ChevronRight,
  Zap, AlertTriangle, Target, DollarSign, Building2, X, Copy, ArrowRight
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lead } from "@shared/schema";
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
    distanceMiles: number;
    etaMinutes: number | null;
  }>;
  placeName: string | null;
}

interface ResponseQueueItem {
  id: string;
  leadId: string;
  priority: number;
  status: string;
  lead?: Lead;
}

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

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
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

  const { data: responseQueue } = useQuery<ResponseQueueItem[]>({
    queryKey: ["/api/storm/response-queue?limit=15&status=pending"],
    refetchInterval: 15000,
  });

  const { data: roiDecisions } = useQuery<RoiDecision[]>({
    queryKey: ["/api/admin/roi/decisions", { limit: 2000 }],
    staleTime: 5 * 60 * 1000,
  });

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
    zipLayerRef.current = zipLayer;
    threatLayerRef.current = threatLayer;

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

    threats.forEach(threat => {
      if (!threat.severe && threat.probSevere < 30) return;

      const color = threat.severe ? "#9333ea" : threat.probSevere >= 60 ? "#dc2626" : "#f97316";

      L.circleMarker([threat.centroidLat, threat.centroidLon], {
        radius: 10,
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 2,
      })
        .bindPopup(`<strong>Active Threat</strong><br/>Hail: ${threat.maxSizeIN}" | Prob: ${threat.probSevere}%<br/>Affects ${threat.affectedLeads?.length || 0} leads`)
        .addTo(layer);

      if (threat.threatPolygons) {
        threat.threatPolygons.forEach((tp, i) => {
          if (tp.polygon) {
            L.polygon(tp.polygon, {
              color,
              fillColor: color,
              fillOpacity: Math.max(0.05, 0.3 - i * 0.05),
              weight: 1,
              dashArray: i > 0 ? "4 4" : undefined,
            }).addTo(layer);
          }
        });
      }

      if (threat.forecastPath && threat.forecastPath.length > 1) {
        L.polyline(threat.forecastPath, {
          color,
          weight: 2,
          dashArray: "6 4",
          opacity: 0.7,
        }).addTo(layer);
      }
    });
  }, [threats]);

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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarOpen(false)} data-testid="button-close-sidebar">
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3">
              <Card className="p-2 text-center">
                <div className="text-lg font-bold text-purple-600" data-testid="text-active-threats">{activeThreats.length}</div>
                <div className="text-[10px] text-muted-foreground">Threats</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-lg font-bold text-red-600" data-testid="text-leads-in-path">{leadsInPath.size}</div>
                <div className="text-[10px] text-muted-foreground">In Path</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-lg font-bold text-emerald-600" data-testid="text-storm-revenue">
                  ${projectedStormRevenue >= 1000 ? `${(projectedStormRevenue / 1000).toFixed(0)}k` : projectedStormRevenue.toFixed(0)}
                </div>
                <div className="text-[10px] text-muted-foreground">Revenue</div>
              </Card>
            </div>

            {activeThreats.length > 0 && (
              <div className="px-3 pb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active Storms</h3>
                <div className="space-y-1.5">
                  {activeThreats.slice(0, 5).map(threat => (
                    <Card key={threat.id} className="p-2 cursor-pointer hover:bg-accent/50 transition-colors" data-testid={`card-threat-${threat.id}`}
                      onClick={() => {
                        mapInstanceRef.current?.setView([threat.centroidLat, threat.centroidLon], 12);
                      }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                          <span className="text-xs font-medium">{threat.placeName || "Storm Cell"}</span>
                        </div>
                        <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
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

            <div className="px-3 pb-2 flex-1 overflow-hidden flex flex-col">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Priority Response Queue</h3>
              <ScrollArea className="flex-1">
                <div className="space-y-1.5 pr-2">
                  {priorityLeads.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No priority leads right now</p>
                  )}
                  {priorityLeads.map(lead => {
                    const decision = roiMap.get(lead.id);
                    const inPath = leadsInPath.has(lead.id);
                    return (
                      <Card
                        key={lead.id}
                        className={`p-2 cursor-pointer transition-colors ${selectedLead?.id === lead.id ? "ring-2 ring-primary" : "hover:bg-accent/50"}`}
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
                              <Badge variant="destructive" className="text-[10px] h-4 px-1">STORM</Badge>
                            )}
                            {decision && (
                              <Badge className={`text-[10px] h-4 px-1 ${getTierBg(decision.decisionType)}`}>
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
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="p-3 border-t">
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="w-full text-xs" data-testid="link-pro-mode">
                  <ArrowRight className="w-3.5 h-3.5 mr-1" />
                  Switch to Pro Mode
                </Button>
              </Link>
            </div>
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

          <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2">
            <Badge variant="outline" className="bg-background/90 backdrop-blur-sm text-[10px] px-2 py-1">
              {leads.length.toLocaleString()} leads
            </Badge>
            {stormStatus?.running && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur-sm text-[10px] px-2 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
                Storm Watch Active
              </Badge>
            )}
          </div>
        </div>

        {selectedLead && (
          <div className="w-80 flex-shrink-0 bg-background border-l flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold truncate flex-1">{selectedLead.address}</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => setSelectedLead(null)} data-testid="button-close-detail">
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
                            <Badge key={api} variant="outline" className="text-[9px] h-4 px-1">{api}</Badge>
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
