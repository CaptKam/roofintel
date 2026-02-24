import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  GitBranch, 
  Users, 
  MapPinned, 
  Zap, 
  Phone, 
  Mail, 
  UserCheck 
} from "lucide-react";

interface GraphIntelligence {
  hasData: boolean;
  lastBuilt: string | null;
  sharedOfficers: Array<{
    officerName: string;
    connectedEntities: Array<{
      name: string;
      type: string;
      propertyCount: number;
      properties: Array<{ leadId: string; address: string; city: string; leadScore: number }>;
    }>;
  }>;
  sharedAgents: Array<{
    agentName: string;
    entityCount: number;
    entities: Array<{ name: string; type: string }>;
  }>;
  mailingClusters: Array<{
    address: string;
    owners: Array<{
      name: string;
      propertyCount: number;
      properties: Array<{ leadId: string; address: string; city: string }>;
    }>;
  }>;
  networkContacts: Array<{
    name: string;
    phone?: string;
    email?: string;
    title?: string;
    relationshipPath: string;
    confidence: number;
  }>;
  connectedPropertyCount: number;
}

export function NetworkIntelligence({ leadId }: { leadId: string }) {
  const { data: graphIntel } = useQuery<GraphIntelligence>({
    queryKey: ["/api/leads", leadId, "graph-intelligence"],
    enabled: !!leadId,
  });

  if (!graphIntel?.hasData) {
    return (
      <Card className="border-dashed border-2 bg-muted/30">
        <CardContent className="pt-6 text-center">
          <GitBranch className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-medium text-muted-foreground">Network Intelligence Locked</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Build the relationship graph in Network Explorer to unlock cross-entity intelligence.
          </p>
          <Link href="/network-explorer">
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Go to Network Explorer
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const hasAnyIntel = (graphIntel.sharedOfficers?.length || 0) > 0 ||
                      (graphIntel.sharedAgents?.length || 0) > 0 ||
                      (graphIntel.mailingClusters?.length || 0) > 0 ||
                      (graphIntel.networkContacts?.length || 0) > 0;

  if (!hasAnyIntel) return null;

  return (
    <Card className="shadow-sm border-blue-100 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/20" data-testid="card-network-intelligence">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <CardTitle className="text-base font-semibold text-blue-900 dark:text-blue-300">Network Intelligence</CardTitle>
          </div>
          {graphIntel.lastBuilt && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider" data-testid="text-graph-last-built">
              Build: {new Date(graphIntel.lastBuilt).toLocaleDateString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-0 space-y-4">
        {graphIntel.sharedOfficers && graphIntel.sharedOfficers.length > 0 && (
          <div className="space-y-2" data-testid="section-shared-officers">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3 h-3" />
              Connected Entities
            </div>
            {graphIntel.sharedOfficers.map((officer, oi) => (
              <div key={oi} className={`space-y-1 ${oi > 0 ? "pt-2 border-t border-blue-100/50" : ""}`} data-testid={`shared-officer-${oi}`}>
                <p className="text-sm">
                  <span className="font-semibold text-blue-800 dark:text-blue-400" data-testid={`text-officer-name-${oi}`}>{officer.officerName}</span>
                  <span className="text-muted-foreground"> also controls:</span>
                </p>
                <div className="pl-3 space-y-1">
                  {officer.connectedEntities.map((entity, ei) => (
                    <div key={ei} className="space-y-0.5" data-testid={`connected-entity-${oi}-${ei}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-medium">{entity.name}</span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">{entity.type}</Badge>
                      </div>
                      {entity.properties && entity.properties.length > 0 && (
                        <div className="pl-2 flex flex-wrap gap-1">
                          {entity.properties.slice(0, 5).map((prop) => (
                            <Link key={prop.leadId} href={`/leads/${prop.leadId}`}>
                              <Badge variant="secondary" className="text-[9px] h-4 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors" data-testid={`link-entity-property-${prop.leadId}`}>
                                {prop.address} ({prop.leadScore})
                              </Badge>
                            </Link>
                          ))}
                          {entity.properties.length > 5 && (
                            <span className="text-[9px] text-muted-foreground">+{entity.properties.length - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {graphIntel.mailingClusters && graphIntel.mailingClusters.length > 0 && (
          <div className="space-y-2" data-testid="section-mailing-clusters">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MapPinned className="w-3 h-3" />
              Address Clusters
            </div>
            {graphIntel.mailingClusters.map((cluster, ci) => (
              <div key={ci} className={`space-y-1 ${ci > 0 ? "pt-2 border-t border-blue-100/50" : ""}`} data-testid={`mailing-cluster-${ci}`}>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{cluster.address}</span> is shared with {cluster.owners?.length || 0} other {cluster.owners?.length === 1 ? "owner" : "owners"}:
                </p>
                <div className="pl-3 flex flex-wrap gap-1">
                  {cluster.owners?.map((owner, owi) => (
                    <div key={owi} className="flex flex-wrap gap-1">
                      {owner.properties?.map((prop) => (
                        <Link key={prop.leadId} href={`/leads/${prop.leadId}`}>
                          <Badge variant="outline" className="text-[9px] h-4 cursor-pointer hover:border-blue-400" data-testid={`link-cluster-property-${prop.leadId}`}>
                            {owner.name}: {prop.address}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {graphIntel.networkContacts && graphIntel.networkContacts.length > 0 && (
          <div className="space-y-2" data-testid="section-network-contacts">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-500" />
              Network-Derived Contacts
            </div>
            {graphIntel.networkContacts.map((contact, ni) => (
              <div key={ni} className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg border border-blue-100/50 dark:border-blue-900/50 space-y-2" data-testid={`network-contact-${ni}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold" data-testid={`text-network-contact-name-${ni}`}>{contact.name}</span>
                    {contact.title && <p className="text-[10px] text-muted-foreground uppercase">{contact.title}</p>}
                  </div>
                  <Badge variant="outline" className="text-[9px] border-blue-200 text-blue-700 bg-blue-50/50" data-testid={`badge-contact-confidence-${ni}`}>
                    {Math.round(contact.confidence * 100)}% Conf
                  </Badge>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className="text-[11px] font-mono text-primary flex items-center gap-1 hover:underline" data-testid={`link-network-phone-${ni}`}>
                      <Phone className="w-2.5 h-2.5" /> {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-[11px] font-mono text-primary flex items-center gap-1 hover:underline" data-testid={`link-network-email-${ni}`}>
                      <Mail className="w-2.5 h-2.5" /> {contact.email}
                    </a>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground italic" data-testid={`text-relationship-path-${ni}`}>
                  {contact.relationshipPath}
                </p>
              </div>
            ))}
          </div>
        )}

        {graphIntel.sharedAgents && graphIntel.sharedAgents.length > 0 && (
          <div className="space-y-2" data-testid="section-shared-agents">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <UserCheck className="w-3 h-3" />
              Shared Agent
            </div>
            {graphIntel.sharedAgents.map((agent, ai) => (
              <div key={ai} className="text-xs" data-testid={`shared-agent-${ai}`}>
                <span className="font-medium">{agent.agentName}</span>
                <span className="text-muted-foreground"> represents {agent.entityCount} other entities in your leads.</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
