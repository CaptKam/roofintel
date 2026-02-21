import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  CloudLightning,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Play,
  Activity,
  Globe,
  Upload,
  FileSpreadsheet,
  Download,
  Building2,
  UserSearch,
  Phone,
  Search,
  Radar,
  ShieldAlert,
} from "lucide-react";
import type { Market, ImportRun, Job, DataSource } from "@shared/schema";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleString();
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case "failed":
    case "error":
      return <XCircle className="w-4 h-4 text-destructive" />;
    case "running":
      return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

export default function DataManagement() {
  const { toast } = useToast();
  const [dcadMinValue, setDcadMinValue] = useState("100000");
  const [dcadMinSqft, setDcadMinSqft] = useState("0");
  const [dcadMaxRecords, setDcadMaxRecords] = useState("5000");

  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const { data: importRuns, isLoading: runsLoading } = useQuery<ImportRun[]>({
    queryKey: ["/api/import/runs"],
    refetchInterval: 5000,
  });

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 5000,
  });

  const { data: dataSources } = useQuery<DataSource[]>({
    queryKey: ["/api/data-sources"],
  });

  const noaaImportMutation = useMutation({
    mutationFn: async ({ marketId, startYear, endYear }: { marketId: string; startYear: number; endYear: number }) => {
      const res = await apiRequest("POST", "/api/import/noaa", { marketId, startYear, endYear });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "NOAA import started", description: "Fetching real hail event data from NOAA. This may take a minute." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/hail-events"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      }, 5000);
    },
    onError: () => {
      toast({ title: "Import failed", description: "Could not start NOAA data import.", variant: "destructive" });
    },
  });

  const hailCorrelationMutation = useMutation({
    mutationFn: async ({ marketId, radiusMiles }: { marketId: string; radiusMiles?: number }) => {
      const res = await apiRequest("POST", "/api/correlate/hail", { marketId, radiusMiles });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Hail correlation started", description: "Matching hail events to nearby properties. Scores will update shortly." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      }, 10000);
    },
    onError: () => {
      toast({ title: "Correlation failed", description: "Could not start hail proximity matching.", variant: "destructive" });
    },
  });

  const dcadImportMutation = useMutation({
    mutationFn: async ({ marketId, minImpValue, maxRecords, minSqft }: { marketId: string; minImpValue?: number; maxRecords?: number; minSqft?: number }) => {
      const res = await apiRequest("POST", "/api/import/dcad", { marketId, minImpValue, maxRecords, minSqft });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "DCAD import started", description: "Fetching commercial property data from Dallas County. This may take a few minutes." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      }, 10000);
    },
    onError: () => {
      toast({ title: "Import failed", description: "Could not start DCAD property import.", variant: "destructive" });
    },
  });

  const { data: enrichmentStatus } = useQuery<{ configured: boolean; apiKeySet: boolean }>({
    queryKey: ["/api/enrichment/status"],
  });

  const { data: phoneStatus } = useQuery<{
    providers: { name: string; available: boolean }[];
    totalAvailable: number;
  }>({
    queryKey: ["/api/enrichment/phone-status"],
  });

  const { data: webResearchStatus } = useQuery<{
    googlePlacesAvailable: boolean;
    serperAvailable: boolean;
    capabilities: string[];
  }>({
    queryKey: ["/api/enrichment/web-research-status"],
  });

  const phoneEnrichMutation = useMutation({
    mutationFn: async ({ marketId, batchSize }: { marketId: string; batchSize?: number }) => {
      const res = await apiRequest("POST", "/api/enrichment/phones", { marketId, batchSize });
      return res.json();
    },
    onSuccess: (data: any) => {
      const providerNames = data.providers?.join(", ") || "available sources";
      toast({ title: "Phone enrichment started", description: `Searching ${providerNames} for business phone numbers.` });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
      }, 15000);
    },
    onError: (err: any) => {
      const message = err?.message || "Could not start phone enrichment.";
      toast({ title: "Phone enrichment failed", description: message, variant: "destructive" });
    },
  });

  const webResearchMutation = useMutation({
    mutationFn: async ({ marketId, batchSize }: { marketId: string; batchSize?: number }) => {
      const res = await apiRequest("POST", "/api/enrichment/web-research", { marketId, batchSize });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Web research agent started", description: "Scanning business websites for facility managers and contact details." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
      }, 15000);
    },
    onError: (err: any) => {
      const message = err?.message || "Could not start web research.";
      toast({ title: "Web research failed", description: message, variant: "destructive" });
    },
  });

  const storyEstimateMutation = useMutation({
    mutationFn: async ({ marketId }: { marketId: string }) => {
      const res = await apiRequest("POST", "/api/leads/estimate-stories", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Story estimation complete", description: `Updated ${data.updated} leads with estimated story counts. ${data.unchanged} unchanged.` });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Story estimation failed", description: err?.message || "Could not estimate stories.", variant: "destructive" });
    },
  });

  const roofTypeEstimateMutation = useMutation({
    mutationFn: async ({ marketId }: { marketId: string }) => {
      const res = await apiRequest("POST", "/api/leads/estimate-roof-type", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Roof type estimation complete", description: `Roof types: ${data.roofTypesUpdated} updated. Construction types: ${data.constructionTypesUpdated} updated. ${data.unchanged} unchanged.` });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Roof type estimation failed", description: err?.message || "Could not estimate roof types.", variant: "destructive" });
    },
  });

  const ownershipFlagMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/flag-ownership", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      const b = data.breakdown || {};
      toast({ title: "Ownership flagging complete", description: `${data.flagged} leads flagged: ${b.deepHolding || 0} deep holdings, ${b.multiLayer || 0} multi-layer, ${b.corpShield || 0} corp shields.` });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Ownership flagging failed", description: err?.message || "Could not flag ownership structures.", variant: "destructive" });
    },
  });

  const { data: roofingStats } = useQuery<{
    totalRoofingPermits: number;
    matchedToLeads: number;
    byYear: { year: string; count: number }[];
    topContractors: { name: string; count: number }[];
  }>({
    queryKey: ["/api/permits/roofing-stats"],
  });

  const roofingPermitMutation = useMutation({
    mutationFn: async ({ marketId, yearsBack }: { marketId: string; yearsBack?: number }) => {
      const res = await apiRequest("POST", "/api/permits/import-roofing", { marketId, yearsBack: yearsBack ?? 10, commercialOnly: false });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Roofing permit import complete",
        description: `Imported ${data.imported} roofing permits (${data.skipped} duplicates skipped). ${data.matched} matched to leads.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/permits/roofing-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Roofing permit import failed", description: err?.message || "Could not import roofing permits.", variant: "destructive" });
    },
  });

  const scanRoofingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/scan-roofing-permits", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Roofing permit scan complete",
        description: `Found ${data.totalRoofingPermits} roofing permits, updated ${data.leadsUpdated} leads with roof type and contractor info.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/permits/roofing-stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Roofing permit scan failed", description: err?.message || "Could not scan roofing permits.", variant: "destructive" });
    },
  });

  const { data: pipelineStats, isLoading: pipelineLoading } = useQuery<{
    total: number;
    withOwner: number;
    withTxFilingData: number;
    withPhone: number;
    withBusinessWebsite: number;
    withContactPerson: number;
    withEmail: number;
    fullyEnriched: number;
    contactConfidence: { high: number; medium: number; low: number; none: number };
  }>({
    queryKey: ["/api/enrichment/pipeline-stats"],
    refetchInterval: 10000,
  });

  const pipelineMutation = useMutation({
    mutationFn: async ({ marketId, batchSize }: { marketId: string; batchSize?: number }) => {
      const res = await apiRequest("POST", "/api/enrichment/run-pipeline", { marketId, batchSize });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Full pipeline started", description: "Running TX Filing -> Phone Lookup -> Web Research sequentially. This may take several minutes." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/enrichment/pipeline-stats"] });
      }, 30000);
    },
    onError: (err: any) => {
      toast({ title: "Pipeline failed", description: err?.message || "Could not start enrichment pipeline.", variant: "destructive" });
    },
  });

  const contactEnrichMutation = useMutation({
    mutationFn: async ({ marketId, batchSize }: { marketId: string; batchSize?: number }) => {
      const res = await apiRequest("POST", "/api/enrichment/contacts", { marketId, batchSize });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contact enrichment started", description: "Looking up owner details via Texas Open Data Portal. Results will appear shortly." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
      }, 15000);
    },
    onError: (err: any) => {
      const message = err?.message || "Could not start contact enrichment.";
      toast({ title: "Enrichment failed", description: message, variant: "destructive" });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);

  const csvUploadMutation = useMutation({
    mutationFn: async ({ file, marketId }: { file: File; marketId: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("marketId", marketId);
      formData.append("minSqft", "2000");
      const res = await fetch("/api/import/property-csv", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setUploadResult(data);
      toast({
        title: "Property import complete",
        description: `${data.imported} properties imported, ${data.skipped} skipped`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && dfwMarket) {
      csvUploadMutation.mutate({ file, marketId: dfwMarket.id });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const currentYear = new Date().getFullYear();
  const dfwMarket = markets?.[0];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Data Management</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect real data sources and manage background agents
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Active Markets
            </CardTitle>
          </CardHeader>
          <CardContent>
            {marketsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                {markets?.map((market) => (
                  <div
                    key={market.id}
                    className="flex items-center justify-between gap-2 p-3 rounded-md border"
                    data-testid={`market-${market.id}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{market.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {market.counties.join(", ")} counties
                      </p>
                    </div>
                    <Badge variant={market.isActive ? "default" : "secondary"}>
                      {market.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                ))}
                {(!markets || markets.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No markets configured</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CloudLightning className="w-4 h-4" />
              NOAA Hail Data Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Import real hail storm event data from NOAA Storm Events Database.
              Data includes event date, location, hail size, and source.
            </p>
            {dataSources?.filter((ds) => ds.type === "noaa_hail").map((ds) => (
              <div key={ds.id} className="text-xs text-muted-foreground">
                Last fetched: {formatDate(ds.lastFetchedAt as any)}
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => dfwMarket && noaaImportMutation.mutate({
                  marketId: dfwMarket.id,
                  startYear: currentYear,
                  endYear: currentYear,
                })}
                disabled={noaaImportMutation.isPending || !dfwMarket}
                data-testid="button-import-noaa-current"
              >
                {noaaImportMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Import {currentYear}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dfwMarket && noaaImportMutation.mutate({
                  marketId: dfwMarket.id,
                  startYear: currentYear - 5,
                  endYear: currentYear,
                })}
                disabled={noaaImportMutation.isPending || !dfwMarket}
                data-testid="button-import-noaa-5yr"
              >
                Import Last 5 Years
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dfwMarket && hailCorrelationMutation.mutate({
                  marketId: dfwMarket.id,
                  radiusMiles: 5,
                })}
                disabled={hailCorrelationMutation.isPending || !dfwMarket}
                data-testid="button-correlate-hail"
              >
                {hailCorrelationMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Activity className="w-3 h-3 mr-1" />
                )}
                Match to Leads
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radar className="w-4 h-4" />
              Live Hail Tracker
            </CardTitle>
            <Badge variant="default" className="text-[10px]">Live Radar</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Real-time NEXRAD radar hail detections and NWS severe weather alerts for
              the DFW region. View live data on the Map View page.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href="/map">
                <Button size="sm" data-testid="button-open-hail-map">
                  <Radar className="w-3 h-3 mr-1" />
                  Open Map with Hail Tracker
                </Button>
              </Link>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Sources: NOAA SWDI (NEXRAD L3 hail signatures), NWS Alerts API</p>
              <p>Coverage: 50-mile radius around DFW center</p>
              <p>Data is fetched live and not stored — no database cost.</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              DCAD Property Agent
            </CardTitle>
            <Badge variant="default" className="text-[10px]">Live API</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Fetch real commercial property data from Dallas Central Appraisal District
              via ArcGIS REST API. Already-imported properties are automatically skipped (no reprocessing costs).
            </p>
            {dataSources?.filter((ds) => ds.type === "dcad_api").map((ds) => (
              <div key={ds.id} className="text-xs text-muted-foreground">
                Last fetched: {formatDate(ds.lastFetchedAt as any)}
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="dcad-min-value" className="text-xs text-muted-foreground">Min Building Value</Label>
                <Input
                  id="dcad-min-value"
                  type="number"
                  value={dcadMinValue}
                  onChange={(e) => setDcadMinValue(e.target.value)}
                  placeholder="100000"
                  data-testid="input-dcad-min-value"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dcad-min-sqft" className="text-xs text-muted-foreground">Min Sq Ft</Label>
                <Input
                  id="dcad-min-sqft"
                  type="number"
                  value={dcadMinSqft}
                  onChange={(e) => setDcadMinSqft(e.target.value)}
                  placeholder="0"
                  data-testid="input-dcad-min-sqft"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dcad-max-records" className="text-xs text-muted-foreground">Max Records</Label>
                <Input
                  id="dcad-max-records"
                  type="number"
                  value={dcadMaxRecords}
                  onChange={(e) => setDcadMaxRecords(e.target.value)}
                  placeholder="5000"
                  data-testid="input-dcad-max-records"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => dfwMarket && dcadImportMutation.mutate({
                  marketId: dfwMarket.id,
                  minImpValue: parseInt(dcadMinValue) || 100000,
                  maxRecords: parseInt(dcadMaxRecords) || 5000,
                  minSqft: parseInt(dcadMinSqft) || 0,
                })}
                disabled={dcadImportMutation.isPending || !dfwMarket}
                data-testid="button-import-dcad"
              >
                {dcadImportMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Building2 className="w-3 h-3 mr-1" />
                )}
                Import Properties
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Duplicates are automatically skipped - only new properties are added.
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Contact Enrichment Pipeline
            </CardTitle>
            <Button
              size="sm"
              onClick={() => dfwMarket && pipelineMutation.mutate({
                marketId: dfwMarket.id,
                batchSize: 25,
              })}
              disabled={pipelineMutation.isPending || !dfwMarket}
              data-testid="button-run-pipeline"
            >
              {pipelineMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Play className="w-3 h-3 mr-1" />
              )}
              Run Full Pipeline
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Automated 3-stage enrichment: TX Filing Lookup, Phone Number Discovery, Web Research for Decision-Makers.
            </p>
            {pipelineLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : pipelineStats ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  {[
                    { label: "Total Leads", value: pipelineStats.total, color: "text-foreground" },
                    { label: "Owner Known", value: pipelineStats.withOwner, color: "text-foreground" },
                    { label: "TX Filing Data", value: pipelineStats.withTxFilingData, color: "text-blue-600 dark:text-blue-400" },
                    { label: "Has Phone", value: pipelineStats.withPhone, color: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Business Website", value: pipelineStats.withBusinessWebsite, color: "text-violet-600 dark:text-violet-400" },
                    { label: "Decision-Maker", value: pipelineStats.withContactPerson, color: "text-amber-600 dark:text-amber-400" },
                    { label: "Has Email", value: pipelineStats.withEmail, color: "text-rose-600 dark:text-rose-400" },
                    { label: "Fully Enriched", value: pipelineStats.fullyEnriched, color: "text-emerald-600 dark:text-emerald-400" },
                  ].map((item) => (
                    <div key={item.label} className="text-center" data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <p className={`text-lg font-semibold ${item.color}`}>{item.value.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 pt-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Contact Confidence:</span>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs">High: {pipelineStats.contactConfidence.high}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-xs">Medium: {pipelineStats.contactConfidence.medium}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-orange-500" />
                    <span className="text-xs">Low: {pipelineStats.contactConfidence.low}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                    <span className="text-xs">None: {pipelineStats.contactConfidence.none}</span>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <UserSearch className="w-4 h-4" />
              Contact Enrichment
            </CardTitle>
            <Badge variant="default" className="text-[10px]">
              Free Data Source
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Enrich LLC/Corp owner contacts via Texas Open Data Portal.
              Finds taxpayer addresses, SOS file numbers, and filing status.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => dfwMarket && contactEnrichMutation.mutate({
                  marketId: dfwMarket.id,
                  batchSize: 50,
                })}
                disabled={contactEnrichMutation.isPending || !dfwMarket}
                data-testid="button-enrich-contacts"
              >
                {contactEnrichMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <UserSearch className="w-3 h-3 mr-1" />
                )}
                Enrich Contacts (50)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dfwMarket && contactEnrichMutation.mutate({
                  marketId: dfwMarket.id,
                  batchSize: 500,
                })}
                disabled={contactEnrichMutation.isPending || !dfwMarket}
                data-testid="button-enrich-contacts-all"
              >
                Enrich All Leads
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Phone className="w-4 h-4" />
              Phone Number Enrichment
            </CardTitle>
            <Badge variant={phoneStatus?.totalAvailable ? "default" : "secondary"} className="text-[10px]">
              {phoneStatus?.totalAvailable || 0} Provider{(phoneStatus?.totalAvailable || 0) !== 1 ? "s" : ""} Active
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Cascading phone lookup: tries Google Places, OpenCorporates, and web search in order.
              Stops at first match to minimize cost.
            </p>
            {phoneStatus?.providers && (
              <div className="space-y-1">
                {phoneStatus.providers.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-2" data-testid={`phone-provider-${p.name}`}>
                    <span className="text-xs text-muted-foreground">{p.name}</span>
                    <Badge variant={p.available ? "default" : "outline"} className="text-[10px]">
                      {p.available ? "Ready" : "Needs API Key"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => dfwMarket && phoneEnrichMutation.mutate({
                  marketId: dfwMarket.id,
                  batchSize: 50,
                })}
                disabled={phoneEnrichMutation.isPending || !dfwMarket || !phoneStatus?.totalAvailable}
                data-testid="button-enrich-phones"
              >
                {phoneEnrichMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Phone className="w-3 h-3 mr-1" />
                )}
                Find Phones (50)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dfwMarket && phoneEnrichMutation.mutate({
                  marketId: dfwMarket.id,
                  batchSize: 500,
                })}
                disabled={phoneEnrichMutation.isPending || !dfwMarket || !phoneStatus?.totalAvailable}
                data-testid="button-enrich-phones-all"
              >
                Find All Phones
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Search className="w-4 h-4" />
              Web Research Agent
            </CardTitle>
            <Badge variant={webResearchStatus?.googlePlacesAvailable ? "default" : "secondary"} className="text-[10px]">
              {webResearchStatus?.googlePlacesAvailable ? "Active" : "Needs API Key"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Scans business websites to find facility managers, property managers, and decision-makers.
              Extracts their phone numbers and emails from staff directories and contact pages.
            </p>
            {webResearchStatus?.capabilities && (
              <div className="space-y-1">
                {webResearchStatus.capabilities.map((cap) => (
                  <div key={cap} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    <span className="text-xs text-muted-foreground">{cap}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => dfwMarket && webResearchMutation.mutate({
                  marketId: dfwMarket.id,
                  batchSize: 25,
                })}
                disabled={webResearchMutation.isPending || !dfwMarket || !webResearchStatus?.googlePlacesAvailable}
                data-testid="button-web-research"
              >
                {webResearchMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Search className="w-3 h-3 mr-1" />
                )}
                Research 25 Leads
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dfwMarket && webResearchMutation.mutate({
                  marketId: dfwMarket.id,
                  batchSize: 100,
                })}
                disabled={webResearchMutation.isPending || !dfwMarket || !webResearchStatus?.googlePlacesAvailable}
                data-testid="button-web-research-all"
              >
                Research 100 Leads
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Property Data Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload county appraisal district CSV files to import commercial properties.
              Auto-detects column headers. Filters by minimum 2,000 sqft for commercial leads.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-csv-file"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={csvUploadMutation.isPending || !dfwMarket}
                data-testid="button-upload-csv"
              >
                {csvUploadMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                Upload CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open("/api/import/sample-csv", "_blank")}
                data-testid="button-download-sample"
              >
                <Download className="w-3 h-3 mr-1" />
                Sample CSV
              </Button>
            </div>
            {uploadResult && (
              <div className="p-3 rounded-md border space-y-1" data-testid="upload-result">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-medium">Import Complete</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {uploadResult.imported} imported, {uploadResult.skipped} skipped, {uploadResult.errors} errors
                  ({uploadResult.totalRows} total rows)
                </p>
                {uploadResult.errorMessages?.length > 0 && (
                  <p className="text-xs text-destructive">{uploadResult.errorMessages.slice(0, 3).join("; ")}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Building & Roof Intelligence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Estimates building stories, roof type, and construction type using property characteristics.
              Roof types are inferred from year built (when available), building size, improvement value, and zoning.
              Construction types estimated from zoning, stories, and size (industrial: tilt-wall/metal, high-rise: steel frame).
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => dfwMarket && storyEstimateMutation.mutate({ marketId: dfwMarket.id })}
                disabled={storyEstimateMutation.isPending || !dfwMarket}
                data-testid="button-estimate-stories"
              >
                {storyEstimateMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Building2 className="w-3 h-3 mr-1" />
                )}
                Estimate Stories
              </Button>
              <Button
                size="sm"
                onClick={() => dfwMarket && roofTypeEstimateMutation.mutate({ marketId: dfwMarket.id })}
                disabled={roofTypeEstimateMutation.isPending || !dfwMarket}
                data-testid="button-estimate-roof-type"
              >
                {roofTypeEstimateMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Building2 className="w-3 h-3 mr-1" />
                )}
                Estimate Roof & Construction Types
              </Button>
              <Button
                size="sm"
                onClick={() => ownershipFlagMutation.mutate()}
                disabled={ownershipFlagMutation.isPending}
                data-testid="button-flag-ownership"
              >
                {ownershipFlagMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <ShieldAlert className="w-3 h-3 mr-1" />
                )}
                Flag Holding Companies
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Search className="w-4 h-4" />
            Roofing Permit History (10 Years)
          </CardTitle>
          {roofingStats && (
            <Badge variant="secondary" data-testid="badge-roofing-permit-count">
              {roofingStats.totalRoofingPermits.toLocaleString()} permits
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Pulls roofing-specific permits from Dallas Open Data going back 10 years. Identifies which properties have had roof work done,
            who the contractor was, and what type of roofing system was installed (TPO, EPDM, shingle, metal, etc.).
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => dfwMarket && roofingPermitMutation.mutate({ marketId: dfwMarket.id, yearsBack: 10 })}
              disabled={roofingPermitMutation.isPending || !dfwMarket}
              data-testid="button-import-roofing-permits"
            >
              {roofingPermitMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Download className="w-3 h-3 mr-1" />
              )}
              Import Roofing Permits (10yr)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => scanRoofingMutation.mutate()}
              disabled={scanRoofingMutation.isPending}
              data-testid="button-scan-roofing-permits"
            >
              {scanRoofingMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Search className="w-3 h-3 mr-1" />
              )}
              Scan & Match to Leads
            </Button>
          </div>
          {roofingStats && roofingStats.totalRoofingPermits > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md border">
                  <p className="text-xs text-muted-foreground">Total Roofing Permits</p>
                  <p className="text-lg font-semibold" data-testid="text-total-roofing-permits">{roofingStats.totalRoofingPermits.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-md border">
                  <p className="text-xs text-muted-foreground">Matched to Leads</p>
                  <p className="text-lg font-semibold" data-testid="text-matched-roofing-permits">{roofingStats.matchedToLeads.toLocaleString()}</p>
                </div>
              </div>
              {roofingStats.byYear.length > 0 && (
                <div className="p-3 rounded-md border">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Permits by Year</p>
                  <div className="flex flex-wrap gap-2">
                    {roofingStats.byYear.slice(0, 12).map((y) => (
                      <div key={y.year} className="text-xs px-2 py-1 bg-muted rounded">
                        <span className="font-medium">{y.year}</span>: {y.count.toLocaleString()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {roofingStats.topContractors.length > 0 && (
                <div className="p-3 rounded-md border">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Top Roofing Contractors</p>
                  <div className="space-y-1">
                    {roofingStats.topContractors.slice(0, 5).map((c, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="truncate max-w-[250px]">{c.name}</span>
                        <Badge variant="secondary" className="text-xs">{c.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Background Agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs && jobs.length > 0 ? (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-md border"
                  data-testid={`job-${job.id}`}
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon status={job.status} />
                    <div>
                      <p className="text-sm font-medium">
                        {job.name === "noaa_hail_sync" ? "NOAA Hail Data Sync" : 
                         job.name === "lead_score_recalc" ? "Lead Score Recalculation" : job.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Schedule: {job.schedule || "Manual"} | Last run: {formatDate(job.lastRunAt as any)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={job.isActive ? "default" : "secondary"} className="text-[10px]">
                      {job.isActive ? "Active" : "Paused"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {job.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Background agents will appear here once configured
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="w-4 h-4" />
            Import History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : importRuns && importRuns.length > 0 ? (
            <div className="space-y-2">
              {importRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-md border"
                  data-testid={`import-run-${run.id}`}
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon status={run.status} />
                    <div>
                      <p className="text-sm font-medium">
                        {run.type === "noaa_hail" ? "NOAA Hail Import" :
                         run.type === "property_csv" ? "Property CSV Import" :
                         run.type === "dcad_api" ? "DCAD Property Import" :
                         run.type === "contact_enrichment" ? "Contact Enrichment" :
                         run.type === "phone_enrichment" ? "Phone Enrichment" : run.type}
                        {(run.metadata as any)?.year && ` (${(run.metadata as any).year})`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(run.startedAt as any)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {run.recordsImported !== null && run.recordsImported! > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {run.recordsImported} imported
                      </Badge>
                    )}
                    {run.recordsSkipped !== null && run.recordsSkipped! > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {run.recordsSkipped} skipped
                      </Badge>
                    )}
                    <Badge variant={run.status === "completed" ? "default" : run.status === "failed" ? "destructive" : "outline"} className="text-[10px]">
                      {run.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No import runs yet. Use the import buttons above to fetch real data.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
