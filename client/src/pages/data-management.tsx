import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
      </div>

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
                         run.type === "property_csv" ? "Property CSV Import" : run.type}
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
