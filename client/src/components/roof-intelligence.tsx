import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Maximize2, Minimize2, Layers, Ruler, Satellite, Map as MapIcon } from "lucide-react";
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
              <span className="text-muted-foreground block">Type</span>
              <span className="font-medium" data-testid="text-roof-type">
                {roofType || "—"}
              </span>
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
      </CardContent>
    </Card>
  );
}
