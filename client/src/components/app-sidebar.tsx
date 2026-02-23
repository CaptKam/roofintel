import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Building2, MapPin, Flame, Zap, Radio, Settings, ChevronRight, Network, Share2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMarket } from "@/hooks/use-market";

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", icon: Building2 },
  { title: "Portfolios", url: "/portfolios", icon: Network },
  { title: "Network", url: "/network", icon: Share2 },
  { title: "Hot Leads", url: "/leads?minScore=80", icon: Flame },
  { title: "Map & Storms", url: "/map", icon: MapPin },
];

const toolsNav = [
  { title: "Admin", url: "/admin", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { markets, activeMarket, setActiveMarketId } = useMarket();

  const { data: monitorStatus } = useQuery<{ running: boolean }>({
    queryKey: ["/api/storm/status"],
    refetchInterval: 30000,
  });

  const { data: xweatherStatus } = useQuery<{ running: boolean; configured: boolean; activeThreats: number }>({
    queryKey: ["/api/xweather/status"],
    refetchInterval: 30000,
  });

  return (
    <Sidebar>
      <SidebarHeader className="px-5 pt-6 pb-4">
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
              <Building2 className="w-[18px] h-[18px] text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-sidebar-foreground tracking-tight">RoofIntel</h1>
              <p className="text-[11px] text-sidebar-foreground/50 font-medium">Lead Intelligence</p>
            </div>
          </div>
        </Link>
        {markets.length > 0 && (
          <div className="mt-4">
            <Select value={activeMarket?.id || ""} onValueChange={setActiveMarketId}>
              <SelectTrigger className="h-9 text-xs font-medium bg-sidebar-accent border-sidebar-border rounded-lg" data-testid="select-market">
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent>
                {markets.map((market) => (
                  <SelectItem key={market.id} value={market.id}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="px-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/35 text-[10px] font-semibold uppercase tracking-[0.1em] px-2 mb-1">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => {
                const isActive = item.url === "/"
                  ? location === "/"
                  : item.url.includes("?")
                    ? location === item.url.split("?")[0] && window.location.search === "?" + item.url.split("?")[1]
                    : location.startsWith(item.url) && !window.location.search;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className="h-9 rounded-lg transition-all duration-150"
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                        <item.icon className="w-[18px] h-[18px]" />
                        <span className="text-[13px] font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/35 text-[10px] font-semibold uppercase tracking-[0.1em] px-2 mb-1">System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith(item.url)}
                    className="h-9 rounded-lg transition-all duration-150"
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-[18px] h-[18px]" />
                      <span className="text-[13px] font-medium">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-5 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-medium text-sidebar-foreground/60">NOAA Live</span>
            </div>
            {monitorStatus?.running && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-[11px] font-medium text-sidebar-foreground/60">Storm Watch</span>
              </div>
            )}
            {xweatherStatus?.running && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                <span className="text-[11px] font-medium text-sidebar-foreground/60">
                  Prediction{(xweatherStatus?.activeThreats || 0) > 0 && ` (${xweatherStatus?.activeThreats})`}
                </span>
              </div>
            )}
          </div>
          {activeMarket && (
            <p className="text-[10px] text-sidebar-foreground/35 font-medium">{activeMarket.name}</p>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
