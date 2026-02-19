import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CloudLightning, MapPin, Calendar, Ruler } from "lucide-react";
import type { HailEvent } from "@shared/schema";

export default function HailEvents() {
  const { data: events, isLoading } = useQuery<HailEvent[]>({
    queryKey: ["/api/hail-events"],
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Hail Events</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real storm event data from NOAA Storm Events Database
          </p>
        </div>
        {events && (
          <Badge variant="secondary" data-testid="badge-hail-count">
            {events.length.toLocaleString()} events
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-3 w-24 mb-1" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : events && events.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {events.map((event) => {
            const sizeLabel =
              event.hailSize >= 2 ? "Severe" : event.hailSize >= 1.5 ? "Large" : event.hailSize >= 1 ? "Significant" : "Minor";
            const sizeColor =
              event.hailSize >= 2
                ? "bg-destructive/15 text-destructive"
                : event.hailSize >= 1.5
                  ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
                  : event.hailSize >= 1
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground";

            return (
              <Card key={event.id} data-testid={`card-hail-${event.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <CloudLightning className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">{event.hailSize}" Hail</span>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${sizeColor}`}
                    >
                      {sizeLabel}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {event.eventDate}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" />
                      {event.city ? `${event.city}, ` : ""}{event.county} County
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Ruler className="w-3 h-3" />
                      Source: {event.source}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <CloudLightning className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No hail events recorded</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Events will appear as storm data is processed</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
