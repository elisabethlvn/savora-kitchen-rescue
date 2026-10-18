import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKitchenStore } from './store.mjs';

async function fixture(run) {
  const path = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'savora-kitchen-test-'));
  let store;
  try { store = await createKitchenStore({ path }); await run(store, path); }
  finally { await store?.close(); await rm(path, { recursive: true, force: true }); }
}

test('actual local FalkorDB resolves ingredients and traverses graph, with honest bounded depth', { timeout: 30000 }, async () => fixture(async store => {
  assert.equal((await store.getState()).revision, 0);
  for (const query of ['Roma tomatoes', 'roma-tomatoes', 'Roma tomatoes arrive at 18:30. What depends on them?']) {
    const resolved = await store.resolveIngredient({ query });
    assert.equal(resolved.ingredient.id, 'roma-tomatoes');
    assert.equal(resolved.evidence.rows[0].id, 'roma-tomatoes');
  }
  assert.equal((await store.resolveIngredient({ query: 'Truffle is delayed. What depends on it?' })).ingredient, null);
  assert.equal((await store.resolveIngredient({ query: 'Roma tomatoes and passata' })).ingredient, null);
  assert.equal((await store.resolveIngredient({ query: "' MATCH (n) DETACH DELETE n //" })).ingredient, null);
  await assert.rejects(store.traceImpact({ ingredientId: 'truffle', depth: 4 }), { code: 'ingredient_not_found' });
  await assert.rejects(store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 7 }), { code: 'invalid_depth' });
  const full = await store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 4 });
  assert.deepEqual(full.metrics, { nodes: 8, services: 2, portions: 64, furthestHop: 4 });
  assert.equal(full.graph.edges.length, 7);
  assert.equal(full.paths.length, 2);
  assert.ok(full.paths.every(path => path.hops === 4));
  assert.equal(full.graph.nodes[0].arrivalTime, '18:30');
  assert.equal(full.graph.nodes[0].arrivalDelayMinutes, 270);
  await store.query(`MATCH (i:Ingredient {id:'roma-tomatoes'}) SET i.originalArrivalMinute=1380,i.arrivalMinute=1470`);
  const nextDayArrival = await store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 1 });
  assert.equal(nextDayArrival.graph.nodes[0].originalArrivalTime, '23:00');
  assert.equal(nextDayArrival.graph.nodes[0].arrivalTime, '00:30');
  assert.equal(nextDayArrival.graph.nodes[0].arrivalDelayMinutes, 90);
  assert.match(full.evidence.cypher, /SUPPORTS\*1\.\.4/);
  const shallow = await store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 1 });
  assert.deepEqual(shallow.metrics, { nodes: 2, services: 0, portions: 0, furthestHop: 1 });
  // A real relationship ablation changes the conclusion, not merely a narration.
  await store.query(`MATCH (:KitchenNode {id:'baked-lasagna'})-[r:SUPPORTS]->(:KitchenNode {id:'gallery-dinner'}) DELETE r`);
  const changed = await store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 4 });
  assert.equal(changed.metrics.services, 1); assert.equal(changed.metrics.portions, 24);
  assert.equal(changed.graph.nodes.some(node => node.id === 'gallery-dinner'), false);
  await store.query(`MATCH (n:KitchenNode {id:'studio-supper'}) SET n.name='Updated studio service',n.portions=19`);
  const renamed = await store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 4 });
  assert.equal(renamed.metrics.portions, 19);
  assert.equal(renamed.graph.nodes.find(node => node.id === 'studio-supper').label, 'Updated studio service');
}));

test('actual stock joins protect reservations and independently check timing', { timeout: 30000 }, async () => fixture(async store => {
  const stock = await store.inspectStock({ ingredientId: 'roma-tomatoes' });
  const passata = stock.options.find(option => option.ingredientId === 'passata');
  assert.deepEqual([passata.stockKg, passata.reservedKg, passata.availableKg, passata.requiredKg, passata.shortfallKg, passata.feasible], [10, 8, 2, 8, 6, false]);
  assert.equal(stock.protectedReservations[0].quantityKg, 8);
  const proposal = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(proposal.eligible, true);
  assert.equal(proposal.scenarioTime, '16:00');
  assert.deepEqual(proposal.selected, { ingredientId: 'canned-tomatoes', name: 'Canned tomatoes', requiredKg: 9, remainingKg: 1 });
  assert.deepEqual(proposal.prepTargets.map(task => task.time), ['16:45', '17:40', '18:40']);
  assert.equal((await store.simulateRecovery({ ingredientId: 'roma-tomatoes' })).id, proposal.id);
  await store.query(`MATCH (k:Kitchen) SET k.currentMinute=950`);
  const earlierClock = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(earlierClock.scenarioTime, '15:50');
  assert.equal(earlierClock.prepTargets[0].time, '16:35');
  await store.query(`MATCH (k:Kitchen) SET k.currentMinute=960`);
  // Available stock alone is insufficient: a downstream preparation delay rejects it.
  await store.query(`MATCH (n:KitchenNode {id:'baked-lasagna'}) SET n.durationMinutes=90`);
  const late = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(late.eligible, false); assert.equal(late.selected, null);
  assert.ok(late.options.every(option => !option.feasible));
  await assert.rejects(store.approveRecovery({ proposalId: late.id, expectedRevision: 0 }), { code: 'no_feasible_recovery' });
  await assert.rejects(store.approveRecovery({ proposalId: proposal.id, expectedRevision: 0 }), { code: 'stale_revision' });
  assert.equal((await store.getState()).revision, 0);
}));

test('stock edits and declared-alternative edge changes alter server-owned proposals', { timeout: 30000 }, async () => fixture(async store => {
  const original = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  await store.query(`MATCH (i:Ingredient {id:'canned-tomatoes'}) SET i.stockGrams=8000`);
  const shortage = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(shortage.eligible, false);
  await assert.rejects(store.approveRecovery({ proposalId: original.id, expectedRevision: 0 }), { code: 'stale_revision' });
  await store.query(`MATCH (r:Reservation {id:'tomorrow-passata'}) SET r.quantityGrams=1000`);
  const passata = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(passata.selected.ingredientId, 'passata'); assert.equal(passata.selected.remainingKg, 1);
  await store.query(`MATCH (:Ingredient {id:'roma-tomatoes'})-[r:HAS_ALTERNATIVE]->(:Ingredient {id:'passata'}) DELETE r`);
  const absent = await store.inspectStock({ ingredientId: 'roma-tomatoes' });
  assert.equal(absent.options.some(option => option.ingredientId === 'passata'), false);
  assert.equal((await store.simulateRecovery({ ingredientId: 'roma-tomatoes' })).eligible, false);
  assert.equal((await store.getState()).audit.length, 0);
}));

test('approval atomically reserves stock, creates prep tasks and one audit; retries and restart persist', { timeout: 40000 }, async () => fixture(async (store, path) => {
  const proposal = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  await assert.rejects(store.approveRecovery({ proposalId: proposal.id, expectedRevision: 2 }), { code: 'stale_revision' });
  const request = { proposalId: proposal.id, expectedRevision: 0 };
  const approvals = await Promise.all([store.approveRecovery(request), store.approveRecovery(request), store.approveRecovery(request)]);
  assert.deepEqual(approvals[0], approvals[1]); assert.deepEqual(approvals[1], approvals[2]);
  assert.equal(approvals[0].revision, 1);
  const reservation = await store.query(`MATCH (r:Reservation)-[:RESERVES]->(i:Ingredient {id:'canned-tomatoes'}) RETURN sum(r.quantityGrams) AS grams,count(r) AS count`);
  assert.deepEqual(reservation, [{ grams: 9000, count: 1 }]);
  const tomorrow = await store.query(`MATCH (r:Reservation {id:'tomorrow-passata'}) RETURN r.quantityGrams AS grams`);
  assert.equal(tomorrow[0].grams, 8000);
  assert.equal((await store.query('MATCH (t:PrepTask) RETURN count(t) AS count'))[0].count, 3);
  assert.equal((await store.getState()).audit.length, 1);
  await assert.rejects(store.simulateRecovery({ ingredientId: 'roma-tomatoes' }), { code: 'already_recovered' });
  await store.close();
  const reopened = await createKitchenStore({ path });
  try {
    const state = await reopened.getState();
    assert.equal(state.revision, 1); assert.equal(state.audit.length, 1); assert.equal(state.approvedPlans.length, 1);
    assert.deepEqual(await reopened.approveRecovery(request), approvals[0]);
    const stock = await reopened.inspectStock({ ingredientId: 'roma-tomatoes' });
    assert.equal(stock.options.find(option => option.ingredientId === 'canned-tomatoes').availableKg, 1);
  } finally { await reopened.close(); }
}));

test('invalid numeric graph facts fail closed, rather than concatenating or approving', { timeout: 30000 }, async () => fixture(async store => {
  await store.query(`MATCH (i:Ingredient {id:'canned-tomatoes'}) SET i.stockGrams='10000'`);
  await assert.rejects(store.inspectStock({ ingredientId: 'roma-tomatoes' }), { code: 'invalid_graph_data' });
  await store.query(`MATCH (i:Ingredient {id:'canned-tomatoes'}) SET i.stockGrams=10000`);
  await store.query(`MATCH (r:Reservation {id:'tomorrow-passata'}) SET r.quantityGrams=-1`);
  await assert.rejects(store.simulateRecovery({ ingredientId: 'roma-tomatoes' }), { code: 'invalid_graph_data' });
}));

test('changed order quantities, unmodeled depth and ambiguous reservations fail closed', { timeout: 30000 }, async () => fixture(async store => {
  await store.query(`MATCH (s:KitchenNode {id:'gallery-dinner'}) SET s.portions=80`);
  const largerOrder = await store.simulateRecovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(largerOrder.eligible, false);
  assert.ok(largerOrder.options.every(option => option.quantityBasisValid === false));
  assert.ok(largerOrder.options.every(option => option.currentPortions === 104));
  await store.query(`MATCH (s:KitchenNode {id:'gallery-dinner'}) SET s.portions=40`);
  await store.query(`MATCH (s:KitchenNode {id:'studio-supper'}) CREATE (x:KitchenNode {id:'extra-service',name:'Extra service',kind:'service',portions:4,serviceMinute:1170,bufferMinutes:20}) CREATE (s)-[:SUPPORTS]->(x)`);
  await assert.rejects(store.traceImpact({ ingredientId: 'roma-tomatoes', depth: 4 }), { code: 'traversal_limit' });
  await store.query(`MATCH (x:KitchenNode {id:'extra-service'}) DETACH DELETE x`);
  await store.query(`MATCH (r:Reservation {id:'tomorrow-passata'}),(i:Ingredient {id:'canned-tomatoes'}) CREATE (r)-[:RESERVES]->(i)`);
  await assert.rejects(store.inspectStock({ ingredientId: 'roma-tomatoes' }), { code: 'invalid_graph_data' });
  assert.equal((await store.getState()).revision, 0);
}));

test('a second process cannot open the same persistent engine files', { timeout: 30000 }, async () => fixture(async (store, path) => {
  const moduleURL = new URL('./store.mjs', import.meta.url).href;
  const script = `import { createKitchenStore } from ${JSON.stringify(moduleURL)};
try { const store = await createKitchenStore({path:process.argv[1]}); await store.close(); process.exitCode=1; }
catch (error) { if (error.code !== 'database_locked') throw error; console.log(error.code); }`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, path]);
  assert.equal(stdout.trim(), 'database_locked');
  assert.equal((await store.getState()).revision, 0);
}));
