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
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import type { Lead, ContactEvidence, ConflictSet, EnrichmentJob } from "@shared/schema";

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

  const { data: enrichmentJobHistory } = useQuery<EnrichmentJob[]>({
    queryKey: ["/api/leads", id, "enrichment-jobs"],
    enabled: !!lead,
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

  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

  const runIntelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/intelligence/run-single/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "intelligence"] });
      toast({ title: "Intelligence gathered" });
    },
    onError: () => {
      toast({ title: "Intelligence gathering failed", variant: "destructive" });
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
  const enrichTriggered = useRef(false);

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${id}/enrich`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Enrichment started", description: "All intelligence agents are running..." });
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
    }
  }, [enrichmentStatus?.status, id]);

  useEffect(() => {
    if (lead && !enrichTriggered.current) {
      const enrichStatus = (lead as any).enrichmentStatus;
      if (enrichStatus !== "complete") {
        enrichTriggered.current = true;
        enrichMutation.mutate();
      }
    }
  }, [lead]);

  const lastEnrichedAt = (lead as any)?.lastEnrichedAt;
  const daysSinceEnrichment = lastEnrichedAt
    ? Math.floor((Date.now() - new Date(lastEnrichedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = daysSinceEnrichment !== null && daysSinceEnrichment > 30;
  const isEnriching = enrichMutation.isPending || (enrichmentStatus?.status === "running");

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><Card className="shadow-sm"><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>
          <div><Card className="shadow-sm"><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Lead not found</p>
      </div>
    );
  }

  const roofAge = lead.roofLastReplaced ? new Date().getFullYear() - lead.roofLastReplaced : null;
  const roofArea = lead.estimatedRoofArea || Math.round(lead.sqft / Math.max(lead.stories || 1, 1));
  const daysSinceHail = lead.lastHailDate ? Math.floor((Date.now() - new Date(lead.lastHailDate).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const claimWindow = lead.claimWindowOpen ?? (daysSinceHail !== null ? daysSinceHail <= 730 : null);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/leads">
          <Button variant="ghost" size="icon" data-testid="button-back-to-leads">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight truncate" data-testid="text-lead-address">{lead.address}</h2>
          <p className="text-sm text-muted-foreground">{lead.city}, {lead.county} County, {lead.state} {lead.zipCode}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <StatusBadge status={lead.status} />
          <ScoreBadge score={lead.leadScore} />
        </div>
      </div>

      <div className="flex items-center gap-3 bg-muted/40 rounded-lg px-4 py-3">
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          {isEnriching && enrichmentStatus?.steps && enrichmentStatus.steps.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
              <span className="text-sm font-medium">Enriching...</span>
              <div className="flex gap-1.5 flex-wrap">
                {enrichmentStatus.steps.map((step, i) => (
                  <Badge
                    key={i}
                    variant={step.status === "complete" ? "default" : step.status === "running" ? "secondary" : step.status === "error" ? "destructive" : "outline"}
                    className="text-[10px]"
                    data-testid={`badge-enrich-step-${i}`}
                  >
                    {step.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />}
                    {step.name}{step.detail ? `: ${step.detail}` : ""}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <>
              {lastEnrichedAt ? (
                <span className="text-sm text-muted-foreground" data-testid="text-last-enriched">
                  Last enriched: {new Date(lastEnrichedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {daysSinceEnrichment !== null && (
                    <span className={isStale ? "text-amber-600 dark:text-amber-400 font-medium ml-1" : "ml-1"}>
                      ({daysSinceEnrichment === 0 ? "today" : `${daysSinceEnrichment}d ago`})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground" data-testid="text-never-enriched">Never enriched</span>
              )}
            </>
          )}
        </div>
        <Button
          size="sm"
          variant={isStale ? "default" : "outline"}
          onClick={() => enrichMutation.mutate()}
          disabled={isEnriching}
          data-testid="button-re-enrich"
        >
          {isEnriching ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="w-3 h-3 mr-1" />
          )}
          {isStale ? "Re-enrich (Stale)" : "Re-enrich"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Property Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <DetailRow icon={Ruler} label="Building Sqft" value={`${lead.sqft.toLocaleString()} sqft`} />
                <DetailRow icon={Ruler} label="Est. Roof Area" value={`~${roofArea.toLocaleString()} sqft`} />
                <DetailRow icon={Calendar} label="Year Built" value={lead.yearBuilt} />
                <DetailRow icon={Home} label="Construction Type" value={lead.constructionType} />
                <DetailRow icon={Layers} label="Stories / Units" value={`${lead.stories} stories, ${lead.units} units`} />
                <DetailRow icon={Building2} label="Zoning" value={lead.zoning} />
                <DetailRow icon={Shield} label="Roof Material" value={lead.roofMaterial} />
                <DetailRow icon={Shield} label="Roof System Type" value={lead.roofType} />
                <DetailRow
                  icon={Calendar}
                  label="Roof Last Replaced"
                  value={lead.roofLastReplaced ? `${lead.roofLastReplaced}${roofAge ? ` (${roofAge} years ago)` : ""}` : "Unknown"}
                />
                <DetailRow icon={FileText} label="Last Roofing Permit" value={
                  lead.lastRoofingPermitDate ? (
                    <span>
                      {lead.lastRoofingPermitDate}
                      {lead.lastRoofingPermitType && <Badge variant="outline" className="ml-1 text-[10px]">{lead.lastRoofingPermitType}</Badge>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No permit on file</span>
                  )
                } />
                <DetailRow icon={HardHat} label="Last Roofing Contractor" value={
                  lead.lastRoofingContractor || <span className="text-muted-foreground">Unknown</span>
                } />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Hail Exposure</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center p-5 bg-muted/30 rounded-xl">
                  <p className="text-3xl font-bold" data-testid="text-hail-events">{lead.hailEvents}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Hail Events</p>
                </div>
                <div className="text-center p-5 bg-muted/30 rounded-xl">
                  <p className="text-3xl font-bold" data-testid="text-last-hail-date">{lead.lastHailDate || "N/A"}</p>
                  <p className="text-xs text-muted-foreground mt-1">Last Hail Date</p>
                </div>
                <div className="text-center p-5 bg-muted/30 rounded-xl">
                  <p className="text-3xl font-bold" data-testid="text-last-hail-size">
                    {lead.lastHailSize ? `${lead.lastHailSize}"` : "N/A"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Largest Hail Size</p>
                </div>
                <div className="text-center p-5 bg-muted/30 rounded-xl">
                  {claimWindow !== null ? (
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

          {permitHistory && permitHistory.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">Permit History</CardTitle>
                <Badge variant="secondary" className="ml-auto">{permitHistory.length} permit{permitHistory.length !== 1 ? 's' : ''}</Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <div className="space-y-3">
                  {permitHistory.map((permit) => {
                    const isRoofing = (permit.workDescription || '').toLowerCase().includes('roof') || (permit.permitType || '').toLowerCase().includes('roof');
                    return (
                      <div
                        key={permit.id}
                        className={`p-4 rounded-xl border text-sm ${isRoofing ? 'border-primary/30 bg-primary/5' : ''}`}
                        data-testid={`permit-${permit.id}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-xs">{permit.issuedDate || 'No date'}</span>
                            {isRoofing && <Badge variant="default" className="text-[10px]">Roofing</Badge>}
                            <Badge variant="outline" className="text-[10px]">{permit.permitType}</Badge>
                          </div>
                          {permit.estimatedValue && (
                            <span className="text-xs text-muted-foreground">${permit.estimatedValue.toLocaleString()}</span>
                          )}
                        </div>
                        {permit.workDescription && (
                          <p className="text-xs text-muted-foreground truncate">{permit.workDescription}</p>
                        )}
                        {permit.contractor && (
                          <p className="text-xs mt-1">
                            <HardHat className="w-3 h-3 inline mr-1" />
                            {permit.contractor}
                            {permit.contractorPhone && <span className="ml-2 text-muted-foreground">{permit.contractorPhone}</span>}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Valuation</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Improvement Value</p>
                  <p className="text-2xl font-semibold mt-1">
                    {lead.improvementValue ? `$${lead.improvementValue.toLocaleString()}` : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Land Value</p>
                  <p className="text-2xl font-semibold mt-1">
                    {lead.landValue ? `$${lead.landValue.toLocaleString()}` : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Assessed Value</p>
                  <p className="text-2xl font-semibold mt-1">
                    {lead.totalValue ? `$${lead.totalValue.toLocaleString()}` : "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
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
                        +{rooftopOwner.otherProperties.length - 3} more
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
              {confidence && (
                <Badge
                  variant={confidence.level === "high" ? "default" : confidence.level === "medium" ? "secondary" : "outline"}
                  className="text-[10px]"
                  data-testid="badge-contact-confidence"
                >
                  {confidence.level === "high" ? "High" : confidence.level === "medium" ? "Medium" : "Low"} ({confidence.score}/100)
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-1">
              <DetailRow icon={User} label="Owner" value={lead.ownerName} />
              <DetailRow icon={Building2} label="Owner Type" value={lead.ownerType} />
              {lead.llcName && <DetailRow icon={FileText} label="LLC Name" value={lead.llcName} />}
              {lead.registeredAgent && <DetailRow icon={Shield} label="Entity Type" value={lead.registeredAgent} />}
              {lead.officerName && (
                <DetailRow
                  icon={Briefcase}
                  label="TX Filing Name"
                  value={lead.officerName.replace(/^TX Filing:\s*/i, "")}
                />
              )}
              {lead.officerTitle && (
                <DetailRow
                  icon={FileText}
                  label="Filing Status"
                  value={lead.officerTitle}
                />
              )}
              {lead.taxpayerId && <DetailRow icon={Hash} label="TX Taxpayer ID" value={lead.taxpayerId} />}
              {lead.sosFileNumber && <DetailRow icon={Hash} label="TX SOS File #" value={lead.sosFileNumber} />}
              <DetailRow icon={MapPin} label="Mailing Address" value={lead.ownerAddress} />
              <DetailRow
                icon={Phone}
                label="Phone"
                value={lead.ownerPhone ? (
                  <span className="flex items-center gap-2 flex-wrap">
                    <a href={`tel:${lead.ownerPhone}`} className="text-primary hover:underline">{lead.ownerPhone}</a>
                    {lead.phoneSource && (
                      <span className="text-[10px] text-muted-foreground">via {lead.phoneSource}</span>
                    )}
                  </span>
                ) : null}
              />
              <DetailRow icon={Mail} label="Email" value={lead.ownerEmail} />
              {(lead.contactEnrichedAt || lead.phoneEnrichedAt) && (
                <p className="text-[10px] text-muted-foreground pt-1">
                  {lead.contactEnrichedAt && `Contact enriched: ${new Date(lead.contactEnrichedAt).toLocaleDateString()}`}
                  {lead.contactEnrichedAt && lead.phoneEnrichedAt && " | "}
                  {lead.phoneEnrichedAt && `Phone searched: ${new Date(lead.phoneEnrichedAt).toLocaleDateString()}`}
                </p>
              )}
            </CardContent>
          </Card>

          {(lead.businessName || lead.contactName || lead.businessWebsite || lead.webResearchedAt) && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Business & Decision Maker</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-1">
                {lead.businessName && (
                  <DetailRow icon={Building2} label="Business Name" value={lead.businessName} />
                )}
                {lead.businessWebsite && (
                  <DetailRow
                    icon={Globe}
                    label="Website"
                    value={
                      <a href={lead.businessWebsite} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                        {lead.businessWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    }
                  />
                )}
                {lead.contactName && (
                  <DetailRow
                    icon={User}
                    label="Key Contact"
                    value={
                      <span>
                        {lead.contactName}
                        {lead.contactTitle && (
                          <span className="text-muted-foreground text-xs ml-1">({lead.contactTitle})</span>
                        )}
                      </span>
                    }
                  />
                )}
                {lead.contactPhone && (
                  <DetailRow
                    icon={Phone}
                    label="Contact Phone"
                    value={
                      <a href={`tel:${lead.contactPhone}`} className="text-primary hover:underline">{lead.contactPhone}</a>
                    }
                  />
                )}
                {lead.contactEmail && (
                  <DetailRow
                    icon={Mail}
                    label="Contact Email"
                    value={
                      <a href={`mailto:${lead.contactEmail}`} className="text-primary hover:underline">{lead.contactEmail}</a>
                    }
                  />
                )}
                {lead.contactSource && (
                  <p className="text-[10px] text-muted-foreground pt-1">via {lead.contactSource}</p>
                )}
                {lead.webResearchedAt && !lead.contactName && !lead.businessWebsite && (
                  <p className="text-xs text-muted-foreground py-2">Researched - no website or staff found</p>
                )}
                {lead.webResearchedAt && (
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Researched: {new Date(lead.webResearchedAt).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {(lead.managementCompany || lead.managementContact || lead.managementPhone || lead.contactRole) && (
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">Property Management</CardTitle>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {lead.contactRole && lead.contactRole !== "Unknown" && (
                    <Badge variant="secondary" className="text-[10px]" data-testid="badge-contact-role">
                      {lead.contactRole}
                    </Badge>
                  )}
                  {(lead as any).dmConfidenceScore !== null && (lead as any).dmConfidenceScore !== undefined && (
                    <Badge
                      variant={(lead as any).dmConfidenceScore >= 85 ? "default" : (lead as any).dmConfidenceScore >= 60 ? "secondary" : "outline"}
                      className="text-[10px]"
                      data-testid="badge-dm-confidence"
                    >
                      DM: {(lead as any).dmConfidenceScore}/100
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-1">
                {lead.managementCompany && (
                  <DetailRow icon={Building2} label="Management Company" value={lead.managementCompany} />
                )}
                {lead.managementContact && (
                  <DetailRow icon={User} label="Management Contact" value={lead.managementContact} />
                )}
                {lead.managementPhone && (
                  <DetailRow
                    icon={Phone}
                    label="Management Phone"
                    value={
                      <a href={`tel:${lead.managementPhone}`} className="text-primary hover:underline" data-testid="link-mgmt-phone">
                        {lead.managementPhone}
                      </a>
                    }
                  />
                )}
                {lead.managementEmail && (
                  <DetailRow
                    icon={Mail}
                    label="Management Email"
                    value={
                      <a href={`mailto:${lead.managementEmail}`} className="text-primary hover:underline">
                        {lead.managementEmail}
                      </a>
                    }
                  />
                )}
                {lead.contactRole && (
                  <DetailRow icon={UserCheck} label="Decision Maker Role" value={
                    <span className="flex items-center gap-2">
                      {lead.contactRole}
                      {(lead as any).roleConfidence && (
                        <span className="text-[10px] text-muted-foreground">({(lead as any).roleConfidence}% confidence)</span>
                      )}
                      {(lead as any).decisionMakerRank && (
                        <span className="text-[10px] text-muted-foreground">Rank #{(lead as any).decisionMakerRank}</span>
                      )}
                    </span>
                  } />
                )}
                {(lead as any).managementEvidence && Array.isArray((lead as any).managementEvidence) && (lead as any).managementEvidence.length > 0 && (
                  <div className="pt-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Evidence Sources</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {((lead as any).managementEvidence as any[]).map((ev: any, i: number) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {ev.source}: {ev.field} ({ev.confidence}%)
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(lead as any).managementAttributedAt && (
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Attributed: {new Date((lead as any).managementAttributedAt).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {(lead as any).reverseAddressType && (lead as any).reverseAddressType !== "same_as_property" && (
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">Reverse Address Lookup</CardTitle>
                <Badge
                  variant={(lead as any).reverseAddressType === "management_office" ? "default" : "secondary"}
                  className="text-[10px]"
                  data-testid="badge-reverse-address-type"
                >
                  {((lead as any).reverseAddressType || "").replace(/_/g, " ")}
                </Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-2">
                {lead.ownerAddress && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Owner Mailing Address</p>
                      <p className="text-sm" data-testid="text-owner-mailing-address">{lead.ownerAddress}</p>
                    </div>
                  </div>
                )}
                {Array.isArray((lead as any).reverseAddressBusinesses) && (lead as any).reverseAddressBusinesses.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Businesses Found at Address</p>
                    {((lead as any).reverseAddressBusinesses as any[]).slice(0, 5).map((biz: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-muted/30 rounded px-2.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="font-medium" data-testid={`text-reverse-biz-${i}`}>{biz.name}</span>
                        </div>
                        <Badge variant="outline" className="text-[9px]">
                          {(biz.classification || "").replace(/_/g, " ")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {(lead as any).reverseAddressEnrichedAt && (
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Enriched: {new Date((lead as any).reverseAddressEnrichedAt).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-semibold">Owner Intelligence</CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(lead as any).ownershipFlag && (
                  <Badge
                    variant="destructive"
                    className="text-[10px]"
                    data-testid="badge-ownership-flag"
                  >
                    {(lead as any).ownershipFlag}
                  </Badge>
                )}
                {intelligence?.score !== undefined && intelligence.score > 0 && (
                  <span className="text-xs text-muted-foreground font-medium" data-testid="badge-intel-score">
                    {intelligence.score}/100
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-2">
              {intelligence?.managingMember ? (
                <>
                  <DetailRow icon={User} label="Real Owner" value={
                    <span className="font-semibold">{intelligence.managingMember}</span>
                  } />
                  {intelligence.managingMemberTitle && (
                    <DetailRow icon={Briefcase} label="Role" value={intelligence.managingMemberTitle} />
                  )}
                  {intelligence.managingMemberPhone && (
                    <DetailRow icon={Phone} label="Direct Phone" value={
                      <a href={`tel:${intelligence.managingMemberPhone}`} className="text-primary hover:underline">{intelligence.managingMemberPhone}</a>
                    } />
                  )}
                  {intelligence.managingMemberEmail && (
                    <DetailRow icon={Mail} label="Direct Email" value={
                      <a href={`mailto:${intelligence.managingMemberEmail}`} className="text-primary hover:underline">{intelligence.managingMemberEmail}</a>
                    } />
                  )}
                  {intelligence.llcChain && intelligence.llcChain.length > 0 && (
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">LLC Chain</p>
                      {intelligence.llcChain.slice(0, 3).map((link, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs pl-3 py-1">
                          <span className="text-muted-foreground/60">{i > 0 ? "  " : ""}</span>
                          <span className="font-medium">{link.entityName}</span>
                          {link.status && <span className="text-[10px] text-muted-foreground">({link.status})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {intelligence.realPeople && intelligence.realPeople.length > 1 && (
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Other People Found</p>
                      {intelligence.realPeople.slice(1, 5).map((person, i) => (
                        <div key={i} className="flex items-center justify-between text-xs pl-3 py-1.5 border-b last:border-0" data-testid={`real-person-${i}`}>
                          <div>
                            <span className="font-medium">{person.name}</span>
                            {person.title && <span className="text-muted-foreground ml-1.5">({person.title})</span>}
                          </div>
                          {person.confidence && (
                            <span className="text-[10px] text-muted-foreground">{person.confidence}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {intelligence.sources && intelligence.sources.length > 0 && (
                    <p className="text-[10px] text-muted-foreground pt-2">
                      Sources: {intelligence.sources.join(", ")}
                    </p>
                  )}
                  {intelligence.generatedAt && (
                    <div className="flex items-center gap-2 pt-2">
                      <p className="text-[10px] text-muted-foreground">
                        Intel gathered: {new Date(intelligence.generatedAt).toLocaleDateString()}
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => runIntelMutation.mutate()}
                        disabled={runIntelMutation.isPending}
                        data-testid="button-rerun-intel"
                      >
                        {runIntelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    {intelligence?.generatedAt ? "No real owner found yet" : "Not investigated yet"}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runIntelMutation.mutate()}
                    disabled={runIntelMutation.isPending}
                    data-testid="button-run-intel"
                  >
                    {runIntelMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                    Run 16-Agent Pipeline
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {intelligence?.buildingContacts && intelligence.buildingContacts.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-semibold">Building Contacts</CardTitle>
                <span className="text-xs text-muted-foreground" data-testid="badge-building-contacts-count">
                  {intelligence.buildingContacts.length} found
                </span>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                {intelligence.buildingContacts.slice(0, 8).map((contact, i) => (
                  <div key={i} className="space-y-1" data-testid={`building-contact-${i}`}>
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
                      <span className="text-sm font-medium" data-testid={`text-building-contact-name-${i}`}>{contact.name}</span>
                    </div>
                    <div className="pl-6 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground" data-testid={`badge-building-contact-role-${i}`}>{contact.role}</span>
                        {contact.company && (
                          <span className="text-xs text-muted-foreground" data-testid={`text-building-contact-company-${i}`}>{contact.company}</span>
                        )}
                      </div>
                      {contact.phone && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Phone className="w-3 h-3 text-muted-foreground/60" />
                          <a href={`tel:${contact.phone}`} className="text-primary hover:underline" data-testid={`link-building-contact-phone-${i}`}>{contact.phone}</a>
                        </div>
                      )}
                      {contact.email && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Mail className="w-3 h-3 text-muted-foreground/60" />
                          <a href={`mailto:${contact.email}`} className="text-primary hover:underline" data-testid={`link-building-contact-email-${i}`}>{contact.email}</a>
                        </div>
                      )}
                      <span className="text-[10px] text-muted-foreground" data-testid={`text-building-contact-source-${i}`}>{contact.source}</span>
                    </div>
                    {i < intelligence.buildingContacts!.length - 1 && i < 7 && <Separator className="mt-3" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {intelligence?.dossier?.skipTraceHits && intelligence.dossier.skipTraceHits.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">Skip Trace / Provenance</CardTitle>
                <span className="text-xs text-muted-foreground" data-testid="badge-skip-trace-count">
                  {intelligence.dossier.skipTraceHits.length} claims
                </span>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-3">
                {intelligence.dossier.skipTraceHits.slice(0, 12).map((hit: any, i: number) => (
                  <div key={i} className="border rounded-xl p-3 space-y-1" data-testid={`skip-trace-hit-${i}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{hit.fieldName}</span>
                      <span className="text-xs text-muted-foreground font-medium" data-testid={`badge-skip-confidence-${i}`}>
                        {hit.confidence}%
                      </span>
                    </div>
                    <p className="text-sm font-mono truncate" data-testid={`text-skip-value-${i}`}>{hit.fieldValue}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                      <span>{hit.source}</span>
                      {hit.parsingMethod && <span>via {hit.parsingMethod}</span>}
                      {hit.sourceUrl && (
                        <a href={hit.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-0.5" data-testid={`link-skip-source-${i}`}>
                          <ExternalLink className="w-2.5 h-2.5" /> source
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {evidence && evidence.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">Contact Evidence</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-evidence-count">
                      {evidence.length} record{evidence.length !== 1 ? "s" : ""}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => validateMutation.mutate()}
                      disabled={validateMutation.isPending}
                      data-testid="button-validate-contacts"
                    >
                      {validateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                      <span className="ml-1">Validate</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEvidenceExpanded(!evidenceExpanded)}
                      data-testid="button-toggle-evidence"
                    >
                      {evidenceExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                {!evidenceExpanded ? (
                  <div className="space-y-2">
                    {Object.entries(
                      evidence.reduce((acc: Record<string, ContactEvidence[]>, ev) => {
                        const key = ev.contactType;
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(ev);
                        return acc;
                      }, {})
                    ).map(([type, items]) => (
                      <div key={type} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          {type === "PHONE" && <Phone className="w-3.5 h-3.5 text-muted-foreground" />}
                          {type === "EMAIL" && <Mail className="w-3.5 h-3.5 text-muted-foreground" />}
                          {type !== "PHONE" && type !== "EMAIL" && <Database className="w-3.5 h-3.5 text-muted-foreground" />}
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{type}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono">{items.length}</span>
                          {items.some(i => i.validationStatus === "VERIFIED") && (
                            <CheckCircle className="w-3 h-3 text-green-500" />
                          )}
                          {items.some(i => i.validationStatus === "INVALID") && (
                            <XCircle className="w-3 h-3 text-red-500" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {evidence.map((ev, i) => (
                      <div key={ev.id} className="border rounded-lg p-3 space-y-2" data-testid={`evidence-item-${i}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{ev.contactType}</Badge>
                            <span className="text-sm font-mono">{ev.normalizedValue || ev.contactValue}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {ev.validationStatus === "VERIFIED" && (
                              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">Verified</Badge>
                            )}
                            {ev.validationStatus === "INVALID" && (
                              <Badge variant="destructive" className="text-[10px]">Invalid</Badge>
                            )}
                            {ev.validationStatus === "UNVERIFIED" && (
                              <Badge variant="secondary" className="text-[10px]">Unverified</Badge>
                            )}
                            <span className="text-xs font-mono font-medium">{Math.round(ev.computedScore)}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Database className="w-3 h-3" />
                            <span>{ev.sourceName}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            <span>Trust: {ev.sourceTrustScore}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Fingerprint className="w-3 h-3" />
                            <span>{ev.extractorMethod}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Layers className="w-3 h-3" />
                            <span>Corr: {ev.corroborationCount}</span>
                          </div>
                          {ev.sourceUrl && (
                            <a
                              href={ev.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 col-span-2 hover:underline"
                              data-testid={`link-evidence-source-${i}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span className="truncate">{(() => { try { return new URL(ev.sourceUrl!).hostname; } catch { return ev.sourceUrl; } })()}</span>
                            </a>
                          )}
                          {ev.extractedAt && (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{new Date(ev.extractedAt).toLocaleDateString()}</span>
                            </div>
                          )}
                          {ev.validationDetail && (
                            <div className="col-span-2 text-[10px] italic">{ev.validationDetail}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {conflicts && conflicts.length > 0 && (
            <Card className="shadow-sm border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Contact Conflicts
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600" data-testid="badge-conflict-count">
                    {conflicts.filter(c => c.resolution === "UNRESOLVED").length} unresolved
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-4">
                {conflicts.map((conflict, ci) => {
                  const candidates = (conflict.candidateValues as Array<{ value: string; score: number; evidenceId: string; source: string }>) || [];
                  const isResolved = conflict.resolution !== "UNRESOLVED";
                  return (
                    <div key={conflict.id} className={`border rounded-lg p-3 space-y-2 ${isResolved ? "opacity-60" : ""}`} data-testid={`conflict-item-${ci}`}>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-[10px]">{conflict.contactType}</Badge>
                        {isResolved ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
                            {conflict.resolution}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            Needs Review
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {candidates.map((candidate, ki) => (
                          <div key={ki} className="flex items-center justify-between gap-2 py-1 px-2 rounded bg-muted/50">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-mono truncate">{candidate.value}</span>
                              <span className="text-[10px] text-muted-foreground flex-shrink-0">{candidate.source}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs font-mono font-medium">{Math.round(candidate.score)}</span>
                              {!isResolved && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => resolveConflictMutation.mutate({ conflictId: conflict.id, pickedEvidenceId: candidate.evidenceId })}
                                  disabled={resolveConflictMutation.isPending}
                                  data-testid={`button-pick-candidate-${ci}-${ki}`}
                                >
                                  Pick
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {conflict.scoreMargin !== null && conflict.scoreMargin !== undefined && (
                        <div className="text-[10px] text-muted-foreground">Score margin: {conflict.scoreMargin.toFixed(1)} points</div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {enrichmentJobHistory && enrichmentJobHistory.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Enrichment Timeline</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0">
                <div className="space-y-3">
                  {enrichmentJobHistory.slice(0, 5).map((job, ji) => {
                    const stages = (job.stages as Array<{ name: string; status: string; startedAt?: string; finishedAt?: string; error?: string }>) || [];
                    const duration = job.startedAt && job.finishedAt
                      ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)
                      : null;
                    return (
                      <div key={job.id} className="border rounded-lg p-3 space-y-2" data-testid={`enrichment-job-${ji}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {job.status === "complete" && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                            {job.status === "running" && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
                            {job.status === "error" && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                            {job.status === "queued" && <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                            <span className="text-xs font-medium capitalize">{job.status}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {duration !== null && <span>{duration}s</span>}
                            {job.createdAt && <span>{new Date(job.createdAt).toLocaleString()}</span>}
                          </div>
                        </div>
                        {stages.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {stages.map((stage, si) => (
                              <Badge
                                key={si}
                                variant={stage.status === "complete" ? "default" : stage.status === "error" ? "destructive" : "secondary"}
                                className="text-[9px]"
                              >
                                {stage.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {job.lastError && (
                          <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-1.5 font-mono">
                            {job.lastError}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {(lead.foreclosureFlag || lead.taxDelinquent || (lead.lienCount && lead.lienCount > 0) || (lead.violationCount && lead.violationCount > 0) || lead.floodZone) && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Distress & Risk Signals</CardTitle>
                {lead.distressScore !== undefined && lead.distressScore !== null && lead.distressScore > 0 && (
                  <Badge variant="destructive" className="text-[10px]" data-testid="badge-distress-score">
                    Distress: {lead.distressScore}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-2">
                {lead.foreclosureFlag && (
                  <DetailRow icon={Ban} label="Foreclosure" value={
                    <Badge variant="destructive" className="text-[10px]" data-testid="badge-foreclosure">Active Foreclosure</Badge>
                  } />
                )}
                {lead.taxDelinquent && (
                  <DetailRow icon={DollarSign} label="Tax Status" value={
                    <Badge variant="destructive" className="text-[10px]" data-testid="badge-tax-delinquent">Tax Delinquent</Badge>
                  } />
                )}
                {lead.lienCount !== undefined && lead.lienCount !== null && lead.lienCount > 0 && (
                  <DetailRow icon={Scale} label="Liens" value={
                    <span data-testid="text-lien-count">{lead.lienCount} lien{lead.lienCount > 1 ? 's' : ''} on record</span>
                  } />
                )}
                {lead.violationCount !== undefined && lead.violationCount !== null && lead.violationCount > 0 && (
                  <DetailRow icon={ShieldAlert} label="Code Violations" value={
                    <span data-testid="text-violation-count">{lead.violationCount} violation{lead.violationCount > 1 ? 's' : ''}</span>
                  } />
                )}
                {lead.floodZone && (
                  <DetailRow icon={Droplets} label="Flood Zone" value={
                    <Badge variant={
                      ['A', 'AE', 'AH', 'AO', 'AR', 'V', 'VE'].includes(lead.floodZone) ? "destructive" : "outline"
                    } className="text-[10px]" data-testid="badge-flood-zone">
                      Zone {lead.floodZone}{lead.floodZoneSubtype ? ` (${lead.floodZoneSubtype})` : ''}
                    </Badge>
                  } />
                )}
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Compliance</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <DetailRow icon={Shield} label="Consent Status" value={
                <Badge variant={lead.consentStatus === "granted" ? "default" : lead.consentStatus === "denied" || lead.consentStatus === "revoked" ? "destructive" : "secondary"} className="text-[10px]" data-testid="badge-consent-status">
                  {lead.consentStatus || "unknown"}
                </Badge>
              } />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Lead Status</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4">
              <Select
                value={lead.status}
                onValueChange={(val) => updateMutation.mutate({ status: val })}
              >
                <SelectTrigger data-testid="select-lead-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="proposal">Proposal</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Separator />
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Notes</label>
                <Textarea
                  value={notes || lead.notes || ""}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this lead..."
                  className="resize-none text-sm"
                  rows={4}
                  data-testid="textarea-lead-notes"
                />
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => updateMutation.mutate({ notes })}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-notes"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Notes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <ScoreBreakdownCard leadId={id!} leadScore={lead.leadScore} />
        </div>
      </div>
    </div>
  );
}

function ScoreBreakdownCard({ leadId, leadScore }: { leadId: string; leadScore: number }) {
  const { data } = useQuery<{ score: number; distressScore: number; breakdown: Record<string, { points: number; max: number; detail: string }> }>({
    queryKey: ["/api/leads", leadId, "score-breakdown"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/score-breakdown`);
      if (!res.ok) throw new Error("Failed to fetch score breakdown");
      return res.json();
    },
  });

  const breakdown = data?.breakdown;
  const categories = [
    "Roof Age", "Hail Exposure", "Storm Recency", "Roof Area", "Contactability",
    "Owner Type", "Property Value", "Distress Signals", "Flood Risk", "Property Condition"
  ];

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Lead Score v3 Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <div className="space-y-3">
          {breakdown ? categories.map(cat => {
            const item = breakdown[cat];
            if (!item) return null;
            return <ScoreBar key={cat} label={cat} value={item.points} max={item.max} />;
          }) : (
            <div className="space-y-3">
              {categories.map(cat => (
                <div key={cat} className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          )}
          <Separator />
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Total Score</span>
            <ScoreBadge score={leadScore} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-medium">{value}/{max}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
