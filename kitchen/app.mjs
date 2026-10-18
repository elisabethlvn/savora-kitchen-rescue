import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const investigationSchema = z.object({ question: z.string().trim().min(1).max(500), depth: z.number().int().min(1).max(4) }).strict();
const recoverySchema = z.object({ ingredientId: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i) }).strict();
const approvalSchema = z.object({ proposalId: z.string().min(1).max(120), expectedRevision: z.number().int().nonnegative() }).strict();

export function createKitchenApp({ store, agent, modelConfigured = false, port = 4319, webPort = 5180 }) {
  const app = express();
  app.disable('x-powered-by');
  const csrfToken = randomBytes(32).toString('hex');
  const validHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1:${webPort}`, `localhost:${webPort}`]);
  const validOrigins = new Set([...validHosts].map(host => `http://${host}`));
  let busy = false;
  const recentRuns = [];
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (!validHosts.has(req.get('host'))) return res.status(403).json({ error: 'Local access only.', code: 'INVALID_HOST' });
    if (req.get('origin') && !validOrigins.has(req.get('origin'))) return res.status(403).json({ error: 'This app only accepts requests from its local interface.', code: 'INVALID_ORIGIN' });
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.use('/api/kitchen', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const supplied = req.get('X-Savora-Token') || '';
    const tokenMatches = /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(csrfToken));
    if (!tokenMatches) return res.status(403).json({ error: 'Refresh the app before making changes.', code: 'INVALID_TOKEN' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON content type required.', code: 'JSON_REQUIRED' });
    next();
  });
  const requireStore = (req, res, next) => store ? next() : res.status(503).json({ error: 'The local graph database is not connected. No graph tools have run.', code: 'DATABASE_UNAVAILABLE' });
  const validate = schema => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Check the request fields and try again.', code: 'INVALID_INPUT' });
    req.body = result.data;
    next();
  };
  const run = handler => async (req, res, next) => {
    if (busy) return res.status(409).json({ error: 'Another operation is running. Please wait for it to finish.', code: 'BUSY' });
    const now = Date.now();
    while (recentRuns.length && recentRuns[0] <= now - 60_000) recentRuns.shift();
    if (recentRuns.length >= 20) return res.status(429).json({ error: 'Local demo rate limit reached. Please wait one minute.', code: 'RATE_LIMITED' });
    recentRuns.push(now);
    busy = true;
    try { res.json(await handler(req.body)); } catch (error) { next(error); } finally { busy = false; }
  };
  app.get('/api/kitchen/status', async (req, res, next) => {
    try {
      const state = store ? await store.getState() : { revision: null, dataset: 'Fictional kitchen scenario' };
      res.json({ database: store ? 'connected' : 'unavailable', provider: 'falkordblite', modelConfigured, modelStatus: modelConfigured ? 'configured-unverified' : 'not-configured', agentMode: modelConfigured ? 'gemini' : 'guided', revision: state.revision, dataset: state.dataset, csrfToken });
    } catch (error) { next(error); }
  });
  app.get('/api/kitchen/state', requireStore, async (req, res, next) => {
    try { res.json(await store.getState()); } catch (error) { next(error); }
  });
  app.post('/api/kitchen/investigate', requireStore, validate(investigationSchema), run(body => agent.investigate(body)));
  app.post('/api/kitchen/recovery', requireStore, validate(recoverySchema), run(body => agent.recovery(body)));
  app.post('/api/kitchen/approve', requireStore, validate(approvalSchema), run(body => store.approveRecovery(body)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.', code: 'NOT_FOUND' }));
  const dist = fileURLToPath(new URL('./web/dist/', import.meta.url));
  if (existsSync(`${dist}/index.html`)) {
    app.use(express.static(dist));
    app.get('/{*splat}', (req, res) => res.sendFile(`${dist}/index.html`));
  }
  app.use((error, req, res, next) => {
    const candidate = Number(error.status || error.statusCode);
    const status = candidate >= 400 && candidate < 500 ? candidate : 500;
    res.status(status).json({ error: status === 500 ? 'The operation did not complete. No successful result has been assumed.' : (error.type === 'entity.parse.failed' ? 'Invalid JSON.' : error.message), code: error.code || 'OPERATION_FAILED' });
  });
  return app;
}
