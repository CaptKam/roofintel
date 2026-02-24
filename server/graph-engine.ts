import { db } from "./storage";
import { graphNodes, graphEdges, graphBuildRuns, leads, type GraphNode, type GraphEdge } from "@shared/schema";
import { eq, sql, and, or, inArray } from "drizzle-orm";

function normalize(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toUpperCase()
    .replace(/[,.\-'"#&()]/g, "")
    .replace(/\b(LLC|L\.L\.C|LC|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC|PC|CO|COMPANY|TRUST|REVOCABLE|IRREVOCABLE|LIVING|FAMILY|SERIES|SER|THE)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPerson(name: string): boolean {
  const upper = name.toUpperCase();
  const corpIndicators = /\b(LLC|INC|CORP|LTD|LP|LLP|PLLC|TRUST|ESTATE|COMPANY|FUND|BANK|CHURCH|SCHOOL|CENTER|DISTRICT|CITY OF|STATE OF|COUNTY OF|ASSOCIATION|FOUNDATION|UNIVERSITY|HOSPITAL)\b/i;
  if (corpIndicators.test(name)) return false;
  const parts = normalize(name).split(" ").filter(p => p.length > 1);
  return parts.length >= 2 && parts.length <= 5;
}

type NodeType = "person" | "company" | "property" | "llc" | "address";
type EdgeType = "owns" | "manages" | "officer_of" | "registered_agent_for" | "located_at" | "shared_officer" | "shared_agent" | "member_of" | "manages_property" | "mailing_match";

const nodeCache = new Map<string, string>();

async function getOrCreateNode(
  nodeType: NodeType,
  label: string,
  entityId?: string,
  metadata?: any
): Promise<string> {
  const normalizedLabel = normalize(label);
  if (!normalizedLabel || normalizedLabel.length < 2) return "";

  const cacheKey = `${nodeType}:${normalizedLabel}`;
  if (nodeCache.has(cacheKey)) return nodeCache.get(cacheKey)!;

  const existing = await db.select({ id: graphNodes.id })
    .from(graphNodes)
    .where(and(
      eq(graphNodes.nodeType, nodeType),
      eq(graphNodes.normalizedLabel, normalizedLabel)
    ))
    .limit(1);

  if (existing.length > 0) {
    nodeCache.set(cacheKey, existing[0].id);
    return existing[0].id;
  }

  const [row] = await db.insert(graphNodes).values({
    nodeType,
    label: label.trim(),
    normalizedLabel,
    entityId,
    metadata: metadata || {},
  }).returning({ id: graphNodes.id });

  nodeCache.set(cacheKey, row.id);
  return row.id;
}

const edgeSet = new Set<string>();

async function createEdge(
  sourceId: string,
  targetId: string,
  edgeType: EdgeType,
  label?: string,
  weight: number = 1.0,
  evidence?: string,
  metadata?: any
): Promise<void> {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const edgeKey = `${sourceId}:${targetId}:${edgeType}`;
  const reverseKey = `${targetId}:${sourceId}:${edgeType}`;
  if (edgeSet.has(edgeKey) || edgeSet.has(reverseKey)) return;
  edgeSet.add(edgeKey);

  try {
    await db.insert(graphEdges).values({
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      edgeType,
      label: label || edgeType.replace(/_/g, " "),
      weight,
      evidence,
      metadata: metadata || {},
    });
  } catch {
  }
}

let activeBuildRunId: string | null = null;

export function getActiveBuildRunId(): string | null {
  return activeBuildRunId;
}

export async function getBuildRunStatus(runId?: string): Promise<any> {
  if (runId) {
    const [run] = await db.select().from(graphBuildRuns).where(eq(graphBuildRuns.id, runId)).limit(1);
    return run || null;
  }
  if (activeBuildRunId) {
    const [run] = await db.select().from(graphBuildRuns).where(eq(graphBuildRuns.id, activeBuildRunId)).limit(1);
    return run || null;
  }
  const [latest] = await db.select().from(graphBuildRuns).orderBy(sql`created_at DESC`).limit(1);
  return latest || null;
}

export async function buildRelationshipGraph(): Promise<string> {
  if (activeBuildRunId) {
    const [existing] = await db.select().from(graphBuildRuns).where(eq(graphBuildRuns.id, activeBuildRunId)).limit(1);
    if (existing && existing.status === "running") {
      return activeBuildRunId;
    }
  }

  await db.update(graphBuildRuns)
    .set({ status: "error", error: "Superseded by new build", completedAt: new Date() })
    .where(eq(graphBuildRuns.status, "running"));

  nodeCache.clear();
  edgeSet.clear();

  const allLeads = await db.select().from(leads);
  const totalLeads = allLeads.length;

  const [run] = await db.insert(graphBuildRuns).values({
    status: "running",
    totalLeads,
    startedAt: new Date(),
    currentPhase: "initializing",
  }).returning({ id: graphBuildRuns.id });

  activeBuildRunId = run.id;

  buildGraphAsync(run.id, allLeads).catch(async (err) => {
    console.error("[Graph Engine] Build failed:", err);
    await db.update(graphBuildRuns).set({
      status: "error",
      error: err.message,
      completedAt: new Date(),
    }).where(eq(graphBuildRuns.id, run.id));
    activeBuildRunId = null;
  });

  return run.id;
}

async function buildGraphAsync(runId: string, allLeads: any[]): Promise<void> {
  console.log(`[Graph Engine] Starting build for ${allLeads.length} leads...`);

  await db.update(graphBuildRuns).set({ currentPhase: "clearing_old_data" }).where(eq(graphBuildRuns.id, runId));
  await db.delete(graphEdges);
  await db.delete(graphNodes);

  let nodesCreated = 0;
  let edgesCreated = 0;
  let leadsProcessed = 0;

  await db.update(graphBuildRuns).set({ currentPhase: "building_property_nodes" }).where(eq(graphBuildRuns.id, runId));

  for (const lead of allLeads) {
    try {
      const propertyId = await getOrCreateNode("property", lead.address, lead.id, {
        city: lead.city,
        county: lead.county,
        sqft: lead.sqft,
        yearBuilt: lead.yearBuilt,
        leadScore: lead.leadScore,
        totalValue: lead.totalValue,
        latitude: lead.latitude,
        longitude: lead.longitude,
      });
      if (!propertyId) { leadsProcessed++; continue; }

      const ownerName = lead.ownerName;
      if (ownerName) {
        const ownerType: NodeType = isLikelyPerson(ownerName) ? "person" : "company";
        const ownerId = await getOrCreateNode(ownerType, ownerName, undefined, {
          ownerType: lead.ownerType,
          phone: lead.ownerPhone,
          email: lead.ownerEmail,
        });
        if (ownerId) {
          await createEdge(ownerId, propertyId, "owns", "owns", 1.0, "DCAD property record");
          edgesCreated++;
        }

        if (lead.ownerAddress) {
          const addrId = await getOrCreateNode("address", lead.ownerAddress, undefined, {
            type: lead.reverseAddressType || "unknown",
          });
          if (addrId && ownerId) {
            await createEdge(ownerId, addrId, "located_at", "mailing address", 0.8, "DCAD mailing address");
            edgesCreated++;
          }
        }

        if (lead.llcName && normalize(lead.llcName) !== normalize(ownerName)) {
          const llcId = await getOrCreateNode("llc", lead.llcName, undefined, {
            sosFileNumber: lead.sosFileNumber,
          });
          if (llcId && ownerId) {
            await createEdge(ownerId, llcId, "member_of", "member of", 0.9, "TX SOS filing");
            await createEdge(llcId, propertyId, "owns", "entity owns", 0.95, "DCAD + TX SOS");
            edgesCreated += 2;
          }
        }

        if (lead.registeredAgent) {
          const agentType: NodeType = isLikelyPerson(lead.registeredAgent) ? "person" : "company";
          const agentId = await getOrCreateNode(agentType, lead.registeredAgent);
          const targetId = lead.llcName
            ? await getOrCreateNode("llc", lead.llcName)
            : ownerId;
          if (agentId && targetId) {
            await createEdge(agentId, targetId, "registered_agent_for", "registered agent for", 0.7, "TX SOS");
            edgesCreated++;
          }
        }

        if (lead.officerName && isLikelyPerson(lead.officerName)) {
          const officerId = await getOrCreateNode("person", lead.officerName, undefined, {
            title: lead.officerTitle,
          });
          const entityId = lead.llcName
            ? await getOrCreateNode("llc", lead.llcName)
            : ownerId;
          if (officerId && entityId && officerId !== entityId) {
            await createEdge(officerId, entityId, "officer_of", lead.officerTitle || "officer of", 0.85, "TX SOS / Comptroller");
            edgesCreated++;
          }
        }

        if (lead.managingMember && isLikelyPerson(lead.managingMember)) {
          const memberId = await getOrCreateNode("person", lead.managingMember, undefined, {
            title: lead.managingMemberTitle,
            phone: lead.managingMemberPhone,
            email: lead.managingMemberEmail,
          });
          const entityId = lead.llcName
            ? await getOrCreateNode("llc", lead.llcName)
            : ownerId;
          if (memberId && entityId && memberId !== entityId) {
            await createEdge(memberId, entityId, "officer_of", lead.managingMemberTitle || "managing member", 0.9, "TX SOS / Comptroller");
            edgesCreated++;
          }
        }

        if (lead.managementCompany) {
          const mgmtId = await getOrCreateNode("company", lead.managementCompany, undefined, {
            phone: lead.managementPhone,
            email: lead.managementEmail,
            contact: lead.managementContact,
          });
          if (mgmtId) {
            await createEdge(mgmtId, propertyId, "manages_property", "manages", 0.85, "Management attribution");
            edgesCreated++;
          }
        }

        if (lead.contactName && isLikelyPerson(lead.contactName) && normalize(lead.contactName) !== normalize(ownerName)) {
          const contactId = await getOrCreateNode("person", lead.contactName, undefined, {
            title: lead.contactTitle,
            phone: lead.contactPhone,
            email: lead.contactEmail,
            role: lead.contactRole,
          });
          if (contactId) {
            const targetEntity = lead.managementCompany
              ? await getOrCreateNode("company", lead.managementCompany)
              : (lead.llcName ? await getOrCreateNode("llc", lead.llcName) : ownerId);
            if (targetEntity && contactId !== targetEntity) {
              await createEdge(contactId, targetEntity, "officer_of", lead.contactTitle || lead.contactRole || "contact", 0.7, lead.contactSource || "Web research");
              edgesCreated++;
            }
          }
        }

        if (lead.llcChain && Array.isArray(lead.llcChain)) {
          for (const link of lead.llcChain as any[]) {
            if (!link.entityName) continue;
            const chainLlcId = await getOrCreateNode("llc", link.entityName, undefined, {
              entityType: link.entityType,
              sosFileNumber: link.sosFileNumber,
              status: link.status,
            });
            if (!chainLlcId) continue;

            if (link.registeredAgent) {
              const raType: NodeType = isLikelyPerson(link.registeredAgent) ? "person" : "company";
              const raId = await getOrCreateNode(raType, link.registeredAgent);
              if (raId) {
                await createEdge(raId, chainLlcId, "registered_agent_for", "registered agent for", 0.7, "TX SOS LLC chain");
                edgesCreated++;
              }
            }

            if (link.officers && Array.isArray(link.officers)) {
              for (const officer of link.officers) {
                if (!officer.name || !isLikelyPerson(officer.name)) continue;
                const offId = await getOrCreateNode("person", officer.name, undefined, {
                  title: officer.title,
                  phone: officer.phone,
                  email: officer.email,
                });
                if (offId) {
                  await createEdge(offId, chainLlcId, "officer_of", officer.title || "officer", 0.85, `LLC chain: ${link.source || "TX SOS"}`);
                  edgesCreated++;
                }
              }
            }
          }
        }
      }

      leadsProcessed++;
      if (leadsProcessed % 200 === 0) {
        nodesCreated = nodeCache.size;
        await db.update(graphBuildRuns).set({
          leadsProcessed,
          nodesCreated,
          edgesCreated,
          currentPhase: `processing leads (${leadsProcessed}/${allLeads.length})`,
        }).where(eq(graphBuildRuns.id, runId));
        console.log(`[Graph Engine] Progress: ${leadsProcessed}/${allLeads.length} leads, ${nodesCreated} nodes, ${edgesCreated} edges`);
      }
    } catch (err: any) {
      console.error(`[Graph Engine] Error processing lead ${lead.id}:`, err.message);
    }
  }

  await db.update(graphBuildRuns).set({
    currentPhase: "cross_linking",
  }).where(eq(graphBuildRuns.id, runId));

  const crossEdges = await crossLinkSharedEntities();
  edgesCreated += crossEdges;

  nodesCreated = nodeCache.size;
  await db.update(graphBuildRuns).set({
    status: "complete",
    leadsProcessed,
    nodesCreated,
    edgesCreated,
    currentPhase: "complete",
    completedAt: new Date(),
  }).where(eq(graphBuildRuns.id, runId));

  activeBuildRunId = null;
  console.log(`[Graph Engine] Build complete: ${nodesCreated} nodes, ${edgesCreated} edges from ${leadsProcessed} leads`);
}

async function crossLinkSharedEntities(): Promise<number> {
  let edgesAdded = 0;

  const sharedAgents = await db.execute(sql`
    SELECT ge1.source_node_id as node1, ge2.source_node_id as node2, gn.label as agent_name
    FROM graph_edges ge1
    JOIN graph_edges ge2 ON ge1.source_node_id = ge2.source_node_id
      AND ge1.target_node_id != ge2.target_node_id
      AND ge1.edge_type = 'registered_agent_for'
      AND ge2.edge_type = 'registered_agent_for'
      AND ge1.target_node_id < ge2.target_node_id
    JOIN graph_nodes gn ON gn.id = ge1.source_node_id
    LIMIT 5000
  `);

  for (const row of sharedAgents.rows as any[]) {
    const key = `${row.node1}:${row.node2}:shared_agent`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      try {
        await db.insert(graphEdges).values({
          sourceNodeId: row.node1,
          targetNodeId: row.node2,
          edgeType: "shared_agent",
          label: `shared agent: ${row.agent_name}`,
          weight: 0.6,
          evidence: "Cross-link: same registered agent",
        });
        edgesAdded++;
      } catch {}
    }
  }

  const sharedOfficers = await db.execute(sql`
    SELECT ge1.target_node_id as entity1, ge2.target_node_id as entity2, gn.label as officer_name
    FROM graph_edges ge1
    JOIN graph_edges ge2 ON ge1.source_node_id = ge2.source_node_id
      AND ge1.target_node_id != ge2.target_node_id
      AND ge1.edge_type = 'officer_of'
      AND ge2.edge_type = 'officer_of'
      AND ge1.target_node_id < ge2.target_node_id
    JOIN graph_nodes gn ON gn.id = ge1.source_node_id
    LIMIT 5000
  `);

  for (const row of sharedOfficers.rows as any[]) {
    const key = `${row.entity1}:${row.entity2}:shared_officer`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      try {
        await db.insert(graphEdges).values({
          sourceNodeId: row.entity1,
          targetNodeId: row.entity2,
          edgeType: "shared_officer",
          label: `shared officer: ${row.officer_name}`,
          weight: 0.8,
          evidence: "Cross-link: same officer/member",
        });
        edgesAdded++;
      } catch {}
    }
  }

  const mailingMatches = await db.execute(sql`
    SELECT ge1.source_node_id as owner1, ge2.source_node_id as owner2, gn.label as address
    FROM graph_edges ge1
    JOIN graph_edges ge2 ON ge1.target_node_id = ge2.target_node_id
      AND ge1.source_node_id != ge2.source_node_id
      AND ge1.edge_type = 'located_at'
      AND ge2.edge_type = 'located_at'
      AND ge1.source_node_id < ge2.source_node_id
    JOIN graph_nodes gn ON gn.id = ge1.target_node_id
    WHERE gn.node_type = 'address'
    LIMIT 5000
  `);

  for (const row of mailingMatches.rows as any[]) {
    const key = `${row.owner1}:${row.owner2}:mailing_match`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      try {
        await db.insert(graphEdges).values({
          sourceNodeId: row.owner1,
          targetNodeId: row.owner2,
          edgeType: "mailing_match",
          label: `same mailing: ${row.address}`,
          weight: 0.5,
          evidence: "Cross-link: same mailing address",
        });
        edgesAdded++;
      } catch {}
    }
  }

  console.log(`[Graph Engine] Cross-linking added ${edgesAdded} edges`);
  return edgesAdded;
}

export async function getNodeWithEdges(nodeId: string, depth: number = 1): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  const visitedNodes = new Set<string>();
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const queue: { id: string; currentDepth: number }[] = [{ id: nodeId, currentDepth: 0 }];

  while (queue.length > 0) {
    const { id, currentDepth } = queue.shift()!;
    if (visitedNodes.has(id)) continue;
    visitedNodes.add(id);

    const [node] = await db.select().from(graphNodes).where(eq(graphNodes.id, id)).limit(1);
    if (node) allNodes.push(node);

    if (currentDepth < depth) {
      const outEdges = await db.select().from(graphEdges).where(eq(graphEdges.sourceNodeId, id));
      const inEdges = await db.select().from(graphEdges).where(eq(graphEdges.targetNodeId, id));
      const edges = [...outEdges, ...inEdges];

      for (const edge of edges) {
        const edgeKey = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.edgeType}`;
        if (!allEdges.some(e => `${e.sourceNodeId}:${e.targetNodeId}:${e.edgeType}` === edgeKey)) {
          allEdges.push(edge);
        }
        const neighborId = edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;
        if (!visitedNodes.has(neighborId)) {
          queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
        }
      }
    }
  }

  return { nodes: allNodes, edges: allEdges };
}

export async function searchGraphNodes(query: string, nodeType?: string, limit: number = 20): Promise<GraphNode[]> {
  const normalizedQuery = normalize(query);
  const conditions = [
    sql`${graphNodes.normalizedLabel} ILIKE ${'%' + normalizedQuery + '%'}`,
  ];
  if (nodeType) {
    conditions.push(eq(graphNodes.nodeType, nodeType));
  }
  return db.select().from(graphNodes)
    .where(and(...conditions))
    .limit(limit);
}

export async function getGraphStats(): Promise<{
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  topConnected: Array<{ id: string; label: string; nodeType: string; connections: number }>;
  lastBuild: any;
}> {
  const nodeCountResult = await db.select({ count: sql<number>`count(*)::int` }).from(graphNodes);
  const edgeCountResult = await db.select({ count: sql<number>`count(*)::int` }).from(graphEdges);

  const nodesByTypeResult = await db.select({
    nodeType: graphNodes.nodeType,
    count: sql<number>`count(*)::int`,
  }).from(graphNodes).groupBy(graphNodes.nodeType);

  const edgesByTypeResult = await db.select({
    edgeType: graphEdges.edgeType,
    count: sql<number>`count(*)::int`,
  }).from(graphEdges).groupBy(graphEdges.edgeType);

  const topConnectedResult = await db.execute(sql`
    SELECT n.id, n.label, n.node_type,
      (SELECT count(*) FROM graph_edges WHERE source_node_id = n.id OR target_node_id = n.id)::int as connections
    FROM graph_nodes n
    ORDER BY connections DESC
    LIMIT 15
  `);

  const [lastBuild] = await db.select().from(graphBuildRuns).orderBy(sql`created_at DESC`).limit(1);

  const nodesByType: Record<string, number> = {};
  for (const row of nodesByTypeResult) {
    nodesByType[row.nodeType] = row.count;
  }

  const edgesByType: Record<string, number> = {};
  for (const row of edgesByTypeResult) {
    edgesByType[row.edgeType] = row.count;
  }

  return {
    totalNodes: nodeCountResult[0]?.count || 0,
    totalEdges: edgeCountResult[0]?.count || 0,
    nodesByType,
    edgesByType,
    topConnected: (topConnectedResult.rows as any[]).map(r => ({
      id: r.id,
      label: r.label,
      nodeType: r.node_type,
      connections: r.connections,
    })),
    lastBuild: lastBuild || null,
  };
}

export interface GraphIntelligence {
  hasData: boolean;
  lastBuilt: string | null;
  sharedOfficers: Array<{
    officerName: string;
    connectedEntities: Array<{ name: string; type: string; propertyCount: number; properties: Array<{ leadId: string; address: string; city: string; leadScore: number }> }>;
  }>;
  sharedAgents: Array<{
    agentName: string;
    entityCount: number;
    entities: Array<{ name: string; type: string }>;
  }>;
  mailingClusters: Array<{
    address: string;
    owners: Array<{ name: string; propertyCount: number; properties: Array<{ leadId: string; address: string; city: string }> }>;
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

export async function getGraphIntelligence(leadId: string): Promise<GraphIntelligence | null> {
  const nodeCount = await db.select({ count: sql<number>`count(*)::int` }).from(graphNodes);
  if (!nodeCount[0]?.count || nodeCount[0].count === 0) return null;

  const [lastBuild] = await db.select().from(graphBuildRuns)
    .where(eq(graphBuildRuns.status, "complete"))
    .orderBy(sql`completed_at DESC`).limit(1);

  const propertyNodes = await db.select().from(graphNodes)
    .where(and(eq(graphNodes.nodeType, "property"), eq(graphNodes.entityId, leadId)));

  if (propertyNodes.length === 0) {
    return {
      hasData: false,
      lastBuilt: lastBuild?.completedAt?.toISOString() || null,
      sharedOfficers: [],
      sharedAgents: [],
      mailingClusters: [],
      networkContacts: [],
      connectedPropertyCount: 0,
    };
  }

  const propertyNodeId = propertyNodes[0].id;

  const ownerEdges = await db.select().from(graphEdges)
    .where(and(eq(graphEdges.targetNodeId, propertyNodeId), eq(graphEdges.edgeType, "owns")));

  const managesEdges = await db.select().from(graphEdges)
    .where(and(eq(graphEdges.targetNodeId, propertyNodeId), eq(graphEdges.edgeType, "manages_property")));

  const ownerNodeIds = [...ownerEdges.map(e => e.sourceNodeId), ...managesEdges.map(e => e.sourceNodeId)];
  if (ownerNodeIds.length === 0) {
    return {
      hasData: true,
      lastBuilt: lastBuild?.completedAt?.toISOString() || null,
      sharedOfficers: [],
      sharedAgents: [],
      mailingClusters: [],
      networkContacts: [],
      connectedPropertyCount: 0,
    };
  }

  const sharedOfficers: GraphIntelligence["sharedOfficers"] = [];
  for (const ownerNodeId of ownerNodeIds) {
    const officerEdges = await db.execute(sql`
      SELECT DISTINCT ge2.target_node_id as other_entity_id, officer_node.label as officer_name
      FROM graph_edges ge1
      JOIN graph_edges ge2 ON ge1.source_node_id = ge2.source_node_id
        AND ge2.edge_type = 'officer_of'
        AND ge2.target_node_id != ${ownerNodeId}
      JOIN graph_nodes officer_node ON officer_node.id = ge1.source_node_id
      WHERE ge1.target_node_id = ${ownerNodeId}
        AND ge1.edge_type = 'officer_of'
      LIMIT 50
    `);

    const officerMap = new Map<string, { officerName: string; entityIds: Set<string> }>();
    for (const row of officerEdges.rows as any[]) {
      const existing = officerMap.get(row.officer_name) || { officerName: row.officer_name, entityIds: new Set<string>() };
      existing.entityIds.add(row.other_entity_id);
      officerMap.set(row.officer_name, existing);
    }

    for (const [, officer] of officerMap) {
      const entityIds = [...officer.entityIds];
      if (entityIds.length === 0) continue;

      const entities: GraphIntelligence["sharedOfficers"][0]["connectedEntities"] = [];
      for (const eid of entityIds.slice(0, 10)) {
        const [entityNode] = await db.select().from(graphNodes).where(eq(graphNodes.id, eid)).limit(1);
        if (!entityNode) continue;

        const propertyEdges = await db.execute(sql`
          SELECT gn.entity_id as lead_id, gn.label as address, gn.metadata
          FROM graph_edges ge
          JOIN graph_nodes gn ON gn.id = ge.target_node_id AND gn.node_type = 'property'
          WHERE ge.source_node_id = ${eid} AND ge.edge_type = 'owns'
          LIMIT 5
        `);

        const properties = (propertyEdges.rows as any[]).map(r => ({
          leadId: r.lead_id || "",
          address: r.address || "",
          city: r.metadata?.city || "",
          leadScore: r.metadata?.leadScore || 0,
        })).filter(p => p.leadId && p.leadId !== leadId);

        const totalProps = await db.execute(sql`
          SELECT count(*)::int as cnt FROM graph_edges WHERE source_node_id = ${eid} AND edge_type = 'owns'
        `);

        entities.push({
          name: entityNode.label,
          type: entityNode.nodeType,
          propertyCount: (totalProps.rows[0] as any)?.cnt || 0,
          properties,
        });
      }

      if (entities.length > 0) {
        sharedOfficers.push({ officerName: officer.officerName, connectedEntities: entities });
      }
    }
  }

  const sharedAgents: GraphIntelligence["sharedAgents"] = [];
  for (const ownerNodeId of ownerNodeIds) {
    const agentEdges = await db.execute(sql`
      SELECT agent_node.label as agent_name, agent_node.id as agent_id
      FROM graph_edges ge
      JOIN graph_nodes agent_node ON agent_node.id = ge.source_node_id
      WHERE ge.target_node_id = ${ownerNodeId}
        AND ge.edge_type = 'registered_agent_for'
      LIMIT 10
    `);

    for (const agentRow of agentEdges.rows as any[]) {
      const otherEntities = await db.execute(sql`
        SELECT DISTINCT gn.label as entity_name, gn.node_type as entity_type
        FROM graph_edges ge
        JOIN graph_nodes gn ON gn.id = ge.target_node_id
        WHERE ge.source_node_id = ${agentRow.agent_id}
          AND ge.edge_type = 'registered_agent_for'
          AND ge.target_node_id != ${ownerNodeId}
        LIMIT 20
      `);

      if ((otherEntities.rows as any[]).length > 0) {
        sharedAgents.push({
          agentName: agentRow.agent_name,
          entityCount: (otherEntities.rows as any[]).length,
          entities: (otherEntities.rows as any[]).map(r => ({ name: r.entity_name, type: r.entity_type })),
        });
      }
    }
  }

  const mailingClusters: GraphIntelligence["mailingClusters"] = [];
  for (const ownerNodeId of ownerNodeIds) {
    const addressEdges = await db.execute(sql`
      SELECT addr.label as address, addr.id as address_id
      FROM graph_edges ge
      JOIN graph_nodes addr ON addr.id = ge.target_node_id AND addr.node_type = 'address'
      WHERE ge.source_node_id = ${ownerNodeId}
        AND ge.edge_type = 'located_at'
      LIMIT 5
    `);

    for (const addrRow of addressEdges.rows as any[]) {
      const otherOwners = await db.execute(sql`
        SELECT DISTINCT gn.label as owner_name, gn.id as owner_id
        FROM graph_edges ge
        JOIN graph_nodes gn ON gn.id = ge.source_node_id
        WHERE ge.target_node_id = ${addrRow.address_id}
          AND ge.edge_type = 'located_at'
          AND ge.source_node_id != ${ownerNodeId}
        LIMIT 10
      `);

      if ((otherOwners.rows as any[]).length > 0) {
        const owners: GraphIntelligence["mailingClusters"][0]["owners"] = [];
        for (const ownerRow of otherOwners.rows as any[]) {
          const ownerProps = await db.execute(sql`
            SELECT gn.entity_id as lead_id, gn.label as address, gn.metadata
            FROM graph_edges ge
            JOIN graph_nodes gn ON gn.id = ge.target_node_id AND gn.node_type = 'property'
            WHERE ge.source_node_id = ${ownerRow.owner_id} AND ge.edge_type = 'owns'
            LIMIT 3
          `);

          owners.push({
            name: ownerRow.owner_name,
            propertyCount: (ownerProps.rows as any[]).length,
            properties: (ownerProps.rows as any[]).map((r: any) => ({
              leadId: r.lead_id || "",
              address: r.address || "",
              city: r.metadata?.city || "",
            })).filter((p: any) => p.leadId && p.leadId !== leadId),
          });
        }

        mailingClusters.push({ address: addrRow.address, owners });
      }
    }
  }

  const networkContacts: GraphIntelligence["networkContacts"] = [];
  const leadData = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const thisLead = leadData[0];
  const needsPhone = !thisLead?.ownerPhone;
  const needsEmail = !thisLead?.ownerEmail;

  if (needsPhone || needsEmail) {
    for (const ownerNodeId of ownerNodeIds) {
      const connectedPeople = await db.execute(sql`
        SELECT DISTINCT person.label as name, person.metadata, 'officer' as relationship
        FROM graph_edges ge1
        JOIN graph_edges ge2 ON ge1.source_node_id = ge2.source_node_id
          AND ge2.edge_type = 'officer_of'
        JOIN graph_nodes person ON person.id = ge1.source_node_id AND person.node_type = 'person'
        WHERE ge1.target_node_id = ${ownerNodeId}
          AND ge1.edge_type = 'officer_of'
        LIMIT 20
      `);

      for (const person of connectedPeople.rows as any[]) {
        const meta = person.metadata || {};
        if ((needsPhone && meta.phone) || (needsEmail && meta.email)) {
          networkContacts.push({
            name: person.name,
            phone: meta.phone || undefined,
            email: meta.email || undefined,
            title: meta.title || meta.role || undefined,
            relationshipPath: `Officer of ${ownerNodeIds.length > 0 ? "connected entity" : "owner entity"}`,
            confidence: 60,
          });
        }
      }
    }

    for (const cluster of mailingClusters) {
      for (const owner of cluster.owners) {
        for (const prop of owner.properties) {
          if (!prop.leadId) continue;
          const relatedLead = await db.select().from(leads).where(eq(leads.id, prop.leadId)).limit(1);
          if (relatedLead[0]) {
            const rl = relatedLead[0];
            if ((needsPhone && rl.ownerPhone) || (needsEmail && rl.ownerEmail)) {
              networkContacts.push({
                name: rl.ownerName || owner.name,
                phone: needsPhone ? (rl.ownerPhone || undefined) : undefined,
                email: needsEmail ? (rl.ownerEmail || undefined) : undefined,
                relationshipPath: `Same mailing address: ${cluster.address}`,
                confidence: 40,
              });
            }
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  const uniqueContacts = networkContacts.filter(c => {
    const key = `${c.name}:${c.phone}:${c.email}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.confidence - a.confidence).slice(0, 10);

  let connectedPropertyCount = 0;
  for (const ownerNodeId of ownerNodeIds) {
    const propCount = await db.execute(sql`
      SELECT count(*)::int as cnt FROM graph_edges WHERE source_node_id = ${ownerNodeId} AND edge_type = 'owns'
    `);
    connectedPropertyCount += (propCount.rows[0] as any)?.cnt || 0;
  }

  return {
    hasData: true,
    lastBuilt: lastBuild?.completedAt?.toISOString() || null,
    sharedOfficers,
    sharedAgents,
    mailingClusters,
    networkContacts: uniqueContacts,
    connectedPropertyCount: Math.max(0, connectedPropertyCount - 1),
  };
}

export async function getNodesByLeadId(leadId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const propertyNodes = await db.select().from(graphNodes)
    .where(and(
      eq(graphNodes.nodeType, "property"),
      eq(graphNodes.entityId, leadId)
    ));

  if (propertyNodes.length === 0) return { nodes: [], edges: [] };

  return getNodeWithEdges(propertyNodes[0].id, 2);
}
