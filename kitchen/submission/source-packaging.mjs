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

const README = `# Savora Kitchen Rescue

When an ingredient delivery is delayed, which meals depend on it, and what can the kitchen prepare instead? Savora follows those dependencies in FalkorDB, checks replacement ingredients against existing stock reservations and service times, and presents a recovery plan for human approval.

Built for Graph Hacks Track 01, Agents That Act on Connected Data. The demo uses fictional quantities, recipes and timings. It is not food-safety advice or production kitchen software.

## Run locally

No Docker, cloud database or model key is required. You need Node.js 22.12+, npm, native Redis on PATH, and the native FalkorDB module used by FalkorDBLite. The tested platform is macOS arm64. Linux x64 is supported upstream but has not been tested for this project.

1. Clone the repository to a short path, such as ~/savora, to stay within Unix socket path limits.
2. Install native Redis if needed. On macOS, use \`brew install redis\`. Do not start brew services; Savora manages its own private Redis process.
3. Run \`npm ci\`, then \`npm run dev\`. Open http://127.0.0.1:5180.
4. For a local production build, run \`npm run build\`, then \`npm start\`. Open http://127.0.0.1:4319.
5. Run \`npm test\` for graph, API, MCP and lifecycle tests. Run \`npm run test:packaging\` to check source-package safeguards. Tests make no model API calls.

FalkorDBLite 0.3.0's optional macOS binary package was unusable on the development machine. Native Redis plus the official FalkorDB module download worked. Installation may require internet access, OpenSSL libraries or libomp. Tests and builds reused installed dependencies; a fresh \`npm ci\` and a fresh-machine installation remain unverified. See [runtime notes](RUNTIME.md) for details.

Both servers bind to loopback. The database uses a private Unix socket with TCP disabled and persists data in .kitchen-data. To try a fresh scenario, set KITCHEN_DATA_DIR to a new empty directory instead of deleting prior approvals. Normal shutdown releases .savora.lock. After a hard crash, confirm the old process has stopped before recovering a stale lock.

## Graph model and recovery

Savora traverses Ingredient → shared base → preparation → dish → service paths using variable-length Cypher. Alternative ingredients, stock reservations and service timing are also graph facts. Missing or invalid facts block a proposal rather than being filled in by the model.

The [graph store](kitchen/store.mjs) contains the parameterized Cypher queries, stock checks and atomic approval mutation. The [data model and API contract](kitchen/CONTRACT.md) describes the relationships and response shapes. [Graph tests](kitchen/store.test.mjs) and [end-to-end tests](kitchen/integration.test.mjs) check that changed graph facts change or block the result.

The [agent](kitchen/agent.mjs) calls tools through the MCP SDK's local InMemoryTransport. This is local MCP, not an externally hosted endpoint. Without Gemini configuration, guided mode calls those tools deterministically and is labeled as such. With Gemini enabled, the model selects permitted read and proposal tools; it cannot invent Cypher or recipes.

Approval is human-only and is not exposed as a model tool. A separate local HTTP endpoint checks the server-owned proposal, current stock and revision, then atomically records the reservation, preparation tasks and audit event. Repeated approval requests return the existing receipt. The model cannot approve, reserve stock, purchase ingredients or message suppliers.

## Optional Gemini

Use [CONFIGURATION.example.txt](CONFIGURATION.example.txt) to create a private .env.kitchen. Check your project's free tier, billing and quota before enabling the model. Savora cannot verify billing or guarantee free API use. It does not buy credits, enable billing or switch to a paid fallback. Keep credentials private and use only fictional data.

The [verification record](kitchen/VERIFICATION.md) documents live Gemini investigation and recovery-tool selection on 18 October 2026. Approval and persistence browser checks used guided mode. Each run reports its actual mode, including a guided fallback if needed.

## Try the scenario

Ask about delayed Roma tomatoes at one hop, then four. At one hop, downstream service impact is not evaluated. Four hops connects two services and 64 portions. Review the passata conflict: 10 kg on hand minus 8 kg reserved leaves 2 kg against an 8 kg requirement. Canned tomatoes require 9 kg of the 10 kg available. Review the timing assumptions, approve the plan, then reload to see the saved preparation tasks. Ask about truffle to see how an unmodeled ingredient is handled.

## Limits and attribution

Savora is a single-user local demo. It has no multi-user authorization and is not safe for a public writable deployment. It does not send supplier messages, place purchases or infer allergens or food safety. The graph is bounded to four hops; missing coverage is not evidence that a service is unaffected.

The tomato photograph is a real photograph by Dilara on Pexels, not an AI-generated image. It illustrates the interface and does not establish the tomato variety. See [asset attribution and license](ASSET_LICENSES.md). Dependencies retain their own licenses; no project source-code license has been selected.

## AI-assistance disclosure

Built with **OpenAI Codex coding assistance** for implementation, tests, research and documentation, under the participant's concept and design direction. The verification record covers automated tests and actual FalkorDB, MCP and Gemini checks. This does not certify complete participant review; the participant must review and understand the code and claims before submission. Gemini use within the application is separate from that development assistance.
`;

const RUNTIME = `# Runtime and reproducibility notes

- package.json pins exact direct versions. package-lock.json records the integrity-pinned transitive dependencies. Native runtime prerequisites are installed separately.
- Use npm ci, not a lockfile regeneration, for the first clean install. Dependency lifecycle scripts may download the FalkorDB module. Review them according to your normal supply-chain policy.
- The development runtime was macOS arm64, native Redis 8.10.2, and FalkorDB module 4.18.3, loaded by falkordblite 0.3.0. The native Redis executable comes from the operating-system package manager; it is **not** pinned by package-lock.json or bundled here.
- The optional platform-package issue means this is not a guaranteed one-command, offline installation. Do not install a differently named platform bundle merely because its filename looks compatible; verify the native architecture.
- Build and test checks reused existing installed dependencies. They do not establish that npm ci or the native runtime works on a fresh machine. Linux x64 and other environments remain unverified until tested there.
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
  files.set('export-manifest.json', Buffer.from(json({ format: 1, project: 'Savora Kitchen Rescue',
    policy: 'Explicit source-file allowlist; excludes private configuration, credentials, database state, installed dependencies and generated artifacts.', files: records })));
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
