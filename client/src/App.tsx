import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { MarketProvider } from "@/hooks/use-market";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Leads from "@/pages/leads";
import LeadDetail from "@/pages/lead-detail";
import MapStorms from "@/pages/map-storms";
import Admin from "@/pages/admin";
import Portfolios from "@/pages/portfolios";
import NetworkExplorer from "@/pages/network-explorer";
import Privacy from "@/pages/privacy";
import About from "@/pages/about";
import Contact from "@/pages/contact";
import Contractors from "@/pages/contractors";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/leads" component={Leads} />
      <Route path="/leads/:id" component={LeadDetail} />
      <Route path="/portfolios" component={Portfolios} />
      <Route path="/network" component={NetworkExplorer} />
      <Route path="/map" component={MapStorms} />
      <Route path="/contractors" component={Contractors} />
      <Route path="/admin" component={Admin} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <HelmetProvider>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MarketProvider>
          <TooltipProvider>
            <SidebarProvider style={style as React.CSSProperties}>
              <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md" data-testid="link-skip-nav">
                Skip to main content
              </a>
              <div className="flex h-screen w-full">
                <AppSidebar />
                <div className="flex flex-col flex-1 min-w-0">
                  <header className="flex items-center justify-between gap-2 h-12 px-4 border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
                    <SidebarTrigger data-testid="button-sidebar-toggle" className="w-8 h-8" />
                    <ThemeToggle />
                  </header>
                  <div className="flex-1 overflow-auto">
                    <Router />
                  </div>
                </div>
              </div>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </MarketProvider>
      </QueryClientProvider>
    </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
