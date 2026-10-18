import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKitchenStore } from './store.mjs';
import { createKitchenAgent, kitchenModelConfiguration } from './agent.mjs';
import { createKitchenApp } from './app.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.KITCHEN_PORT || 4319);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('KITCHEN_PORT must be a non-privileged port.');
let store;
let agent;
// FalkorDBLite installs signal handlers that re-raise SIGTERM before application
// cleanup finishes. Own shutdown here so the database directory lock is released.
// Preserve all listeners that were present before opening this runtime.
const signalListeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
try {
  store = await createKitchenStore({ path: process.env.KITCHEN_DATA_DIR || resolve(root, '.kitchen-data') });
  for (const [signal, previous] of signalListeners) {
    for (const listener of process.listeners(signal)) if (!previous.has(listener)) process.removeListener(signal, listener);
  }
  agent = await createKitchenAgent(store);
  console.log('Kitchen Rescue: actual FalkorDBLite connected locally. Fictional kitchen dataset.');
} catch (error) {
  console.error(`Kitchen Rescue could not start its graph: ${error.message}`);
  await store?.close().catch(() => {});
  store = null;
}
const modelConfigured = kitchenModelConfiguration().configured;
console.log(modelConfigured ? 'Gemini configuration supplied; live model success will be reported per run.' : 'Guided MCP mode. No external model calls; no API charges.');
const app = createKitchenApp({ store, agent, modelConfigured, port });
const server = app.listen(port, '127.0.0.1', () => console.log(`Kitchen Rescue API: http://127.0.0.1:${port}`));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise(resolve => server.close(resolve));
  try { await agent?.close(); } catch (error) { console.error(`Agent shutdown: ${error.message}`); }
  try { await store?.close(); } catch (error) { console.error(`Database shutdown: ${error.message}`); }
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
