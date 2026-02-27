import { db } from "./storage";
import { graphNodes, graphEdges, graphBuildRuns, leads, contactEvidence } from "@shared/schema";
import { eq, and, or, sql, desc, ilike, inArray } from "drizzle-orm";

let activeBuildRunId: string | null = null;

export function getActiveBuildRunId(): string | null {
  return activeBuildRunId;
}

function normalize(val: string | null | undefined): string {
  if (!val) return "";
  return val.trim().toUpperCase().replace(/\s+/g, " ");
}

export async function buildRelationshipGraph(): Promise<string> {
  console.log("[GraphEngine] Starting relationship graph build...");

  const [run] = await db.insert(graphBuildRuns).values({
    status: "running",
    startedAt: new Date(),
    currentPhase: "initializing",
  }).returning();
  activeBuildRunId = run.id;

  try {
    await db.delete(graphEdges);
    await db.delete(graphNodes);

    const allLeads = await db.select({
      id: leads.id,
      ownerName: leads.ownerName,
      llcName: leads.llcName,
      officerName: leads.officerName,
      officerTitle: leads.officerTitle,
      registeredAgent: leads.registeredAgent,
      ownerAddress: leads.ownerAddress,
      contactName: leads.contactName,
      contactTitle: leads.contactTitle,
      address: leads.address,
      city: leads.city,
    }).from(leads);

    const totalLeads = allLeads.length;
    await db.update(graphBuildRuns).set({ totalLeads }).where(eq(graphBuildRuns.id, run.id));
    console.log(`[GraphEngine] Processing ${totalLeads} leads...`);

    const entityMap = new Map<string, string>();
    const personMap = new Map<string, string>();
    const agentMap = new Map<string, string>();
    const addressMap = new Map<string, string>();

    const pendingNodes: Array<{ nodeType: string; label: string; normalizedLabel: string; entityId?: string; metadata?: any }> = [];
    const pendingEdges: Array<{ sourceNodeId: string; targetNodeId: string; edgeType: string; label: string; weight?: number; evidence?: string; metadata?: any }> = [];

    function getOrCreateEntity(name: string, metadata?: any): string | null {
      const norm = normalize(name);
      if (!norm || norm.length < 2) return null;
      if (entityMap.has(norm)) return entityMap.get(norm)!;
      const id = crypto.randomUUID();
      entityMap.set(norm, id);
      pendingNodes.push({ nodeType: "entity", label: name.trim(), normalizedLabel: norm, metadata });
      return id;
    }

    function getOrCreatePerson(name: string, metadata?: any): string | null {
      const norm = normalize(name);
      if (!norm || norm.length < 2) return null;
      if (personMap.has(norm)) return personMap.get(norm)!;
      const id = crypto.randomUUID();
      personMap.set(norm, id);
      pendingNodes.push({ nodeType: "person", label: name.trim(), normalizedLabel: norm, metadata });
      return id;
    }

    function getOrCreateAgent(name: string): string | null {
      const norm = normalize(name);
      if (!norm || norm.length < 2) return null;
      if (agentMap.has(norm)) return agentMap.get(norm)!;
      const id = crypto.randomUUID();
      agentMap.set(norm, id);
      pendingNodes.push({ nodeType: "agent", label: name.trim(), normalizedLabel: norm });
      return id;
    }

    function getOrCreateAddress(addr: string): string | null {
      const norm = normalize(addr);
      if (!norm || norm.length < 5) return null;
      if (addressMap.has(norm)) return addressMap.get(norm)!;
      const id = crypto.randomUUID();
      addressMap.set(norm, id);
      pendingNodes.push({ nodeType: "address", label: addr.trim(), normalizedLabel: norm });
      return id;
    }

    const edgeSet = new Set<string>();
    function addEdge(sourceId: string, targetId: string, edgeType: string, label: string, metadata?: any, evidence?: string) {
      const key = `${sourceId}|${targetId}|${edgeType}`;
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      pendingEdges.push({ sourceNodeId: sourceId, targetNodeId: targetId, edgeType, label, metadata, evidence });
    }

    await db.update(graphBuildRuns).set({ currentPhase: "extracting_entities" }).where(eq(graphBuildRuns.id, run.id));
    console.log("[GraphEngine] Phase 1: Extracting entities and building edges...");

    for (let i = 0; i < allLeads.length; i++) {
      const lead = allLeads[i];

      const entityId = getOrCreateEntity(lead.ownerName || "");

      if (lead.officerName && lead.officerName.trim()) {
        const personId = getOrCreatePerson(lead.officerName, { title: lead.officerTitle });
        if (personId && entityId) {
          const title = lead.officerTitle?.trim() || undefined;
          addEdge(personId, entityId, "officer_of", `Officer of ${(lead.ownerName || "").trim()}`, title ? { title } : undefined, `Lead #${lead.id}`);
        }
      }

      if (lead.contactName && lead.contactName.trim() && normalize(lead.contactName) !== normalize(lead.officerName || "")) {
        const personId = getOrCreatePerson(lead.contactName, { title: lead.contactTitle });
        if (personId && entityId) {
          addEdge(personId, entityId, "contact_of", `Contact for ${(lead.ownerName || "").trim()}`, lead.contactTitle ? { title: lead.contactTitle.trim() } : undefined, `Lead #${lead.id}`);
        }
      }

      if (lead.registeredAgent && lead.registeredAgent.trim()) {
        const agentId = getOrCreateAgent(lead.registeredAgent);
        if (agentId && entityId) {
          addEdge(agentId, entityId, "registered_agent_for", `RA for ${(lead.ownerName || "").trim()}`, undefined, `Lead #${lead.id}`);
        }
      }

      if (lead.ownerAddress && lead.ownerAddress.trim()) {
        const addrId = getOrCreateAddress(lead.ownerAddress);
        if (addrId && entityId) {
          addEdge(entityId, addrId, "mailing_address_at", `Mails to ${lead.ownerAddress.trim()}`, undefined, `Lead #${lead.id}`);
        }
      }

      if (lead.llcName && lead.llcName.trim() && normalize(lead.llcName) !== normalize(lead.ownerName || "")) {
        const llcId = getOrCreateEntity(lead.llcName, { type: "llc" });
        if (llcId && entityId) {
          addEdge(entityId, llcId, "llc_link", `LLC: ${lead.llcName.trim()}`, undefined, `Lead #${lead.id}`);
        }
      }

      if (i > 0 && i % 2000 === 0) {
        console.log(`[GraphEngine] Processed ${i}/${totalLeads} leads...`);
        await db.update(graphBuildRuns).set({ leadsProcessed: i }).where(eq(graphBuildRuns.id, run.id));
      }
    }

    await db.update(graphBuildRuns).set({ leadsProcessed: totalLeads, currentPhase: "inserting_nodes" }).where(eq(graphBuildRuns.id, run.id));
    console.log(`[GraphEngine] Phase 2: Inserting ${pendingNodes.length} nodes...`);

    const BATCH_SIZE = 500;
    for (let i = 0; i < pendingNodes.length; i += BATCH_SIZE) {
      const batch = pendingNodes.slice(i, i + BATCH_SIZE).map(n => ({
        id: (n.nodeType === "entity" ? entityMap : n.nodeType === "person" ? personMap : n.nodeType === "agent" ? agentMap : addressMap).get(n.normalizedLabel)!,
        nodeType: n.nodeType,
        label: n.label,
        normalizedLabel: n.normalizedLabel,
        entityId: n.entityId,
        metadata: n.metadata || null,
      }));
      await db.insert(graphNodes).values(batch);
    }

    await db.update(graphBuildRuns).set({ nodesCreated: pendingNodes.length, currentPhase: "inserting_edges" }).where(eq(graphBuildRuns.id, run.id));
    console.log(`[GraphEngine] Phase 3: Inserting ${pendingEdges.length} edges...`);

    for (let i = 0; i < pendingEdges.length; i += BATCH_SIZE) {
      const batch = pendingEdges.slice(i, i + BATCH_SIZE);
      await db.insert(graphEdges).values(batch);
    }

    await db.update(graphBuildRuns).set({
      nodesCreated: pendingNodes.length,
      edgesCreated: pendingEdges.length,
      status: "completed",
      currentPhase: "done",
      completedAt: new Date(),
    }).where(eq(graphBuildRuns.id, run.id));

    console.log(`[GraphEngine] Build complete: ${pendingNodes.length} nodes, ${pendingEdges.length} edges`);
    console.log(`[GraphEngine]   Entities: ${entityMap.size}, People: ${personMap.size}, Agents: ${agentMap.size}, Addresses: ${addressMap.size}`);

    activeBuildRunId = null;
    return run.id;
  } catch (error: any) {
    console.error("[GraphEngine] Build failed:", error);
    await db.update(graphBuildRuns).set({
      status: "failed",
      error: error.message,
      completedAt: new Date(),
    }).where(eq(graphBuildRuns.id, run.id));
    activeBuildRunId = null;
    throw error;
  }
}

export async function getBuildRunStatus(runId?: string) {
  if (!runId) {
    const [latest] = await db.select().from(graphBuildRuns).orderBy(desc(graphBuildRuns.createdAt)).limit(1);
    return latest || null;
  }
  const [run] = await db.select().from(graphBuildRuns).where(eq(graphBuildRuns.id, runId)).limit(1);
  return run || null;
}

export async function getGraphStats() {
  const [nodeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(graphNodes);
  const [edgeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(graphEdges);

  const typeCounts = await db.execute(sql`
    SELECT node_type, count(*)::int as count
    FROM ${graphNodes}
    GROUP BY node_type
    ORDER BY count DESC
  `);

  const edgeTypeCounts = await db.execute(sql`
    SELECT edge_type, count(*)::int as count
    FROM ${graphEdges}
    GROUP BY edge_type
    ORDER BY count DESC
  `);

  const topConnected = await db.execute(sql`
    SELECT n.id, n.label, n.node_type as "nodeType", count(*)::int as connections
    FROM ${graphNodes} n
    JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
    WHERE n.node_type IN ('entity', 'person', 'agent')
    GROUP BY n.id, n.label, n.node_type
    ORDER BY count(*) DESC
    LIMIT 20
  `);

  return {
    totalNodes: nodeCount.count,
    totalEdges: edgeCount.count,
    nodeTypes: typeCounts.rows,
    edgeTypes: edgeTypeCounts.rows,
    topConnected: topConnected.rows,
  };
}

export async function getNodeWithEdges(nodeId: string, depth: number = 1) {
  const [node] = await db.select().from(graphNodes).where(eq(graphNodes.id, nodeId)).limit(1);
  if (!node) return { node: null, edges: [], connectedNodes: [] };

  const edges = await db.select().from(graphEdges).where(
    or(eq(graphEdges.sourceNodeId, nodeId), eq(graphEdges.targetNodeId, nodeId))
  );

  const connectedNodeIds = new Set<string>();
  edges.forEach(e => {
    if (e.sourceNodeId !== nodeId) connectedNodeIds.add(e.sourceNodeId);
    if (e.targetNodeId !== nodeId) connectedNodeIds.add(e.targetNodeId);
  });

  let connectedNodes: any[] = [];
  if (connectedNodeIds.size > 0) {
    connectedNodes = await db.select().from(graphNodes).where(
      inArray(graphNodes.id, Array.from(connectedNodeIds))
    );
  }

  if (depth > 1 && connectedNodes.length > 0) {
    const secondaryEdges = await db.select().from(graphEdges).where(
      or(
        inArray(graphEdges.sourceNodeId, Array.from(connectedNodeIds)),
        inArray(graphEdges.targetNodeId, Array.from(connectedNodeIds))
      )
    );

    const allNodeIds = new Set<string>(connectedNodeIds);
    allNodeIds.add(nodeId);
    const newNodeIds = new Set<string>();
    secondaryEdges.forEach(e => {
      if (!allNodeIds.has(e.sourceNodeId)) newNodeIds.add(e.sourceNodeId);
      if (!allNodeIds.has(e.targetNodeId)) newNodeIds.add(e.targetNodeId);
    });

    if (newNodeIds.size > 0) {
      const newNodes = await db.select().from(graphNodes).where(
        inArray(graphNodes.id, Array.from(newNodeIds))
      );
      connectedNodes = [...connectedNodes, ...newNodes];
    }
    edges.push(...secondaryEdges);
  }

  return { node, edges, connectedNodes };
}

export async function searchGraphNodes(query: string, nodeType?: string, limit: number = 20) {
  const conditions = [ilike(graphNodes.label, `%${query}%`)];
  if (nodeType) {
    conditions.push(eq(graphNodes.nodeType, nodeType));
  }
  return db.select().from(graphNodes).where(and(...conditions)).limit(limit);
}

export async function getNodesByLeadId(leadId: string) {
  const [lead] = await db.select({
    ownerName: leads.ownerName,
    llcName: leads.llcName,
    officerName: leads.officerName,
    registeredAgent: leads.registeredAgent,
  }).from(leads).where(eq(leads.id, leadId)).limit(1);

  if (!lead) return [];

  const names = [lead.ownerName, lead.llcName, lead.officerName, lead.registeredAgent]
    .filter(Boolean)
    .map(n => normalize(n!));

  if (names.length === 0) return [];

  return db.select().from(graphNodes).where(
    inArray(graphNodes.normalizedLabel, names)
  );
}

export async function getGraphIntelligence(leadId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;

  const [nodeCount] = await db.select({ count: sql<number>`count(*)` }).from(graphNodes);
  if (Number(nodeCount.count) === 0) return { hasData: false };

  const ownerNorm = normalize(lead.ownerName || "");
  if (!ownerNorm) return { hasData: false };

  const [ownerNode] = await db.select()
    .from(graphNodes)
    .where(and(
      eq(graphNodes.normalizedLabel, ownerNorm),
      eq(graphNodes.nodeType, "entity")
    ))
    .limit(1);

  if (!ownerNode) return { hasData: false };

  const sharedOfficers = await db.execute(sql`
    WITH lead_officers AS (
      SELECT n.id, n.label as name
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      WHERE (e.source_node_id = ${ownerNode.id} OR e.target_node_id = ${ownerNode.id})
      AND n.node_type = 'person'
      AND e.edge_type IN ('officer_of', 'member_of', 'manager_of', 'contact_of')
    ),
    connected_entities AS (
      SELECT lo.name as officer_name, n2.id as entity_node_id, n2.label as entity_name, e2.metadata->>'title' as title
      FROM lead_officers lo
      JOIN ${graphEdges} e2 ON (e2.source_node_id = lo.id OR e2.target_node_id = lo.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = lo.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n2.node_type = 'entity'
      AND n2.id != ${ownerNode.id}
      AND e2.edge_type IN ('officer_of', 'member_of', 'manager_of', 'contact_of')
    )
    SELECT 
      officer_name,
      json_agg(json_build_object(
        'name', entity_name,
        'type', 'Entity',
        'title', title
      )) as connected_entities
    FROM connected_entities
    GROUP BY officer_name
  `);

  const sharedAgents = await db.execute(sql`
    WITH lead_agents AS (
      SELECT n.id, n.label as name
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      WHERE (e.source_node_id = ${ownerNode.id} OR e.target_node_id = ${ownerNode.id})
      AND n.node_type = 'agent'
      AND e.edge_type = 'registered_agent_for'
    ),
    other_entities AS (
      SELECT la.name as agent_name, n2.label as entity_name
      FROM lead_agents la
      JOIN ${graphEdges} e2 ON (e2.source_node_id = la.id OR e2.target_node_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = la.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n2.node_type = 'entity'
      AND n2.id != ${ownerNode.id}
      AND e2.edge_type = 'registered_agent_for'
    )
    SELECT 
      agent_name,
      count(*)::int as entity_count,
      json_agg(entity_name) as entities
    FROM other_entities
    GROUP BY agent_name
  `);

  const mailingClusters = await db.execute(sql`
    WITH lead_addresses AS (
      SELECT n.id, n.label as address
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      WHERE (e.source_node_id = ${ownerNode.id} OR e.target_node_id = ${ownerNode.id})
      AND n.node_type = 'address'
      AND e.edge_type = 'mailing_address_at'
    ),
    other_owners AS (
      SELECT la.address, n2.label as owner_name
      FROM lead_addresses la
      JOIN ${graphEdges} e2 ON (e2.source_node_id = la.id OR e2.target_node_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = la.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n2.node_type = 'entity'
      AND n2.id != ${ownerNode.id}
      AND e2.edge_type = 'mailing_address_at'
    )
    SELECT 
      address,
      json_agg(json_build_object('name', owner_name)) as owners
    FROM other_owners
    GROUP BY address
  `);

  const networkContacts = await db.execute(sql`
    WITH connected_nodes AS (
      SELECT DISTINCT n2.id, lo.label as via_officer, 'Shared Officer' as reason
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      JOIN ${graphNodes} lo ON (lo.id = CASE WHEN e.source_node_id = n.id THEN e.target_node_id ELSE e.source_node_id END)
      JOIN ${graphEdges} e2 ON (e2.source_node_id = lo.id OR e2.target_node_id = lo.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = lo.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n.id = ${ownerNode.id}
      AND lo.node_type = 'person'
      AND n2.node_type = 'entity'
      AND n2.id != ${ownerNode.id}
      
      UNION
      
      SELECT DISTINCT n2.id, la.label as via_address, 'Shared Address' as reason
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      JOIN ${graphNodes} la ON (la.id = CASE WHEN e.source_node_id = n.id THEN e.target_node_id ELSE e.source_node_id END)
      JOIN ${graphEdges} e2 ON (e2.source_node_id = la.id OR e2.target_node_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = la.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n.id = ${ownerNode.id}
      AND la.node_type = 'address'
      AND n2.node_type = 'entity'
      AND n2.id != ${ownerNode.id}
    ),
    connected_leads AS (
      SELECT cn.*, l.id as lead_id, l.owner_name
      FROM connected_nodes cn
      JOIN ${leads} l ON UPPER(TRIM(l.owner_name)) = (SELECT normalized_label FROM ${graphNodes} WHERE id = cn.id)
    )
    SELECT 
      ev.contact_type as type,
      ev.contact_value as value,
      ev.source_name as source,
      cl.reason || ' (' || cl.via_officer || ')' as relationship_path,
      ev.confidence
    FROM connected_leads cl
    JOIN ${contactEvidence} ev ON ev.lead_id = cl.lead_id::text
    WHERE ev.contact_value IS NOT NULL
    AND ev.confidence >= 50
    AND ev.contact_type IN ('phone', 'PHONE', 'email', 'EMAIL', 'EMAIL_VERIFIED')
    ORDER BY ev.confidence DESC
    LIMIT 10
  `);

  const [lastEdge] = await db.select({ timestamp: sql<string>`max(created_at)` }).from(graphEdges);

  const connectedProperties = await getConnectedPropertyCount(ownerNode.id);

  return {
    hasData: true,
    lastBuilt: lastEdge?.timestamp || null,
    sharedOfficers: sharedOfficers.rows,
    sharedAgents: sharedAgents.rows,
    mailingClusters: mailingClusters.rows,
    networkContacts: networkContacts.rows,
    connectedPropertyCount: Number((connectedProperties as any).rows?.[0]?.count || 0),
  };
}

async function getConnectedPropertyCount(ownerNodeId: string) {
  const result = await db.execute(sql`
    WITH connected_entities AS (
      SELECT DISTINCT n2.id
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      JOIN ${graphNodes} lo ON (lo.id = CASE WHEN e.source_node_id = n.id THEN e.target_node_id ELSE e.source_node_id END)
      JOIN ${graphEdges} e2 ON (e2.source_node_id = lo.id OR e2.target_node_id = lo.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = lo.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n.id = ${ownerNodeId}
      AND lo.node_type = 'person'
      AND n2.node_type = 'entity'
      AND n2.id != ${ownerNodeId}
      
      UNION
      
      SELECT DISTINCT n2.id
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_node_id = n.id OR e.target_node_id = n.id)
      JOIN ${graphNodes} la ON (la.id = CASE WHEN e.source_node_id = n.id THEN e.target_node_id ELSE e.source_node_id END)
      JOIN ${graphEdges} e2 ON (e2.source_node_id = la.id OR e2.target_node_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_node_id = la.id THEN e2.target_node_id ELSE e2.source_node_id END)
      WHERE n.id = ${ownerNodeId}
      AND la.node_type = 'address'
      AND n2.node_type = 'entity'
      AND n2.id != ${ownerNodeId}
    )
    SELECT COUNT(l.id)::int as count
    FROM connected_entities ce
    JOIN ${leads} l ON UPPER(TRIM(l.owner_name)) = (SELECT normalized_label FROM ${graphNodes} WHERE id = ce.id)
  `);
  return result;
}
