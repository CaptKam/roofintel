import { useState, useRef } from "react";
import { Link } from "wouter";
import { PageMeta } from "@/components/page-meta";
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
  Network,
  GitMerge,
  Copy,
  Eye,
  SkipForward,
  Users,
  UserCheck,
  ShieldOff,
  Target,
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  MapPin,
  ChevronDown,
  ChevronRight,
  Layers,
  Bot,
  Sparkles,
  Ban,
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
  permitsBySource?: { source: string; count: number }[];
  withOwnerName?: number;
  withContractorPhone?: number;
  withContractorAddress?: number;
  dateRange?: { earliest: string | null; latest: string | null };
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

function CoverageBar({ label, value, total, icon }: { label: string; value: number; total: number; icon?: JSX.Element }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1" data-testid={`coverage-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-medium">{value.toLocaleString()} <span className="text-muted-foreground font-normal">/ {total.toLocaleString()} ({pct}%)</span></span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 50 ? 'bg-emerald-500' : pct >= 20 ? 'bg-amber-500' : 'bg-red-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DataCoveragePanel() {
  const { data, isLoading } = useQuery<{
    total: number;
    coverage: Record<string, number>;
    enrichment: Record<string, number>;
    phoneSources: { source: string; count: number }[];
    contactSources: { source: string; count: number }[];
    evidenceSources: { source: string; count: number }[];
  }>({ queryKey: ["/api/admin/data-coverage"] });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!data) return <div className="text-muted-foreground text-sm">Failed to load coverage data</div>;

  const t = data.total;
  const c = data.coverage;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-leads">{t.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Enriched</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-enriched-count">{(data.enrichment.enriched || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Full pipeline completed</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">With Phone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-phone-count">{(c.phone || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{t > 0 ? Math.round(((c.phone || 0) / t) * 100) : 0}% of leads</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Contact Data Coverage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CoverageBar label="Owner Name" value={c.ownerName || 0} total={t} icon={<Users className="h-3.5 w-3.5" />} />
          <CoverageBar label="Phone Number" value={c.phone || 0} total={t} icon={<Phone className="h-3.5 w-3.5" />} />
          <CoverageBar label="Email Address" value={c.email || 0} total={t} icon={<Globe className="h-3.5 w-3.5" />} />
          <CoverageBar label="Contact Person" value={c.contactPerson || 0} total={t} icon={<UserCheck className="h-3.5 w-3.5" />} />
          <CoverageBar label="Business Website" value={c.website || 0} total={t} icon={<Globe className="h-3.5 w-3.5" />} />
          <CoverageBar label="Managing Member" value={c.managingMember || 0} total={t} icon={<UserSearch className="h-3.5 w-3.5" />} />
          <CoverageBar label="Management Company" value={c.managementCompany || 0} total={t} icon={<Building2 className="h-3.5 w-3.5" />} />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Database className="h-4 w-4" /> Public Records Coverage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CoverageBar label="TX Taxpayer ID" value={c.taxpayerId || 0} total={t} icon={<Fingerprint className="h-3.5 w-3.5" />} />
          <CoverageBar label="SOS File Number" value={c.sosFileNumber || 0} total={t} icon={<FileText className="h-3.5 w-3.5" />} />
          <CoverageBar label="Intelligence Score" value={c.intelligenceScore || 0} total={t} icon={<Target className="h-3.5 w-3.5" />} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.phoneSources.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Phone Sources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.phoneSources.map(s => (
                  <div key={s.source} className="flex justify-between text-sm" data-testid={`phone-source-${s.source}`}>
                    <span className="text-muted-foreground">{s.source}</span>
                    <Badge variant="secondary">{s.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {data.evidenceSources.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Evidence Sources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.evidenceSources.map(s => (
                  <div key={s.source} className="flex justify-between text-sm" data-testid={`evidence-source-${s.source}`}>
                    <span className="text-muted-foreground">{s.source}</span>
                    <Badge variant="secondary">{s.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function EnrichmentCreditsCard() {
  const { data: usage, isLoading } = useQuery<{
    hunter: { used: number; limit: number; remaining: number; month: string };
    pdl: { used: number; limit: number; remaining: number; month: string };
    googlePlaces?: { used: number; limit: number; remaining: number; month: string; estimatedCost: number };
    serperConfigured?: boolean;
    summary?: { totalLeads: number; freeEnriched: number; paidGooglePlaces: number; paidHunter: number; paidPDL: number };
  }>({
    queryKey: ["/api/enrichment/usage"],
  });

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!usage) return null;

  const monthLabel = usage.hunter?.month
    ? new Date(usage.hunter.month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "This Month";

  const nextReset = new Date();
  nextReset.setMonth(nextReset.getMonth() + 1, 1);
  nextReset.setHours(0, 0, 0, 0);
  const daysUntilReset = Math.ceil((nextReset.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <Card className="shadow-sm border-primary/20" data-testid="card-enrichment-credits">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" />
            Enrichment API Credits
          </CardTitle>
          <Badge variant="outline" className="text-xs" data-testid="badge-reset-countdown">
            <Clock className="w-3 h-3 mr-1" />
            Resets in {daysUntilReset} day{daysUntilReset !== 1 ? "s" : ""}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{monthLabel} — Paid APIs require manual trigger per lead. Free enrichment runs automatically.</p>
      </CardHeader>
      <CardContent className="pt-0 space-y-6">
        {usage.summary && (
          <div className="p-3 rounded-lg bg-muted/50 space-y-2" data-testid="enrichment-summary">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Enrichment Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div data-testid="stat-summary-free">
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{usage.summary.freeEnriched.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Free enriched of {usage.summary.totalLeads.toLocaleString()}</div>
              </div>
              <div data-testid="stat-summary-google">
                <div className="text-lg font-bold">{usage.summary.paidGooglePlaces.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Google Places calls</div>
              </div>
              <div data-testid="stat-summary-hunter">
                <div className="text-lg font-bold">{usage.summary.paidHunter.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">Hunter.io lookups</div>
              </div>
              <div data-testid="stat-summary-pdl">
                <div className="text-lg font-bold">{usage.summary.paidPDL.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">PDL lookups</div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid="badge-hunter-manual">Manual Only</Badge>
            </div>
            <CreditMeter
              label="Hunter.io"
              description="Email discovery by domain"
              used={usage.hunter.used}
              limit={usage.hunter.limit}
              icon={<Search className="w-4 h-4" />}
              testId="hunter"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid="badge-pdl-manual">Manual Only</Badge>
            </div>
            <CreditMeter
              label="People Data Labs"
              description="Person & company enrichment"
              used={usage.pdl.used}
              limit={usage.pdl.limit}
              icon={<Users className="w-4 h-4" />}
              testId="pdl"
            />
          </div>
        </div>

        {usage.googlePlaces && (
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-sm">Google Places API</span>
                <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid="badge-google-places-manual">Manual Only</Badge>
              </div>
              <Badge variant="secondary" className="text-xs" data-testid="badge-google-places-cost">
                ${usage.googlePlaces.estimatedCost.toFixed(2)} monthly usage
              </Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-2 rounded-lg bg-muted/50" data-testid="stat-google-places-calls">
                <div className="text-lg font-bold">{usage.googlePlaces.used.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">API Calls</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50" data-testid="stat-google-places-cost">
                <div className="text-lg font-bold">${usage.googlePlaces.estimatedCost.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Est. Cost</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50" data-testid="stat-google-places-limit">
                <div className="text-lg font-bold">{usage.googlePlaces.remaining.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Calls Remaining</div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Google Maps Platform pricing now uses product-specific free thresholds.
            </div>
          </div>
        )}

        <div className="pt-4 border-t">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-violet-500" />
              <span className="font-medium text-sm">Serper (Web Search)</span>
              <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700" data-testid="badge-serper-manual">Manual Only</Badge>
            </div>
            <Badge variant={usage.serperConfigured ? "secondary" : "outline"} className="text-xs" data-testid="badge-serper-status">
              {usage.serperConfigured ? (
                <><CheckCircle2 className="w-3 h-3 mr-1" />Configured</>
              ) : (
                <><XCircle className="w-3 h-3 mr-1" />Not Configured</>
              )}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">People search, court records, building contacts web search</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface BatchFreeStatus {
  running: boolean;
  total: number;
  processed: number;
  enriched: number;
  errors: number;
  currentLead?: string;
  startedAt?: string;
}

function BatchFreeEnrichmentCard() {
  const { toast } = useToast();

  const { data: batchStatus, refetch: refetchStatus } = useQuery<BatchFreeStatus>({
    queryKey: ["/api/enrichment/batch-free/status"],
    refetchInterval: (query) => {
      const data = query.state.data as BatchFreeStatus | undefined;
      return data?.running ? 2000 : false;
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/enrichment/batch-free");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Batch enrichment started", description: "Processing all unenriched leads with free sources only. No paid API credits will be used." });
      refetchStatus();
    },
    onError: (err: any) => {
      toast({ title: "Failed to start batch enrichment", description: err?.message || "Already running or server error", variant: "destructive" });
    },
  });

  const isRunning = batchStatus?.running ?? false;
  const progressPct = batchStatus && batchStatus.total > 0 ? Math.round((batchStatus.processed / batchStatus.total) * 100) : 0;

  return (
    <Card className="shadow-sm border-emerald-500/20" data-testid="card-batch-free-enrichment">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Play className="w-4 h-4" />
            Batch Enrich All Leads (Free Sources Only)
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            <ShieldCheck className="w-3 h-3 mr-1" />
            Zero Cost
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Runs the full free pipeline (TX SOS, LLC Chain, Comptroller, Tax Records, Email Discovery, TREC, TDLR, HUD, BBB, Skip Trace, Management Attribution, Role Inference, Confidence Scoring, Free Phone Providers) across all unenriched leads. No paid API credits are used.
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {!isRunning && (
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            data-testid="button-start-batch-free"
          >
            {startMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Start Batch Free Enrichment
          </Button>
        )}

        {isRunning && batchStatus && (
          <div className="space-y-3" data-testid="batch-free-progress">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="font-medium">Processing...</span>
              </span>
              <span className="text-muted-foreground tabular-nums" data-testid="text-batch-free-counts">
                {batchStatus.processed.toLocaleString()} / {batchStatus.total.toLocaleString()}
              </span>
            </div>

            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progressPct}%` }}
                data-testid="progress-batch-free"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progressPct}% complete</span>
              <span className="flex items-center gap-3">
                <span className="text-emerald-600 dark:text-emerald-400" data-testid="text-batch-free-enriched">{batchStatus.enriched.toLocaleString()} enriched</span>
                {batchStatus.errors > 0 && (
                  <span className="text-destructive" data-testid="text-batch-free-errors">{batchStatus.errors.toLocaleString()} errors</span>
                )}
              </span>
            </div>

            {batchStatus.currentLead && (
              <div className="p-2 rounded-lg bg-muted/50 text-xs text-muted-foreground truncate" data-testid="text-batch-free-current">
                Currently processing: {batchStatus.currentLead}
              </div>
            )}
          </div>
        )}

        {!isRunning && batchStatus && batchStatus.total > 0 && batchStatus.processed > 0 && (
          <div className="p-3 rounded-lg bg-muted/50 space-y-1" data-testid="batch-free-complete">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Last batch complete
            </div>
            <p className="text-xs text-muted-foreground">
              {batchStatus.enriched.toLocaleString()} enriched, {batchStatus.errors.toLocaleString()} errors out of {batchStatus.total.toLocaleString()} leads
              {batchStatus.startedAt && ` — Started ${new Date(batchStatus.startedAt).toLocaleString()}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface BatchGPStatus {
  running: boolean;
  total: number;
  processed: number;
  found: number;
  skipped: number;
  errors: number;
  apiCalls: number;
  estimatedCost: number;
  startedAt: string | null;
  completedAt: string | null;
  currentAddress: string | null;
  recentFinds: Array<{ address: string; phone: string }>;
}

function BatchGooglePlacesCard() {
  const { toast } = useToast();
  const [batchSize, setBatchSize] = useState(1000);

  const { data: status, refetch } = useQuery<BatchGPStatus>({
    queryKey: ["/api/admin/batch-google-places/status"],
    refetchInterval: (query) => {
      const data = query.state.data as BatchGPStatus | undefined;
      return data?.running ? 2000 : false;
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/batch-google-places", { limit: batchSize });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Batch Google Places started", description: `Looking up phone numbers for top ${batchSize} leads by lead score.` });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Failed to start batch", description: err?.message || "Already running or server error", variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/batch-google-places/cancel");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cancellation requested" });
      refetch();
    },
  });

  const isRunning = status?.running ?? false;
  const progressPct = status && status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;

  return (
    <Card className="shadow-sm border-blue-500/20" data-testid="card-batch-google-places">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Batch Google Places Phone Lookup
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            <Globe className="w-3 h-3 mr-1" />
            ~$0.017/call
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Looks up real, published business phone numbers from Google Places for your highest-scored leads that are missing phone data. Each lead uses ~2 API calls.
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {!isRunning && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="batch-size" className="text-xs whitespace-nowrap">Batch size:</Label>
              <Input
                id="batch-size"
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(Math.max(1, Math.min(5000, parseInt(e.target.value) || 100)))}
                className="w-24 h-8 text-sm"
                data-testid="input-batch-size"
              />
            </div>
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid="button-start-batch-gp"
            >
              {startMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Phone className="w-4 h-4" />
              )}
              Find Phone Numbers
            </Button>
          </div>
        )}

        {isRunning && status && (
          <div className="space-y-3" data-testid="batch-gp-progress">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="font-medium">Looking up phones...</span>
              </span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground tabular-nums" data-testid="text-batch-gp-counts">
                  {status.processed.toLocaleString()} / {status.total.toLocaleString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelMutation.mutate()}
                  data-testid="button-cancel-batch-gp"
                >
                  Cancel
                </Button>
              </div>
            </div>

            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${progressPct}%` }}
                data-testid="progress-batch-gp"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-1">
              <span>{progressPct}% complete</span>
              <span className="flex items-center gap-3">
                <span className="text-emerald-600 dark:text-emerald-400" data-testid="text-gp-found">{status.found} phones found</span>
                <span>{status.skipped} no result</span>
                <span className="font-medium" data-testid="text-gp-cost">${status.estimatedCost}</span>
                {status.errors > 0 && (
                  <span className="text-destructive">{status.errors} errors</span>
                )}
              </span>
            </div>

            {status.currentAddress && (
              <div className="p-2 rounded-lg bg-muted/50 text-xs text-muted-foreground truncate" data-testid="text-gp-current">
                Currently: {status.currentAddress}
              </div>
            )}
          </div>
        )}

        {!isRunning && status && status.total > 0 && status.processed > 0 && (
          <div className="p-3 rounded-lg bg-muted/50 space-y-2" data-testid="batch-gp-complete">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Last batch complete
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Processed:</span>{" "}
                <span className="font-medium">{status.processed.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Phones found:</span>{" "}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">{status.found.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">API calls:</span>{" "}
                <span className="font-medium">{status.apiCalls.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cost:</span>{" "}
                <span className="font-medium">${status.estimatedCost}</span>
              </div>
            </div>
            {status.startedAt && (
              <p className="text-[11px] text-muted-foreground">
                Started {new Date(status.startedAt).toLocaleString()}
                {status.completedAt && ` — Completed ${new Date(status.completedAt).toLocaleString()}`}
              </p>
            )}
          </div>
        )}

        {status && status.recentFinds && status.recentFinds.length > 0 && (
          <div className="space-y-1" data-testid="batch-gp-recent-finds">
            <p className="text-xs font-medium text-muted-foreground">Recent finds:</p>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {status.recentFinds.slice(0, 5).map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30">
                  <span className="truncate mr-2">{f.address}</span>
                  <a href={`tel:${f.phone}`} className="text-blue-600 dark:text-blue-400 whitespace-nowrap font-medium">{f.phone}</a>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreditMeter({ label, description, used, limit, icon, testId }: {
  label: string;
  description: string;
  used: number;
  limit: number;
  icon: JSX.Element;
  testId: string;
}) {
  const remaining = Math.max(0, limit - used);
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const isExhausted = remaining <= 0;
  const isLow = remaining > 0 && remaining <= Math.ceil(limit * 0.2);

  return (
    <div className="space-y-2" data-testid={`credit-meter-${testId}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <span className="text-sm font-medium">{label}</span>
            <p className="text-[11px] text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className={`text-lg font-bold tabular-nums ${isExhausted ? "text-destructive" : isLow ? "text-amber-600 dark:text-amber-400" : "text-primary"}`} data-testid={`text-remaining-${testId}`}>
          {remaining}
          <span className="text-xs font-normal text-muted-foreground ml-0.5">left</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isExhausted ? "bg-destructive" : isLow ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
          data-testid={`progress-${testId}`}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{used} of {limit} used</span>
        {isExhausted && <span className="text-destructive font-medium">Exhausted</span>}
        {isLow && !isExhausted && <span className="text-amber-600 dark:text-amber-400 font-medium">Running low</span>}
      </div>
    </div>
  );
}

interface PipelineStep {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "skipped" | "error";
  detail?: string;
}

interface PipelinePhase {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "skipped" | "error";
  steps: PipelineStep[];
}

interface PipelineStatusData {
  running: boolean;
  cancelled: boolean;
  phases: PipelinePhase[];
  currentPhase?: string;
  currentStep?: string;
  startedAt?: string;
  completedAt?: string;
  skipPhases?: string[];
  matchedLeads?: number;
  pipelineRunId?: string;
}

interface PipelineFilters {
  minSqft: number;
  maxStories: number;
  roofTypes: string[];
  excludeShellCompanies: boolean;
  minPropertyValue: number;
  onlyUnprocessed: boolean;
  forceReprocess: boolean;
}

const ALL_ROOF_TYPES = ["Metal", "TPO", "EPDM", "Modified Bitumen", "Built-Up (BUR)", "Flat", "Shingle", "Unknown"];

const DEFAULT_FILTERS: PipelineFilters = {
  minSqft: 10000,
  maxStories: 1,
  roofTypes: [...ALL_ROOF_TYPES],
  excludeShellCompanies: true,
  minPropertyValue: 0,
  onlyUnprocessed: true,
  forceReprocess: false,
};

function RunAllPipelineCard() {
  const { toast } = useToast();
  const [skipPhases, setSkipPhases] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filters, setFilters] = useState<PipelineFilters>({ ...DEFAULT_FILTERS });

  const { data: status, isLoading } = useQuery<PipelineStatusData>({
    queryKey: ["/api/pipeline/run-all/status"],
    refetchInterval: (query) => {
      const data = query.state.data as PipelineStatusData | undefined;
      return data?.running ? 2000 : 10000;
    },
  });

  const filterParams = new URLSearchParams({
    minSqft: String(filters.minSqft),
    maxStories: String(filters.maxStories),
    roofTypes: filters.roofTypes.join(","),
    excludeShellCompanies: String(filters.excludeShellCompanies),
    minPropertyValue: String(filters.minPropertyValue),
    onlyUnprocessed: String(filters.onlyUnprocessed && !filters.forceReprocess),
  });

  const { data: previewData } = useQuery<{ matchedLeads: number; totalLeads: number }>({
    queryKey: ["/api/pipeline/preview", filterParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline/preview?${filterParams.toString()}`);
      if (!res.ok) throw new Error("Preview failed");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipeline/run-all", { skipPhases, filters });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline started", description: `Processing ${previewData?.matchedLeads || "matching"} leads...` });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/run-all/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start pipeline", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipeline/cancel");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline cancellation requested" });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/run-all/status"] });
    },
  });

  const toggleSkip = (phaseId: string) => {
    setSkipPhases(prev => prev.includes(phaseId) ? prev.filter(p => p !== phaseId) : [...prev, phaseId]);
  };

  const toggleRoofType = (rt: string) => {
    setFilters(prev => ({
      ...prev,
      roofTypes: prev.roofTypes.includes(rt)
        ? prev.roofTypes.filter(r => r !== rt)
        : [...prev.roofTypes, rt],
    }));
  };

  const defaultPhases: PipelinePhase[] = [
    { id: "import", name: "Phase 1: Import Properties", status: "pending", steps: [{ id: "dcad", name: "Import DCAD Properties", status: "pending" }] },
    { id: "building-intel", name: "Phase 2: Building Intelligence", status: "pending", steps: [{ id: "stories", name: "Estimate Stories", status: "pending" }, { id: "roof-types", name: "Estimate Roof Types", status: "pending" }, { id: "holding-companies", name: "Flag Holding Companies", status: "pending" }, { id: "fix-locations", name: "Fix Missing Locations", status: "pending" }] },
    { id: "storm", name: "Phase 3: Storm Data", status: "pending", steps: [{ id: "noaa-current", name: "Import NOAA Hail Data", status: "pending" }, { id: "hail-correlate", name: "Match Hail to Leads", status: "pending" }] },
    { id: "intelligence-data", name: "Phase 4: Intelligence Data", status: "pending", steps: [{ id: "import-311", name: "Import 311 Requests", status: "pending" }, { id: "import-code", name: "Import Code Violations", status: "pending" }, { id: "match-violations", name: "Match Violations", status: "pending" }, { id: "import-dallas-permits", name: "Import Dallas Permits", status: "pending" }, { id: "import-fw-permits", name: "Import Fort Worth Permits", status: "pending" }, { id: "match-permits", name: "Match Permits", status: "pending" }, { id: "sync-contractors", name: "Sync Contractors", status: "pending" }, { id: "flood", name: "Flood Zone Enrichment", status: "pending" }] },
    { id: "roofing-permits", name: "Phase 5: Roofing Permits", status: "pending", steps: [{ id: "import-roofing", name: "Import Roofing Permits", status: "pending" }, { id: "scan-roofing", name: "Scan & Match Roofing", status: "pending" }] },
    { id: "enrichment", name: "Phase 6: Contact Enrichment", status: "pending", steps: [{ id: "batch-free", name: "Batch Free Enrichment (Full Pipeline)", status: "pending" }] },
    { id: "post-enrichment", name: "Phase 7: Post-Enrichment Analysis", status: "pending", steps: [{ id: "classify-ownership", name: "Classify Ownership", status: "pending" }, { id: "scan-management", name: "Management Attribution", status: "pending" }, { id: "scan-addresses", name: "Reverse Address Enrichment", status: "pending" }, { id: "infer-roles", name: "Role Inference", status: "pending" }, { id: "score-confidence", name: "Confidence Scoring", status: "pending" }] },
    { id: "network", name: "Phase 8: Network & Deduplication", status: "pending", steps: [{ id: "analyze-network", name: "Analyze Ownership Network", status: "pending" }, { id: "scan-duplicates", name: "Scan for Duplicates", status: "pending" }] },
    { id: "scoring", name: "Phase 9: Final Scoring", status: "pending", steps: [{ id: "recalc-scores", name: "Recalculate All Lead Scores", status: "pending" }] },
  ];
  const phases = (status?.phases && status.phases.length > 0) ? status.phases : defaultPhases;
  const completedPhases = phases.filter(p => p.status === "complete").length;
  const totalPhases = phases.length;
  const progressPct = totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0;
  const isRunning = status?.running || false;

  const totalSteps = phases.reduce((sum, p) => sum + p.steps.length, 0);
  const completedSteps = phases.reduce((sum, p) => sum + p.steps.filter(s => s.status === "complete").length, 0);
  const errorSteps = phases.reduce((sum, p) => sum + p.steps.filter(s => s.status === "error").length, 0);

  const phaseIcons: Record<string, JSX.Element> = {
    "import": <Database className="w-4 h-4" />,
    "building-intel": <Building2 className="w-4 h-4" />,
    "storm": <CloudLightning className="w-4 h-4" />,
    "intelligence-data": <FileText className="w-4 h-4" />,
    "roofing-permits": <ShieldCheck className="w-4 h-4" />,
    "enrichment": <UserSearch className="w-4 h-4" />,
    "post-enrichment": <Target className="w-4 h-4" />,
    "network": <Network className="w-4 h-4" />,
    "scoring": <BarChart3 className="w-4 h-4" />,
  };

  const phaseStatusIcon = (s: string) => {
    switch (s) {
      case "complete": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "running": return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case "error": return <XCircle className="w-4 h-4 text-destructive" />;
      case "skipped": return <SkipForward className="w-4 h-4 text-muted-foreground" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground/50" />;
    }
  };

  const elapsed = status?.startedAt ? Math.round((Date.now() - new Date(status.startedAt).getTime()) / 1000) : 0;
  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent" data-testid="card-run-all-pipeline">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Play className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg" data-testid="text-pipeline-title">Run All Pipeline</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Execute the full data pipeline in correct dependency order — 9 phases, {totalSteps || "~30"} steps
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-pipeline"
              >
                {cancelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={isRunning || startMutation.isPending}
              data-testid="button-start-pipeline"
            >
              {startMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Play className="w-4 h-4 mr-1" />
              )}
              {isRunning ? "Running..." : "Start Pipeline"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isRunning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Phase {completedPhases}/{totalPhases} • Step {completedSteps}/{totalSteps}
                {errorSteps > 0 && <span className="text-destructive ml-2">({errorSteps} errors)</span>}
              </span>
              <span className="text-muted-foreground tabular-nums">{formatElapsed(elapsed)}</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPct}%` }}
                data-testid="progress-pipeline"
              />
            </div>
            {status?.currentPhase && (
              <p className="text-sm font-medium text-primary" data-testid="text-current-phase">
                <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1.5" />
                {status.currentPhase}{status.currentStep ? ` — ${status.currentStep}` : ""}
              </p>
            )}
          </div>
        )}

        {status?.completedAt && !isRunning && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-muted-foreground">
              Last run completed {new Date(status.completedAt).toLocaleString()} — {completedPhases} phases done, {completedSteps} steps completed
              {errorSteps > 0 && <span className="text-destructive"> ({errorSteps} errors)</span>}
            </span>
          </div>
        )}

        {previewData && !isRunning && (
          <div className="flex items-center gap-2 text-sm" data-testid="text-matched-leads">
            <Badge variant={previewData.matchedLeads > 0 ? "default" : "secondary"} className="tabular-nums">
              {previewData.matchedLeads.toLocaleString()} leads
            </Badge>
            <span className="text-muted-foreground">
              match current filters (of {previewData.totalLeads.toLocaleString()} total)
            </span>
          </div>
        )}

        {status?.matchedLeads !== undefined && isRunning && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="default" className="tabular-nums">
              {status.matchedLeads.toLocaleString()} leads
            </Badge>
            <span className="text-muted-foreground">being processed this run</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className="text-xs text-muted-foreground"
            data-testid="button-toggle-filters"
          >
            <Shield className="w-3.5 h-3.5 mr-1" />
            {filtersExpanded ? "Hide filters" : "Lead filters"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground"
            data-testid="button-toggle-phases"
          >
            {expanded ? "Hide phases" : "Show phases"} ({totalPhases})
          </Button>
        </div>

        {filtersExpanded && !isRunning && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-4" data-testid="pipeline-filters">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Min Sqft</Label>
                <Input
                  type="number"
                  value={filters.minSqft}
                  onChange={(e) => setFilters(prev => ({ ...prev, minSqft: Number(e.target.value) || 0 }))}
                  className="h-8 text-sm"
                  data-testid="input-min-sqft"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Max Stories</Label>
                <Input
                  type="number"
                  value={filters.maxStories}
                  onChange={(e) => setFilters(prev => ({ ...prev, maxStories: Number(e.target.value) || 1 }))}
                  className="h-8 text-sm"
                  data-testid="input-max-stories"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Min Property Value ($)</Label>
                <Input
                  type="number"
                  value={filters.minPropertyValue}
                  onChange={(e) => setFilters(prev => ({ ...prev, minPropertyValue: Number(e.target.value) || 0 }))}
                  className="h-8 text-sm"
                  data-testid="input-min-value"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Roof Types</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_ROOF_TYPES.map((rt) => (
                  <label key={rt} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.roofTypes.includes(rt)}
                      onChange={() => toggleRoofType(rt)}
                      className="rounded border-muted-foreground/30"
                      data-testid={`checkbox-roof-${rt.toLowerCase().replace(/[^a-z]/g, '-')}`}
                    />
                    {rt}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="label-exclude-shell">
                <input
                  type="checkbox"
                  checked={filters.excludeShellCompanies}
                  onChange={(e) => setFilters(prev => ({ ...prev, excludeShellCompanies: e.target.checked }))}
                  className="rounded border-muted-foreground/30"
                  data-testid="checkbox-exclude-shell"
                />
                <span>Exclude shell companies</span>
                <span className="text-muted-foreground">(Deep Holding / Corp Service Shield)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="label-only-unprocessed">
                <input
                  type="checkbox"
                  checked={filters.onlyUnprocessed}
                  onChange={(e) => setFilters(prev => ({ ...prev, onlyUnprocessed: e.target.checked }))}
                  className="rounded border-muted-foreground/30"
                  data-testid="checkbox-only-unprocessed"
                />
                <span>Only unprocessed leads</span>
                <span className="text-muted-foreground">(skip previously processed)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="label-force-reprocess">
                <input
                  type="checkbox"
                  checked={filters.forceReprocess}
                  onChange={(e) => setFilters(prev => ({ ...prev, forceReprocess: e.target.checked }))}
                  className="rounded border-muted-foreground/30"
                  data-testid="checkbox-force-reprocess"
                />
                <span>Force reprocess all</span>
                <span className="text-muted-foreground">(overrides "only unprocessed")</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setFilters({ ...DEFAULT_FILTERS })}
                data-testid="button-reset-filters"
              >
                Reset to defaults
              </Button>
            </div>
          </div>
        )}

        {expanded && (
          <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
            {phases.map((phase) => (
              <div key={phase.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {!isRunning && (
                      <input
                        type="checkbox"
                        checked={!skipPhases.includes(phase.id)}
                        onChange={() => toggleSkip(phase.id)}
                        className="rounded border-muted-foreground/30"
                        data-testid={`checkbox-phase-${phase.id}`}
                      />
                    )}
                    {phaseIcons[phase.id] || <Activity className="w-4 h-4" />}
                    <span className={`text-sm font-medium ${skipPhases.includes(phase.id) && !isRunning ? "text-muted-foreground line-through" : ""}`}>
                      {phase.name}
                    </span>
                  </div>
                  {phaseStatusIcon(phase.status)}
                </div>
                {(phase.status === "running" || phase.status === "complete" || phase.status === "error") && (
                  <div className="ml-8 space-y-0.5">
                    {phase.steps.map((step) => (
                      <div key={step.id} className="flex items-center gap-2 text-xs">
                        {phaseStatusIcon(step.status)}
                        <span className={step.status === "error" ? "text-destructive" : "text-muted-foreground"}>
                          {step.name}
                        </span>
                        {step.detail && (
                          <span className="text-muted-foreground/60 truncate max-w-[300px]">
                            — {step.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { toast } = useToast();
  const [dcadMinValue, setDcadMinValue] = useState("100000");
  const [dcadMinSqft, setDcadMinSqft] = useState("0");
  const [dcadMaxRecords, setDcadMaxRecords] = useState("5000");
  const [lastResults, setLastResults] = useState<Record<string, string>>({});
  const [permitYearsBack, setPermitYearsBack] = useState(5);

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
      const parts: string[] = [];
      if (data.updatedFromPermit > 0) parts.push(`${data.updatedFromPermit} from roof permits`);
      if (data.updatedFromGis > 0) parts.push(`${data.updatedFromGis} from GIS footprints`);
      if (data.updatedFromZoning > 0) parts.push(`${data.updatedFromZoning} from zoning heuristic`);
      toast({
        title: data.updated > 0 ? "Story estimation complete" : "Stories already up to date",
        description: data.updated > 0
          ? `Updated ${data.updated} leads: ${parts.join(", ")}. ${data.unchanged} unchanged. Sources: ${data.availablePermitData} permit, ${data.availableGisData} GIS.`
          : `All ${data.totalLeads.toLocaleString()} leads already have story estimates. Data sources checked: ${data.availablePermitData} permits, ${data.availableGisData} GIS footprints.`,
      });
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
      const totalUpdated = (data.roofTypesUpdated || 0) + (data.constructionTypesUpdated || 0);
      toast({
        title: totalUpdated > 0 ? "Roof type estimation complete" : "Roof types already up to date",
        description: totalUpdated > 0
          ? `Roof types: ${data.roofTypesUpdated} updated. Construction types: ${data.constructionTypesUpdated} updated. ${data.unchanged} unchanged.`
          : `All leads already have roof/construction type estimates. No changes needed.`,
      });
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
      const res = await apiRequest("POST", "/api/permits/import-fortworth", { marketId, yearsBack: permitYearsBack, commercialOnly: true });
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.imported ?? data.count ?? 0;
      const skipped = data.skipped ?? 0;
      setLastResults((prev) => ({ ...prev, importFortWorthPermits: `${count} permits imported, ${skipped} duplicates skipped` }));
      toast({ title: "Fort Worth permits import complete", description: `${count} permits imported (${permitYearsBack}yr, ArcGIS).` });
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

  const ownerIntelligenceAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/intelligence/run", { processAll: true });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Intelligence pipeline started for ALL leads", description: data.message });
    },
    onError: () => {
      toast({ title: "Failed to start pipeline", variant: "destructive" });
    },
  });

  const networkAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/network/analyze", { marketId: dfwMarket?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Network Analysis Complete", description: `Created ${data.portfoliosCreated} portfolios linking ${data.leadsLinked} properties` });
      queryClient.invalidateQueries({ queryKey: ["/api/network/stats", dfwMarket?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios", dfwMarket?.id] });
    },
    onError: (err: any) => {
      toast({ title: "Network analysis failed", description: err?.message, variant: "destructive" });
    },
  });

  const entityResolutionStatsQuery = useQuery<any>({
    queryKey: ["/api/entity-resolution/stats", dfwMarket?.id],
    queryFn: async () => {
      const params = dfwMarket?.id ? `?marketId=${dfwMarket.id}` : "";
      const res = await fetch(`/api/entity-resolution/stats${params}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const entityResolutionClustersQuery = useQuery<any[]>({
    queryKey: ["/api/entity-resolution/clusters", "pending", dfwMarket?.id],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "pending", limit: "20" });
      if (dfwMarket?.id) params.set("marketId", dfwMarket.id);
      const res = await fetch(`/api/entity-resolution/clusters?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch clusters");
      return res.json();
    },
  });

  const entityScanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/entity-resolution/scan", { marketId: dfwMarket?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Entity Resolution Complete", description: `Found ${data.clustersFound} duplicate clusters (${data.totalDuplicateLeads} duplicates)` });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-resolution/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-resolution/clusters"] });
    },
    onError: (err: any) => {
      toast({ title: "Entity scan failed", description: err?.message, variant: "destructive" });
    },
  });

  const entityMergeMutation = useMutation({
    mutationFn: async (clusterId: string) => {
      const res = await apiRequest("POST", `/api/entity-resolution/merge/${clusterId}`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Merge Complete", description: `Merged ${data.merged} duplicates, enriched ${data.fieldsEnriched.length} fields` });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-resolution/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-resolution/clusters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Merge failed", description: err?.message, variant: "destructive" });
    },
  });

  const entitySkipMutation = useMutation({
    mutationFn: async (clusterId: string) => {
      const res = await apiRequest("POST", `/api/entity-resolution/skip/${clusterId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-resolution/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-resolution/clusters"] });
    },
    onError: (err: any) => {
      toast({ title: "Skip failed", description: err?.message, variant: "destructive" });
    },
  });

  const attributionStatsQuery = useQuery<any>({
    queryKey: ["/api/attribution/stats", dfwMarket?.id],
    queryFn: async () => {
      const params = dfwMarket?.id ? `?marketId=${dfwMarket.id}` : "";
      const res = await fetch(`/api/attribution/stats${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const attributionScanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/attribution/scan", { marketId: dfwMarket?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Management Attribution Complete", description: `Attributed ${data.attributed} leads (${data.withCompany} companies, ${data.withContact} contacts)` });
      queryClient.invalidateQueries({ queryKey: ["/api/attribution/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Attribution failed", description: err?.message, variant: "destructive" });
    },
  });

  const roleStatsQuery = useQuery<any>({
    queryKey: ["/api/roles/stats", dfwMarket?.id],
    queryFn: async () => {
      const params = dfwMarket?.id ? `?marketId=${dfwMarket.id}` : "";
      const res = await fetch(`/api/roles/stats${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const roleInferenceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/roles/infer", { marketId: dfwMarket?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Role Inference Complete", description: `Assigned roles to ${data.rolesAssigned} leads` });
      queryClient.invalidateQueries({ queryKey: ["/api/roles/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Role inference failed", description: err?.message, variant: "destructive" });
    },
  });

  const confidenceStatsQuery = useQuery<any>({
    queryKey: ["/api/dm-confidence/stats", dfwMarket?.id],
    queryFn: async () => {
      const params = dfwMarket?.id ? `?marketId=${dfwMarket.id}` : "";
      const res = await fetch(`/api/dm-confidence/stats${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const confidenceScoringMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/dm-confidence/score", { marketId: dfwMarket?.id });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Confidence Scoring Complete", description: `Scored ${data.totalProcessed} leads: ${data.autoPublish} auto-publish, ${data.review} review, ${data.suppress} suppress` });
      queryClient.invalidateQueries({ queryKey: ["/api/dm-confidence/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dm-confidence/review-queue"] });
    },
    onError: (err: any) => {
      toast({ title: "Confidence scoring failed", description: err?.message, variant: "destructive" });
    },
  });

  const reviewQueueQuery = useQuery<any[]>({
    queryKey: ["/api/dm-confidence/review-queue", dfwMarket?.id],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "15" });
      if (dfwMarket?.id) params.set("marketId", dfwMarket.id);
      const res = await fetch(`/api/dm-confidence/review-queue?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ leadId, action, notes }: { leadId: string; action: string; notes?: string }) => {
      const res = await apiRequest("POST", `/api/dm-confidence/review/${leadId}`, { action, notes });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Review Recorded", description: `Lead ${data.action}` });
      queryClient.invalidateQueries({ queryKey: ["/api/dm-confidence/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dm-confidence/review-queue"] });
    },
    onError: (err: any) => {
      toast({ title: "Review failed", description: err?.message, variant: "destructive" });
    },
  });

  const reverseAddressStatsQuery = useQuery<any>({
    queryKey: ["/api/reverse-address/stats"],
    queryFn: async () => {
      const res = await fetch("/api/reverse-address/stats");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const reverseAddressScanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reverse-address/scan", { marketId: dfwMarket?.id, batchSize: 200 });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Reverse Address Scan Complete", description: `Enriched ${data.enriched} leads, skipped ${data.skipped}` });
      queryClient.invalidateQueries({ queryKey: ["/api/reverse-address/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attribution/stats"] });
    },
    onError: (err: any) => {
      toast({ title: "Scan failed", description: err?.message, variant: "destructive" });
    },
  });

  const classifyOwnershipMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/decision-makers/classify");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Ownership Classification Complete", description: `Classified ${data.classified} leads, ${data.withDecisionMakers} with decision makers` });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Classification failed", description: err?.message, variant: "destructive" });
    },
  });

  const fixLocationsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/data/fix-locations");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Location Fix Started", description: "Geocoding leads with missing coordinates in background" });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Location fix failed", description: err?.message, variant: "destructive" });
    },
  });

  const syncContractorsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/permits/sync-contractors");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Contractor Sync Complete", description: `Synced contractor data from ${data.synced || 0} permits to leads` });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/permits/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Contractor sync failed", description: err?.message, variant: "destructive" });
    },
  });

  const [showIntelAdvanced, setShowIntelAdvanced] = useState(false);
  const [showContactAdvanced, setShowContactAdvanced] = useState(false);
  const [showBulkDataFixes, setShowBulkDataFixes] = useState(false);
  const [showAiResults, setShowAiResults] = useState(false);
  const [aiMode, setAiMode] = useState<"audit" | "search" | "both">("audit");
  const [aiBatchSize, setAiBatchSize] = useState(25);

  const { data: aiStatus, refetch: refetchAiStatus } = useQuery<any>({
    queryKey: ["/api/admin/ai-agent/status"],
    refetchInterval: (query) => query.state.data?.running ? 2000 : false,
  });

  const { data: aiSummary, refetch: refetchAiSummary } = useQuery<any>({
    queryKey: ["/api/admin/ai-agent/summary"],
  });

  const { data: aiResults, refetch: refetchAiResults } = useQuery<any>({
    queryKey: ["/api/admin/ai-agent/results?limit=50"],
    enabled: showAiResults,
  });

  const aiRunMutation = useMutation({
    mutationFn: async ({ mode, batchSize }: { mode: string; batchSize: number }) => {
      const res = await apiRequest("POST", "/api/admin/ai-agent/run", { mode, batchSize });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "AI Agent Started", description: data.message });
      refetchAiStatus();
    },
    onError: (err: any) => {
      toast({ title: "Failed to start AI agent", description: err?.message, variant: "destructive" });
    },
  });

  const aiCancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-agent/cancel");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cancel requested" });
      refetchAiStatus();
    },
  });

  const aiApplyMutation = useMutation({
    mutationFn: async (resultId: string) => {
      const res = await apiRequest("POST", `/api/admin/ai-agent/apply/${resultId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Finding applied" });
      refetchAiResults();
      refetchAiSummary();
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to apply", description: err?.message, variant: "destructive" });
    },
  });

  const aiDismissMutation = useMutation({
    mutationFn: async (resultId: string) => {
      const res = await apiRequest("POST", `/api/admin/ai-agent/dismiss/${resultId}`);
      return res.json();
    },
    onSuccess: () => {
      refetchAiResults();
      refetchAiSummary();
    },
  });

  const batchReprocessMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/batch-reprocess");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Intelligence Pipeline Started", description: "Running ownership classification, management attribution, role inference, and confidence scoring across all leads" });
    },
    onError: (err: any) => {
      toast({ title: "Pipeline failed", description: err?.message, variant: "destructive" });
    },
  });

  const batchReprocessStatusQuery = useQuery<any>({
    queryKey: ["/api/admin/batch-reprocess/status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/batch-reprocess/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: batchReprocessMutation.isPending || batchReprocessMutation.isSuccess ? 3000 : false,
  });

  const complianceOverviewQuery = useQuery<any>({
    queryKey: ["/api/compliance/overview", dfwMarket?.id],
    queryFn: async () => {
      const params = dfwMarket?.id ? `?marketId=${dfwMarket.id}` : "";
      const res = await fetch(`/api/compliance/overview${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
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
      <PageMeta
        title="Admin"
        description="RoofIntel administration — manage property data sources, enrichment pipelines, API credits, storm monitoring, and system configuration."
        path="/admin"
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage data sources, enrichment pipelines, and system configuration
        </p>
      </div>

      <EnrichmentCreditsCard />
      <BatchFreeEnrichmentCard />
      <BatchGooglePlacesCard />
      <RunAllPipelineCard />

      <Tabs defaultValue="property-sources" className="space-y-6">
        <TabsList className="inline-flex gap-1 p-1 bg-muted/50 rounded-xl">
          <TabsTrigger value="data-coverage" className="rounded-lg text-[13px] font-medium" data-testid="tab-data-coverage">Data Coverage</TabsTrigger>
          <TabsTrigger value="property-sources" className="rounded-lg text-[13px] font-medium" data-testid="tab-property-sources">Property Sources</TabsTrigger>
          <TabsTrigger value="storm-data" className="rounded-lg text-[13px] font-medium" data-testid="tab-storm-data">Storm Data</TabsTrigger>
          <TabsTrigger value="contact-enrichment" className="rounded-lg text-[13px] font-medium" data-testid="tab-contact-enrichment">Contact Enrichment</TabsTrigger>
          <TabsTrigger value="intelligence" className="rounded-lg text-[13px] font-medium" data-testid="tab-intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="roofing-permits" className="rounded-lg text-[13px] font-medium" data-testid="tab-roofing-permits">Roofing Permits</TabsTrigger>
          <TabsTrigger value="system" className="rounded-lg text-[13px] font-medium" data-testid="tab-system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="data-coverage" className="space-y-6">
          <DataCoveragePanel />
        </TabsContent>

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
                  These are one-time data quality corrections — run after initial property import.
                </p>

                <button
                  onClick={() => setShowBulkDataFixes(!showBulkDataFixes)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-toggle-bulk-fixes"
                >
                  {showBulkDataFixes ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Show bulk data fix controls
                </button>

                {showBulkDataFixes && (
                  <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
                    <Button
                      size="sm"
                      variant="outline"
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
                      variant="outline"
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
                      variant="outline"
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fixLocationsMutation.mutate()}
                      disabled={fixLocationsMutation.isPending}
                      data-testid="button-fix-locations"
                    >
                      {fixLocationsMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <MapPin className="w-3 h-3" />
                      )}
                      Fix Missing Locations
                    </Button>
                  </div>
                )}
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
                Contact Enrichment Overview
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
                Quick Enrich (25 Leads)
              </Button>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-6">
              <p className="text-sm text-muted-foreground">
                For bulk enrichment, use the <strong>Batch Free Enrichment</strong> button at the top of the page. It runs all free agents (TX Filing, Phone Discovery, Web Research) across all unenriched leads automatically. The controls below are for testing individual agents on small batches.
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

              <button
                onClick={() => setShowContactAdvanced(!showContactAdvanced)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                data-testid="button-toggle-contact-advanced"
              >
                {showContactAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Manual controls for individual agents
              </button>

              {showContactAdvanced && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2 border-t">
                  <div className="space-y-3 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">TX Filing Enrichment</p>
                      <Badge variant="outline" className="text-[10px]">Free</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      LLC/Corp contacts via Texas Open Data Portal.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => dfwMarket && contactEnrichMutation.mutate({ marketId: dfwMarket.id, batchSize: 50 })} disabled={contactEnrichMutation.isPending || !dfwMarket} data-testid="button-enrich-contacts">
                        {contactEnrichMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserSearch className="w-3 h-3" />}
                        Enrich (50)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dfwMarket && contactEnrichMutation.mutate({ marketId: dfwMarket.id, batchSize: 500 })} disabled={contactEnrichMutation.isPending || !dfwMarket} data-testid="button-enrich-contacts-all">
                        All Leads
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">Phone Discovery</p>
                      <Badge variant={phoneStatus?.totalAvailable ? "outline" : "secondary"} className="text-[10px]">
                        {phoneStatus?.totalAvailable || 0} Provider{(phoneStatus?.totalAvailable || 0) !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cascading lookup: Google Places, OpenCorporates, web search.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => dfwMarket && phoneEnrichMutation.mutate({ marketId: dfwMarket.id, batchSize: 50 })} disabled={phoneEnrichMutation.isPending || !dfwMarket || !phoneStatus?.totalAvailable} data-testid="button-enrich-phones">
                        {phoneEnrichMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
                        Find (50)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dfwMarket && phoneEnrichMutation.mutate({ marketId: dfwMarket.id, batchSize: 500 })} disabled={phoneEnrichMutation.isPending || !dfwMarket || !phoneStatus?.totalAvailable} data-testid="button-enrich-phones-all">
                        All Leads
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">Web Research</p>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${webResearchStatus?.googlePlacesAvailable ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                        <span className="text-[10px] text-muted-foreground">{webResearchStatus?.googlePlacesAvailable ? "Active" : "Needs Key"}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Scans business websites for decision-maker contacts.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => dfwMarket && webResearchMutation.mutate({ marketId: dfwMarket.id, batchSize: 25 })} disabled={webResearchMutation.isPending || !dfwMarket || !webResearchStatus?.googlePlacesAvailable} data-testid="button-web-research">
                        {webResearchMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                        Research (25)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dfwMarket && webResearchMutation.mutate({ marketId: dfwMarket.id, batchSize: 100 })} disabled={webResearchMutation.isPending || !dfwMarket || !webResearchStatus?.googlePlacesAvailable} data-testid="button-web-research-all">
                        Research (100)
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
                  Import building permits from Dallas (Socrata) and Fort Worth (ArcGIS, 1.5M+ records back to 2001), then match to leads with evidence recording.
                </p>

                {permitsStatus && permitsStatus.totalPermits > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="permit-stats-grid">
                    <div className="rounded-lg border p-2.5">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Matched</p>
                      <p className="text-lg font-bold" data-testid="stat-permits-matched">{permitsStatus.matchedPermits?.toLocaleString() ?? 0}</p>
                    </div>
                    <div className="rounded-lg border p-2.5">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">With Owner</p>
                      <p className="text-lg font-bold" data-testid="stat-permits-with-owner">{(permitsStatus.withOwnerName ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border p-2.5">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">With Phone</p>
                      <p className="text-lg font-bold" data-testid="stat-permits-with-phone">{(permitsStatus.withContractorPhone ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border p-2.5">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">With Address</p>
                      <p className="text-lg font-bold" data-testid="stat-permits-with-address">{(permitsStatus.withContractorAddress ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                )}

                {permitsStatus?.permitsBySource && permitsStatus.permitsBySource.length > 0 && (
                  <div className="flex flex-wrap gap-2" data-testid="permit-source-badges">
                    {permitsStatus.permitsBySource.map((s) => (
                      <span key={s.source} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">
                        {s.source.replace(/_/g, " ")}: {s.count.toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}

                {permitsStatus?.dateRange?.earliest && (
                  <p className="text-xs text-muted-foreground" data-testid="text-permit-date-range">
                    Date range: {permitsStatus.dateRange.earliest} to {permitsStatus.dateRange.latest}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Years back:</label>
                  <select
                    value={permitYearsBack}
                    onChange={(e) => setPermitYearsBack(Number(e.target.value))}
                    className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    data-testid="select-permit-years-back"
                  >
                    <option value={1}>1 year</option>
                    <option value={3}>3 years</option>
                    <option value={5}>5 years</option>
                    <option value={10}>10 years</option>
                    <option value={15}>15 years</option>
                    <option value={20}>20 years</option>
                  </select>
                </div>

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
                    Fort Worth ({permitYearsBack}yr ArcGIS)
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncContractorsMutation.mutate()}
                    disabled={syncContractorsMutation.isPending || !marketId}
                    data-testid="button-sync-contractors"
                  >
                    {syncContractorsMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Users className="w-3 h-3" />
                    )}
                    Sync Contractors to Leads
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
                    disabled={ownerIntelligenceMutation.isPending || ownerIntelligenceAllMutation.isPending}
                    data-testid="button-run-owner-intelligence"
                  >
                    {ownerIntelligenceMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Run Next Batch (10)
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => ownerIntelligenceAllMutation.mutate()}
                    disabled={ownerIntelligenceMutation.isPending || ownerIntelligenceAllMutation.isPending}
                    data-testid="button-run-owner-intelligence-all"
                  >
                    {ownerIntelligenceAllMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Run All Leads
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Intelligence Pipeline
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => batchReprocessMutation.mutate()}
                    disabled={batchReprocessMutation.isPending || batchReprocessStatusQuery.data?.running || !dfwMarket}
                    data-testid="button-run-intel-pipeline"
                  >
                    {batchReprocessMutation.isPending || batchReprocessStatusQuery.data?.running ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Play className="w-3 h-3 mr-1" />
                    )}
                    {batchReprocessStatusQuery.data?.running ? "Running..." : "Run All Steps"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Runs all post-enrichment analysis in sequence: ownership classification, management attribution, role inference, confidence scoring, and lead re-scoring. Use this after importing new data or running enrichment.
                </p>

                {batchReprocessStatusQuery.data?.running && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
                        Phase: {batchReprocessStatusQuery.data.currentPhase?.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {batchReprocessStatusQuery.data.progress?.processed?.toLocaleString()} / {batchReprocessStatusQuery.data.progress?.total?.toLocaleString()} leads
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {[
                    { key: "ownership_classification", label: "Ownership Classification", desc: "Classify ownership structures (private, investment, REIT, managed)", icon: <ShieldCheck className="w-3 h-3" /> },
                    { key: "management_attribution", label: "Management Attribution", desc: `${attributionStatsQuery.data?.attributed?.toLocaleString() ?? 0} attributed`, icon: <Users className="w-3 h-3" /> },
                    { key: "role_inference", label: "Role Inference", desc: `${roleStatsQuery.data?.withRole?.toLocaleString() ?? 0} with roles`, icon: <UserCheck className="w-3 h-3" /> },
                    { key: "confidence_scoring", label: "Confidence Scoring", desc: `${confidenceStatsQuery.data?.scored?.toLocaleString() ?? 0} scored`, icon: <Target className="w-3 h-3" /> },
                  ].map((step) => {
                    const phaseData = batchReprocessStatusQuery.data?.phases?.[step.key];
                    const isActive = batchReprocessStatusQuery.data?.currentPhase === step.key;
                    const isComplete = phaseData?.status === "completed";
                    return (
                      <div key={step.key} className={`flex items-center gap-3 p-2 rounded-lg ${isActive ? "bg-blue-50 dark:bg-blue-900/20" : ""}`} data-testid={`intel-step-${step.key}`}>
                        <div className="shrink-0">
                          {isActive ? (
                            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                          ) : isComplete ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          {step.icon}
                          <span className="font-medium">{step.label}</span>
                          <span className="text-xs text-muted-foreground">{step.desc}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {confidenceStatsQuery.data && confidenceStatsQuery.data.scored > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Scored</p>
                      <p className="text-lg font-bold mt-0.5" data-testid="text-dm-scored">{confidenceStatsQuery.data.scored?.toLocaleString()}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Avg Score</p>
                      <p className="text-lg font-bold mt-0.5" data-testid="text-dm-avg-score">{confidenceStatsQuery.data.avgScore}</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3">
                      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Auto-Publish</p>
                      <p className="text-lg font-bold mt-0.5 text-emerald-700 dark:text-emerald-400" data-testid="text-dm-auto-publish">{confidenceStatsQuery.data.autoPublish?.toLocaleString()}</p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                      <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider">Review Queue</p>
                      <p className="text-lg font-bold mt-0.5 text-amber-700 dark:text-amber-400" data-testid="text-dm-review">{confidenceStatsQuery.data.review?.toLocaleString()}</p>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                      <p className="text-[11px] font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">Suppress</p>
                      <p className="text-lg font-bold mt-0.5 text-red-700 dark:text-red-400" data-testid="text-dm-suppress">{confidenceStatsQuery.data.suppress?.toLocaleString()}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => recalcScoresMutation.mutate()}
                    disabled={recalcScoresMutation.isPending || !marketId}
                    data-testid="button-recalculate-scores"
                  >
                    {recalcScoresMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Recalculate Lead Scores
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => networkAnalysisMutation.mutate()}
                    disabled={networkAnalysisMutation.isPending || !dfwMarket}
                    data-testid="button-analyze-network"
                  >
                    {networkAnalysisMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Network className="w-3 h-3" />
                    )}
                    Analyze Portfolio Network
                  </Button>
                  <Link href="/portfolios">
                    <Button size="sm" variant="ghost" data-testid="button-view-portfolios">
                      <Network className="w-3 h-3" />
                      View Portfolios
                    </Button>
                  </Link>
                </div>
                {lastResults.recalcScores && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span data-testid="text-result-recalcScores">{lastResults.recalcScores}</span>
                  </div>
                )}

                <button
                  onClick={() => setShowIntelAdvanced(!showIntelAdvanced)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                  data-testid="button-toggle-intel-advanced"
                >
                  {showIntelAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Advanced: Run individual steps
                </button>

                {showIntelAdvanced && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t">
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Management Attribution</p>
                      <p className="text-xs text-muted-foreground">Separates property managers from owners.</p>
                      {attributionStatsQuery.data && (
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{attributionStatsQuery.data.attributed?.toLocaleString()} attributed</Badge>
                          <Badge variant="outline" className="text-[10px]">{attributionStatsQuery.data.withCompany?.toLocaleString()} companies</Badge>
                        </div>
                      )}
                      <Button size="sm" variant="outline" onClick={() => attributionScanMutation.mutate()} disabled={attributionScanMutation.isPending || !dfwMarket} data-testid="button-attribution-scan">
                        {attributionScanMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                        Scan Management
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Role Inference</p>
                      <p className="text-xs text-muted-foreground">Classifies contacts into decision-maker roles.</p>
                      {roleStatsQuery.data && (
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{roleStatsQuery.data.withRole?.toLocaleString()} with roles</Badge>
                          <Badge variant="outline" className="text-[10px]">{roleStatsQuery.data.avgConfidence}% avg confidence</Badge>
                        </div>
                      )}
                      <Button size="sm" variant="outline" onClick={() => roleInferenceMutation.mutate()} disabled={roleInferenceMutation.isPending || !dfwMarket} data-testid="button-role-inference">
                        {roleInferenceMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                        Infer Roles
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Reverse Address Enrichment</p>
                      <p className="text-xs text-muted-foreground">Identifies management companies from mailing address mismatches.</p>
                      {reverseAddressStatsQuery.data && (
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{reverseAddressStatsQuery.data.withDifferentAddress?.toLocaleString()} different addr</Badge>
                          <Badge variant="outline" className="text-[10px]">{reverseAddressStatsQuery.data.mgmtDiscovered?.toLocaleString()} mgmt found</Badge>
                        </div>
                      )}
                      <Button size="sm" variant="outline" onClick={() => reverseAddressScanMutation.mutate()} disabled={reverseAddressScanMutation.isPending || !dfwMarket} data-testid="button-reverse-address-scan">
                        {reverseAddressScanMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                        Scan Addresses
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Confidence Scoring</p>
                      <p className="text-xs text-muted-foreground">7-factor decision-maker confidence scoring.</p>
                      <Button size="sm" variant="outline" onClick={() => confidenceScoringMutation.mutate()} disabled={confidenceScoringMutation.isPending || !dfwMarket} data-testid="button-confidence-scoring">
                        {confidenceScoringMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                        Score Confidence
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ownership Classification</p>
                      <p className="text-xs text-muted-foreground">Classify ownership structures and assign decision-makers.</p>
                      <Button size="sm" variant="outline" onClick={() => classifyOwnershipMutation.mutate()} disabled={classifyOwnershipMutation.isPending} data-testid="button-classify-ownership">
                        {classifyOwnershipMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                        Classify Ownership
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm border-blue-200 dark:border-blue-800">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">
                  AI Data Agent
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-normal">Claude Haiku</Badge>
              </div>
              <div className="flex items-center gap-2">
                {aiStatus?.running ? (
                  <Button size="sm" variant="outline" onClick={() => aiCancelMutation.mutate()} data-testid="button-ai-cancel">
                    <Ban className="w-3 h-3" /> Cancel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => aiRunMutation.mutate({ mode: aiMode, batchSize: aiBatchSize })}
                    disabled={aiRunMutation.isPending}
                    data-testid="button-ai-run"
                  >
                    {aiRunMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Run AI Agent
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Uses AI to audit owner data, discover decision-makers via web search, and find connections between entities. Costs ~$0.001/lead.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Mode:</Label>
                  <select
                    value={aiMode}
                    onChange={(e) => setAiMode(e.target.value as any)}
                    className="text-xs border rounded px-2 py-1 bg-background"
                    data-testid="select-ai-mode"
                  >
                    <option value="audit">Data Audit</option>
                    <option value="search">Web Search</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Batch:</Label>
                  <select
                    value={aiBatchSize}
                    onChange={(e) => setAiBatchSize(parseInt(e.target.value))}
                    className="text-xs border rounded px-2 py-1 bg-background"
                    data-testid="select-ai-batch"
                  >
                    <option value="10">10 leads</option>
                    <option value="25">25 leads</option>
                    <option value="50">50 leads</option>
                    <option value="100">100 leads</option>
                    <option value="250">250 leads</option>
                  </select>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Est. cost: ~${(aiBatchSize * 0.001).toFixed(3)}
                </span>
              </div>

              {aiStatus?.running && (
                <div className="rounded-lg border p-3 space-y-2 bg-blue-50 dark:bg-blue-950/30">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                      Running ({aiStatus.mode})
                    </span>
                    <span>{aiStatus.processed}/{aiStatus.total} leads</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${aiStatus.total > 0 ? (aiStatus.processed / aiStatus.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>{aiStatus.findingsCount} findings</span>
                    <span>{aiStatus.tokensUsed.toLocaleString()} tokens</span>
                    <span>~${aiStatus.estimatedCost.toFixed(4)}</span>
                    {aiStatus.errors > 0 && <span className="text-destructive">{aiStatus.errors} errors</span>}
                  </div>
                </div>
              )}

              {aiStatus && !aiStatus.running && aiStatus.entityResolution && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-2.5" data-testid="entity-resolution-result">
                  <div className="flex items-center gap-1.5 mb-1">
                    <GitMerge className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-medium">Entity Resolution & Deduplication</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>{aiStatus.entityResolution.clustersFound} clusters found</span>
                    <span>{aiStatus.entityResolution.totalDuplicateLeads} duplicate leads</span>
                    <span>{aiStatus.entityResolution.deterministic} deterministic</span>
                    <span>{aiStatus.entityResolution.probabilistic} probabilistic</span>
                    <span>{(aiStatus.entityResolution.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              )}

              {aiSummary && aiSummary.total > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-2.5 text-center">
                    <p className="text-lg font-bold" data-testid="stat-ai-total">{aiSummary.total}</p>
                    <p className="text-[10px] text-muted-foreground">Total Findings</p>
                  </div>
                  <div className="rounded-lg border p-2.5 text-center">
                    <p className="text-lg font-bold" data-testid="stat-ai-tokens">{(aiSummary.totalTokens || 0).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">Tokens Used</p>
                  </div>
                  <div className="rounded-lg border p-2.5 text-center">
                    <p className="text-lg font-bold" data-testid="stat-ai-cost">${(aiSummary.estimatedCost || 0).toFixed(4)}</p>
                    <p className="text-[10px] text-muted-foreground">Est. Cost</p>
                  </div>
                  <div className="rounded-lg border p-2.5 text-center">
                    <p className="text-lg font-bold">
                      {aiSummary.byType?.filter((t: any) => t.status === "pending").reduce((s: number, t: any) => s + t.count, 0) || 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Pending Review</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => { setShowAiResults(!showAiResults); if (!showAiResults) refetchAiResults(); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-toggle-ai-results"
              >
                {showAiResults ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Review findings ({aiSummary?.total || 0} total)
              </button>

              {showAiResults && aiResults?.results && (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {aiResults.results.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No pending findings. Run the AI agent to generate insights.</p>
                  ) : (
                    aiResults.results.map((r: any) => (
                      <div key={r.id} className="rounded-lg border p-3 space-y-2" data-testid={`ai-result-${r.id}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant={r.audit_type === "owner_analysis" ? "default" : r.audit_type === "web_search" ? "secondary" : "outline"} className="text-[10px]">
                              {r.audit_type === "owner_analysis" ? "Owner Analysis" : r.audit_type === "web_search" ? "Web Search" : r.audit_type === "connection_discovery" ? "Connection" : r.audit_type}
                            </Badge>
                            <span className="text-xs font-medium">{r.owner_name}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">{Math.round((r.confidence || 0) * 100)}%</span>
                            {r.status === "pending" && (
                              <>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => aiApplyMutation.mutate(r.id)} disabled={aiApplyMutation.isPending}>
                                  <ThumbsUp className="w-3 h-3 text-emerald-500" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => aiDismissMutation.mutate(r.id)}>
                                  <ThumbsDown className="w-3 h-3 text-muted-foreground" />
                                </Button>
                              </>
                            )}
                            {r.status === "applied" && <Badge variant="outline" className="text-[10px] text-emerald-600">Applied</Badge>}
                            {r.status === "dismissed" && <Badge variant="outline" className="text-[10px] text-muted-foreground">Dismissed</Badge>}
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{r.address}, {r.city}</p>
                        {r.audit_type === "owner_analysis" && r.findings && (
                          <div className="text-xs space-y-1">
                            {(r.findings as any).personToContact && (
                              <p className="text-emerald-700 dark:text-emerald-400 font-medium">
                                Contact: {(r.findings as any).personToContact}
                                {(r.findings as any).personRole && <span className="font-normal text-muted-foreground"> — {(r.findings as any).personRole}</span>}
                              </p>
                            )}
                            <p className="font-medium text-blue-700 dark:text-blue-400">Next Step: {(r.findings as any).actionableNextStep || (r.findings as any).decisionMakerHint}</p>
                            <p className="text-muted-foreground">{(r.findings as any).likelyBusinessType}</p>
                            {(r.findings as any).searchSuggestions?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {(r.findings as any).searchSuggestions.slice(0, 2).map((q: string, i: number) => (
                                  <a key={i} href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer"
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-blue-600 dark:text-blue-400 underline-offset-2 hover:underline">
                                    {q.length > 50 ? q.substring(0, 50) + "..." : q}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {r.audit_type === "web_search" && r.findings && (
                          <div className="text-xs space-y-0.5">
                            {(r.findings as any).foundContacts?.length > 0 ? (
                              (r.findings as any).foundContacts.map((c: any, i: number) => (
                                <p key={i}>
                                  <span className="font-medium">{c.name || "Unknown"}</span>
                                  {c.title && <span className="text-muted-foreground"> — {c.title}</span>}
                                  {c.phone && <span className="text-emerald-600 dark:text-emerald-400"> {c.phone}</span>}
                                  {c.email && <span className="text-blue-600 dark:text-blue-400"> {c.email}</span>}
                                </p>
                              ))
                            ) : (
                              <p className="text-muted-foreground">No contacts found</p>
                            )}
                            {(r.findings as any).businessInsights?.managementCompany && (
                              <p><span className="font-medium">Mgmt Co:</span> {(r.findings as any).businessInsights.managementCompany}</p>
                            )}
                          </div>
                        )}
                        {r.audit_type === "connection_discovery" && r.findings && (
                          <div className="text-xs space-y-0.5">
                            <p><span className="font-medium">Type:</span> {(r.findings as any).connectionType}</p>
                            <p><span className="font-medium">Portfolio:</span> {(r.findings as any).portfolioSize} properties</p>
                            <p><span className="font-medium">Strategy:</span> {(r.findings as any).centralContactStrategy}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">
                Entity Resolution & Deduplication
              </CardTitle>
              <Button
                size="sm"
                onClick={() => entityScanMutation.mutate()}
                disabled={entityScanMutation.isPending || !dfwMarket}
                data-testid="button-entity-scan"
              >
                {entityScanMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Fingerprint className="w-3 h-3 mr-1" />
                )}
                Scan for Duplicates
              </Button>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Identifies duplicate property records using deterministic matching (taxpayer IDs, SOS file numbers, addresses) and probabilistic fuzzy matching (owner names with Jaro-Winkler similarity). Soft-merge preserves provenance and enriches the canonical record.
              </p>

              {entityResolutionStatsQuery.data && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Clusters</p>
                    <p className="text-lg font-bold mt-0.5" data-testid="text-entity-total-clusters">
                      {entityResolutionStatsQuery.data.totalClusters?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Duplicates</p>
                    <p className="text-lg font-bold mt-0.5" data-testid="text-entity-total-duplicates">
                      {entityResolutionStatsQuery.data.totalDuplicates?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Merged</p>
                    <p className="text-lg font-bold mt-0.5 text-emerald-600" data-testid="text-entity-merged">
                      {entityResolutionStatsQuery.data.mergedClusters?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Avg Confidence</p>
                    <p className="text-lg font-bold mt-0.5" data-testid="text-entity-avg-confidence">
                      {entityResolutionStatsQuery.data.avgConfidence}%
                    </p>
                  </div>
                </div>
              )}

              {entityResolutionStatsQuery.data && entityResolutionStatsQuery.data.totalClusters > 0 && (
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    <Copy className="w-2.5 h-2.5 mr-1" />
                    {entityResolutionStatsQuery.data.deterministicClusters} deterministic
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Search className="w-2.5 h-2.5 mr-1" />
                    {entityResolutionStatsQuery.data.probabilisticClusters} probabilistic
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Clock className="w-2.5 h-2.5 mr-1" />
                    {entityResolutionStatsQuery.data.pendingClusters} pending review
                  </Badge>
                </div>
              )}

              {entityResolutionClustersQuery.data && entityResolutionClustersQuery.data.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Review</p>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {entityResolutionClustersQuery.data.map((cluster: any) => (
                      <div key={cluster.id} className="border rounded-lg p-3 space-y-2" data-testid={`cluster-${cluster.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant={cluster.matchType === "deterministic" ? "default" : "secondary"} className="text-[10px]">
                                {cluster.matchType === "deterministic" ? (
                                  <Copy className="w-2.5 h-2.5 mr-1" />
                                ) : (
                                  <Search className="w-2.5 h-2.5 mr-1" />
                                )}
                                {cluster.matchType}
                              </Badge>
                              <span className="text-xs font-medium">{cluster.matchConfidence}% confidence</span>
                              <span className="text-xs text-muted-foreground">{cluster.memberLeadIds.length} records</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 truncate" title={cluster.matchExplanation}>
                              {cluster.matchExplanation}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2"
                              onClick={() => entityMergeMutation.mutate(cluster.id)}
                              disabled={entityMergeMutation.isPending}
                              data-testid={`button-merge-${cluster.id}`}
                            >
                              <GitMerge className="w-3 h-3 mr-1" />
                              Merge
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2"
                              onClick={() => entitySkipMutation.mutate(cluster.id)}
                              disabled={entitySkipMutation.isPending}
                              data-testid={`button-skip-${cluster.id}`}
                            >
                              <SkipForward className="w-3 h-3 mr-1" />
                              Skip
                            </Button>
                          </div>
                        </div>
                        {cluster.leads && cluster.leads.length > 0 && (
                          <div className="bg-muted/30 rounded p-2 space-y-1">
                            {cluster.leads.map((lead: any) => (
                              <div key={lead.id} className="flex items-center gap-2 text-xs">
                                {lead.id === cluster.canonicalLeadId && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700">
                                    canonical
                                  </Badge>
                                )}
                                <span className="font-medium truncate max-w-[180px]" title={lead.ownerName}>{lead.ownerName}</span>
                                <span className="text-muted-foreground truncate max-w-[200px]" title={lead.address}>{lead.address}, {lead.city}</span>
                                <span className="text-muted-foreground">{lead.sqft?.toLocaleString()} sqft</span>
                                {lead.ownerPhone && <Badge variant="outline" className="text-[9px] px-1 py-0">phone</Badge>}
                                {lead.ownerEmail && <Badge variant="outline" className="text-[9px] px-1 py-0">email</Badge>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">
                Human-in-the-Loop Review Console
              </CardTitle>
              <Badge variant="outline" className="text-[10px]" data-testid="badge-review-queue-count">
                <Eye className="w-2.5 h-2.5 mr-1" />
                {reviewQueueQuery.data?.length ?? 0} pending
              </Badge>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Review contacts where confidence is between 60-84%. Each card shows evidence from assessor, permits, corporate registry, and web research. Approve to auto-publish, reject to suppress, or reassign the decision-maker role.
              </p>

              {complianceOverviewQuery.data && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Consent Granted</p>
                    <p className="text-lg font-bold mt-0.5 text-emerald-600" data-testid="text-compliance-granted">
                      {complianceOverviewQuery.data.consent?.granted?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Consent Unknown</p>
                    <p className="text-lg font-bold mt-0.5" data-testid="text-compliance-unknown">
                      {complianceOverviewQuery.data.consent?.unknown?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Phone Clear</p>
                    <p className="text-lg font-bold mt-0.5" data-testid="text-compliance-phone-clear">
                      {complianceOverviewQuery.data.reachability?.phoneClear?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Suppressed</p>
                    <p className="text-lg font-bold mt-0.5 text-red-600" data-testid="text-compliance-suppressed">
                      {complianceOverviewQuery.data.suppressions?.totalActive?.toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              {reviewQueueQuery.data && reviewQueueQuery.data.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Review Queue</p>
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {reviewQueueQuery.data.map((lead: any) => (
                      <div key={lead.id} className="border rounded-lg p-4 space-y-3" data-testid={`review-lead-${lead.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold truncate" data-testid={`text-review-address-${lead.id}`}>
                                {lead.address}, {lead.city}
                              </span>
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                Score: {lead.dmConfidenceScore}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{lead.ownerName}</span>
                              <span>|</span>
                              <span>{lead.sqft?.toLocaleString()} sqft</span>
                              <span>|</span>
                              <span>Lead: {lead.leadScore}</span>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => reviewMutation.mutate({ leadId: lead.id, action: "approve" })}
                              disabled={reviewMutation.isPending}
                              data-testid={`button-approve-${lead.id}`}
                            >
                              <ThumbsUp className="w-3 h-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs"
                              onClick={() => reviewMutation.mutate({ leadId: lead.id, action: "reject" })}
                              disabled={reviewMutation.isPending}
                              data-testid={`button-reject-${lead.id}`}
                            >
                              <ThumbsDown className="w-3 h-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {lead.dmConfidenceComponents && Object.entries(lead.dmConfidenceComponents).map(([key, val]: any) => (
                            <div key={key} className="text-[10px] bg-muted/30 rounded px-2 py-1">
                              <span className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").trim()}: </span>
                              <span className="font-medium">{val}</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          {lead.contactRole && (
                            <Badge variant="outline" className="text-[10px]" data-testid={`badge-role-${lead.id}`}>
                              <UserCheck className="w-2.5 h-2.5 mr-1" />
                              {lead.contactRole}
                            </Badge>
                          )}
                          {lead.managementCompany && (
                            <Badge variant="outline" className="text-[10px]" data-testid={`badge-mgmt-${lead.id}`}>
                              <Users className="w-2.5 h-2.5 mr-1" />
                              {lead.managementCompany}
                            </Badge>
                          )}
                          {lead.contactPhone && (
                            <Badge variant="outline" className="text-[10px]">
                              <Phone className="w-2.5 h-2.5 mr-1" />
                              {lead.contactPhone}
                            </Badge>
                          )}
                          {lead.ownerPhone && !lead.contactPhone && (
                            <Badge variant="outline" className="text-[10px]">
                              <Phone className="w-2.5 h-2.5 mr-1" />
                              {lead.ownerPhone}
                            </Badge>
                          )}
                          {(lead.contactEmail || lead.ownerEmail) && (
                            <Badge variant="outline" className="text-[10px]">
                              {lead.contactEmail || lead.ownerEmail}
                            </Badge>
                          )}
                        </div>

                        {lead.roleEvidence && Array.isArray(lead.roleEvidence) && lead.roleEvidence.length > 0 && (
                          <div className="bg-muted/20 rounded p-2 space-y-1">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Evidence</p>
                            {(lead.roleEvidence as any[]).slice(0, 3).map((candidate: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 text-[10px]">
                                <span className="font-medium">{candidate.name}</span>
                                <span className="text-muted-foreground">{candidate.role}</span>
                                <span className="text-muted-foreground">({candidate.confidence}%)</span>
                                {candidate.evidence?.map((e: any, i: number) => (
                                  <span key={i} className="text-muted-foreground">{e.source}</span>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!reviewQueueQuery.data || reviewQueueQuery.data.length === 0) && confidenceStatsQuery.data?.scored > 0 && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No leads pending review. Run confidence scoring to populate the review queue.
                </div>
              )}
            </CardContent>
          </Card>
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
