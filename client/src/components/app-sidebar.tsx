import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Building2, MapPin, CloudLightning, Download, Database, Flame, Zap, Bell, Radio, Radar, Fingerprint, Shield } from "lucide-react";
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

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", icon: Building2 },
  { title: "Hot Leads", url: "/leads?minScore=80", icon: Flame },
  { title: "Map View", url: "/map", icon: MapPin },
  { title: "Hail Events", url: "/hail", icon: CloudLightning },
  { title: "Owner Intel", url: "/intelligence", icon: Fingerprint },
];

const stormNav = [
  { title: "Storm Response", url: "/storm", icon: Zap },
  { title: "Alert Settings", url: "/alerts", icon: Bell },
];

const toolsNav = [
  { title: "Export", url: "/export", icon: Download },
  { title: "Data Sources", url: "/data", icon: Database },
  { title: "Data Intelligence", url: "/data-intelligence", icon: Shield },
];

export function AppSidebar() {
  const [location] = useLocation();

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
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center">
              <Building2 className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-sidebar-foreground tracking-tight">RoofIntel</h1>
              <p className="text-[10px] text-sidebar-foreground/60 tracking-wider uppercase">Lead Intelligence</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest">Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.url === "/"
                        ? location === "/"
                        : item.url.includes("?")
                          ? location === item.url.split("?")[0] && window.location.search === "?" + item.url.split("?")[1]
                          : location.startsWith(item.url) && !window.location.search
                    }
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest">Storm Center</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {stormNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith(item.url)}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest">Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.startsWith(item.url)}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px]">DFW Region</Badge>
          <Badge variant="default" className="text-[10px]">NOAA Live</Badge>
          {monitorStatus?.running && (
            <Badge variant="default" className="text-[10px]">
              <Radio className="w-2.5 h-2.5 mr-1" />
              Storm Watch
            </Badge>
          )}
          {xweatherStatus?.running && (
            <Badge variant="default" className="text-[10px]">
              <Zap className="w-2.5 h-2.5 mr-1" />
              Prediction
              {(xweatherStatus?.activeThreats || 0) > 0 && ` (${xweatherStatus?.activeThreats})`}
            </Badge>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
