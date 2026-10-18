import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKitchenStore } from './store.mjs';
import { createKitchenAgent } from './agent.mjs';
import { createKitchenApp } from './app.mjs';

test('HTTP → actual MCP → actual FalkorDB → human approval → persisted receipt', { timeout: 30000 }, async () => {
  const path = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'savora-e2e-'));
  let store, agent, server;
  try {
    store = await createKitchenStore({ path });
    agent = await createKitchenAgent(store, { env: {} });
    server = createServer().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const port = server.address().port;
    server.on('request', createKitchenApp({ store, agent, port }));
    const base = `http://127.0.0.1:${port}/api/kitchen`;
    const status = await (await fetch(`${base}/status`)).json();
    const post = async (endpoint, body) => {
      const response = await fetch(`${base}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Savora-Token': status.csrfToken }, body: JSON.stringify(body) });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    };
    const shallow = await post('investigate', { question: 'Roma tomatoes are delayed. What depends on them?', depth: 1 });
    assert.equal(shallow.metrics.nodes, 2);
    assert.match(shallow.answer, /not evaluated/);
    assert.equal(shallow.agent.mode, 'guided');
    const full = await post('investigate', { question: 'Roma tomatoes are delayed. What depends on them?', depth: 4 });
    assert.deepEqual(full.metrics, { nodes: 8, services: 2, portions: 64, furthestHop: 4 });
    assert.ok(full.trace.some(row => row.tool === 'trace_recipe_impact' && row.source === 'mcp' && row.rowCount > 0));
    const unknown = await post('investigate', { question: 'Truffle is delayed', depth: 4 });
    assert.equal(unknown.status, 'unknown');
    assert.ok(!unknown.trace.some(row => row.tool === 'trace_recipe_impact'));
    const plan = await post('recovery', { ingredientId: 'roma-tomatoes' });
    assert.equal(plan.selected.ingredientId, 'canned-tomatoes');
    assert.equal(plan.options.find(item => item.ingredientId === 'passata').shortfallKg, 6);
    assert.equal((await (await fetch(`${base}/state`)).json()).audit.length, 0);
    const receipt = await post('approve', { proposalId: plan.id, expectedRevision: plan.revision });
    assert.equal(receipt.status, 'approved');
    assert.equal(receipt.selected.requiredKg, 9);
    const repeated = await post('approve', { proposalId: plan.id, expectedRevision: plan.revision });
    assert.deepEqual(repeated, receipt);
    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(state.approvedPlans.length, 1);
    assert.equal(state.audit.length, 1);
    assert.equal(state.revision, 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await agent?.close();
    await store?.close();
    await rm(path, { recursive: true, force: true });
  }
});
