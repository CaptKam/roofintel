import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertTriangle,
  Shield,
  Droplets,
  FileText,
  ShieldCheck,
  Scale,
  Fingerprint,
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

interface ViolationsStatus {
  totalViolations: number;
  matchedViolations: number;
}

interface PermitsStatus {
  totalPermits: number;
  matchedPermits: number;
}

interface FloodStatus {
  enriched: number;
  total: number;
  highRisk: number;
  zoneDistribution?: Record<string, number>;
}

interface ComplianceStatus {
  granted: number;
  unknown: number;
  dncRegistered: number;
}

export default function Admin() {
  const { toast } = useToast();
  const [dcadMinValue, setDcadMinValue] = useState("100000");
  const [dcadMinSqft, setDcadMinSqft] = useState("0");
  const [dcadMaxRecords, setDcadMaxRecords] = useState("5000");
  const [lastResults, setLastResults] = useState<Record<string, string>>({});

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

  const { data: roofingStats } = useQuery<{
    totalRoofingPermits: number;
    matchedToLeads: number;
    byYear: { year: string; count: number }[];
    topContractors: { name: string; count: number }[];
  }>({
    queryKey: ["/api/permits/roofing-stats"],
  });

  const dfwMarket = markets?.[0];
  const marketId = dfwMarket?.id;

  const { data: violationsStatus, isLoading: violationsLoading } = useQuery<ViolationsStatus>({
    queryKey: ["/api/violations/status"],
    enabled: !!marketId,
  });

  const { data: permitsStatus, isLoading: permitsLoading } = useQuery<PermitsStatus>({
    queryKey: ["/api/permits/status"],
    enabled: !!marketId,
  });

  const { data: floodStatus, isLoading: floodLoading } = useQuery<FloodStatus>({
    queryKey: ["/api/flood/status", marketId],
    queryFn: async () => {
      const res = await fetch(`/api/flood/status?marketId=${marketId}`);
      if (!res.ok) throw new Error("Failed to fetch flood status");
      return res.json();
    },
    enabled: !!marketId,
  });

  const { data: complianceStatus, isLoading: complianceLoading } = useQuery<ComplianceStatus>({
    queryKey: ["/api/compliance/status", marketId],
    queryFn: async () => {
      const res = await fetch(`/api/compliance/status?marketId=${marketId}`);
      if (!res.ok) throw new Error("Failed to fetch compliance status");
      return res.json();
    },
    enabled: !!marketId,
  });

  const currentYear = new Date().getFullYear();

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

  const import311Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/violations/import-311", { marketId, daysBack: 90 });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.imported ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, import311: `${count} records imported` }));
      toast({ title: "Dallas 311 import complete", description: `${count} service requests imported.` });
      queryClient.invalidateQueries({ queryKey: ["/api/violations/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err?.message || "Could not import 311 data.", variant: "destructive" });
    },
  });

  const importCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/violations/import-code", { marketId, daysBack: 365 });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.imported ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, importCode: `${count} records imported` }));
      toast({ title: "Code violations import complete", description: `${count} violations imported.` });
      queryClient.invalidateQueries({ queryKey: ["/api/violations/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err?.message || "Could not import code violations.", variant: "destructive" });
    },
  });

  const matchViolationsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/violations/match", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.matched ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, matchViolations: `${count} matched` }));
      toast({ title: "Violation matching complete", description: `${count} violations matched to leads.` });
      queryClient.invalidateQueries({ queryKey: ["/api/violations/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Matching failed", description: err?.message || "Could not match violations.", variant: "destructive" });
    },
  });

  const importDallasPermitsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/permits/import-dallas", { marketId, commercialOnly: true, daysBack: 3650 });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.imported ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, importDallasPermits: `${count} permits imported` }));
      toast({ title: "Dallas permits import complete", description: `${count} permits imported.` });
      queryClient.invalidateQueries({ queryKey: ["/api/permits/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err?.message || "Could not import Dallas permits.", variant: "destructive" });
    },
  });

  const importFortWorthPermitsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/permits/import-fortworth", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.imported ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, importFortWorthPermits: `${count} permits imported` }));
      toast({ title: "Fort Worth permits import complete", description: `${count} permits imported.` });
      queryClient.invalidateQueries({ queryKey: ["/api/permits/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err?.message || "Could not import Fort Worth permits.", variant: "destructive" });
    },
  });

  const matchPermitsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/permits/match", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.matched ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, matchPermits: `${count} matched` }));
      toast({ title: "Permit matching complete", description: `${count} permits matched to leads.` });
      queryClient.invalidateQueries({ queryKey: ["/api/permits/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Matching failed", description: err?.message || "Could not match permits.", variant: "destructive" });
    },
  });

  const floodEnrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/flood/enrich", { marketId, batchSize: 50 });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.enriched ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, floodEnrich: `${count} leads enriched` }));
      toast({ title: "Flood enrichment complete", description: `${count} leads enriched with FEMA flood data.` });
      queryClient.invalidateQueries({ queryKey: ["/api/flood/status", marketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Enrichment failed", description: err?.message || "Could not enrich flood data.", variant: "destructive" });
    },
  });

  const recalcScoresMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/recalculate-scores", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.updated ?? data.count ?? 0;
      setLastResults((prev) => ({ ...prev, recalcScores: `${count} leads updated` }));
      toast({ title: "Score recalculation complete", description: `${count} lead scores updated.` });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Recalculation failed", description: err?.message || "Could not recalculate scores.", variant: "destructive" });
    },
  });

  const ownerIntelligenceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/intelligence/run", { batchSize: 10 });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Intelligence pipeline started", description: data.message });
    },
    onError: () => {
      toast({ title: "Failed to start pipeline", variant: "destructive" });
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

  const isIntelStatsLoading = marketsLoading || violationsLoading || permitsLoading || floodLoading || complianceLoading;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Admin</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage data sources, enrichment pipelines, and system configuration
        </p>
      </div>

      <Tabs defaultValue="property-sources" className="space-y-6">
        <TabsList className="inline-flex gap-1 p-1 bg-muted/50 rounded-xl">
          <TabsTrigger value="property-sources" className="rounded-lg text-[13px] font-medium" data-testid="tab-property-sources">Property Sources</TabsTrigger>
          <TabsTrigger value="storm-data" className="rounded-lg text-[13px] font-medium" data-testid="tab-storm-data">Storm Data</TabsTrigger>
          <TabsTrigger value="contact-enrichment" className="rounded-lg text-[13px] font-medium" data-testid="tab-contact-enrichment">Contact Enrichment</TabsTrigger>
          <TabsTrigger value="intelligence" className="rounded-lg text-[13px] font-medium" data-testid="tab-intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="roofing-permits" className="rounded-lg text-[13px] font-medium" data-testid="tab-roofing-permits">Roofing Permits</TabsTrigger>
          <TabsTrigger value="system" className="rounded-lg text-[13px] font-medium" data-testid="tab-system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="property-sources" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  DCAD Property Agent
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-normal">Live API</Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Fetch real commercial property data from Dallas Central Appraisal District
                  via ArcGIS REST API. Already-imported properties are automatically skipped.
                </p>
                {dataSources?.filter((ds) => ds.type === "dcad_api").map((ds) => (
                  <div key={ds.id} className="text-xs text-muted-foreground">
                    Last fetched: {formatDate(ds.lastFetchedAt as any)}
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Building2 className="w-3 h-3" />
                    )}
                    Import Properties
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Duplicates are automatically skipped — only new properties are added.
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Property Data Import
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    Upload CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open("/api/import/sample-csv", "_blank")}
                    data-testid="button-download-sample"
                  >
                    <Download className="w-3 h-3" />
                    Sample CSV
                  </Button>
                </div>
                {uploadResult && (
                  <div className="p-4 rounded-md border space-y-1" data-testid="upload-result">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
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

            <Card className="lg:col-span-2 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Building & Roof Intelligence
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Estimates building stories, roof type, and construction type using property characteristics.
                  Roof types are inferred from year built, building size, improvement value, and zoning.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => dfwMarket && storyEstimateMutation.mutate({ marketId: dfwMarket.id })}
                    disabled={storyEstimateMutation.isPending || !dfwMarket}
                    data-testid="button-estimate-stories"
                  >
                    {storyEstimateMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Building2 className="w-3 h-3" />
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Building2 className="w-3 h-3" />
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ShieldAlert className="w-3 h-3" />
                    )}
                    Flag Holding Companies
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="storm-data" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  NOAA Hail Data Import
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
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
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Live Hail Tracker
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-normal">Live Radar</Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Real-time NEXRAD radar hail detections and NWS severe weather alerts for
                  the DFW region. View live data on the Map View page.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href="/map">
                    <Button size="sm" data-testid="button-open-hail-map">
                      <Radar className="w-3 h-3" />
                      Open Map with Hail Tracker
                    </Button>
                  </Link>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Sources: NOAA SWDI (NEXRAD L3 hail signatures), NWS Alerts API</p>
                  <p>Coverage: 50-mile radius around DFW center</p>
                  <p>Data is fetched live and not stored.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Hail Correlation
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Match imported hail events to nearby properties within a configurable radius. Updates lead scores based on proximity to hail damage.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => dfwMarket && hailCorrelationMutation.mutate({
                      marketId: dfwMarket.id,
                      radiusMiles: 5,
                    })}
                    disabled={hailCorrelationMutation.isPending || !dfwMarket}
                    data-testid="button-correlate-hail"
                  >
                    {hailCorrelationMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Activity className="w-3 h-3" />
                    )}
                    Match to Leads
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="contact-enrichment" className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">
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
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                Run Full Pipeline
              </Button>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-6">
              <p className="text-sm text-muted-foreground">
                Automated 3-stage enrichment: TX Filing Lookup, Phone Number Discovery, Web Research for Decision-Makers.
              </p>
              {pipelineLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : pipelineStats ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
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
                        <p className={`text-2xl font-bold ${item.color}`}>{item.value.toLocaleString()}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-xs text-muted-foreground">Contact Confidence:</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-xs">High: {pipelineStats.contactConfidence.high}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-xs">Medium: {pipelineStats.contactConfidence.medium}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      <span className="text-xs">Low: {pipelineStats.contactConfidence.low}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                      <span className="text-xs">None: {pipelineStats.contactConfidence.none}</span>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  TX Filing Enrichment
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-normal">
                  Free Data Source
                </Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <UserSearch className="w-3 h-3" />
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

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Phone Number Enrichment
                </CardTitle>
                <Badge variant={phoneStatus?.totalAvailable ? "outline" : "secondary"} className="text-[10px] font-normal">
                  {phoneStatus?.totalAvailable || 0} Provider{(phoneStatus?.totalAvailable || 0) !== 1 ? "s" : ""} Active
                </Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Cascading phone lookup: tries Google Places, OpenCorporates, and web search in order.
                  Stops at first match to minimize cost.
                </p>
                {phoneStatus?.providers && (
                  <div className="space-y-1.5">
                    {phoneStatus.providers.map((p) => (
                      <div key={p.name} className="flex items-center justify-between gap-2" data-testid={`phone-provider-${p.name}`}>
                        <span className="text-xs text-muted-foreground">{p.name}</span>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${p.available ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                          <span className="text-[11px] text-muted-foreground">{p.available ? "Ready" : "Needs API Key"}</span>
                        </div>
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Phone className="w-3 h-3" />
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

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Web Research Agent
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${webResearchStatus?.googlePlacesAvailable ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                  <span className="text-[11px] text-muted-foreground">{webResearchStatus?.googlePlacesAvailable ? "Active" : "Needs API Key"}</span>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Scans business websites to find facility managers, property managers, and decision-makers.
                  Extracts their phone numbers and emails from staff directories and contact pages.
                </p>
                {webResearchStatus?.capabilities && (
                  <div className="space-y-1.5">
                    {webResearchStatus.capabilities.map((cap) => (
                      <div key={cap} className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
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
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Search className="w-3 h-3" />
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
          </div>
        </TabsContent>

        <TabsContent value="intelligence" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {isIntelStatsLoading ? (
              [...Array(4)].map((_, i) => (
                <Card key={i} className="shadow-sm">
                  <CardContent className="p-6">
                    <Skeleton className="h-3 w-20 mb-3" />
                    <Skeleton className="h-8 w-16 mb-2" />
                    <Skeleton className="h-3 w-28" />
                  </CardContent>
                </Card>
              ))
            ) : (
              <>
                <Card className="shadow-sm">
                  <CardContent className="p-6">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Code Violations</p>
                    <p className="text-2xl font-bold mt-2 tracking-tight" data-testid="stat-total-violations">
                      {violationsStatus?.totalViolations?.toLocaleString() ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {violationsStatus?.matchedViolations?.toLocaleString() ?? 0} matched to leads
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardContent className="p-6">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Building Permits</p>
                    <p className="text-2xl font-bold mt-2 tracking-tight" data-testid="stat-total-permits">
                      {permitsStatus?.totalPermits?.toLocaleString() ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {permitsStatus?.matchedPermits?.toLocaleString() ?? 0} matched to leads
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardContent className="p-6">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Flood Zones</p>
                    <p className="text-2xl font-bold mt-2 tracking-tight" data-testid="stat-flood-enriched">
                      {floodStatus?.enriched?.toLocaleString() ?? 0}
                      <span className="text-sm font-normal text-muted-foreground"> / {floodStatus?.total?.toLocaleString() ?? 0}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {floodStatus?.highRisk?.toLocaleString() ?? 0} high risk
                    </p>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardContent className="p-6">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Compliance</p>
                    <p className="text-2xl font-bold mt-2 tracking-tight" data-testid="stat-compliance-granted">
                      {complianceStatus?.granted?.toLocaleString() ?? 0}
                      <span className="text-sm font-normal text-muted-foreground"> granted</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {complianceStatus?.unknown?.toLocaleString() ?? 0} unknown, {complianceStatus?.dncRegistered?.toLocaleString() ?? 0} DNC
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Code Violations & 311
                </CardTitle>
                {violationsStatus && (
                  <span className="text-xs text-muted-foreground">
                    {violationsStatus.totalViolations.toLocaleString()} total
                  </span>
                )}
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Import code violations and 311 service requests from Dallas Open Data, then match them to tracked leads.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => import311Mutation.mutate()}
                    disabled={import311Mutation.isPending || !marketId}
                    data-testid="button-import-311"
                  >
                    {import311Mutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Import Dallas 311 (Last 90 Days)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => importCodeMutation.mutate()}
                    disabled={importCodeMutation.isPending || !marketId}
                    data-testid="button-import-code-violations"
                  >
                    {importCodeMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FileText className="w-3 h-3" />
                    )}
                    Import Code Violations Archive
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => matchViolationsMutation.mutate()}
                    disabled={matchViolationsMutation.isPending || !marketId}
                    data-testid="button-match-violations"
                  >
                    {matchViolationsMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Match to Leads
                  </Button>
                </div>
                {lastResults.import311 && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-import311">{lastResults.import311}</span>
                  </div>
                )}
                {lastResults.importCode && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-importCode">{lastResults.importCode}</span>
                  </div>
                )}
                {lastResults.matchViolations && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-matchViolations">{lastResults.matchViolations}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Building Permits
                </CardTitle>
                {permitsStatus && (
                  <span className="text-xs text-muted-foreground">
                    {permitsStatus.totalPermits.toLocaleString()} total
                  </span>
                )}
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Import building permits from Dallas and Fort Worth open data portals, then match them to leads.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => importDallasPermitsMutation.mutate()}
                    disabled={importDallasPermitsMutation.isPending || !marketId}
                    data-testid="button-import-dallas-permits"
                  >
                    {importDallasPermitsMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Import Dallas Permits
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => importFortWorthPermitsMutation.mutate()}
                    disabled={importFortWorthPermitsMutation.isPending || !marketId}
                    data-testid="button-import-fortworth-permits"
                  >
                    {importFortWorthPermitsMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Building2 className="w-3 h-3" />
                    )}
                    Import Fort Worth Permits
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => matchPermitsMutation.mutate()}
                    disabled={matchPermitsMutation.isPending || !marketId}
                    data-testid="button-match-permits"
                  >
                    {matchPermitsMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Match to Leads
                  </Button>
                </div>
                {lastResults.importDallasPermits && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-importDallasPermits">{lastResults.importDallasPermits}</span>
                  </div>
                )}
                {lastResults.importFortWorthPermits && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-importFortWorthPermits">{lastResults.importFortWorthPermits}</span>
                  </div>
                )}
                {lastResults.matchPermits && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-matchPermits">{lastResults.matchPermits}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Flood Risk Assessment
                </CardTitle>
                {floodStatus && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-destructive" />
                    <span className="text-xs text-muted-foreground">{floodStatus.highRisk} high risk</span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enrich leads with FEMA National Flood Hazard Layer data to identify properties in high-risk flood zones.
                </p>
                {floodStatus && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-xs">
                      <span className="text-muted-foreground">Progress: </span>
                      <span className="font-medium" data-testid="text-flood-progress">
                        {floodStatus.enriched.toLocaleString()} / {floodStatus.total.toLocaleString()} leads
                      </span>
                    </div>
                    {floodStatus.highRisk > 0 && (
                      <Badge variant="destructive" className="text-[10px]" data-testid="badge-flood-high-risk">
                        {floodStatus.highRisk} high risk
                      </Badge>
                    )}
                  </div>
                )}
                {floodStatus?.zoneDistribution && Object.keys(floodStatus.zoneDistribution).length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {Object.entries(floodStatus.zoneDistribution).map(([zone, count]) => (
                      <Badge key={zone} variant="outline" className="text-[10px]" data-testid={`badge-zone-${zone}`}>
                        {zone}: {count}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => floodEnrichMutation.mutate()}
                    disabled={floodEnrichMutation.isPending || !marketId}
                    data-testid="button-enrich-flood"
                  >
                    {floodEnrichMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Droplets className="w-3 h-3" />
                    )}
                    Enrich All Leads (FEMA NFHL)
                  </Button>
                </div>
                {lastResults.floodEnrich && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-floodEnrich">{lastResults.floodEnrich}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Owner Intelligence
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Run the 12-agent intelligence pipeline to unmask the real people behind LLCs, skip-trace owners, and find building contacts.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => ownerIntelligenceMutation.mutate()}
                    disabled={ownerIntelligenceMutation.isPending}
                    data-testid="button-run-owner-intelligence"
                  >
                    {ownerIntelligenceMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Run Intelligence Pipeline
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Lead Scoring v2
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Recalculate lead scores using the enhanced v2 algorithm that incorporates violations, permits, flood risk, distress signals, and compliance data.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => recalcScoresMutation.mutate()}
                    disabled={recalcScoresMutation.isPending || !marketId}
                    data-testid="button-recalculate-scores"
                  >
                    {recalcScoresMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Recalculate All Scores
                  </Button>
                </div>
                {lastResults.recalcScores && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-recalcScores">{lastResults.recalcScores}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="roofing-permits" className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">
                Roofing Permit History (10 Years)
              </CardTitle>
              {roofingStats && (
                <span className="text-xs text-muted-foreground" data-testid="badge-roofing-permit-count">
                  {roofingStats.totalRoofingPermits.toLocaleString()} permits
                </span>
              )}
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-6">
              <p className="text-sm text-muted-foreground">
                Pulls roofing-specific permits from Dallas Open Data going back 10 years. Identifies which properties have had roof work done,
                who the contractor was, and what type of roofing system was installed.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => dfwMarket && roofingPermitMutation.mutate({ marketId: dfwMarket.id, yearsBack: 10 })}
                  disabled={roofingPermitMutation.isPending || !dfwMarket}
                  data-testid="button-import-roofing-permits"
                >
                  {roofingPermitMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
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
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Search className="w-3 h-3" />
                  )}
                  Scan & Match to Leads
                </Button>
              </div>
              {roofingStats && roofingStats.totalRoofingPermits > 0 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 rounded-md border">
                      <p className="text-xs text-muted-foreground">Total Roofing Permits</p>
                      <p className="text-2xl font-bold mt-1" data-testid="text-total-roofing-permits">{roofingStats.totalRoofingPermits.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-4 rounded-md border">
                      <p className="text-xs text-muted-foreground">Matched to Leads</p>
                      <p className="text-2xl font-bold mt-1" data-testid="text-matched-roofing-permits">{roofingStats.matchedToLeads.toLocaleString()}</p>
                    </div>
                  </div>
                  {roofingStats.byYear.length > 0 && (
                    <div className="p-4 rounded-md border">
                      <p className="text-xs font-medium text-muted-foreground mb-3">Permits by Year</p>
                      <div className="flex flex-wrap gap-2">
                        {roofingStats.byYear.slice(0, 12).map((y) => (
                          <div key={y.year} className="text-xs px-2 py-1 bg-muted rounded-md">
                            <span className="font-medium">{y.year}</span>: {y.count.toLocaleString()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {roofingStats.topContractors.length > 0 && (
                    <div className="p-4 rounded-md border">
                      <p className="text-xs font-medium text-muted-foreground mb-3">Top Roofing Contractors</p>
                      <div className="divide-y">
                        {roofingStats.topContractors.slice(0, 5).map((c, i) => (
                          <div key={i} className="flex justify-between gap-2 py-2 text-xs items-center">
                            <span className="truncate max-w-[250px]">{c.name}</span>
                            <span className="text-muted-foreground font-medium">{c.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Active Markets
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                {marketsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <div className="divide-y">
                    {markets?.map((market) => (
                      <div
                        key={market.id}
                        className="flex items-center justify-between gap-2 py-3"
                        data-testid={`market-${market.id}`}
                      >
                        <div>
                          <p className="text-sm font-medium">{market.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {market.counties.join(", ")} counties
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${market.isActive ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                          <span className="text-xs text-muted-foreground">{market.isActive ? "Active" : "Inactive"}</span>
                        </div>
                      </div>
                    ))}
                    {(!markets || markets.length === 0) && (
                      <p className="text-sm text-muted-foreground text-center py-6">No markets configured</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">
                  Background Agents
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                {jobs && jobs.length > 0 ? (
                  <div className="divide-y">
                    {jobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between gap-2 py-3"
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
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${job.isActive ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                            <span className="text-[11px] text-muted-foreground">{job.isActive ? "Active" : "Paused"}</span>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {job.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Background agents will appear here once configured
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">
                Import History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              {runsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : importRuns && importRuns.length > 0 ? (
                <div className="divide-y">
                  {importRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between gap-2 py-3"
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
                          <span className="text-[11px] text-muted-foreground">
                            {run.recordsImported} imported
                          </span>
                        )}
                        {run.recordsSkipped !== null && run.recordsSkipped! > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {run.recordsSkipped} skipped
                          </span>
                        )}
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${run.status === "completed" ? "bg-emerald-500" : run.status === "failed" ? "bg-destructive" : "bg-muted-foreground"}`} />
                          <span className="text-[11px] text-muted-foreground">{run.status}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No import runs yet. Use the import buttons above to fetch real data.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
