import test from 'node:test';
import assert from 'node:assert/strict';
import { createKitchenAgent, kitchenModelConfiguration } from './agent.mjs';

const confirmedEnv = { GEMINI_API_KEY: 'test-only-not-a-real-key', GEMINI_MODEL: 'gemini-test', GEMINI_FREE_TIER_CONFIRMED: 'true' };
const evidence = (name) => ({ cypher: `MATCH (n:${name}) RETURN n`, rows: [{ id: name }] });

function fakeStore() {
  const calls = [];
  return {
    calls,
    async resolveIngredient({ query }) {
      calls.push(['resolve', query]);
      return { ingredient: /^(roma-tomatoes|tomatoes|What happens if tomatoes arrive late\?)$/.test(query) ? { id: 'roma-tomatoes', name: 'Roma tomatoes' } : null, evidence: evidence('Ingredient') };
    },
    async traceImpact({ ingredientId, depth }) {
      calls.push(['trace', ingredientId, depth]);
      return { ingredient: { id: ingredientId, name: 'Roma tomatoes' }, depth, graph: { nodes: [{ id: 'roma-tomatoes', label: 'Roma tomatoes', kind: 'ingredient', depth: 0 }], edges: [] }, paths: [], metrics: { nodes: depth + 1, services: depth === 4 ? 2 : 0, portions: depth === 4 ? 64 : 0, furthestHop: depth }, revision: 0, evidence: evidence('Impact') };
    },
    async inspectStock({ ingredientId }) {
      calls.push(['inspect', ingredientId]);
      return { options: [], protectedReservations: [{ name: 'Tomorrow lunch', reservedKg: 8 }], evidence: evidence('Stock') };
    },
    async simulateRecovery({ ingredientId }) {
      calls.push(['simulate', ingredientId]);
      return { id: 'proposal-1', revision: 0, eligible: true, options: [], selected: { ingredientId: 'canned-tomatoes', name: 'Canned tomatoes', requiredKg: 9, remainingKg: 1 }, prepTargets: [], protectedReservations: [], evidence: evidence('Proposal') };
    },
    async approveRecovery() { throw new Error('Approval must never be exposed to the agent'); },
  };
}

function modelResponse(name, args, extra = {}) {
  return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id: `call-${name}` }, ...extra }] } }] };
}

test('guided investigation executes actual MCP catalogue and calls with measured graph evidence', async (t) => {
  const store = fakeStore();
  const agent = await createKitchenAgent(store, { env: {} });
  t.after(() => agent.close());
  const result = await agent.investigate({ question: 'tomatoes', depth: 4 });
  assert.equal(result.agent.mode, 'guided');
  assert.equal(result.status, 'answered');
  assert.match(result.answer, /2 services and 64 portions/);
  assert.deepEqual(result.trace.map((entry) => entry.tool), ['tools/list', 'resolve_ingredient', 'trace_recipe_impact']);
  for (const entry of result.trace) {
    assert.equal(entry.source, 'mcp');
    assert.ok(Number.isFinite(entry.durationMs) && entry.durationMs >= 0);
  }
  assert.equal(result.trace[2].rowCount, 1);
  assert.equal(result.trace[2].cypher, evidence('Impact').cypher);
});

test('unknown ingredient stops before graph traversal or Gemini', async (t) => {
  const store = fakeStore();
  const agent = await createKitchenAgent(store, { env: confirmedEnv, modelClient: { models: { generateContent() { throw new Error('Must not be called'); } } } });
  t.after(() => agent.close());
  const result = await agent.investigate({ question: 'truffle', depth: 4 });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.graph, { nodes: [], edges: [] });
  assert.deepEqual(store.calls, [['resolve', 'truffle']]);
});

test('shallow traversal never implies services are unaffected', async (t) => {
  const agent = await createKitchenAgent(fakeStore(), { env: {} });
  t.after(() => agent.close());
  assert.match((await agent.investigate({ question: 'tomatoes', depth: 1 })).answer, /not evaluated, not proven absent/);
});

test('recovery resolves then inspects and simulates through MCP, never approves', async (t) => {
  const store = fakeStore();
  const agent = await createKitchenAgent(store, { env: {} });
  t.after(() => agent.close());
  const result = await agent.recovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(result.selected.remainingKg, 1);
  assert.deepEqual(store.calls.map(([name]) => name), ['resolve', 'inspect', 'simulate']);
  await assert.rejects(agent.recovery({ ingredientId: 'truffle' }), { code: 'INGREDIENT_NOT_MODELED', status: 404 });
});

test('strict input validation rejects extra fields, invalid depth, and injection-shaped identifiers', async (t) => {
  const store = fakeStore();
  const agent = await createKitchenAgent(store, { env: {} });
  t.after(() => agent.close());
  for (const input of [{ question: 'tomatoes', depth: 5 }, { question: 'tomatoes', depth: 4, approve: true }, { question: '', depth: 1 }]) {
    await assert.rejects(agent.investigate(input), { code: 'INVALID_ARGUMENTS' });
  }
  await assert.rejects(agent.recovery({ ingredientId: "x') DETACH DELETE n" }), { code: 'INVALID_ARGUMENTS' });
  assert.deepEqual(store.calls, []);
});

test('Gemini is disabled unless every explicit free-tier configuration condition holds', async (t) => {
  for (const env of [{}, { ...confirmedEnv, GEMINI_FREE_TIER_CONFIRMED: 'false' }, { ...confirmedEnv, GEMINI_MODEL: '' }, { ...confirmedEnv, GEMINI_API_KEY: '' }]) {
    assert.equal(kitchenModelConfiguration(env).configured, false);
    const agent = await createKitchenAgent(fakeStore(), { env, modelClient: { models: { generateContent() { throw new Error('Must not be called'); } } } });
    t.after(() => agent.close());
    assert.equal((await agent.investigate({ question: 'tomatoes', depth: 4 })).agent.mode, 'guided');
  }
});

test('Gemini tool selection uses discovered schemas and preserves opaque thought signatures and function IDs', async (t) => {
  const requests = [];
  const first = modelResponse('inspect_stock_reservations', { ingredientId: 'roma-tomatoes' }, { thoughtSignature: 'opaque-test-signature' });
  const modelClient = { models: { async generateContent(request) {
    requests.push(structuredClone({ contents: request.contents, tools: request.config.tools }));
    return requests.length === 1 ? first : modelResponse('simulate_recovery', { ingredientId: 'roma-tomatoes' });
  } } };
  const agent = await createKitchenAgent(fakeStore(), { env: confirmedEnv, modelClient });
  t.after(() => agent.close());
  const result = await agent.recovery({ ingredientId: 'roma-tomatoes' });
  assert.equal(result.agent.mode, 'gemini');
  assert.deepEqual(requests[0].tools[0].functionDeclarations.map((tool) => tool.name), ['inspect_stock_reservations']);
  assert.equal(requests[1].contents[1].parts[0].thoughtSignature, 'opaque-test-signature');
  assert.equal(requests[1].contents[2].parts[0].functionResponse.id, 'call-inspect_stock_reservations');
  assert.ok(requests[0].tools[0].functionDeclarations[0].parametersJsonSchema);
});

test('malicious model approval, wrong ingredient, depth, or extra arguments is rejected then disclosed as guided', async (t) => {
  const outputs = [
    modelResponse('approve_recovery', { proposalId: 'x', expectedRevision: 0 }),
    modelResponse('trace_recipe_impact', { ingredientId: 'other', depth: 4 }),
    modelResponse('trace_recipe_impact', { ingredientId: 'roma-tomatoes', depth: 1 }),
    modelResponse('trace_recipe_impact', { ingredientId: 'roma-tomatoes', depth: 4, cypher: 'DELETE' }),
  ];
  for (const output of outputs) {
    const store = fakeStore();
    const agent = await createKitchenAgent(store, { env: confirmedEnv, modelClient: { models: { async generateContent() { return output; } } } });
    t.after(() => agent.close());
    const result = await agent.investigate({ question: 'tomatoes', depth: 4 });
    assert.equal(result.agent.mode, 'guided');
    assert.match(result.agent.reason, /tool-policy rejection/);
    assert.deepEqual(store.calls, [['resolve', 'tomatoes'], ['trace', 'roma-tomatoes', 4]]);
  }
});

test('provider quota failure is disclosed without leaking provider messages or keys', async (t) => {
  const agent = await createKitchenAgent(fakeStore(), { env: confirmedEnv, modelClient: { models: { async generateContent() { throw Object.assign(new Error('secret-key-provider-detail'), { status: 429 }); } } } });
  t.after(() => agent.close());
  const result = await agent.investigate({ question: 'tomatoes', depth: 4 });
  assert.match(result.agent.reason, /quota or rate limit/);
  assert.doesNotMatch(JSON.stringify(result), /secret-key-provider-detail|test-only-not-a-real-key/);
});

test('store failure cannot become a fabricated successful model or guided result', async (t) => {
  const store = fakeStore();
  store.traceImpact = async () => { throw new Error('database-password-detail'); };
  const agent = await createKitchenAgent(store, { env: {} });
  t.after(() => agent.close());
  await assert.rejects(agent.investigate({ question: 'tomatoes', depth: 4 }), (cause) => cause.status === 503 && !cause.message.includes('password'));
});

test('confirmed configuration pins Google Developer API and disables retries and enterprise fallback', async (t) => {
  let captured;
  const agent = await createKitchenAgent(fakeStore(), {
    env: { ...confirmedEnv, GOOGLE_GEMINI_BASE_URL: 'https://untrusted.example/', GOOGLE_GENAI_USE_ENTERPRISE: 'true' },
    modelClientFactory(options) {
      captured = options;
      return { models: { async generateContent() { return modelResponse('trace_recipe_impact', { ingredientId: 'roma-tomatoes', depth: 4 }); } } };
    },
  });
  t.after(() => agent.close());
  assert.equal(captured.httpOptions.baseUrl, 'https://generativelanguage.googleapis.com/');
  assert.equal(captured.httpOptions.retryOptions.attempts, 1);
  assert.equal(captured.httpOptions.timeout, 12000);
  assert.equal(captured.enterprise, false);
  assert.equal(captured.vertexai, false);
  const result = await agent.investigate({ question: 'tomatoes', depth: 4 });
  assert.equal(result.agent.mode, 'gemini');
  assert.doesNotMatch(JSON.stringify(result), /test-only-not-a-real-key/);
});

test('unconfirmed configuration never even creates a model client', async (t) => {
  const agent = await createKitchenAgent(fakeStore(), {
    env: { ...confirmedEnv, GEMINI_FREE_TIER_CONFIRMED: 'false' },
    modelClientFactory() { assert.fail('Model client must not be constructed'); },
  });
  t.after(() => agent.close());
  assert.equal((await agent.recovery({ ingredientId: 'roma-tomatoes' })).agent.mode, 'guided');
});
