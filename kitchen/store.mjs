import { FalkorDB } from 'falkordblite';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import { KITCHEN_FIXTURE, FIXTURE_VERSION } from './data.mjs';

const DATASET = 'Fictional kitchen scenario';
const openedPaths = new Set();
const kg = grams => grams / 1000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clock = minute => minute == null ? null : `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const safeNumber = (value, name, max = 1_000_000_000) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw error(409, 'invalid_graph_data', `The graph contains an invalid ${name}; recovery cannot be verified.`);
  return value;
};
function error(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function checkId(id) { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw error(400, 'invalid_id', 'Use a valid ingredient or proposal ID.'); }
function joinEvidence(...evidence) { return { cypher: evidence.map(item => item.cypher).filter(Boolean).join('\n\n'), rows: evidence.flatMap(item => item.rows || []) }; }

export const CYPHER = {
  resolve: `MATCH (i:Ingredient) WHERE i.id=$query OR toLower(i.name)=$query
OR any(alias IN i.aliases WHERE alias=$query OR $padded CONTAINS (' '+alias+' '))
RETURN i.id AS id, i.name AS name ORDER BY id LIMIT 10`,
  ingredient: `MATCH (i:Ingredient {id:$ingredientId}) RETURN i.id AS id, i.name AS name,
i.arrivalMinute AS arrivalMinute, i.originalArrivalMinute AS originalArrivalMinute, i.requiredGrams AS requiredGrams LIMIT 1`,
  impact: `MATCH p=(i:Ingredient {id:$ingredientId})-[:SUPPORTS*1..4]->(n:KitchenNode)
WHERE length(p)<=$depth
RETURN [v IN nodes(p) | v.id] AS ids, [v IN nodes(p) | v.name] AS names,
[v IN nodes(p) | v.kind] AS kinds, [v IN nodes(p) | v.durationMinutes] AS durations,
[v IN nodes(p) | v.portions] AS portions, [v IN nodes(p) | v.serviceMinute] AS serviceMinutes,
[v IN nodes(p) | v.bufferMinutes] AS buffers, [r IN relationships(p) | type(r)] AS types,
length(p) AS hops,n.id AS endpoint
ORDER BY hops,endpoint LIMIT 200`,
  frontier: `MATCH p=(i:Ingredient {id:$ingredientId})-[:SUPPORTS*1..4]->(n:KitchenNode)
WHERE length(p)=4 MATCH (n)-[:SUPPORTS]->(next:KitchenNode)
RETURN DISTINCT n.id AS frontierId,next.id AS unseenId LIMIT 20`,
  stock: `MATCH (root:Ingredient {id:$ingredientId})-[alternative:HAS_ALTERNATIVE]->(i:Ingredient)
WHERE alternative.chefApproved=true
OPTIONAL MATCH (reservation:Reservation {active:true})-[:RESERVES]->(i)
OPTIONAL MATCH (reservation)-[:FOR_SERVICE]->(service:KitchenNode)
RETURN i.id AS ingredientId, i.name AS name, i.stockGrams AS stockGrams,
alternative.requiredGrams AS requiredGrams, alternative.baseDurationMinutes AS baseDurationMinutes,alternative.plannedPortions AS plannedPortions,
collect(DISTINCT {id:reservation.id,quantityGrams:reservation.quantityGrams,purpose:reservation.purpose,
serviceId:service.id,serviceName:service.name}) AS reservations ORDER BY i.id LIMIT 20`,
};

export async function createKitchenStore({ path = fileURLToPath(new URL('../.kitchen-data', import.meta.url)), graphName = 'savora_kitchen' } = {}) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(graphName)) throw error(400, 'invalid_graph_name', 'Invalid kitchen graph name.');
  const directory = resolve(path);
  if (openedPaths.has(directory)) throw error(409, 'database_already_open', 'This kitchen database directory is already open in this process.');
  openedPaths.add(directory);
  let db, lock;
  const lockPath = join(directory, '.savora.lock');
  const releaseLock = async () => { if (lock) { await lock.close().catch(() => {}); await unlink(lockPath).catch(() => {}); lock = null; } openedPaths.delete(directory); };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (cause) {
      if (cause.code === 'EEXIST') throw error(409, 'database_locked', 'This data directory has a kitchen process lock. Close the other process first. After a crash, verify it has stopped before removing .savora.lock.');
      throw cause;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    db = await FalkorDB.open({ path: directory, logLevel: 'warning', additionalConfig: { appendonly: 'yes', appendfsync: 'always' } });
    const store = new KitchenStore(db, db.selectGraph(graphName), releaseLock);
    await store.seed();
    return store;
  } catch (cause) {
    if (db) await db.close().catch(() => {});
    await releaseLock();
    throw cause;
  }
}

// The graph handle is internal application infrastructure, never an HTTP/MCP tool.
// Tests use it to change real graph data and prove answers are not fixture playback.
class KitchenStore {
  constructor(db, graph, onClose) { this.db = db; this.graph = graph; this.onClose = onClose; this.closed = false; }
  async query(cypher, params = {}) {
    const reply = await this.graph.query(cypher, { params, TIMEOUT: 5000 });
    return reply.data || [];
  }
  async read(cypher, params = {}) { const rows = await this.query(cypher, params); return { rows, evidence: { cypher, rows } }; }
  async seed() {
    const existing = await this.query('MATCH (k:Kitchen {id:$id}) RETURN k.fixtureVersion AS version,k.seedComplete AS complete', { id: KITCHEN_FIXTURE.id });
    if (existing.length && existing[0].version !== FIXTURE_VERSION) throw error(409, 'fixture_version_mismatch', 'The kitchen fixture version changed. Use a new data directory; existing state was not overwritten.');
    if (existing[0]?.complete) return;
    await this.query(`MERGE (k:Kitchen {id:$id}) ON CREATE SET k.fixtureVersion=$version,k.revision=0,k.currentMinute=$minute,k.seedComplete=false`,
      { id: KITCHEN_FIXTURE.id, version: FIXTURE_VERSION, minute: KITCHEN_FIXTURE.currentMinute });
    for (const node of KITCHEN_FIXTURE.nodes) {
      const label = node.kind === 'ingredient' ? ':Ingredient' : '';
      await this.query(`MERGE (n:KitchenNode${label} {id:$id}) ON CREATE SET n += $properties`, { id: node.id, properties: node });
    }
    await this.query(`UNWIND $links AS link MATCH (a:KitchenNode {id:link.from}),(b:KitchenNode {id:link.to}) MERGE (a)-[:SUPPORTS]->(b)`,
      { links: KITCHEN_FIXTURE.supports.map(([from, to]) => ({ from, to })) });
    await this.query(`UNWIND $links AS link MATCH (a:Ingredient {id:link.from}),(b:Ingredient {id:link.to})
MERGE (a)-[r:HAS_ALTERNATIVE]->(b) ON CREATE SET r.requiredGrams=link.requiredGrams,r.baseDurationMinutes=link.baseDurationMinutes,r.plannedPortions=link.plannedPortions,r.chefApproved=link.chefApproved`,
      { links: KITCHEN_FIXTURE.alternatives });
    for (const item of KITCHEN_FIXTURE.reservations) await this.query(`MATCH (i:Ingredient {id:$ingredientId}),(s:KitchenNode {id:$serviceId})
MERGE (r:Reservation {id:$id}) ON CREATE SET r.quantityGrams=$quantityGrams,r.purpose=$purpose,r.active=$active
MERGE (r)-[:RESERVES]->(i) MERGE (r)-[:FOR_SERVICE]->(s)`, item);
    await this.query('MATCH (k:Kitchen {id:$id}) SET k.seedComplete=true', { id: KITCHEN_FIXTURE.id });
  }
  async context() {
    const { rows, evidence } = await this.read('MATCH (k:Kitchen {id:$id}) RETURN k.revision AS revision,k.currentMinute AS currentMinute,k.seedComplete AS complete', { id: KITCHEN_FIXTURE.id });
    if (rows.length !== 1 || !rows[0].complete) throw error(503, 'kitchen_unavailable', 'The kitchen graph is not ready.');
    safeNumber(rows[0].revision, 'revision'); safeNumber(rows[0].currentMinute, 'current time', 2879);
    return { ...rows[0], evidence };
  }
  async resolveIngredient({ query }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 600) throw error(400, 'invalid_query', 'Enter an ingredient name or a question under 600 characters.');
    const normalized = query.toLowerCase().trim();
    const padded = ` ${normalized.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
    const { rows, evidence } = await this.read(CYPHER.resolve, { query: normalized, padded });
    return { ingredient: rows.length === 1 ? rows[0] : null, evidence };
  }
  async ingredient(id) {
    checkId(id);
    const result = await this.read(CYPHER.ingredient, { ingredientId: id });
    if (result.rows.length !== 1) throw error(404, 'ingredient_not_found', 'This ingredient is not modeled in the kitchen graph.');
    return { ingredient: result.rows[0], evidence: result.evidence };
  }
  async traceImpact({ ingredientId, depth }) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 4) throw error(400, 'invalid_depth', 'Connection depth must be 1–4.');
    const [root, context, result] = await Promise.all([this.ingredient(ingredientId), this.context(), this.read(CYPHER.impact, { ingredientId, depth })]);
    if (result.rows.length >= 200) throw error(409, 'traversal_limit', 'The modeled impact exceeds the bounded traversal; no complete answer can be established.');
    const frontier = depth === 4 ? await this.read(CYPHER.frontier, { ingredientId }) : { rows: [], evidence: { cypher: '', rows: [] } };
    if (frontier.rows.length) throw error(409, 'traversal_limit', 'Relationships continue beyond four hops. This bounded model cannot establish complete service impact.');
    const ingredient = { id: root.ingredient.id, name: root.ingredient.name };
    const first = { id: ingredient.id, label: ingredient.name, kind: 'ingredient', depth: 0 };
    for (const [source, target] of [['arrivalMinute', 'arrivalTime'], ['originalArrivalMinute', 'originalArrivalTime']]) {
      if (root.ingredient[source] != null) first[target] = clock(safeNumber(root.ingredient[source], 'delivery time', 2879));
    }
    if (root.ingredient.arrivalMinute != null && root.ingredient.originalArrivalMinute != null) {
      first.arrivalDelayMinutes = root.ingredient.arrivalMinute - root.ingredient.originalArrivalMinute;
    }
    if (root.ingredient.requiredGrams != null) first.requiredKg = kg(safeNumber(root.ingredient.requiredGrams, 'required quantity'));
    const nodes = new Map([[first.id, first]]), edges = new Map();
    for (const row of result.rows) {
      if (new Set(row.ids).size !== row.ids.length) throw error(409, 'cyclic_recipe', 'A recipe cycle prevents a verified recovery.');
      row.ids.forEach((id, i) => {
        if (!nodes.has(id)) {
          const node = { id, label: row.names[i], kind: row.kinds[i], depth: i };
          if (row.portions[i] != null) node.portions = safeNumber(row.portions[i], 'portion count');
          if (row.serviceMinutes[i] != null) node.serviceTime = clock(safeNumber(row.serviceMinutes[i], 'service time', 2879));
          if (row.durations[i] != null) node.durationMinutes = safeNumber(row.durations[i], 'preparation duration', 1440);
          if (row.buffers[i] != null) node.bufferMinutes = safeNumber(row.buffers[i], 'service buffer', 1440);
          nodes.set(id, node);
        } else nodes.get(id).depth = Math.min(nodes.get(id).depth, i);
        if (i) edges.set(`${row.ids[i - 1]}:${id}:${row.types[i - 1]}`, { source: row.ids[i - 1], target: id, type: row.types[i - 1] });
      });
    }
    const allNodes = [...nodes.values()];
    const paths = result.rows.filter(row => !result.rows.some(other => other.ids.length > row.ids.length && row.ids.every((id, i) => other.ids[i] === id)))
      .map(row => ({ nodeIds: row.ids, labels: row.names, hops: row.ids.length - 1 }));
    const services = allNodes.filter(node => node.kind === 'service');
    return { ingredient, depth, graph: { nodes: allNodes, edges: [...edges.values()] }, paths,
      metrics: { nodes: nodes.size, services: services.length, portions: services.reduce((sum, node) => sum + (node.portions || 0), 0), furthestHop: Math.max(...allNodes.map(node => node.depth)) },
      revision: context.revision, evidence: joinEvidence(root.evidence, context.evidence, result.evidence, frontier.evidence) };
  }
  async inspectStock({ ingredientId }) {
    const root = await this.ingredient(ingredientId);
    const ownership = await this.read(`MATCH (:Ingredient {id:$ingredientId})-[:HAS_ALTERNATIVE]->(:Ingredient)<-[:RESERVES]-(r:Reservation {active:true})-[:RESERVES]->(owner:Ingredient)
WITH r,count(DISTINCT owner) AS ownerCount WHERE ownerCount<>1 RETURN r.id AS reservationId,ownerCount LIMIT 1`, { ingredientId });
    if (ownership.rows.length) throw error(409, 'invalid_graph_data', 'A stock reservation must belong to exactly one ingredient.');
    const { rows, evidence } = await this.read(CYPHER.stock, { ingredientId });
    if (rows.length >= 20) throw error(409, 'alternative_limit', 'Too many recipe alternatives to establish a complete recovery.');
    const protectedReservations = [];
    const options = rows.map(row => {
      const stock = safeNumber(row.stockGrams, 'stock quantity'), required = safeNumber(row.requiredGrams, 'recipe quantity');
      if (!required) throw error(409, 'invalid_graph_data', 'A recipe alternative needs a positive quantity.');
      safeNumber(row.baseDurationMinutes, 'base preparation duration', 1440);
      safeNumber(row.plannedPortions, 'declared recipe portion basis');
      let reserved = 0;
      const seen = new Set();
      for (const reservation of row.reservations.filter(item => item.id != null).sort((a, b) => a.id.localeCompare(b.id))) {
        if (seen.has(reservation.id)) throw error(409, 'invalid_graph_data', 'A reservation has ambiguous service ownership.');
        seen.add(reservation.id);
        reserved += safeNumber(reservation.quantityGrams, 'reserved quantity');
        protectedReservations.push({ id: reservation.id, ingredientId: row.ingredientId, ingredientName: row.name,
          quantityKg: kg(reservation.quantityGrams), purpose: reservation.purpose, serviceId: reservation.serviceId, serviceName: reservation.serviceName });
      }
      if (reserved > stock) throw error(409, 'invalid_graph_data', 'Existing stock reservations exceed recorded inventory.');
      const available = stock - reserved;
      return { ingredientId: row.ingredientId, name: row.name, stockKg: kg(stock), reservedKg: kg(reserved), availableKg: kg(available),
        requiredKg: kg(required), shortfallKg: kg(Math.max(0, required - available)), feasible: available >= required,
        baseDurationMinutes: row.baseDurationMinutes, plannedPortions: row.plannedPortions };
    });
    return { options, protectedReservations, evidence: joinEvidence(root.evidence, ownership.evidence, evidence) };
  }
  async recoveryFacts(ingredientId) {
    const context = await this.context();
    const impact = await this.traceImpact({ ingredientId, depth: 4 });
    const stock = await this.inspectStock({ ingredientId });
    const nodes = new Map(impact.graph.nodes.map(node => [node.id, node]));
    const baseNodes = impact.graph.nodes.filter(node => node.depth === 1 && node.kind === 'base');
    const servicePaths = impact.paths.filter(path => nodes.get(path.nodeIds.at(-1)).kind === 'service');
    const graphComplete = impact.paths.length > 0 && servicePaths.length === impact.paths.length && baseNodes.length === 1;
    const options = stock.options.map(option => {
      const quantityBasisValid = option.plannedPortions === impact.metrics.portions;
      const baseReady = context.currentMinute + option.baseDurationMinutes;
      const targets = graphComplete ? [{ id: baseNodes[0].id, name: baseNodes[0].label, time: clock(baseReady), serviceTime: null, bufferMinutes: null, readyMinute: baseReady }] : [];
      let timingFeasible = graphComplete;
      const covered = new Set();
      for (const path of servicePaths) {
        const service = nodes.get(path.nodeIds.at(-1));
        const serviceRow = impact.evidence.rows.find(row => row.ids?.join('|') === path.nodeIds.join('|'));
        const due = safeNumber(serviceRow.serviceMinutes.at(-1), 'service time', 2879);
        const buffer = safeNumber(serviceRow.buffers.at(-1), 'service buffer', 1440);
        const durations = path.nodeIds.slice(2, -1).map(id => safeNumber(nodes.get(id).durationMinutes, 'downstream duration', 1440));
        const earliest = baseReady + durations.reduce((sum, minutes) => sum + minutes, 0);
        if (earliest > due - buffer) timingFeasible = false;
        if (!covered.has(service.id)) targets.push({ id: service.id, name: service.label, time: clock(due - buffer), serviceTime: clock(due), bufferMinutes: buffer, readyMinute: due - buffer });
        covered.add(service.id);
      }
      return { ...option, feasible: option.feasible && timingFeasible && quantityBasisValid, timingFeasible, quantityBasisValid,
        currentPortions: impact.metrics.portions, prepTargets: targets };
    });
    const feasible = options.filter(option => option.feasible).sort((a, b) => a.requiredKg - b.requiredKg || a.ingredientId.localeCompare(b.ingredientId));
    const chosen = feasible[0];
    const selected = chosen ? { ingredientId: chosen.ingredientId, name: chosen.name, requiredKg: chosen.requiredKg, remainingKg: chosen.availableKg - chosen.requiredKg } : null;
    const facts = { revision: context.revision, scenarioTime: clock(context.currentMinute), eligible: Boolean(selected), ingredientId, options, selected,
      prepTargets: chosen?.prepTargets || [], protectedReservations: stock.protectedReservations,
      limitations: ['Fictional quantities, recipe alternatives and timings. Alternatives are explicitly chef-approved demo records; no allergen safety is inferred.',
        'Alternative quantities are complete batches declared for the graph-recorded planned portion count. Changed order quantities require a new declared recipe; amounts are not guessed or scaled.',
        'Connected services are not automatically late. Recovery checks declared preparation durations and service buffers.'],
      evidence: joinEvidence(context.evidence, impact.evidence, stock.evidence) };
    return { ...facts, signature: digest({ revision: facts.revision, scenarioTime: facts.scenarioTime, ingredientId, options, protectedReservations: facts.protectedReservations, paths: impact.paths }) };
  }
  async simulateRecovery({ ingredientId }) {
    checkId(ingredientId);
    const approved = await this.query(`MATCH (p:RecoveryProposal {ingredientId:$ingredientId,status:'approved'}) RETURN p.id AS id LIMIT 1`, { ingredientId });
    if (approved.length) throw error(409, 'already_recovered', 'This ingredient disruption already has an approved recovery. Inspect the current prep board.');
    const facts = await this.recoveryFacts(ingredientId);
    const existing = await this.query(`MATCH (p:RecoveryProposal {signature:$signature,status:'proposed'}) RETURN p.json AS json LIMIT 1`, { signature: facts.signature });
    if (existing.length) return JSON.parse(existing[0].json);
    const proposal = { id: `proposal-${randomUUID()}`, ...facts, createdAt: new Date().toISOString() };
    const rows = await this.query(`MATCH (k:Kitchen {id:$kitchenId}) WHERE k.revision=$revision
CREATE (p:RecoveryProposal {id:$id,ingredientId:$ingredientId,revision:$revision,signature:$signature,status:'proposed',json:$json})
CREATE (p)-[:PROPOSED_FOR]->(k) RETURN p.id AS id`,
      { kitchenId: KITCHEN_FIXTURE.id, revision: proposal.revision, id: proposal.id, ingredientId, signature: proposal.signature, json: JSON.stringify(proposal) });
    if (!rows.length) throw error(409, 'stale_revision', 'The kitchen changed during this proposal. Investigate again.');
    return proposal;
  }
  async proposal(id) {
    checkId(id);
    const rows = await this.query('MATCH (p:RecoveryProposal {id:$id}) RETURN p.json AS json,p.status AS status,p.receipt AS receipt LIMIT 1', { id });
    if (!rows.length) throw error(404, 'proposal_not_found', 'Recovery proposal not found.');
    return rows[0];
  }
  async approveRecovery({ proposalId, expectedRevision }) {
    safeNumber(expectedRevision, 'expected revision');
    const record = await this.proposal(proposalId);
    if (record.status === 'approved') return JSON.parse(record.receipt);
    const proposal = JSON.parse(record.json);
    if (proposal.revision !== expectedRevision) throw error(409, 'stale_revision', 'Review the latest recovery before approving.');
    if (!proposal.eligible || !proposal.selected) throw error(409, 'no_feasible_recovery', 'Only a feasible server-checked recovery can be approved.');
    const fresh = await this.recoveryFacts(proposal.ingredientId);
    if (fresh.revision !== expectedRevision || fresh.signature !== proposal.signature) {
      const retried = await this.proposal(proposalId);
      if (retried.status === 'approved') return JSON.parse(retried.receipt);
      throw error(409, 'stale_revision', 'Stock, recipes or service commitments changed. Review a fresh recovery.');
    }
    const selected = proposal.selected, requiredGrams = Math.round(selected.requiredKg * 1000);
    const approvedAt = new Date().toISOString(), revision = expectedRevision + 1;
    const audit = { id: `audit-${randomUUID()}`, action: 'human_approved_recovery', createdAt: approvedAt, proposalId, revision,
      details: { ingredientId: selected.ingredientId, reservedKg: selected.requiredKg, protectedReservations: proposal.protectedReservations, prepTargets: proposal.prepTargets } };
    const receipt = { status: 'approved', revision, proposalId, selected, prepTargets: proposal.prepTargets, approvedAt, audit: [audit] };
    const params = { kitchenId: KITCHEN_FIXTURE.id, proposalId, expectedRevision, ingredientId: proposal.ingredientId,
      selectedId: selected.ingredientId, requiredGrams, reservationId: `recovery-${proposalId}`, receipt: JSON.stringify(receipt),
      createdAt: approvedAt, tasks: proposal.prepTargets.map(task => ({ ...task, taskId: `${proposalId}-${task.id}` })),
      auditId: audit.id, auditJson: JSON.stringify(audit), nextRevision: revision };
    const rows = await this.query(`MATCH (k:Kitchen {id:$kitchenId}),(p:RecoveryProposal {id:$proposalId}),
(root:Ingredient {id:$ingredientId})-[alternative:HAS_ALTERNATIVE]->(selected:Ingredient {id:$selectedId})
WHERE k.revision=$expectedRevision AND p.revision=$expectedRevision AND p.status='proposed'
AND alternative.chefApproved=true AND alternative.requiredGrams=$requiredGrams
OPTIONAL MATCH (existing:Reservation {active:true})-[:RESERVES]->(selected)
WITH k,p,selected,sum(coalesce(existing.quantityGrams,0)) AS reserved
WHERE selected.stockGrams-reserved >= $requiredGrams
SET k.revision=$nextRevision,p.status='approved',p.receipt=$receipt
CREATE (r:Reservation {id:$reservationId,quantityGrams:$requiredGrams,active:true,purpose:'Approved kitchen recovery'})
CREATE (r)-[:RESERVES]->(selected) CREATE (r)-[:FOR_RECOVERY]->(p)
WITH k,p UNWIND $tasks AS task
CREATE (t:PrepTask {id:task.taskId,name:task.name,readyMinute:task.readyMinute,time:task.time,status:'scheduled',proposalId:$proposalId})
CREATE (t)-[:FOR_RECOVERY]->(p)
WITH DISTINCT k,p
CREATE (a:AuditEvent {id:$auditId,json:$auditJson,createdAt:$createdAt,revision:$nextRevision})
CREATE (a)-[:RECORDED_FOR]->(k) CREATE (a)-[:APPROVED]->(p)
RETURN p.receipt AS receipt`, params);
    if (rows.length) return JSON.parse(rows[0].receipt);
    const retried = await this.proposal(proposalId);
    if (retried.status === 'approved') return JSON.parse(retried.receipt);
    throw error(409, 'stale_revision', 'Another approval or stock change invalidated this recovery. Review it again.');
  }
  async getState() {
    const context = await this.context();
    const plans = await this.query(`MATCH (p:RecoveryProposal {status:'approved'}) RETURN p.receipt AS json ORDER BY p.id LIMIT 50`);
    const audits = await this.query('MATCH (a:AuditEvent) RETURN a.json AS json ORDER BY a.revision,a.createdAt LIMIT 100');
    return { revision: context.revision, dataset: DATASET, approvedPlans: plans.map(row => JSON.parse(row.json)), audit: audits.map(row => JSON.parse(row.json)) };
  }
  async close() { if (this.closed) return; this.closed = true; try { await this.db.close(); } finally { await this.onClose(); } }
}
