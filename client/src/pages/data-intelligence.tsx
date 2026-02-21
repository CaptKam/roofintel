import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Shield,
  Droplets,
  FileText,
  Building2,
  RefreshCw,
  Play,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  Scale,
} from "lucide-react";
import type { Market } from "@shared/schema";

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

export default function DataIntelligence() {
  const { toast } = useToast();
  const [lastResults, setLastResults] = useState<Record<string, string>>({});

  const { data: markets, isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
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

  const isStatsLoading = marketsLoading || violationsLoading || permitsLoading || floodLoading || complianceLoading;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">Data Intelligence</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage property intelligence layers, distress signals, and compliance
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isStatsLoading ? (
          [...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Code Violations</p>
                    <p className="text-2xl font-bold mt-1 tracking-tight" data-testid="stat-total-violations">
                      {violationsStatus?.totalViolations?.toLocaleString() ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {violationsStatus?.matchedViolations?.toLocaleString() ?? 0} matched to leads
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-md bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Building Permits</p>
                    <p className="text-2xl font-bold mt-1 tracking-tight" data-testid="stat-total-permits">
                      {permitsStatus?.totalPermits?.toLocaleString() ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {permitsStatus?.matchedPermits?.toLocaleString() ?? 0} matched to leads
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-md bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Flood Zones</p>
                    <p className="text-2xl font-bold mt-1 tracking-tight" data-testid="stat-flood-enriched">
                      {floodStatus?.enriched?.toLocaleString() ?? 0}
                      <span className="text-sm font-normal text-muted-foreground"> / {floodStatus?.total?.toLocaleString() ?? 0}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {floodStatus?.highRisk?.toLocaleString() ?? 0} high risk
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-md bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                    <Droplets className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Compliance</p>
                    <p className="text-2xl font-bold mt-1 tracking-tight" data-testid="stat-compliance-granted">
                      {complianceStatus?.granted?.toLocaleString() ?? 0}
                      <span className="text-sm font-normal text-muted-foreground"> granted</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {complianceStatus?.unknown?.toLocaleString() ?? 0} unknown, {complianceStatus?.dncRegistered?.toLocaleString() ?? 0} DNC
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Code Violations & 311
            </CardTitle>
            {violationsStatus && (
              <Badge variant="secondary" className="text-[10px]">
                {violationsStatus.totalViolations.toLocaleString()} total
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Play className="w-3 h-3 mr-1" />
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <FileText className="w-3 h-3 mr-1" />
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Match to Leads
              </Button>
            </div>
            {lastResults.import311 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-import311">{lastResults.import311}</span>
              </div>
            )}
            {lastResults.importCode && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-importCode">{lastResults.importCode}</span>
              </div>
            )}
            {lastResults.matchViolations && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-matchViolations">{lastResults.matchViolations}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Building Permits
            </CardTitle>
            {permitsStatus && (
              <Badge variant="secondary" className="text-[10px]">
                {permitsStatus.totalPermits.toLocaleString()} total
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Play className="w-3 h-3 mr-1" />
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Building2 className="w-3 h-3 mr-1" />
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Match to Leads
              </Button>
            </div>
            {lastResults.importDallasPermits && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-importDallasPermits">{lastResults.importDallasPermits}</span>
              </div>
            )}
            {lastResults.importFortWorthPermits && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-importFortWorthPermits">{lastResults.importFortWorthPermits}</span>
              </div>
            )}
            {lastResults.matchPermits && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-matchPermits">{lastResults.matchPermits}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Droplets className="w-4 h-4" />
              Flood Risk Assessment
            </CardTitle>
            {floodStatus && (
              <Badge variant="secondary" className="text-[10px]">
                {floodStatus.highRisk} high risk
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Droplets className="w-3 h-3 mr-1" />
                )}
                Enrich All Leads (FEMA NFHL)
              </Button>
            </div>
            {lastResults.floodEnrich && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-floodEnrich">{lastResults.floodEnrich}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Scale className="w-4 h-4" />
              Lead Scoring v2
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
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
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Recalculate All Scores
              </Button>
            </div>
            {lastResults.recalcScores && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span data-testid="text-result-recalcScores">{lastResults.recalcScores}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
