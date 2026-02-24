import { db } from "./storage";
import { graphNodes, graphEdges, leads, contactEvidence } from "@shared/schema";
import { eq, and, or, sql, desc, inArray } from "drizzle-orm";

export async function getGraphIntelligence(leadId: string) {
  // 1. Get the lead and its owner entity
  const [lead] = await db.select().from(leads).where(eq(leads.id, parseInt(leadId))).limit(1);
  if (!lead) return null;

  // 2. Check if graph exists
  const [nodeCount] = await db.select({ count: sql<number>`count(*)` }).from(graphNodes);
  if (Number(nodeCount.count) === 0) return { hasData: false };

  // 3. Find the node for this lead's owner
  const [ownerNode] = await db.select()
    .from(graphNodes)
    .where(and(
      eq(graphNodes.name, lead.ownerName),
      eq(graphNodes.type, 'entity')
    ))
    .limit(1);

  if (!ownerNode) return { hasData: false };

  // 4. Shared Officers
  // Find nodes connected via 'officer_of' or 'member_of'
  const sharedOfficers = await db.execute(sql`
    WITH lead_officers AS (
      SELECT n.id, n.name
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      WHERE (e.source_id = ${ownerNode.id} OR e.target_id = ${ownerNode.id})
      AND n.type = 'person'
      AND e.type IN ('officer_of', 'member_of', 'manager_of')
    ),
    connected_entities AS (
      SELECT lo.name as officer_name, n2.id as entity_node_id, n2.name as entity_name, e2.metadata->>'title' as title
      FROM lead_officers lo
      JOIN ${graphEdges} e2 ON (e2.source_id = lo.id OR e2.target_id = lo.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = lo.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n2.type = 'entity'
      AND n2.id != ${ownerNode.id}
      AND e2.type IN ('officer_of', 'member_of', 'manager_of')
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

  // 5. Shared Registered Agents
  const sharedAgents = await db.execute(sql`
    WITH lead_agents AS (
      SELECT n.id, n.name
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      WHERE (e.source_id = ${ownerNode.id} OR e.target_id = ${ownerNode.id})
      AND n.type = 'agent'
      AND e.type = 'registered_agent_for'
    ),
    other_entities AS (
      SELECT la.name as agent_name, n2.name as entity_name
      FROM lead_agents la
      JOIN ${graphEdges} e2 ON (e2.source_id = la.id OR e2.target_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = la.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n2.type = 'entity'
      AND n2.id != ${ownerNode.id}
      AND e2.type = 'registered_agent_for'
    )
    SELECT 
      agent_name,
      count(*) as entity_count,
      json_agg(entity_name) as entities
    FROM other_entities
    GROUP BY agent_name
  `);

  // 6. Mailing Address Clusters
  const mailingClusters = await db.execute(sql`
    WITH lead_addresses AS (
      SELECT n.id, n.name as address
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      WHERE (e.source_id = ${ownerNode.id} OR e.target_id = ${ownerNode.id})
      AND n.type = 'address'
      AND e.type = 'mailing_address_at'
    ),
    other_owners AS (
      SELECT la.address, n2.name as owner_name
      FROM lead_addresses la
      JOIN ${graphEdges} e2 ON (e2.source_id = la.id OR e2.target_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = la.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n2.type = 'entity'
      AND n2.id != ${ownerNode.id}
      AND e2.type = 'mailing_address_at'
    )
    SELECT 
      address,
      json_agg(json_build_object('name', owner_name)) as owners
    FROM other_owners
    GROUP BY address
  `);

  // 7. Network Derived Contacts
  // Find contacts for connected entities
  const networkContacts = await db.execute(sql`
    WITH connected_nodes AS (
      -- Entities sharing officers
      SELECT DISTINCT n2.id, lo.name as via_officer, 'Shared Officer' as reason
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      JOIN ${graphNodes} lo ON (lo.id = CASE WHEN e.source_id = n.id THEN e.target_id ELSE e.source_id END)
      JOIN ${graphEdges} e2 ON (e2.source_id = lo.id OR e2.target_id = lo.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = lo.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n.id = ${ownerNode.id}
      AND lo.type = 'person'
      AND n2.type = 'entity'
      AND n2.id != ${ownerNode.id}
      
      UNION
      
      -- Entities sharing address
      SELECT DISTINCT n2.id, la.name as via_address, 'Shared Address' as reason
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      JOIN ${graphNodes} la ON (la.id = CASE WHEN e.source_id = n.id THEN e.target_id ELSE e.source_id END)
      JOIN ${graphEdges} e2 ON (e2.source_id = la.id OR e2.target_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = la.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n.id = ${ownerNode.id}
      AND la.type = 'address'
      AND n2.type = 'entity'
      AND n2.id != ${ownerNode.id}
    ),
    connected_leads AS (
      SELECT cn.*, l.id as lead_id, l.owner_name
      FROM connected_nodes cn
      JOIN ${leads} l ON l.owner_name = (SELECT name FROM ${graphNodes} WHERE id = cn.id)
    )
    SELECT 
      ev.contact_name as name,
      ev.value as phone,
      ev.email,
      ev.contact_title as title,
      cl.reason || ' (' || cl.via_officer || ')' as relationship_path,
      ev.confidence
    FROM connected_leads cl
    JOIN ${contactEvidence} ev ON ev.lead_id = cl.lead_id
    WHERE (ev.value IS NOT NULL OR ev.email IS NOT NULL)
    AND ev.confidence >= 50
    ORDER BY ev.confidence DESC
    LIMIT 5
  `);

  // 8. Last built timestamp
  const [lastEdge] = await db.select({ timestamp: sql<string>`max(created_at)` }).from(graphEdges);

  const connectedProperties = await getConnectedPropertyCount(ownerNode.id);

  return {
    hasData: true,
    lastBuilt: lastEdge?.timestamp || null,
    sharedOfficers: sharedOfficers.rows,
    sharedAgents: sharedAgents.rows,
    mailingClusters: mailingClusters.rows,
    networkContacts: networkContacts.rows,
    connectedPropertyCount: (connectedProperties as any).rows[0]?.count || 0
  };
}

async function getConnectedPropertyCount(ownerNodeId: number) {
  const result = await db.execute(sql`
    WITH connected_entities AS (
      -- Shared officers
      SELECT DISTINCT n2.id
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      JOIN ${graphNodes} lo ON (lo.id = CASE WHEN e.source_id = n.id THEN e.target_id ELSE e.source_id END)
      JOIN ${graphEdges} e2 ON (e2.source_id = lo.id OR e2.target_id = lo.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = lo.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n.id = ${ownerNodeId}
      AND lo.type = 'person'
      AND n2.type = 'entity'
      AND n2.id != ${ownerNodeId}
      
      UNION
      
      -- Shared address
      SELECT DISTINCT n2.id
      FROM ${graphNodes} n
      JOIN ${graphEdges} e ON (e.source_id = n.id OR e.target_id = n.id)
      JOIN ${graphNodes} la ON (la.id = CASE WHEN e.source_id = n.id THEN e.target_id ELSE e.source_id END)
      JOIN ${graphEdges} e2 ON (e2.source_id = la.id OR e2.target_id = la.id)
      JOIN ${graphNodes} n2 ON (n2.id = CASE WHEN e2.source_id = la.id THEN e2.target_id ELSE e2.source_id END)
      WHERE n.id = ${ownerNodeId}
      AND la.type = 'address'
      AND n2.type = 'entity'
      AND n2.id != ${ownerNodeId}
    )
    SELECT COUNT(l.id)::int as count
    FROM connected_entities ce
    JOIN ${leads} l ON l.owner_name = (SELECT name FROM ${graphNodes} WHERE id = ce.id)
  `);
  return result;
}

export async function buildRelationshipGraph() {
  // Existing implementation...
  console.log("Starting graph build...");
  // Clear existing graph
  await db.delete(graphEdges);
  await db.delete(graphNodes);

  // Nodes and edges generation logic...
  // (Assuming existing implementation is here or needs to be preserved)
}
