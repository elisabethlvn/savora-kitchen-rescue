import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Deliberately not a recursive directory copy: adding a local file never adds it
// to a public export. In particular, no .env file is opened by this builder.
export const SOURCE_ALLOWLIST = Object.freeze([
  'kitchen/agent.mjs', 'kitchen/agent.test.mjs',
  'kitchen/app.mjs', 'kitchen/app.test.mjs',
  'kitchen/data.mjs', 'kitchen/dev.mjs', 'kitchen/server.mjs',
  'kitchen/store.mjs', 'kitchen/store.test.mjs',
  'kitchen/integration.test.mjs', 'kitchen/lifecycle.test.mjs',
  'kitchen/CONTRACT.md', 'kitchen/VERIFICATION.md',
  'kitchen/web/main.jsx', 'kitchen/web/styles.css',
  'kitchen/web/index.html', 'kitchen/web/vite.config.js',
  'kitchen/submission/source-packaging.mjs',
  'kitchen/submission/source-packaging.test.mjs',
  'design/editorial/assets/tomatoes-dilara-pexels.jpg',
]);
const DIRECT_DEPENDENCIES = Object.freeze(['@google/genai', '@modelcontextprotocol/sdk', 'express', 'falkordb', 'falkordblite', 'lucide-react', 'react', 'react-dom', 'zod']);
const DEV_DEPENDENCIES = Object.freeze(['vite']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function assertSafePath(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.includes('\0')) throw new Error('Unsafe export path.');
  const pieces = name.split('/');
  if (pieces.some(part => !part || part === '.' || part === '..' || /^\.env/i.test(part)
    || /^\.kitchen-data/i.test(part) || ['node_modules', 'artifacts', '.git', '.savora.lock'].includes(part))) {
    throw new Error(`Forbidden export path: ${name}`);
  }
  if (/\.(?:rdb|aof|log|zip)$/i.test(name)) throw new Error(`Runtime/archive file is not a source export: ${name}`);
  return name;
}

export function assertNoSecret(bytes, label) {
  const text = bytes.toString('utf8');
  // High-confidence patterns only. Environment variable NAMES and empty example
  // placeholders are expected; secret VALUES are not. No matched value is logged.
  const patterns = [
    /AIza[0-9A-Za-z_-]{35}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[0-9A-Za-z]{30,}\b/,
    /\bsk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{40,}\b/,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  ];
  if (patterns.some(pattern => pattern.test(text))) throw new Error(`Possible credential in allowlisted file ${label}; export refused. Matched content is intentionally not printed.`);
}

async function readAllowedFile(root, name) {
  assertSafePath(name);
  let current = root;
  for (const part of name.split('/')) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Symlink not permitted in source export: ${name}`);
  }
  const info = await lstat(current);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`Not a bounded regular file: ${name}`);
  const actual = await realpath(current);
  if (relative(root, actual).startsWith(`..${sep}`)) throw new Error(`File escapes export source root: ${name}`);
  const bytes = await readFile(current);
  if (name.endsWith('.jpg')) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error(`Expected JPEG data: ${name}`);
  } else assertNoSecret(bytes, name);
  return bytes;
}

export function makePackageFiles(originalLock) {
  if (originalLock.lockfileVersion !== 3 || !originalLock.packages?.['']) throw new Error('Expected the existing npm lockfile v3.');
  const originalRoot = originalLock.packages[''];
  const expectedNames = [...DIRECT_DEPENDENCIES, ...DEV_DEPENDENCIES].sort();
  const originalNames = [...Object.keys(originalRoot.dependencies || {}), ...Object.keys(originalRoot.devDependencies || {})].sort();
  if (JSON.stringify(originalNames) !== JSON.stringify(expectedNames)) throw new Error('Root dependency set changed. Review the kitchen-only dependency allowlist before exporting.');
  const versions = names => Object.fromEntries(names.map(name => {
    const version = originalLock.packages[`node_modules/${name}`]?.version;
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error(`Missing exact locked dependency: ${name}`);
    return [name, version];
  }));
  for (const [name, entry] of Object.entries(originalLock.packages)) {
    if (name && !name.startsWith('node_modules/')) throw new Error('Workspace/file dependencies cannot be safely exported by this builder.');
    if (entry.link) throw new Error('Linked dependencies are not allowed in this standalone export.');
    if (entry.resolved) {
      const url = new URL(entry.resolved);
      if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.search || url.hash) {
        throw new Error('Lockfile contains a non-public-registry or credential-bearing resolution; export refused.');
      }
    }
  }
  const manifest = {
    name: 'savora-kitchen-rescue', version: '0.1.0', private: true, type: 'module',
    description: 'Graph-grounded kitchen recovery with local FalkorDB, MCP tools and human-approved reservations.',
    engines: { node: '>=22.12' },
    scripts: {
      dev: 'node kitchen/dev.mjs', start: 'node --env-file-if-exists=.env.kitchen kitchen/server.mjs',
      build: 'vite build --config kitchen/web/vite.config.js', test: 'node --test kitchen/*.test.mjs',
      'kitchen:dev': 'node kitchen/dev.mjs', 'kitchen:start': 'node --env-file-if-exists=.env.kitchen kitchen/server.mjs',
      'kitchen:build': 'vite build --config kitchen/web/vite.config.js', 'kitchen:test': 'node --test kitchen/*.test.mjs',
      'test:packaging': 'node --test kitchen/submission/source-packaging.test.mjs',
      'export:source': 'node kitchen/submission/source-packaging.mjs',
    },
    dependencies: versions(DIRECT_DEPENDENCIES), devDependencies: versions(DEV_DEPENDENCIES),
  };
  // Every original direct dependency is used by Kitchen Rescue. Preserve the
  // original, integrity-pinned transitive graph and only replace root metadata.
  const lock = structuredClone(originalLock);
  lock.name = manifest.name; lock.version = manifest.version;
  lock.packages[''] = { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies, engines: manifest.engines };
  return { manifest, lock };
}

const README = `# Savora — Kitchen Rescue

A local graph-grounded recovery workbench for Graph Hacks Track 01. A delayed ingredient connects to shared preparations and two services. Competing stock reservations invalidate one alternative; a human reviews the graph-backed proposal before reservations and preparation tasks change together.

This standalone export contains **only Kitchen Rescue**, not the earlier travel prototype. All quantities, recipes and timings are fictional. It is not food-safety advice or production kitchen software.

## Run locally — no Docker, no Cloud database, no model key required

Requirements: Node.js 22.12+, npm, native Redis on PATH, and the native FalkorDB module used by FalkorDBLite. The tested platform is macOS arm64. Upstream also supports Linux x64, but this project has not verified that platform.

1. Extract this source folder to a short path, such as ~/savora, because Unix socket paths have platform length limits.
2. Install native Redis with your package manager if it is absent (macOS: \`brew install redis\`). **Do not start brew services**: the application owns its private Redis process.
3. Run \`npm ci\`, then \`npm run dev\`. Open http://127.0.0.1:5180.
4. Build with \`npm run build\`; run \`npm start\` and open http://127.0.0.1:4319 for production-style local serving.
5. Run \`npm test\` for real graph/API/MCP/lifecycle tests and \`npm run test:packaging\` for export safeguards. Tests make no model API calls.

FalkorDBLite 0.3.0's optional macOS binary package was unusable on the development machine; native Redis plus the official module download worked. Installation may need internet access, OpenSSL libraries and/or libomp. A successful npm install does not prove native runtime compatibility. This export does not bundle node_modules or native binaries. Consult RUNTIME.md before claiming a fresh-machine install works.

The API and Vite server bind to loopback. The database uses a private Unix socket, TCP disabled, and a persistent .kitchen-data directory. No data directory is included. Use a **new empty** KITCHEN_DATA_DIR for another rehearsal; never erase prior approval evidence just to restart a demo. Normal shutdown releases .savora.lock. After a hard crash, verify the old process has stopped before manually recovering a stale lock.

## Real graph and agent behavior

- Ingredient → shared base → preparation → dish → service uses actual variable-length FalkorDB Cypher traversal.
- Declared alternatives, ingredient stock, other reservations and service timing constrain recovery. Missing/invalid facts fail closed; the model cannot invent recipes or Cypher.
- Real MCP SDK client/server calls use local InMemoryTransport. This is **local MCP**, not an externally hosted MCP endpoint.
- Without private Gemini configuration, disclosed **guided mode** calls actual MCP tools deterministically. It is not described as AI-selected reasoning.
- Gemini, when explicitly configured, selects allowed read/proposal tools. Human approval is not a model tool. The model cannot reserve stock, approve, purchase or message.
- Approval uses a separate local HTTP endpoint, server-owned proposals, a current-stock recheck, revision guards, one atomic graph mutation and durable audit. Retries return the prior receipt.

## Optional Gemini

CONFIGURATION.example.txt contains only empty placeholders and a disabled confirmation. Create a private .env.kitchen yourself if wanted; no private configuration is copied by this exporter. Only enable the model after independently checking the project's free tier, billing and quota. The application does not verify billing or guarantee free external API use. It does not buy credits, enable billing or switch to a paid fallback. Keep the dataset fictional.

See kitchen/VERIFICATION.md for the development verification record: live Gemini investigation and recovery-tool selection were verified on 18 October 2026; approval/persistence browser checks used guided mode. Approval remains human-only, not a model tool. Referenced screenshots/QA databases are intentionally **not** included here.

## Demonstration

Ask about delayed Roma tomatoes at one hop, then four. Shallow traversal is “not evaluated,” not an all-clear. Four hops connects two services/64 portions. Review the passata conflict: 10 kg on hand minus 8 kg already reserved leaves 2 kg against an 8 kg requirement. The declared canned-tomato alternative requires 9 kg of 10 kg available. Review timings, approve, reload the persisted prep board, then ask about unknown truffle.

## Publication and boundaries

This is a single-local-user prototype: no public writable deployment, multi-user authorization, supplier messages or purchases. No source-code license has been chosen by this exporter; the owner should choose a license before public publication if desired. Third-party dependencies retain their own licenses, and the food photograph has separate attribution in ASSET_LICENSES.md.

Review the allowlisted source, empty configuration template and export-manifest.json before publishing. Initialize a **new repository from this clean source folder**, not from the parent workspace; this avoids unrelated history/data. This export does not create repositories, push commits, upload files or submit the entry.

## AI-assistance disclosure

This project was developed with **OpenAI Codex coding assistance**, including implementation, tests, research and technical documentation. The concept and design direction are participant-owned and were developed through human/AI collaboration. Automated tests and actual local FalkorDB/MCP execution were verified; kitchen/VERIFICATION.md describes the verification scope, including live Gemini investigation and recovery-tool selection. These checks do not establish that the participant has personally reviewed every part of the implementation.

**Before final submission, the participant must review and understand the code, queries, agent boundaries, tests and claims, and meaningfully own the submitted work.** That review is not asserted to be complete. Optional Gemini use inside the application is separate from Codex assistance used to build it. The tomato photograph is a licensed real photograph, not an AI-generated image; see ASSET_LICENSES.md.
`;

const RUNTIME = `# Runtime and reproducibility notes

- package.json pins exact direct versions from the existing npm lockfile. package-lock.json preserves the same integrity-pinned transitive package graph, with kitchen-only root metadata. No dependencies are installed by the exporter.
- Use npm ci, not a lockfile regeneration, for the first clean install. Dependency lifecycle scripts may download the FalkorDB module. Review them according to your normal supply-chain policy.
- The development runtime was macOS arm64, native Redis 8.10.2, and FalkorDB module 4.18.3, loaded by falkordblite 0.3.0. The native Redis executable comes from the operating-system package manager; it is **not** pinned by package-lock.json or bundled here.
- The optional platform-package issue means this is not a guaranteed one-command, offline installation. Do not install a differently named platform bundle merely because its filename looks compatible; verify the native architecture.
- Current-platform source/export build and test checks may reuse existing installed dependencies. They do not establish that npm ci or the native runtime works on a fresh machine. Linux x64 and other environments remain unverified until tested there.
- The exporter writes a standard ZIP with fixed timestamps and an explicit file list. export-manifest.json records SHA-256 hashes of every included source/generated file except the manifest itself. No filesystem metadata, home directory paths, env values or existing database contents are added to that manifest.

Official runtime source: https://github.com/FalkorDB/falkordblite-ts
Troubleshooting: https://github.com/FalkorDB/falkordblite-ts/blob/main/TROUBLESHOOTING.md
`;

function generatedFiles(manifest, lock) {
  return new Map(Object.entries({
    'package.json': json(manifest), 'package-lock.json': json(lock),
    'README.md': README, 'RUNTIME.md': RUNTIME,
    'CONFIGURATION.example.txt': '# Copy privately to .env.kitchen only if enabling the optional model.\n# Never commit keys or enable billing through this demo.\nGEMINI_API_KEY=\nGEMINI_MODEL=\nGEMINI_FREE_TIER_CONFIRMED=false\n# Optional: KITCHEN_DATA_DIR=/your/new/empty/short/path\n',
    '.gitignore': 'node_modules/\n.env*\n.kitchen-data*/\nartifacts/\nkitchen/web/dist/\n.DS_Store\n*.log\n*.zip\n',
    'ASSET_LICENSES.md': '# Photograph attribution\n\nTomato photograph: Dilara / Pexels, photo 29081091.\n\nOriginal: https://www.pexels.com/photo/fresh-heirloom-tomatoes-on-rustic-wooden-table-29081091/\n\nLicense: https://www.pexels.com/license/\n\nThe Pexels license permits free use and modification; attribution is appreciated. The image is illustrative food photography, not evidence of the Roma variety, and does not imply photographer endorsement. The photograph is not being relicensed as project source code.\n\nIncluded path: design/editorial/assets/tomatoes-dilara-pexels.jpg\n',
  }).map(([name, content]) => [name, Buffer.from(content)]));
}

function checkRelativeImports(files) {
  for (const [name, bytes] of files) {
    if (!/\.(?:mjs|jsx)$/.test(name)) continue;
    for (const match of bytes.toString('utf8').matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)) {
      const target = posix.normalize(posix.join(posix.dirname(name), match[1]));
      if (!files.has(target)) throw new Error(`Missing allowlisted relative import from ${name}: ${target}`);
    }
  }
}

export async function collectSourceFiles(root) {
  const sourceRoot = await realpath(resolve(root));
  const source = new Map();
  for (const name of SOURCE_ALLOWLIST) source.set(name, await readAllowedFile(sourceRoot, name));
  // This is public dependency metadata, not an env/config file.
  const lockBytes = await readAllowedFile(sourceRoot, 'package-lock.json');
  const { manifest, lock } = makePackageFiles(JSON.parse(lockBytes.toString('utf8')));
  const files = new Map([...source, ...generatedFiles(manifest, lock)]);
  checkRelativeImports(files);
  const records = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) }));
  files.set('export-manifest.json', Buffer.from(json({ format: 1, project: 'Savora — Kitchen Rescue',
    policy: 'Explicit file allowlist; no .env files, credentials, database state, node_modules, artifacts or travel application source.', files: records })));
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Dependency-free ZIP32 writer (stored entries, UTF-8 paths, fixed 1980 timestamp).
// No shell expansion, recursive ZIP tool or file metadata can leak extra files.
export function makeZip(files) {
  if (files.size > 65535) throw new Error('ZIP32 entry limit exceeded.');
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    assertSafePath(name);
    const filename = Buffer.from(name), bytes = Buffer.from(content), crc = crc32(bytes);
    if (filename.length > 65535 || bytes.length > MAX_FILE_BYTES) throw new Error('ZIP entry exceeds export limits.');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function buildSourceExport({ root = fileURLToPath(new URL('../../', import.meta.url)), outputParent } = {}) {
  const files = await collectSourceFiles(root); // All validation happens before any export directory is created.
  const archive = makeZip(files);
  const parent = outputParent || join(resolve(root), 'artifacts', 'submission-exports');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'savora-kitchen-rescue-'));
  const sourcePath = join(directory, 'source');
  for (const [name, bytes] of files) {
    const target = join(sourcePath, ...name.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
  }
  const archivePath = join(directory, 'Savora-Kitchen-Rescue.zip');
  await writeFile(archivePath, archive, { flag: 'wx', mode: 0o644 });
  return { sourcePath, archivePath, files: files.size, archiveBytes: archive.length, archiveSha256: hash(archive) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const unexpected = process.argv.slice(2);
  if (unexpected.length) throw new Error('This builder takes no command-line arguments; its explicit source allowlist is fixed.');
  console.log(json(await buildSourceExport()));
}
