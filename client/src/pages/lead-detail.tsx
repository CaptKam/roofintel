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
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import type { Lead } from "@shared/schema";

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
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
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
  }>({
    queryKey: ["/api/leads", id, "intelligence"],
    enabled: !!lead,
  });

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

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>
          <div><Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Lead not found</p>
      </div>
    );
  }

  const roofAge = lead.roofLastReplaced ? new Date().getFullYear() - lead.roofLastReplaced : null;
  const roofArea = lead.estimatedRoofArea || Math.round(lead.sqft / Math.max(lead.stories || 1, 1));
  const daysSinceHail = lead.lastHailDate ? Math.floor((Date.now() - new Date(lead.lastHailDate).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const claimWindow = lead.claimWindowOpen ?? (daysSinceHail !== null ? daysSinceHail <= 730 : null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/leads">
          <Button variant="ghost" size="icon" data-testid="button-back-to-leads">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold tracking-tight truncate" data-testid="text-lead-address">{lead.address}</h2>
          <p className="text-sm text-muted-foreground">{lead.city}, {lead.county} County, {lead.state} {lead.zipCode}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <StatusBadge status={lead.status} />
          <ScoreBadge score={lead.leadScore} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Property Details
              </CardTitle>
            </CardHeader>
            <CardContent>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CloudLightning className="w-4 h-4 text-primary" />
                Hail Exposure
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-md">
                  <p className="text-2xl font-bold" data-testid="text-hail-events">{lead.hailEvents}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Hail Events</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-md">
                  <p className="text-2xl font-bold" data-testid="text-last-hail-date">{lead.lastHailDate || "N/A"}</p>
                  <p className="text-xs text-muted-foreground mt-1">Last Hail Date</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-md">
                  <p className="text-2xl font-bold" data-testid="text-last-hail-size">
                    {lead.lastHailSize ? `${lead.lastHailSize}"` : "N/A"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Largest Hail Size</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-md">
                  {claimWindow !== null ? (
                    <>
                      <p className={`text-2xl font-bold ${claimWindow ? "text-emerald-600" : "text-amber-500"}`} data-testid="text-claim-window">
                        {claimWindow ? "OPEN" : "CLOSED"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Insurance Claim Window
                        {daysSinceHail !== null && <span className="block">{daysSinceHail} days ago</span>}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-muted-foreground" data-testid="text-claim-window">N/A</p>
                      <p className="text-xs text-muted-foreground mt-1">Insurance Claim Window</p>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />
                Valuation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Improvement Value</p>
                  <p className="text-lg font-semibold mt-0.5">
                    {lead.improvementValue ? `$${lead.improvementValue.toLocaleString()}` : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Land Value</p>
                  <p className="text-lg font-semibold mt-0.5">
                    {lead.landValue ? `$${lead.landValue.toLocaleString()}` : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Assessed Value</p>
                  <p className="text-lg font-semibold mt-0.5">
                    {lead.totalValue ? `$${lead.totalValue.toLocaleString()}` : "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Owner / Contact
              </CardTitle>
              {confidence && (
                <Badge
                  variant={confidence.level === "high" ? "default" : confidence.level === "medium" ? "secondary" : "outline"}
                  className="text-[10px]"
                  data-testid="badge-contact-confidence"
                >
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  {confidence.level === "high" ? "High" : confidence.level === "medium" ? "Medium" : "Low"} Confidence ({confidence.score}/100)
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-1">
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
                  <span className="flex items-center gap-2">
                    <a href={`tel:${lead.ownerPhone}`} className="text-primary hover:underline">{lead.ownerPhone}</a>
                    {lead.phoneSource && (
                      <Badge variant="outline" className="text-[10px]">via {lead.phoneSource}</Badge>
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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Search className="w-4 h-4 text-primary" />
                  Business & Decision Maker
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
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
                  <Badge variant="outline" className="text-[10px] mt-1">
                    via {lead.contactSource}
                  </Badge>
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

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-primary" />
                Owner Intelligence
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {(lead as any).ownershipFlag && (
                  <Badge
                    variant="destructive"
                    className="text-[10px]"
                    data-testid="badge-ownership-flag"
                  >
                    <ShieldAlert className="w-3 h-3 mr-0.5" />
                    {(lead as any).ownershipFlag}
                  </Badge>
                )}
                {intelligence?.score !== undefined && intelligence.score > 0 && (
                  <Badge variant={intelligence.score >= 70 ? "default" : "outline"} className="text-[10px]" data-testid="badge-intel-score">
                    {intelligence.score}/100
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
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
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><LinkIcon className="w-3 h-3" /> LLC Chain</p>
                      {intelligence.llcChain.slice(0, 3).map((link, i) => (
                        <div key={i} className="flex items-center gap-1 text-xs pl-3 py-0.5">
                          <span className="text-muted-foreground">{i > 0 ? "  " : ""}</span>
                          <span>{link.entityName}</span>
                          {link.status && <Badge variant="outline" className="text-[8px] no-default-active-elevate">{link.status}</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                  {intelligence.sources && intelligence.sources.length > 0 && (
                    <div className="flex gap-1 flex-wrap pt-1">
                      {intelligence.sources.map(s => (
                        <Badge key={s} variant="outline" className="text-[10px] no-default-active-elevate">{s}</Badge>
                      ))}
                    </div>
                  )}
                  {intelligence.generatedAt && (
                    <div className="flex items-center gap-2 pt-1">
                      <p className="text-[10px] text-muted-foreground">
                        Intel gathered: {new Date(intelligence.generatedAt).toLocaleDateString()}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-2 text-[10px]"
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
                <div className="text-center py-3">
                  <p className="text-xs text-muted-foreground mb-2">
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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <HardHat className="w-4 h-4 text-primary" />
                  Building Contacts
                </CardTitle>
                <Badge variant="outline" className="text-[10px] no-default-active-elevate" data-testid="badge-building-contacts-count">
                  {intelligence.buildingContacts.length} found
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {intelligence.buildingContacts.slice(0, 8).map((contact, i) => (
                  <div key={i} className="space-y-1" data-testid={`building-contact-${i}`}>
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium" data-testid={`text-building-contact-name-${i}`}>{contact.name}</span>
                    </div>
                    <div className="pl-5 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] no-default-active-elevate" data-testid={`badge-building-contact-role-${i}`}>{contact.role}</Badge>
                        {contact.company && (
                          <span className="text-xs text-muted-foreground" data-testid={`text-building-contact-company-${i}`}>{contact.company}</span>
                        )}
                      </div>
                      {contact.phone && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Phone className="w-3 h-3 text-muted-foreground" />
                          <a href={`tel:${contact.phone}`} className="text-primary hover:underline" data-testid={`link-building-contact-phone-${i}`}>{contact.phone}</a>
                        </div>
                      )}
                      {contact.email && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Mail className="w-3 h-3 text-muted-foreground" />
                          <a href={`mailto:${contact.email}`} className="text-primary hover:underline" data-testid={`link-building-contact-email-${i}`}>{contact.email}</a>
                        </div>
                      )}
                      <span className="text-[10px] text-muted-foreground" data-testid={`text-building-contact-source-${i}`}>{contact.source}</span>
                    </div>
                    {i < intelligence.buildingContacts!.length - 1 && i < 7 && <Separator className="mt-2" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {intelligence?.dossier?.skipTraceHits && intelligence.dossier.skipTraceHits.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  Skip Trace / Provenance
                </CardTitle>
                <Badge variant="outline" className="text-[10px] no-default-active-elevate" data-testid="badge-skip-trace-count">
                  {intelligence.dossier.skipTraceHits.length} claims
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {intelligence.dossier.skipTraceHits.slice(0, 12).map((hit: any, i: number) => (
                  <div key={i} className="border rounded-md p-2 space-y-1" data-testid={`skip-trace-hit-${i}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{hit.fieldName}</span>
                      <Badge variant={hit.confidence >= 70 ? "default" : "outline"} className="text-[10px] no-default-active-elevate" data-testid={`badge-skip-confidence-${i}`}>
                        {hit.confidence}%
                      </Badge>
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

          {(lead.foreclosureFlag || lead.taxDelinquent || (lead.lienCount && lead.lienCount > 0) || (lead.violationCount && lead.violationCount > 0) || lead.floodZone) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Distress & Risk Signals
                </CardTitle>
                {lead.distressScore !== undefined && lead.distressScore !== null && lead.distressScore > 0 && (
                  <Badge variant="destructive" className="text-[10px]" data-testid="badge-distress-score">
                    Distress: {lead.distressScore}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DetailRow icon={Shield} label="Consent Status" value={
                <Badge variant={lead.consentStatus === "granted" ? "default" : lead.consentStatus === "denied" || lead.consentStatus === "revoked" ? "destructive" : "secondary"} className="text-[10px]" data-testid="badge-consent-status">
                  {lead.consentStatus || "unknown"}
                </Badge>
              } />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Lead Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Notes</label>
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
                  className="mt-2 w-full"
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Lead Score v3 Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
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
                  <Skeleton className="h-1.5 w-full" />
                </div>
              ))}
            </div>
          )}
          <Separator />
          <div className="flex items-center justify-between">
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
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-medium">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
