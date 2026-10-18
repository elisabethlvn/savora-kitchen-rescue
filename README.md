# Savora — Kitchen Rescue

A local graph-grounded recovery workbench for Graph Hacks Track 01. A delayed ingredient connects to shared preparations and two services. Competing stock reservations invalidate one alternative; a human reviews the graph-backed proposal before reservations and preparation tasks change together.

This standalone export contains **only Kitchen Rescue**, not the earlier travel prototype. All quantities, recipes and timings are fictional. It is not food-safety advice or production kitchen software.

## Run locally — no Docker, no Cloud database, no model key required

Requirements: Node.js 22.12+, npm, native Redis on PATH, and the native FalkorDB module used by FalkorDBLite. The tested platform is macOS arm64. Upstream also supports Linux x64, but this project has not verified that platform.

1. Extract this source folder to a short path, such as ~/savora, because Unix socket paths have platform length limits.
2. Install native Redis with your package manager if it is absent (macOS: `brew install redis`). **Do not start brew services**: the application owns its private Redis process.
3. Run `npm ci`, then `npm run dev`. Open http://127.0.0.1:5180.
4. Build with `npm run build`; run `npm start` and open http://127.0.0.1:4319 for production-style local serving.
5. Run `npm test` for real graph/API/MCP/lifecycle tests and `npm run test:packaging` for export safeguards. Tests make no model API calls.

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
