import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_ALLOWLIST, assertSafePath, assertNoSecret, makePackageFiles, collectSourceFiles, makeZip, buildSourceExport } from './source-packaging.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');

test('path guards reject private state, recursive-copy risks and traversal', () => {
  for (const name of ['.env', '.env.kitchen.example', 'nested/.env.private', '.kitchen-data/dump.rdb', 'artifacts/screenshot.png', 'node_modules/a/index.js', '../secret', '/etc/passwd', 'a/../b', 'a\\b', '.git/config', 'dump.aof']) {
    assert.throws(() => assertSafePath(name));
  }
  assert.equal(assertSafePath('kitchen/server.mjs'), 'kitchen/server.mjs');
  assert.equal(assertSafePath('CONFIGURATION.example.txt'), 'CONFIGURATION.example.txt');
});

test('credential detection refuses values without echoing the matched credential', () => {
  const synthetic = `AIza${'A'.repeat(35)}`;
  assert.throws(() => assertNoSecret(Buffer.from(synthetic), 'fixture.txt'), error => !error.message.includes(synthetic));
  assert.throws(() => assertNoSecret(Buffer.from(['https://', 'user', ':', 'password', '@', 'registry.example/a'].join('')), 'lock'));
  assert.doesNotThrow(() => assertNoSecret(Buffer.from('GEMINI_API_KEY=\nGEMINI_FREE_TIER_CONFIRMED=false'), 'template'));
});

test('manifest pins exact locked versions and refuses unexpected/private dependency sources', async () => {
  const original = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const { manifest, lock } = makePackageFiles(original);
  assert.equal(manifest.name, 'savora-kitchen-rescue');
  assert.equal(manifest.private, true);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  for (const [name, version] of Object.entries(manifest.dependencies)) assert.equal(version, lock.packages[`node_modules/${name}`].version);
  assert.equal(manifest.scripts['graph:seed'], undefined);
  const additional = structuredClone(original);
  additional.packages[''].dependencies.unreviewed = '1.0.0';
  assert.throws(() => makePackageFiles(additional), /dependency set changed/);
  const privateLock = structuredClone(original);
  privateLock.packages['node_modules/express'].resolved = ['https://', 'user', ':', 'password', '@', 'registry.example/express.tgz'].join('');
  assert.throws(() => makePackageFiles(privateLock), /resolution/);
});

test('actual export allowlist closes imports, includes the photograph and hashes every included file', async () => {
  const files = await collectSourceFiles(root);
  for (const name of SOURCE_ALLOWLIST) assert.ok(files.has(name), name);
  assert.ok(files.has('design/editorial/assets/tomatoes-dilara-pexels.jpg'));
  const readme = files.get('README.md').toString('utf8');
  assert.match(readme, /OpenAI Codex coding assistance/);
  assert.match(readme, /participant must review and understand/);
  assert.match(readme, /does not certify complete participant review/);
  assert.ok(![...files.keys()].some(name => name.startsWith('server/') || name.startsWith('web/') || name.startsWith('agent/') || name.includes('.env')));
  const manifest = JSON.parse(files.get('export-manifest.json'));
  assert.equal(manifest.files.length, files.size - 1);
  for (const item of manifest.files) {
    assert.equal(item.bytes, files.get(item.path).length);
    assert.equal(item.sha256, sha(files.get(item.path)));
  }
  assert.deepEqual(makeZip(files), makeZip(files));
});

test('public documentation describes the project without internal packaging language', async () => {
  const files = await collectSourceFiles(root);
  for (const name of ['README.md', 'RUNTIME.md', 'ASSET_LICENSES.md', 'package.json', 'package-lock.json', 'export-manifest.json']) {
    const content = files.get(name).toString('utf8');
    assert.doesNotMatch(content, /\u2014/, name);
    assert.doesNotMatch(content, /earlier travel|travel prototype|travel application source|standalone export|parent workspace|before publishing|new repository from/i, name);
  }
  const readme = files.get('README.md').toString('utf8');
  for (const path of ['kitchen/store.mjs', 'kitchen/CONTRACT.md', 'kitchen/store.test.mjs', 'kitchen/integration.test.mjs', 'kitchen/agent.mjs', 'kitchen/VERIFICATION.md', 'RUNTIME.md', 'ASSET_LICENSES.md']) {
    assert.ok(readme.includes(`](${path})`), `README links ${path}`);
    assert.ok(files.has(path), `README target exists: ${path}`);
  }
  assert.match(readme, /fictional quantities, recipes and timings/);
  assert.match(readme, /fresh-machine installation remain unverified/);
  assert.match(readme, /guided mode calls those tools deterministically/);
  assert.match(readme, /Approval is human-only and is not exposed as a model tool/);
  assert.match(readme, /not safe for a public writable deployment/);
  const manifest = JSON.parse(files.get('export-manifest.json'));
  assert.equal(manifest.project, 'Savora Kitchen Rescue');
  assert.match(manifest.policy, /excludes private configuration, credentials, database state/);
});

test('allowlist refuses a symlink even when the target is otherwise readable', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'savora-export-symlink-'));
  try {
    await mkdir(join(scratch, 'kitchen'), { recursive: true });
    await symlink(join(root, 'kitchen/agent.mjs'), join(scratch, 'kitchen/agent.mjs'));
    await assert.rejects(collectSourceFiles(scratch), /Symlink/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('export creates a unique folder and standard stored-entry ZIP without overwriting prior files', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'savora-export-test-'));
  try {
    const result = await buildSourceExport({ root, outputParent: scratch });
    const zip = await readFile(result.archivePath);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt16LE(zip.length - 12), result.files);
    assert.equal(sha(zip), result.archiveSha256);
    const storedManifest = JSON.parse(await readFile(join(result.sourcePath, 'export-manifest.json'), 'utf8'));
    for (const item of storedManifest.files) assert.equal(sha(await readFile(join(result.sourcePath, item.path))), item.sha256);
    const second = await buildSourceExport({ root, outputParent: scratch });
    assert.notEqual(dirname(result.sourcePath), dirname(second.sourcePath));
    assert.equal(result.archiveSha256, second.archiveSha256);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
