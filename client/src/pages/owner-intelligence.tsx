import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Users,
  ShieldCheck,
  Bot,
  Play,
  Eye,
  Phone,
  Mail,
  MapPin,
  Building2,
  Link as LinkIcon,
  ChevronRight,
  Search,
  FileText,
  Scale,
  Globe,
  Fingerprint,
  UserCheck,
  Loader2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { Lead } from "@shared/schema";

interface IntelligenceStatusAgent {
  name: string;
  available: boolean;
  description: string;
}

function AgentIcon({ name }: { name: string }) {
  switch (name) {
    case "TX SOS Deep": return <FileText className="w-3.5 h-3.5" />;
    case "LLC Chain": return <LinkIcon className="w-3.5 h-3.5" />;
    case "TX Comptroller": return <Scale className="w-3.5 h-3.5" />;
    case "Property Tax Records": return <Building2 className="w-3.5 h-3.5" />;
    case "People Search": return <Search className="w-3.5 h-3.5" />;
    case "Email Discovery": return <Mail className="w-3.5 h-3.5" />;
    case "Google Business": return <Globe className="w-3.5 h-3.5" />;
    case "Court Records": return <Scale className="w-3.5 h-3.5" />;
    case "Social Intelligence": return <Users className="w-3.5 h-3.5" />;
    case "Building Contacts": return <Building2 className="w-3.5 h-3.5" />;
    case "Master Orchestrator": return <Bot className="w-3.5 h-3.5" />;
    default: return <Bot className="w-3.5 h-3.5" />;
  }
}

function IntelligenceScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "text-green-600 dark:text-green-400" : score >= 40 ? "text-yellow-600 dark:text-yellow-400" : score > 0 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground";
  const label = score >= 70 ? "Unmasked" : score >= 40 ? "Partial" : score > 0 ? "Minimal" : "Unknown";

  return (
    <Badge variant="outline" className="gap-1" data-testid={`badge-intel-score-${score}`}>
      <Fingerprint className={`w-3 h-3 ${color}`} />
      <span className={color}>{score}</span>
      <span className="text-muted-foreground">/ 100</span>
      <span className={`ml-0.5 ${color}`}>{label}</span>
    </Badge>
  );
}

export default function OwnerIntelligence() {
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useQuery<{ agents: IntelligenceStatusAgent[]; totalAvailable: number }>({
    queryKey: ["/api/intelligence/status"],
  });

  const { data: leadsData, isLoading: leadsLoading } = useQuery<{ leads: Lead[]; total: number }>({
    queryKey: ["/api/leads?limit=200&sortBy=intelligenceScore"],
  });

  const runPipelineMutation = useMutation({
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

  const leads = leadsData?.leads || [];
  const llcLeads = leads.filter(l => l.ownerType === "LLC" || l.ownerType === "Corporation" || l.ownerType === "LP");
  const intelligenced = llcLeads.filter(l => l.intelligenceAt);
  const unmasked = llcLeads.filter(l => (l.intelligenceScore || 0) >= 70);
  const partial = llcLeads.filter(l => (l.intelligenceScore || 0) >= 40 && (l.intelligenceScore || 0) < 70);
  const withPeople = llcLeads.filter(l => l.managingMember);

  const topLeads = llcLeads
    .filter(l => l.intelligenceAt && l.managingMember)
    .sort((a, b) => (b.intelligenceScore || 0) - (a.intelligenceScore || 0))
    .slice(0, 20);

  const pendingLeads = llcLeads
    .filter(l => !l.intelligenceAt)
    .sort((a, b) => b.leadScore - a.leadScore)
    .slice(0, 10);

  if (statusLoading || leadsLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <Fingerprint className="w-5 h-5 text-primary" />
            Owner Intelligence
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">11-agent pipeline to unmask the real people behind LLCs and find building contacts</p>
        </div>
        <Button
          onClick={() => runPipelineMutation.mutate()}
          disabled={runPipelineMutation.isPending}
          data-testid="button-run-pipeline"
        >
          {runPipelineMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Run Intelligence Pipeline
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">LLC/Corp Leads</p>
            <p className="text-2xl font-bold mt-1" data-testid="stat-llc-leads">{llcLeads.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{intelligenced.length} investigated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">People Found</p>
            <p className="text-2xl font-bold mt-1" data-testid="stat-people-found">{withPeople.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">real people behind LLCs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">Fully Unmasked</p>
            <p className="text-2xl font-bold mt-1" data-testid="stat-unmasked">{unmasked.length}</p>
            <Progress value={llcLeads.length > 0 ? (unmasked.length / llcLeads.length) * 100 : 0} className="h-1.5 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <p className="text-xs text-muted-foreground">Partial Intel</p>
            <p className="text-2xl font-bold mt-1" data-testid="stat-partial">{partial.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{llcLeads.length - intelligenced.length} pending</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                Unmasked Owners
                <Badge variant="outline" className="text-[10px] ml-auto no-default-active-elevate">{topLeads.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topLeads.length === 0 ? (
                <div className="text-center py-8">
                  <Fingerprint className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No owners unmasked yet. Run the intelligence pipeline to get started.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {topLeads.map(lead => (
                    <Link key={lead.id} href={`/leads/${lead.id}`}>
                      <div className="flex items-center gap-3 p-2.5 rounded-md hover-elevate cursor-pointer" data-testid={`row-intel-lead-${lead.id}`}>
                        <IntelligenceScoreBadge score={lead.intelligenceScore || 0} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{lead.managingMember}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {lead.managingMemberTitle || "Owner"} at {lead.ownerName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {lead.managingMemberPhone && (
                            <Badge variant="outline" className="text-[10px] no-default-active-elevate">
                              <Phone className="w-2.5 h-2.5 mr-0.5" /> Phone
                            </Badge>
                          )}
                          {lead.managingMemberEmail && (
                            <Badge variant="outline" className="text-[10px] no-default-active-elevate">
                              <Mail className="w-2.5 h-2.5 mr-0.5" /> Email
                            </Badge>
                          )}
                          {(() => {
                            const bc = lead.buildingContacts as any[] | null;
                            return bc && bc.length > 0 ? (
                              <Badge variant="outline" className="text-[10px] no-default-active-elevate" data-testid={`badge-bldg-contacts-${lead.id}`}>
                                <Building2 className="w-2.5 h-2.5 mr-0.5" /> {bc.length} Bldg
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {pendingLeads.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  Pending Investigation
                  <Badge variant="secondary" className="text-[10px] ml-auto no-default-active-elevate">{llcLeads.length - intelligenced.length} remaining</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {pendingLeads.map(lead => (
                    <div key={lead.id} className="flex items-center gap-3 p-2.5 rounded-md" data-testid={`row-pending-lead-${lead.id}`}>
                      <Badge variant="outline" className="text-[10px] no-default-active-elevate">
                        Score {lead.leadScore}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{lead.ownerName}</p>
                        <p className="text-xs text-muted-foreground truncate">{lead.address}, {lead.city}</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] no-default-active-elevate">{lead.ownerType}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                Intelligence Agents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {status?.agents.map((agent, i) => (
                  <div key={agent.name} className="flex items-center gap-2.5 py-1.5" data-testid={`agent-status-${i}`}>
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-mono font-bold ${agent.available ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <AgentIcon name={agent.name} />
                        <span className="text-xs font-medium">{agent.name}</span>
                        {agent.available ? (
                          <ShieldCheck className="w-3 h-3 text-green-500" />
                        ) : (
                          <Badge variant="outline" className="text-[10px] no-default-active-elevate">needs API key</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{agent.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">
                {status?.totalAvailable || 0} of {status?.agents.length || 10} agents active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">How It Works</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>The intelligence pipeline runs 11 specialized agents against each LLC/Corporation to find the real human owners and building-connected people:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Search TX Secretary of State filings for officers</li>
                <li>Follow LLC ownership chains up to 3 levels</li>
                <li>Query TX Comptroller for responsible parties</li>
                <li>Extract contacts from property tax records</li>
                <li>Web search to find phone/email for people</li>
                <li>Generate and verify email patterns</li>
                <li>Pull Google Business profiles and reviews</li>
                <li>Search court filings and building permits</li>
                <li>Check BBB, LinkedIn, business registrations</li>
                <li>Find property managers, tenants, and contractors connected to the building</li>
                <li>Deduplicate all findings and score confidence</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
