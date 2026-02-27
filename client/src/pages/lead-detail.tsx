import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Ruler,
  Calendar,
  CloudLightning,
  User,
  Phone,
  Mail,
  DollarSign,
  Layers,
  Home,
  Shield,
  FileText,
  Briefcase,
  Hash,
  Globe,
  Search,
  ShieldCheck,
  Fingerprint,
  LinkIcon,
  Play,
  Loader2,
  HardHat,
  UserCheck,
  Database,
  ExternalLink,
  AlertTriangle,
  Droplets,
  Scale,
  ShieldAlert,
  Ban,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Users,
  MapPinned,
  Zap,
  GitBranch,
  CircleCheck,
  CircleMinus,
  CircleAlert,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { Lead, ContactEvidence, ConflictSet, EnrichmentJob } from "@shared/schema";
import { NetworkIntelligence } from "@/components/network-intelligence";
import { RoofIntelligence } from "@/components/roof-intelligence";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface RoofRiskBreakdownPillar {
  score: number;
  max: number;
  detail: string;
}

interface RoofRiskData {
  score: number;
  tier: "Low" | "Moderate" | "High" | "Critical";
  exposureWindow: string;
  breakdown: {
    ageRisk: RoofRiskBreakdownPillar;
    stormRisk: RoofRiskBreakdownPillar;
    permitSilence: RoofRiskBreakdownPillar;
    climateStress: RoofRiskBreakdownPillar;
    portfolioConcentration: RoofRiskBreakdownPillar;
  };
}

function getRiskColor(tier: string) {
  switch (tier) {
    case "Critical": return { bg: "bg-red-500", text: "text-red-700 dark:text-red-400", ring: "ring-red-500/30", bgLight: "bg-red-500/10" };
    case "High": return { bg: "bg-orange-500", text: "text-orange-700 dark:text-orange-400", ring: "ring-orange-500/30", bgLight: "bg-orange-500/10" };
    case "Moderate": return { bg: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-500/30", bgLight: "bg-amber-500/10" };
    default: return { bg: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-500/30", bgLight: "bg-emerald-500/10" };
  }
}

function getScoreColor(score: number, max: number) {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.8) return "bg-red-500";
  if (pct >= 0.6) return "bg-orange-500";
  if (pct >= 0.4) return "bg-amber-500";
  return "bg-emerald-500";
}

function RoofRiskGauge({ score, tier }: { score: number; tier: string }) {
  const colors = getRiskColor(tier);
  const circumference = 2 * Math.PI * 54;
  const progress = Math.min(score / 100, 1);
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="relative flex items-center justify-center" data-testid="gauge-roof-risk">
      <svg width="140" height="140" viewBox="0 0 128 128" className="-rotate-90">
        <circle cx="64" cy="64" r="54" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/30" />
        <circle
          cx="64" cy="64" r="54" fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={colors.bg}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${colors.text}`} data-testid="text-roof-risk-score">{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">/100</span>
      </div>
    </div>
  );
}

function PillarBar({ label, icon: Icon, pillar }: { label: string; icon: React.ElementType; pillar: RoofRiskBreakdownPillar }) {
  const pct = pillar.max > 0 ? Math.round((pillar.score / pillar.max) * 100) : 0;
  const barColor = getScoreColor(pillar.score, pillar.max);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="space-y-1.5 cursor-default" data-testid={`pillar-${label.toLowerCase().replace(/[\s\/]+/g, "-")}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-medium truncate">{label}</span>
            </div>
            <span className="text-xs font-mono text-muted-foreground flex-shrink-0">{pillar.score}/{pillar.max}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor}`}
              style={{ width: `${pct}%`, transition: "width 0.6s ease-out" }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {pillar.detail}
      </TooltipContent>
    </Tooltip>
  );
}

function RoofRiskIndexCard({ leadId }: { leadId: string }) {
  const { data: riskData, isLoading } = useQuery<RoofRiskData>({
    queryKey: ["/api/leads", leadId, "roof-risk"],
    enabled: !!leadId,
  });

  if (isLoading) {
    return (
      <Card className="shadow-sm" data-testid="card-roof-risk-loading">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="w-[140px] h-[140px] rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!riskData) return null;

  const colors = getRiskColor(riskData.tier);
  const breakdown = riskData.breakdown;

  const keyFactors: string[] = [];
  const pillars = [
    { label: "Age Risk", data: breakdown.ageRisk },
    { label: "Storm Risk", data: breakdown.stormRisk },
    { label: "Permit Silence", data: breakdown.permitSilence },
    { label: "Climate/Financial", data: breakdown.climateStress },
    { label: "Portfolio Risk", data: breakdown.portfolioConcentration },
  ];
  pillars
    .filter(p => p.data.score > 0)
    .sort((a, b) => (b.data.score / b.data.max) - (a.data.score / a.data.max))
    .slice(0, 3)
    .forEach(p => keyFactors.push(p.data.detail));

  return (
    <Card className={`shadow-sm ring-1 ${colors.ring}`} data-testid="card-roof-risk-index">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base font-semibold">Roof Risk Index</CardTitle>
          </div>
          <Badge
            variant="secondary"
            className={`no-default-hover-elevate no-default-active-elevate text-xs ${colors.bgLight} ${colors.text}`}
            data-testid="badge-risk-tier"
          >
            {riskData.tier} Risk
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <RoofRiskGauge score={riskData.score} tier={riskData.tier} />
            <p className={`text-xs font-semibold ${colors.text}`} data-testid="text-risk-tier-label">
              {riskData.tier} Risk
            </p>
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            <div className={`p-3 rounded-md ${colors.bgLight}`} data-testid="text-exposure-window">
              <div className="flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed">{riskData.exposureWindow}</p>
              </div>
            </div>

            <div className="space-y-3">
              <PillarBar label="Age Risk" icon={Calendar} pillar={breakdown.ageRisk} />
              <PillarBar label="Storm Exposure" icon={CloudLightning} pillar={breakdown.stormRisk} />
              <PillarBar label="Permit Silence" icon={FileText} pillar={breakdown.permitSilence} />
              <PillarBar label="Climate / Financial" icon={Droplets} pillar={breakdown.climateStress} />
              <PillarBar label="Portfolio Concentration" icon={Layers} pillar={breakdown.portfolioConcentration} />
            </div>

            {keyFactors.length > 0 && (
              <div className="pt-2 border-t space-y-1" data-testid="list-key-risk-factors">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Key Risk Factors</p>
                <ul className="space-y-1">
                  {keyFactors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HunterPDLButtons({ leadId }: { leadId: string }) {
  const { toast } = useToast();
  const { data: usage } = useQuery<{
    hunter: { used: number; limit: number; remaining: number };
    pdl: { used: number; limit: number; remaining: number };
    googlePlaces: { used: number; limit: number; remaining: number; estimatedCost: number; month: string };
    serperConfigured: boolean;
  }>({
    queryKey: ["/api/enrichment/usage"],
  });

  const hunterMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enrichment/hunter/${leadId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrichment/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      if (data.success && data.emails?.length > 0) {
        toast({ title: "Hunter.io", description: `Found ${data.emails.length} email(s)` });
      } else if (data.error) {
        toast({ title: "Hunter.io", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Hunter.io", description: "No emails found for this domain" });
      }
    },
    onError: async (err: any) => {
      let description = err.message || "Unknown error";
      try {
        const raw = description.replace(/^\d+:\s*/, "");
        const body = JSON.parse(raw);
        if (body.detail) {
          description = body.detail;
          if (body.suggestions?.length) description += " Try: " + body.suggestions[0];
        } else if (body.message) {
          description = body.message;
        }
      } catch {}
      toast({ title: "Hunter.io", description, variant: "destructive" });
    },
  });

  const pdlMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enrichment/pdl/${leadId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrichment/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      if (data.success && data.person) {
        const found = [];
        if (data.person.emails?.length) found.push(`${data.person.emails.length} email(s)`);
        if (data.person.phones?.length) found.push(`${data.person.phones.length} phone(s)`);
        toast({ title: "People Data Labs", description: found.length > 0 ? `Found ${found.join(", ")}` : "Match found but no new contacts" });
      } else if (data.error) {
        toast({ title: "People Data Labs", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "People Data Labs", description: "No match found" });
      }
    },
    onError: (err: any) => {
      toast({ title: "PDL failed", description: err.message, variant: "destructive" });
    },
  });

  const hunterRemaining = usage?.hunter?.remaining ?? 0;
  const pdlRemaining = usage?.pdl?.remaining ?? 0;
  const gpUsed = usage?.googlePlaces?.used ?? 0;
  const serperAvailable = usage?.serperConfigured ?? false;

  const googlePlacesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/enrich/google-places`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrichment/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "contact-path"] });
      toast({ title: "Google Places", description: data.message || "Enrichment complete" });
    },
    onError: (err: any) => {
      toast({ title: "Google Places failed", description: err.message, variant: "destructive" });
    },
  });

  const serperMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/enrich/serper`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrichment/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "contact-path"] });
      const agents = data.agentResults?.length || 0;
      toast({ title: "Serper", description: agents > 0 ? `${agents} agent(s) returned results` : "Enrichment complete" });
    },
    onError: (err: any) => {
      toast({ title: "Serper failed", description: err.message, variant: "destructive" });
    },
  });

  const sosMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enrichment/tx-sos/${leadId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      if (data.success && data.entity?.officers?.length > 0) {
        toast({ title: "TX SOS", description: `Found ${data.entity.officers.length} officer(s): ${data.entity.officers.map((o: any) => o.name).join(", ")}` });
      } else if (data.error) {
        toast({ title: "TX SOS", description: data.error });
      } else {
        toast({ title: "TX SOS", description: "Entity found but no officer data" });
      }
    },
    onError: (err: any) => {
      toast({ title: "TX SOS failed", description: err.message, variant: "destructive" });
    },
  });

  const edgarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enrichment/sec-edgar/${leadId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      if (data.success && data.company) {
        toast({ title: "SEC EDGAR", description: `Found: ${data.company.name} (${data.company.sicDescription || "N/A"})` });
      } else if (data.error) {
        toast({ title: "SEC EDGAR", description: data.error });
      } else {
        toast({ title: "SEC EDGAR", description: "No SEC filings found" });
      }
    },
    onError: (err: any) => {
      toast({ title: "SEC EDGAR failed", description: err.message, variant: "destructive" });
    },
  });

  const countyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enrichment/county-clerk/${leadId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "evidence"] });
      if (data.success && data.records?.length > 0) {
        toast({ title: "County Clerk", description: `Found ${data.records.length} deed record(s)` });
      } else if (data.error) {
        toast({ title: "County Clerk", description: data.error });
      } else {
        toast({ title: "County Clerk", description: "No deed records found" });
      }
    },
    onError: (err: any) => {
      toast({ title: "County Clerk failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => hunterMutation.mutate()}
        disabled={hunterMutation.isPending || hunterRemaining <= 0}
        className="text-xs"
        data-testid="button-hunter-enrich"
      >
        {hunterMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <Mail className="w-3 h-3 mr-1" />
        )}
        Hunter.io ({hunterRemaining})
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => pdlMutation.mutate()}
        disabled={pdlMutation.isPending || pdlRemaining <= 0}
        className="text-xs"
        data-testid="button-pdl-enrich"
      >
        {pdlMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <Users className="w-3 h-3 mr-1" />
        )}
        PDL ({pdlRemaining})
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => sosMutation.mutate()}
        disabled={sosMutation.isPending}
        className="text-xs"
        data-testid="button-txsos-enrich"
      >
        {sosMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <FileText className="w-3 h-3 mr-1" />
        )}
        TX SOS
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => edgarMutation.mutate()}
        disabled={edgarMutation.isPending}
        className="text-xs"
        data-testid="button-edgar-enrich"
      >
        {edgarMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <Scale className="w-3 h-3 mr-1" />
        )}
        SEC EDGAR
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => countyMutation.mutate()}
        disabled={countyMutation.isPending}
        className="text-xs"
        data-testid="button-county-enrich"
      >
        {countyMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <FileText className="w-3 h-3 mr-1" />
        )}
        County Clerk
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => googlePlacesMutation.mutate()}
        disabled={googlePlacesMutation.isPending}
        className="text-xs"
        data-testid="button-google-places-enrich"
      >
        {googlePlacesMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin mr-1" />
        ) : (
          <MapPinned className="w-3 h-3 mr-1" />
        )}
        Google Places ({gpUsed} used)
      </Button>
      {serperAvailable && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => serperMutation.mutate()}
          disabled={serperMutation.isPending}
          className="text-xs"
          data-testid="button-serper-enrich"
        >
          {serperMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : (
            <Search className="w-3 h-3 mr-1" />
          )}
          Serper Search
        </Button>
      )}
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3.5 py-3">
      <Icon className="w-4 h-4 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="text-sm font-medium mt-0.5" data-testid={`detail-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</div>
      </div>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: lead, isLoading } = useQuery<Lead>({
    queryKey: ["/api/leads", id],
  });

  const { data: confidence } = useQuery<{
    score: number;
    level: "high" | "medium" | "low" | "none";
    factors: string[];
  }>({
    queryKey: ["/api/leads", id, "confidence"],
    enabled: !!lead,
  });

  const { data: intelligence } = useQuery<{
    managingMember: string | null;
    managingMemberTitle: string | null;
    managingMemberPhone: string | null;
    managingMemberEmail: string | null;
    llcChain: Array<{ entityName: string; entityType: string; officers: Array<{ name: string; title?: string; confidence: number }>; source: string; status?: string }>;
    buildingContacts: Array<{ name: string; role: string; company?: string; phone?: string; email?: string; source: string; confidence: number }> | null;
    dossier: any;
    score: number;
    sources: string[];
    generatedAt: string | null;
    realPeople: Array<{ name: string; title?: string; source?: string; phone?: string; email?: string; address?: string; confidence?: number }>;
  }>({
    queryKey: ["/api/leads", id, "intelligence"],
    enabled: !!lead,
  });

  const { data: permitHistory } = useQuery<Array<{
    id: string;
    permitNumber: string;
    permitType: string;
    issuedDate: string | null;
    address: string;
    contractor: string | null;
    contractorPhone: string | null;
    workDescription: string | null;
    estimatedValue: number | null;
    source: string;
  }>>({
    queryKey: ["/api/leads", id, "permits"],
    enabled: !!lead,
  });

  const { data: evidence } = useQuery<ContactEvidence[]>({
    queryKey: ["/api/leads", id, "evidence"],
    enabled: !!lead,
  });

  const { data: conflicts } = useQuery<ConflictSet[]>({
    queryKey: ["/api/leads", id, "conflicts"],
    enabled: !!lead,
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${id}/validate-contacts`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "evidence"] });
      toast({ title: "Contacts validated" });
    },
  });

  const resolveConflictMutation = useMutation({
    mutationFn: async ({ conflictId, pickedEvidenceId }: { conflictId: string; pickedEvidenceId: string }) => {
      const res = await apiRequest("POST", `/api/conflicts/${conflictId}/resolve`, { pickedEvidenceId, resolvedBy: "admin" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "evidence"] });
      toast({ title: "Conflict resolved" });
    },
  });

  const { data: contactPath } = useQuery<{
    leadId: string;
    phones: Array<{ rank: number; evidenceId: string; contactType: string; value: string; displayValue: string; effectiveScore: number; reasons: string[]; warnings: string[]; lineType: string | null; carrierName: string | null; sourceName: string; sourceCount: number; validationStatus: string; isRecommended: boolean; ageInDays: number }>;
    emails: Array<{ rank: number; evidenceId: string; contactType: string; value: string; displayValue: string; effectiveScore: number; reasons: string[]; warnings: string[]; lineType: string | null; sourceName: string; sourceCount: number; validationStatus: string; isRecommended: boolean; ageInDays: number }>;
    bestPhone: any;
    bestEmail: any;
    overallConfidence: "high" | "medium" | "low" | "none";
    warnings: string[];
  }>({
    queryKey: ["/api/leads", id, "contact-path"],
    enabled: !!lead,
  });

  const { data: roiDecision } = useQuery<{
    decisionType: string;
    roiScore: number;
    expectedValue: number;
    enrichmentCost: number;
    recommendedApis: string[];
    reasonSummary: string;
    confidence: number;
  } | null>({
    queryKey: ["/api/leads", id, "roi-decision"],
    enabled: !!lead,
  });

  const roiBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/roi/run-batch", { marketId: lead?.marketId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "roi-decision"] });
      toast({ title: "ROI Analysis", description: "Batch ROI analysis started" });
    },
    onError: () => {
      toast({ title: "ROI Analysis failed", variant: "destructive" });
    },
  });

  const { data: rooftopOwner } = useQuery<{
    primary: { id: string; name: string; role: string; title: string | null; confidence: number; source: string; address: string | null; phone: string | null; email: string | null; propertyCount: number; totalPortfolioValue: number | null; totalPortfolioSqft: number | null; portfolioGroupId: string | null };
    allPeople: Array<{ id: string; name: string; role: string; title: string | null; confidence: number; source: string; isPrimary: boolean }>;
    otherProperties: Array<{ leadId: string; address: string; city: string; sqft: number; totalValue: number; leadScore: number; hailEvents: number }>;
  } | null>({
    queryKey: ["/api/leads", id, "rooftop-owner"],
    enabled: !!lead,
  });

  const { data: decisionMakers } = useQuery<{
    ownershipStructure: string;
    ownershipLabel: string;
    ownershipConfidence: number;
    ownershipSignals: Array<{ factor: string; value: string; weight: number; direction: string }>;
    decisionMakers: Array<{
      name: string;
      title: string | null;
      role: string;
      tier: "primary" | "secondary" | "operational";
      titleRelevance: number;
      confidence: number;
      combinedScore: number;
      phone: string | null;
      email: string | null;
      source: string;
      reasoning: string;
    }>;
  }>({
    queryKey: ["/api/leads", id, "decision-makers"],
    enabled: !!lead,
  });

  const markWrongMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      const res = await apiRequest("POST", `/api/evidence/${evidenceId}/mark-wrong`, { feedback: "Wrong number" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "contact-path"] });
      toast({ title: "Contact marked as wrong" });
    },
  });

  const confirmGoodMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      const res = await apiRequest("POST", `/api/evidence/${evidenceId}/confirm-good`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "contact-path"] });
      toast({ title: "Contact confirmed" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: { status?: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/leads/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Lead updated" });
    },
    onError: () => {
      toast({ title: "Failed to update lead", variant: "destructive" });
    },
  });

  const [notes, setNotes] = useState("");

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${id}/enrich`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Auto-Enrich started", description: "Running free intelligence agents..." });
    },
    onError: () => {
      toast({ title: "Enrichment failed", variant: "destructive" });
    },
  });

  const leadEnrichmentStatus = (lead as any)?.enrichmentStatus;
  const shouldPollEnrichment = enrichMutation.isSuccess || leadEnrichmentStatus === "running";

  const { data: enrichmentStatus } = useQuery<{
    leadId: string;
    status: string;
    steps: Array<{ name: string; status: string; detail?: string }>;
  }>({
    queryKey: ["/api/leads", id, "enrichment-status"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${id}/enrichment-status`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id && shouldPollEnrichment,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "complete" || data.status === "error" || data.status === "idle")) {
        return false;
      }
      return 2000;
    },
  });

  useEffect(() => {
    if (enrichmentStatus?.status === "complete") {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "confidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "contact-path"] });
    }
  }, [enrichmentStatus?.status, id]);

  useEffect(() => {
    if (lead?.notes) {
      setNotes(lead.notes);
    }
  }, [lead?.notes]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[400px] w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-[300px] w-full" />
            <Skeleton className="h-[300px] w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!lead) return null;

  const claimWindow = lead.claimWindowOpen;
  const daysSinceHail = lead.lastHailDate ? Math.floor((new Date().getTime() - new Date(lead.lastHailDate).getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950/50 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/leads">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
                Back to Leads
              </Button>
            </Link>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-lead-address">{lead.address}</h1>
            {(lead as any).dataConfidence && (
              <Badge
                variant="secondary"
                className={`no-default-hover-elevate no-default-active-elevate text-xs ${
                  (lead as any).dataConfidence === "high"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : (lead as any).dataConfidence === "medium"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400"
                }`}
                data-testid="badge-data-confidence"
              >
                {(lead as any).dataConfidence === "high" ? (
                  <CircleCheck className="w-3.5 h-3.5 mr-1" />
                ) : (lead as any).dataConfidence === "medium" ? (
                  <CircleMinus className="w-3.5 h-3.5 mr-1" />
                ) : (
                  <CircleAlert className="w-3.5 h-3.5 mr-1" />
                )}
                {(lead as any).dataConfidence === "high" ? "High Confidence" : (lead as any).dataConfidence === "medium" ? "Medium Confidence" : "Low Confidence"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <HunterPDLButtons leadId={id!} />
            <Button
              size="sm"
              onClick={() => enrichMutation.mutate()}
              disabled={enrichMutation.isPending || leadEnrichmentStatus === "running"}
              data-testid="button-auto-enrich"
            >
              {enrichMutation.isPending || leadEnrichmentStatus === "running" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              {leadEnrichmentStatus === "complete" ? "Re-Enrich (Free)" : "Auto-Enrich (Free)"}
            </Button>
          </div>
        </div>

        {enrichmentStatus && (enrichmentStatus.status === "running" || enrichmentStatus.status === "pending") && (
          <Card className="mb-8 border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-4 duration-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-full">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Enrichment in Progress</h3>
                    <p className="text-xs text-muted-foreground">Running free intelligence agents and state record lookups...</p>
                  </div>
                </div>
                <Badge variant="secondary" className="animate-pulse capitalize">{enrichmentStatus.status}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {enrichmentStatus.steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {step.status === "complete" ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    ) : step.status === "running" ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-muted" />
                    )}
                    <span className={`text-[10px] uppercase tracking-wider font-medium ${step.status === "complete" ? "text-foreground" : "text-muted-foreground"}`}>
                      {step.name}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <RoofRiskIndexCard leadId={id!} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Property Details</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y px-6">
                    <DetailRow icon={Building2} label="Property Type" value={lead.zoning} />
                    <DetailRow icon={Ruler} label="Square Footage" value={lead.sqft ? `${lead.sqft.toLocaleString()} sqft` : "N/A"} />
                    <DetailRow icon={Calendar} label="Year Built" value={lead.yearBuilt || "N/A"} />
                    <DetailRow icon={MapPin} label="Location" value={`${lead.city}, ${lead.county} County`} />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Ownership</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y px-6">
                    <DetailRow icon={User} label="Owner Name" value={lead.ownerName} />
                    <DetailRow icon={Briefcase} label="Owner Type" value={lead.ownerType} />
                    {lead.llcName && <DetailRow icon={Layers} label="LLC Entity" value={lead.llcName} />}
                    {lead.ownerAddress && <DetailRow icon={Home} label="Mailing Address" value={lead.ownerAddress} />}
                  </div>
                </CardContent>
              </Card>
            </div>

            {lead.latitude && lead.longitude && (
              <RoofIntelligence
                leadId={lead.id}
                latitude={lead.latitude}
                longitude={lead.longitude}
                address={lead.address}
                existingRoofArea={lead.estimatedRoofArea}
                yearBuilt={lead.yearBuilt}
                roofMaterial={(lead as any).roofMaterial}
                roofType={(lead as any).roofType}
                roofLastReplaced={lead.roofLastReplaced}
              />
            )}
            
            <Card className="shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
                  <div className="p-6 text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Intelligence Score</p>
                    <div className="flex justify-center">
                      <ScoreBadge score={lead.leadScore} size="lg" />
                    </div>
                  </div>
                  <div className="p-6 text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Hail Exposure</p>
                    <p className="text-3xl font-bold" data-testid="text-hail-events">{lead.hailEvents}</p>
                    <p className="text-xs text-muted-foreground mt-1">Confirmed Events</p>
                  </div>
                  <div className="p-6 text-center">
                    {daysSinceHail !== null ? (
                      <>
                        <p className={`text-3xl font-bold ${claimWindow ? "text-emerald-600" : "text-amber-500"}`} data-testid="text-claim-window">
                          {claimWindow ? "OPEN" : "CLOSED"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Insurance Claim Window
                          {daysSinceHail !== null && <span className="block">{daysSinceHail} days ago</span>}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-3xl font-bold text-muted-foreground" data-testid="text-claim-window">N/A</p>
                        <p className="text-xs text-muted-foreground mt-1">Insurance Claim Window</p>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <LeadStormHistory lead={lead} />
            
            <BuildingContacts intelligence={intelligence} />
          </div>

          <div className="space-y-6">
            <NetworkIntelligence leadId={id!} />

            {(decisionMakers || (rooftopOwner && rooftopOwner.primary)) && (
              <Card className="shadow-sm" data-testid="card-rooftop-owner">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Who Controls This Roof</CardTitle>
                  {decisionMakers && (
                    <span className="text-[10px] text-muted-foreground font-medium mt-0.5" data-testid="text-ownership-structure">
                      {decisionMakers.ownershipLabel} · {decisionMakers.ownershipConfidence}% confidence
                    </span>
                  )}
                </CardHeader>
                <CardContent className="p-6 pt-0 space-y-3">
                  {decisionMakers && decisionMakers.decisionMakers.length > 0 ? (
                    <div className="space-y-3">
                      {decisionMakers.decisionMakers.map((dm, i) => (
                        <div key={`${dm.name}-${dm.tier}`} className={`space-y-1 ${i > 0 ? "pt-2 border-t" : ""}`} data-testid={`dm-contact-${dm.tier}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                              dm.tier === "primary" ? "bg-primary/10 text-primary" :
                              dm.tier === "secondary" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
                              "bg-muted text-muted-foreground"
                            }`} data-testid={`badge-tier-${dm.tier}`}>
                              {dm.tier}
                            </span>
                            <span className="text-[10px] text-muted-foreground">Relevance {dm.titleRelevance}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium" data-testid={`text-dm-name-${dm.tier}`}>{dm.name}</span>
                            <span className="text-[10px] text-muted-foreground">{dm.combinedScore} pts</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {dm.title || dm.role} · via {dm.source}
                          </div>
                          {dm.phone && (
                            <a href={`tel:${dm.phone}`} className="text-[11px] font-mono block" data-testid={`link-dm-phone-${dm.tier}`}>{dm.phone}</a>
                          )}
                          {dm.email && (
                            <a href={`mailto:${dm.email}`} className="text-[11px] font-mono block" data-testid={`link-dm-email-${dm.tier}`}>{dm.email}</a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : rooftopOwner && rooftopOwner.primary ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium" data-testid="text-rooftop-owner-name">{rooftopOwner.primary.name}</span>
                        <span className="text-[10px] text-muted-foreground">{rooftopOwner.primary.confidence}%</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {rooftopOwner.primary.title || rooftopOwner.primary.role} · via {rooftopOwner.primary.source}
                      </div>
                      {rooftopOwner.primary.phone && (
                        <a href={`tel:${rooftopOwner.primary.phone}`} className="text-[11px] font-mono block" data-testid="link-owner-phone">{rooftopOwner.primary.phone}</a>
                      )}
                      {rooftopOwner.primary.email && (
                        <a href={`mailto:${rooftopOwner.primary.email}`} className="text-[11px] font-mono block" data-testid="link-owner-email">{rooftopOwner.primary.email}</a>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No decision makers resolved yet</p>
                  )}

                  {rooftopOwner && rooftopOwner.primary && rooftopOwner.primary.propertyCount > 1 && (
                    <a
                      href={`/portfolios?owner=${encodeURIComponent(rooftopOwner.primary.name)}`}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline pt-1"
                      data-testid="link-portfolio"
                    >
                      <Users className="w-3 h-3" />
                      Also controls {rooftopOwner.primary.propertyCount - 1} other {rooftopOwner.primary.propertyCount - 1 === 1 ? "property" : "properties"}
                      {rooftopOwner.primary.totalPortfolioValue ? ` · $${(rooftopOwner.primary.totalPortfolioValue / 1000000).toFixed(1)}M portfolio` : ""}
                    </a>
                  )}

                  {rooftopOwner && rooftopOwner.otherProperties && rooftopOwner.otherProperties.length > 0 && (
                    <div className="space-y-1 pt-1 border-t">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground pt-2">Other Properties</div>
                      {rooftopOwner.otherProperties.slice(0, 3).map((prop) => (
                        <a key={prop.leadId} href={`/leads/${prop.leadId}`} className="flex items-center justify-between py-1 text-[11px] rounded px-1 -mx-1" data-testid={`link-portfolio-property-${prop.leadId}`}>
                          <span className="truncate">{prop.address}, {prop.city}</span>
                          <span className="text-muted-foreground ml-2 flex-shrink-0">Score {prop.leadScore}</span>
                        </a>
                      ))}
                      {rooftopOwner.otherProperties.length > 3 && rooftopOwner.primary && (
                        <a href={`/portfolios?owner=${encodeURIComponent(rooftopOwner.primary.name)}`} className="text-[10px] text-primary hover:underline" data-testid="link-more-properties">
                          +${rooftopOwner.otherProperties.length - 3} more
                        </a>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {contactPath && (contactPath.phones.length > 0 || contactPath.emails.length > 0) && (
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">Call Sheet</CardTitle>
                    <span className="text-[11px] text-muted-foreground capitalize" data-testid="badge-contact-path-confidence">
                      {contactPath.overallConfidence} confidence
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-0 space-y-4">
                  {contactPath.phones.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Phones</div>
                      {contactPath.phones.map((phone, i) => (
                        <div key={phone.evidenceId} className="py-2 border-b last:border-0" data-testid={`call-sheet-phone-${i}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <a href={`tel:${phone.value}`} className="text-sm font-mono font-medium" data-testid={`link-call-phone-${i}`}>
                                {phone.displayValue}
                              </a>
                              {phone.lineType && (
                                <span className="text-[10px] text-muted-foreground">{phone.lineType}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {phone.isRecommended && <span className="text-[10px] font-medium text-primary">Best</span>}
                              <span className="text-[10px] text-muted-foreground" data-testid={`text-phone-score-${i}`}>{Math.round(phone.effectiveScore)}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-muted-foreground">
                              {phone.sourceCount} {phone.sourceCount === 1 ? "source" : "sources"}
                              {phone.validationStatus === "VERIFIED" || phone.validationStatus === "CONFIRMED" ? " · Verified" : ""}
                            </span>
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => confirmGoodMutation.mutate(phone.evidenceId)} disabled={confirmGoodMutation.isPending} data-testid={`button-confirm-phone-${i}`}>
                                <ThumbsUp className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => markWrongMutation.mutate(phone.evidenceId)} disabled={markWrongMutation.isPending} data-testid={`button-wrong-phone-${i}`}>
                                <ThumbsDown className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          {phone.warnings.length > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">{phone.warnings.join(" · ")}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {contactPath.emails.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Emails</div>
                      {contactPath.emails.map((email, i) => (
                        <div key={email.evidenceId} className="py-2 border-b last:border-0" data-testid={`call-sheet-email-${i}`}>
                          <div className="flex items-center justify-between">
                            <a href={`mailto:${email.value}`} className="text-sm font-mono font-medium truncate" data-testid={`link-email-${i}`}>
                              {email.displayValue}
                            </a>
                            <div className="flex items-center gap-2">
                              {email.isRecommended && <span className="text-[10px] font-medium text-primary">Best</span>}
                              <span className="text-[10px] text-muted-foreground">{Math.round(email.effectiveScore)}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-muted-foreground">
                              {email.sourceCount} {email.sourceCount === 1 ? "source" : "sources"}
                              {email.validationStatus === "VERIFIED" ? " · Verified" : ""}
                            </span>
                            <div className="flex gap-0.5">
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => confirmGoodMutation.mutate(email.evidenceId)} disabled={confirmGoodMutation.isPending} data-testid={`button-confirm-email-${i}`}>
                                <ThumbsUp className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => markWrongMutation.mutate(email.evidenceId)} disabled={markWrongMutation.isPending} data-testid={`button-wrong-email-${i}`}>
                                <ThumbsDown className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {contactPath.warnings.length > 0 && (
                    <div className="text-[10px] text-muted-foreground pt-1">
                      {contactPath.warnings.join(" · ")}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">Owner / Contact</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Primary Owner</p>
                  <p className="text-sm font-medium">{lead.ownerName}</p>
                  {lead.ownerPhone && (
                    <a href={`tel:${lead.ownerPhone}`} className="text-xs font-mono block text-primary hover:underline" data-testid="link-owner-phone-raw">{lead.ownerPhone}</a>
                  )}
                  {lead.ownerEmail && (
                    <a href={`mailto:${lead.ownerEmail}`} className="text-xs font-mono block text-primary hover:underline" data-testid="link-owner-email-raw">{lead.ownerEmail}</a>
                  )}
                </div>
                
                <Separator />

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Contact Person</p>
                  <p className="text-sm font-medium">{lead.contactName || "Not identified"}</p>
                  {lead.contactTitle && <p className="text-xs text-muted-foreground">{lead.contactTitle}</p>}
                  {lead.contactPhone && (
                    <a href={`tel:${lead.contactPhone}`} className="text-xs font-mono block text-primary hover:underline" data-testid="link-contact-phone-raw">{lead.contactPhone}</a>
                  )}
                  {lead.contactEmail && (
                    <a href={`mailto:${lead.contactEmail}`} className="text-xs font-mono block text-primary hover:underline" data-testid="link-contact-email-raw">{lead.contactEmail}</a>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm" data-testid="card-distress-signals">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Distress Signals</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Roof Age ({lead.roofLastReplaced ? 2026 - lead.roofLastReplaced : "Unknown"} years)</span>
                    <Badge variant={lead.roofLastReplaced && (2026 - lead.roofLastReplaced) > 15 ? "destructive" : "secondary"}>
                      {lead.roofLastReplaced && (2026 - lead.roofLastReplaced) > 15 ? "High Risk" : "Moderate"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Storm Recency</span>
                    <Badge variant={lead.lastHailDate && (new Date().getTime() - new Date(lead.lastHailDate).getTime()) < 180 * 24 * 60 * 60 * 1000 ? "destructive" : "secondary"}>
                      {lead.lastHailDate ? new Date(lead.lastHailDate).toLocaleDateString() : "No recent"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">CRM Status</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Status</p>
                  <Select
                    value={lead.status}
                    onValueChange={(val) => updateMutation.mutate({ status: val })}
                    disabled={updateMutation.isPending}
                  >
                    <SelectTrigger className="w-full h-9" data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="proposal">Proposal</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Internal Notes</p>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => updateMutation.mutate({ notes })}
                    placeholder="Add notes about this lead..."
                    className="min-h-[100px] text-sm resize-none"
                    data-testid="textarea-notes"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm" data-testid="card-enrichment-recommendation">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <CardTitle className="text-base font-semibold">Enrichment Recommendation</CardTitle>
                  </div>
                  {roiDecision && (
                    <Badge
                      variant="secondary"
                      className={`no-default-hover-elevate no-default-active-elevate text-xs ${
                        roiDecision.roiScore > 12
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : roiDecision.roiScore > 6
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/15 text-red-700 dark:text-red-400"
                      }`}
                      data-testid="badge-roi-score"
                    >
                      ROI {(roiDecision.roiScore || 0).toFixed(1)}x
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-3">
                {roiDecision ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Decision Tier</span>
                      <span className="text-sm font-medium" data-testid="text-roi-decision-type">{roiDecision.decisionType}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2.5 rounded-md bg-muted/50">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Expected Value</p>
                        <p className="text-sm font-semibold tabular-nums" data-testid="text-roi-expected-value">
                          ${(roiDecision.expectedValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="p-2.5 rounded-md bg-muted/50">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Enrichment Cost</p>
                        <p className="text-sm font-semibold tabular-nums" data-testid="text-roi-enrichment-cost">
                          ${(roiDecision.enrichmentCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                    {roiDecision.recommendedApis && roiDecision.recommendedApis.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recommended APIs</p>
                        <div className="flex flex-wrap gap-1">
                          {roiDecision.recommendedApis.map((api) => (
                            <Badge key={api} variant="outline" className="text-[10px]" data-testid={`badge-roi-api-${api}`}>
                              {api}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Reason</p>
                      <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-roi-reason">{roiDecision.reasonSummary}</p>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidence</span>
                      <span className="text-xs font-medium" data-testid="text-roi-confidence">{roiDecision.confidence}%</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-3 space-y-3">
                    <p className="text-sm text-muted-foreground" data-testid="text-roi-not-scored">Not yet scored</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => roiBatchMutation.mutate()}
                      disabled={roiBatchMutation.isPending}
                      data-testid="button-run-roi-analysis"
                    >
                      {roiBatchMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                      ) : (
                        <Play className="w-3 h-3 mr-1.5" />
                      )}
                      Run ROI Analysis
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeadStormHistory({ lead }: { lead: Lead }) {
  const claimWindow = lead.claimWindowOpen;
  const daysSinceHail = lead.lastHailDate ? Math.floor((new Date().getTime() - new Date(lead.lastHailDate).getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Storm Exposure</CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-0 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Hits</p>
            <p className="text-xl font-bold">{lead.hailEvents}</p>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Max Size</p>
            <p className="text-xl font-bold">{lead.lastHailSize ? `${lead.lastHailSize}"` : "N/A"}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Last Storm Date</p>
          <p className="text-sm font-medium">{lead.lastHailDate ? new Date(lead.lastHailDate).toLocaleDateString() : "None recorded"}</p>
          {daysSinceHail !== null && (
            <p className="text-[10px] text-muted-foreground italic">Approx. ${daysSinceHail} days ago</p>
          )}
        </div>
        <div className="pt-2">
          <Badge variant={claimWindow ? "default" : "secondary"} className="w-full justify-center py-1">
            {claimWindow ? "Insurance Claim Window Active" : "No Active Claim Window"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function BuildingContacts({ intelligence }: { intelligence: any }) {
  if (!intelligence || !intelligence.buildingContacts) return null;
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Building Contacts</CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-0 space-y-3">
        {intelligence.buildingContacts.map((c: any, i: number) => (
          <div key={i} className={`space-y-1 ${i > 0 ? "pt-2 border-t" : ""}`}>
            <div className="flex items-center justify-between">
              <Link href={`/contractors?search=${encodeURIComponent(c.name || c.company || "")}`}>
                <span className="text-sm font-medium text-primary hover:underline cursor-pointer" data-testid={`link-building-contact-${i}`}>{c.name}</span>
              </Link>
              <Badge variant="outline" className="text-[9px]">{c.confidence}%</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {c.role} {c.company ? `at ${c.company}` : ""} · via {c.source}
            </p>
            {c.phone && (
              <a href={`tel:${c.phone}`} className="text-[11px] font-mono text-primary hover:underline flex items-center gap-1 w-fit" data-testid={`link-contact-phone-${i}`}>
                <Phone className="w-3 h-3" />{c.phone}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="text-[11px] font-mono text-primary hover:underline flex items-center gap-1 w-fit" data-testid={`link-contact-email-${i}`}>
                <Mail className="w-3 h-3" />{c.email}
              </a>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
