import test from 'node:test';
import assert from 'node:assert/strict';
import { createKitchenApp } from './app.mjs';
import { createServer } from 'node:http';

async function fixture(t, storeOverride) {
  const calls = [];
  const store = storeOverride === null ? null : { getState: async () => ({ revision: 1, dataset: 'Fictional kitchen scenario' }), approveRecovery: async args => { calls.push(args); return { status: 'approved', revision: 2 }; } };
  const agent = { investigate: async args => { calls.push(args); return { status: 'answered' }; }, recovery: async args => { calls.push(args); return { eligible: true }; } };
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  server.on('request', createKitchenApp({ store, agent, port: server.address().port }));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, opts = {}) => fetch(`${base}/api/kitchen${path}`, opts);
  const status = await (await request('/status')).json();
  const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Savora-Token': status.csrfToken, ...headers }, body: JSON.stringify(body) });
  return { calls, request, post, status };
}
test('local status discloses guided mode and never includes a model key', async t => {
  const { status } = await fixture(t);
  assert.equal(status.database, 'connected');
  assert.equal(status.agentMode, 'guided');
  assert.equal(status.modelConfigured, false);
  assert.equal(status.csrfToken.length, 64);
});
test('approval requires local token and rejects external origin before any mutation', async t => {
  const { post, calls } = await fixture(t);
  const body = { proposalId: 'proposal-1', expectedRevision: 1 };
  assert.equal((await post('/approve', body, { 'X-Savora-Token': '' })).status, 403);
  assert.equal((await post('/approve', body, { Origin: 'https://evil.example' })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await post('/approve', body)).status, 200);
  assert.equal(calls.length, 1);
});
test('strict input and bounded traversal are checked before tools', async t => {
  const { post, calls } = await fixture(t);
  assert.equal((await post('/investigate', { question: 'Roma tomatoes', depth: 99 })).status, 400);
  assert.equal((await post('/investigate', { question: 'Roma tomatoes', depth: 4, cypher: 'DELETE' })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post('/investigate', { question: 'Roma tomatoes', depth: 4 })).status, 200);
});
test('unavailable graph is not replaced with a fixture response', async t => {
  const { status, post } = await fixture(t, null);
  assert.equal(status.database, 'unavailable');
  assert.equal((await post('/investigate', { question: 'Roma tomatoes', depth: 1 })).status, 503);
});
