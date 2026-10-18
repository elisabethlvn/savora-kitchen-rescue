# Kitchen Rescue implementation contract

New app, separate from existing Bandung travel prototype. $0, local FalkorDBLite, optional Gemini free-tier key. No Cloud credentials, billing, external writes or public deployment. Fictional dataset, actual graph execution. No simulated timing or fake model/tool claims.

## Ownership
- Backend agent: `kitchen/store.mjs`, `kitchen/data.mjs`, `kitchen/store.test.mjs`. May add kitchen Cypher helpers. Do not edit package files.
- Frontend agent: `kitchen/web/**`. Do not edit package files or server files.
- Agent-tools agent: `kitchen/agent.mjs`, `kitchen/agent.test.mjs`. Actual MCP SDK client/server in-memory transport is fine; clearly describe local MCP. Do not edit package files.
- Root: integration server, dependencies, scripts, documentation, QA.

## Store exports
`export async function createKitchenStore({path, graphName='savora_kitchen'}={})` returns methods:
- `resolveIngredient({query})` -> `{ ingredient: {id,name}|null, evidence: {cypher,rows} }`. Exact names/aliases only; may extract a known ingredient from question but unknown must stay unknown.
- `traceImpact({ingredientId,depth})` -> `{ingredient,depth,graph:{nodes:[{id,label,kind,depth}],edges:[{source,target,type}]},paths:[{nodeIds,labels,hops}],metrics:{nodes,services,portions,furthestHop},revision,evidence:{cypher,rows}}`. Return actual Cypher variable-hop traversal, not JS fixture traversal. At depth1, services=0 means NOT EVALUATED, not unaffected.
- `inspectStock({ingredientId})` -> `{options:[{ingredientId,name,stockKg,reservedKg,availableKg,requiredKg,shortfallKg,feasible}],protectedReservations:[...],evidence:{cypher,rows}}`. Graph-connected reservations and alternatives determine results.
- `simulateRecovery({ingredientId})` -> `{id,revision,eligible,options:[same fields],selected:{ingredientId,name,requiredKg,remainingKg}|null,prepTargets:[{name,time,serviceTime,bufferMinutes}],protectedReservations:[...],evidence:{cypher,rows}}`. Proposal server-owned and persisted in graph; reject duplicates or handle current approved state safely.
- `approveRecovery({proposalId,expectedRevision})` -> `{status:'approved',revision,proposalId,selected,prepTargets,audit:[...]}`. Atomic revision gate + available stock recheck + idempotency; mutate graph reservations, prep tasks and audit. No purchasing/messages. Only called by HTTP human approval endpoint, never exposed to model.
- `getState()` -> `{revision,dataset:'Fictional kitchen scenario',approvedPlans:[],audit:[]}`.
- `close()`.
Errors can carry `status` HTTP status and `code`. Raw errors to logs only, not response secrets.

## Agent exports
`export async function createKitchenAgent(store)` -> `{investigate({question,depth}), recovery({ingredientId}), close()}`.
Investigation returns store traceImpact fields plus `{runId,status:'answered'|'unknown',answer,trace:[{tool,args,durationMs,rowCount,cypher,source:'mcp'}],agent:{mode:'gemini'|'guided',model?,reason?}}`.
Unknown returns empty graph/paths/metrics with answer stating not modeled, no impact traversal.
`recovery` returns store simulateRecovery plus actual MCP trace and agent metadata.
MCP tools: resolve_ingredient, trace_recipe_impact, inspect_stock_reservations, simulate_recovery. Fixed parameterized Cypher is store-owned. Only tool result rows drive UI facts. No key -> real graph MCP execution with disclosed deterministic guided mode, NEVER claim AI selected tools. Gemini available only when GEMINI_API_KEY + GEMINI_MODEL + GEMINI_FREE_TIER_CONFIRMED=true are configured; no paid fallback. Bounded tool loop, preserve returned Gemini model parts/thought signatures, validate allowlist/args. Recovery must resolve graph-backed facts. On model failures disclose exact general category, no fake successful model calls.

## HTTP contract
Port4319 API, port5180 Vite, localhost only. Prefix `/api/kitchen`.
- GET `/status` -> `{database:'connected'|'unavailable',provider:'falkordblite',modelConfigured:boolean,agentMode:'gemini'|'guided',revision,dataset,csrfToken}`
- POST `/investigate` body `{question,depth}` -> agent result above
- POST `/recovery` body `{ingredientId}` -> agent recovery above
- POST `/approve` body `{proposalId,expectedRevision}` -> approval above
- GET `/state` -> store state above
POSTs require `X-Savora-Token` value from status, same-origin fetch, JSON content-type. Frontend should show backend errors and clear stale results; do not show fixture as execution while loading/disconnected.

## Fixture & interface
Use approved Figma editorial design in `design/editorial/`: white, black, cobalt blue; real tomato photo (existing licensed file); no rainbow/AI gradients. Desktop spacious editorial header, 1–4 hop controls, layered graph, actual tool trace, recovery review and approval receipt. Responsive, keyboard focus, readable text and reduced motion. Distinguish guided/AI status.

Roma tomatoes -> Tomato base -> Lasagna filling -> Baked lasagna -> Gallery dinner (40 portions,18:00); Tomato base -> Arrabbiata sauce -> Penne arrabbiata -> Studio supper (24 portions,19:00). 8 nodes,7 edges,4 hops. Delivery14:00->18:30. Two dinners CONNECTED, not necessarily both at risk.
Passata10kg stock,8kg reserved for Tomorrow lunch,2kg free,8kg required -> reject6kg short. Canned tomatoes10kg free,9kg required -> choose1kg remaining. Explicit chef-approved alternatives, never infer allergen safety.
Prep target Tomato base16:45; Gallery ready17:40; Studio ready18:40,20min buffers. Durations/yields synthetic declared assumptions. Preserve8kg passata reservation. Approval creates canned9kg reservation, prep tasks, graph audit and increments revision. Unknown truffle -> honest not modeled. Keep original fixture names and graph relationships mutable/testable so changing graph data changes outcomes.
