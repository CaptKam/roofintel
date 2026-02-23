import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import ForceGraph2D from "react-force-graph-2d";
import { Search, Loader2, Share2, Building2, User, Landmark, MapPin, RefreshCw, ZoomIn, ZoomOut, Maximize2, Info, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface GraphNodeData {
  id: string;
  nodeType: string;
  label: string;
  normalizedLabel: string;
  entityId: string | null;
  metadata: any;
}

interface GraphEdgeData {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  label: string;
  weight: number;
  evidence: string | null;
}

interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

interface BuildStatus {
  id?: string;
  status: string;
  nodesCreated?: number;
  edgesCreated?: number;
  leadsProcessed?: number;
  totalLeads?: number;
  currentPhase?: string;
}

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  topConnected: Array<{ id: string; label: string; nodeType: string; connections: number }>;
  lastBuild: any;
}

const NODE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  company: "#8b5cf6",
  property: "#10b981",
  llc: "#f59e0b",
  address: "#6b7280",
};

const NODE_ICONS: Record<string, any> = {
  person: User,
  company: Building2,
  property: Landmark,
  llc: Share2,
  address: MapPin,
};

const EDGE_COLORS: Record<string, string> = {
  owns: "#10b981",
  manages_property: "#8b5cf6",
  officer_of: "#3b82f6",
  registered_agent_for: "#f59e0b",
  member_of: "#ef4444",
  located_at: "#6b7280",
  shared_officer: "#ec4899",
  shared_agent: "#f97316",
  mailing_match: "#06b6d4",
};

function formatGraphForForce(data: GraphData) {
  const nodeMap = new Map<string, any>();
  for (const n of data.nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      label: n.label,
      nodeType: n.nodeType,
      entityId: n.entityId,
      metadata: n.metadata,
      color: NODE_COLORS[n.nodeType] || "#6b7280",
    });
  }

  const links = data.edges
    .filter(e => nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId))
    .map(e => ({
      source: e.sourceNodeId,
      target: e.targetNodeId,
      edgeType: e.edgeType,
      label: e.label,
      weight: e.weight,
      evidence: e.evidence,
      color: EDGE_COLORS[e.edgeType] || "#94a3b8",
    }));

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
}

export default function NetworkExplorer() {
  const { toast } = useToast();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const { data: stats, isLoading: statsLoading } = useQuery<GraphStats>({
    queryKey: ["/api/graph/stats"],
    refetchInterval: 10000,
  });

  const { data: buildStatus } = useQuery<BuildStatus>({
    queryKey: ["/api/graph/build/status"],
    refetchInterval: (query) => {
      const data = query.state.data as BuildStatus | undefined;
      return data?.status === "running" ? 2000 : 30000;
    },
  });

  const { data: searchResults } = useQuery<GraphNodeData[]>({
    queryKey: [`/api/graph/search?q=${encodeURIComponent(searchQuery)}`],
    enabled: searchQuery.length >= 2,
  });

  const buildMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/graph/build"),
    onSuccess: () => {
      toast({ title: "Graph build started", description: "Processing all leads to build relationship network..." });
      queryClient.invalidateQueries({ queryKey: ["/api/graph/build/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Build failed", description: err.message, variant: "destructive" });
    },
  });

  const loadNode = useCallback(async (nodeId: string, depth: number = 2) => {
    try {
      const res = await fetch(`/api/graph/node/${nodeId}?depth=${depth}`);
      const data: GraphData = await res.json();
      const formatted = formatGraphForForce(data);

      setGraphData(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.id));
        const existingLinkKeys = new Set(prev.links.map((l: any) => `${l.source?.id || l.source}:${l.target?.id || l.target}`));

        const newNodes = formatted.nodes.filter(n => !existingNodeIds.has(n.id));
        const newLinks = formatted.links.filter(l => {
          const key = `${l.source}:${l.target}`;
          return !existingLinkKeys.has(key);
        });

        return {
          nodes: [...prev.nodes, ...newNodes],
          links: [...prev.links, ...newLinks],
        };
      });
    } catch (err) {
      console.error("Failed to load node:", err);
    }
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
    loadNode(node.id, 1);
  }, [loadNode]);

  const handleSearchSelect = useCallback((node: GraphNodeData) => {
    setSearchQuery("");
    setGraphData({ nodes: [], links: [] });
    setSelectedNode(null);
    loadNode(node.id, 2);
  }, [loadNode]);

  const handleReset = useCallback(() => {
    setGraphData({ nodes: [], links: [] });
    setSelectedNode(null);
    setSearchQuery("");
  }, []);

  const isBuilding = buildStatus?.status === "running";
  const hasGraph = (stats?.totalNodes || 0) > 0;
  const buildProgress = isBuilding && buildStatus?.totalLeads
    ? Math.round(((buildStatus?.leadsProcessed || 0) / buildStatus.totalLeads) * 100)
    : 0;

  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = node.id === selectedNode?.id ? 8 : 6;
    const fontSize = Math.max(10 / globalScale, 1.5);

    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color || "#6b7280";
    ctx.fill();

    if (node.id === selectedNode?.id) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (globalScale > 0.8) {
      const label = node.label.length > 25 ? node.label.substring(0, 22) + "..." : node.label;
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = node.id === selectedNode?.id ? "#ffffff" : "rgba(255,255,255,0.8)";
      ctx.fillText(label, node.x, node.y + size + 2);
    }
  }, [selectedNode]);

  return (
    <div className="h-full flex flex-col" data-testid="page-network-explorer">
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Network Explorer</h1>
            <p className="text-xs text-muted-foreground">
              {hasGraph
                ? `${stats?.totalNodes?.toLocaleString()} entities, ${stats?.totalEdges?.toLocaleString()} connections`
                : "Build a relationship graph to explore ownership networks"
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              data-testid="input-graph-search"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
            {searchResults && searchResults.length > 0 && searchQuery.length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-64 overflow-auto">
                {searchResults.map((node) => {
                  const Icon = NODE_ICONS[node.nodeType] || Share2;
                  return (
                    <button
                      key={node.id}
                      data-testid={`search-result-${node.id}`}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-accent transition-colors"
                      onClick={() => handleSearchSelect(node)}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: NODE_COLORS[node.nodeType] }} />
                      <span className="truncate font-medium">{node.label}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
                        {node.nodeType}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Button
            data-testid="button-build-graph"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => buildMutation.mutate()}
            disabled={isBuilding || buildMutation.isPending}
          >
            {isBuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {isBuilding ? `Building ${buildProgress}%` : "Build Graph"}
          </Button>
          {graphData.nodes.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleReset} data-testid="button-reset-graph">
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {isBuilding && (
        <div className="px-6 py-2 bg-primary/5 border-b">
          <div className="flex items-center gap-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            <div className="flex-1">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${buildProgress}%` }}
                />
              </div>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {buildStatus?.leadsProcessed?.toLocaleString()}/{buildStatus?.totalLeads?.toLocaleString()} leads
              {" | "}{buildStatus?.nodesCreated?.toLocaleString()} nodes
              {" | "}{buildStatus?.edgesCreated?.toLocaleString()} edges
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{buildStatus?.currentPhase}</p>
        </div>
      )}

      <div className="flex-1 flex">
        <div className="flex-1 relative bg-slate-950" ref={containerRef}>
          {graphData.nodes.length > 0 ? (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width - (selectedNode ? 320 : 0)}
              height={dimensions.height}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath();
                ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={(link: any) => link.color || "#334155"}
              linkWidth={(link: any) => Math.max(0.5, link.weight * 1.5)}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={0.75}
              linkLabel={(link: any) => link.label || link.edgeType}
              onNodeClick={handleNodeClick}
              backgroundColor="#0f172a"
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              linkDirectionalParticles={1}
              linkDirectionalParticleWidth={1.5}
              linkDirectionalParticleSpeed={0.005}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {!hasGraph ? (
                <div className="text-center space-y-4">
                  <Share2 className="w-16 h-16 text-slate-600 mx-auto" />
                  <div>
                    <h3 className="text-lg font-semibold text-slate-300" data-testid="text-empty-title">No Relationship Graph Yet</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-md">
                      Build a graph from your lead database to visualize ownership networks, LLC chains, and decision-maker connections.
                    </p>
                  </div>
                  <Button
                    data-testid="button-build-graph-empty"
                    onClick={() => buildMutation.mutate()}
                    disabled={isBuilding || buildMutation.isPending}
                    className="gap-2"
                  >
                    {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Build Relationship Graph
                  </Button>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <Search className="w-12 h-12 text-slate-600 mx-auto" />
                  <div>
                    <h3 className="text-base font-semibold text-slate-300" data-testid="text-search-prompt">Search to Explore</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Search for an owner, company, or address to start exploring the network.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {graphData.nodes.length > 0 && (
            <div className="absolute bottom-4 left-4 flex gap-1.5">
              <Button variant="secondary" size="icon" className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700" onClick={() => graphRef.current?.zoomIn(2)}>
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700" onClick={() => graphRef.current?.zoomOut(2)}>
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="icon" className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700" onClick={() => graphRef.current?.zoomToFit(400)}>
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {graphData.nodes.length > 0 && (
            <div className="absolute top-4 left-4 bg-slate-800/80 backdrop-blur-sm rounded-lg p-3 space-y-1.5">
              {Object.entries(NODE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-slate-300 capitalize">{type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedNode && (
          <div className="w-80 border-l bg-background overflow-auto" data-testid="panel-node-detail">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = NODE_ICONS[selectedNode.nodeType] || Share2;
                    return <Icon className="w-4 h-4" style={{ color: NODE_COLORS[selectedNode.nodeType] }} />;
                  })()}
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 capitalize"
                    style={{ borderColor: NODE_COLORS[selectedNode.nodeType], color: NODE_COLORS[selectedNode.nodeType] }}
                  >
                    {selectedNode.nodeType}
                  </Badge>
                </div>
                <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setSelectedNode(null)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <h3 className="text-sm font-semibold mt-2" data-testid="text-selected-node-label">{selectedNode.label}</h3>
            </div>

            {selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0 && (
              <div className="p-4 border-b">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Details</h4>
                <div className="space-y-1.5">
                  {Object.entries(selectedNode.metadata).map(([key, value]) => {
                    if (!value || value === "null") return null;
                    return (
                      <div key={key} className="flex items-start justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                        <span className="text-[11px] font-medium text-right max-w-[160px] truncate">
                          {typeof value === "number" ? value.toLocaleString() : String(value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="p-4">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Connections</h4>
              <div className="space-y-1">
                {graphData.links
                  .filter((l: any) => {
                    const srcId = l.source?.id || l.source;
                    const tgtId = l.target?.id || l.target;
                    return srcId === selectedNode.id || tgtId === selectedNode.id;
                  })
                  .map((link: any, i: number) => {
                    const srcId = link.source?.id || link.source;
                    const tgtId = link.target?.id || link.target;
                    const otherId = srcId === selectedNode.id ? tgtId : srcId;
                    const otherNode = graphData.nodes.find(n => n.id === otherId);
                    const direction = srcId === selectedNode.id ? "outgoing" : "incoming";
                    return (
                      <button
                        key={i}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-left hover:bg-accent transition-colors text-xs"
                        onClick={() => {
                          if (otherNode) {
                            setSelectedNode(otherNode);
                            loadNode(otherNode.id, 1);
                          }
                        }}
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: EDGE_COLORS[link.edgeType] || "#6b7280" }} />
                        <span className="truncate flex-1">{otherNode?.label || otherId}</span>
                        <span className="text-[10px] text-muted-foreground">{link.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            {selectedNode.entityId && (
              <div className="p-4 border-t">
                <a
                  href={`/leads/${selectedNode.entityId}`}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  data-testid="link-view-lead"
                >
                  <Info className="w-3 h-3" />
                  View Lead Details
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {hasGraph && graphData.nodes.length === 0 && !isBuilding && stats && (
        <div className="border-t bg-background/80">
          <div className="px-6 py-3">
            <div className="flex items-center gap-6">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Connected</h4>
              <div className="flex items-center gap-3 flex-1 overflow-x-auto">
                {stats.topConnected.slice(0, 8).map((node) => {
                  const Icon = NODE_ICONS[node.nodeType] || Share2;
                  return (
                    <button
                      key={node.id}
                      data-testid={`top-connected-${node.id}`}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 hover:bg-muted transition-colors whitespace-nowrap"
                      onClick={() => handleSearchSelect(node as any)}
                    >
                      <Icon className="w-3 h-3" style={{ color: NODE_COLORS[node.nodeType] }} />
                      <span className="text-[11px] font-medium truncate max-w-[120px]">{node.label}</span>
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{node.connections}</Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
