import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import { Building2, Ruler, Calendar, CloudLightning, X } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Lead } from "@shared/schema";

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

export default function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
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

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Map View</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {leads ? `${leads.length} properties` : "Loading..."} plotted by score
          </p>
        </div>
        <div className="flex items-center gap-3">
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
