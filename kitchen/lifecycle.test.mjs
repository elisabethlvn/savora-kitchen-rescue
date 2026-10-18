import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKitchenStore } from './store.mjs';

test('SIGTERM gracefully releases the persistent database lock and permits restart', { timeout: 20000 }, async () => {
  const path = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'savora-lifecycle-'));
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => probe.once('listening', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let child, reopened;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      env: { ...process.env, KITCHEN_DATA_DIR: path, KITCHEN_PORT: String(port), GEMINI_API_KEY: '', GEMINI_MODEL: '', GEMINI_FREE_TIER_CONFIRMED: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
      child.stdout.on('data', bytes => { output += bytes.toString(); if (output.includes(`Kitchen Rescue API: http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', bytes => { output += bytes.toString(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const status = await (await fetch(`http://127.0.0.1:${port}/api/kitchen/status`)).json();
    assert.equal(status.database, 'connected', output);
    child.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
    await assert.rejects(stat(join(path, '.savora.lock')), { code: 'ENOENT' });
    reopened = await createKitchenStore({ path });
    assert.equal((await reopened.getState()).revision, 0);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await reopened?.close();
    await rm(path, { recursive: true, force: true });
  }
});
