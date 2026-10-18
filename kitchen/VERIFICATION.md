# Kitchen Rescue verification

Verified on 18 October 2026 on macOS arm64 with the local native FalkorDBLite engine.

## Automated checks

- `npm run kitchen:test`: **25 passed, 0 failed, 0 skipped**. Includes actual graph traversal, reservation-aware proposals, atomic and idempotent approval, persistence, HTTP → MCP → FalkorDB integration, local-request protections, and graceful SIGTERM shutdown followed by reopening the database.
- `npm run kitchen:build`: production bundle built successfully.
- Existing travel prototype `npm test`: **25 passed, 0 failed, 1 Cloud integration test skipped**.
- The tests make no Gemini API requests. Model-adapter tests use controlled responses; they do not prove live-model operation.

## Browser checks

- One hop shows the shared base and labels downstream impact as not evaluated. Four hops returns two connected services and 64 portions.
- Unknown truffle stops after ingredient resolution without an impact query.
- Recovery rejects passata because 8 kg is already reserved; the proposed canned-tomato alternative needs 9 kg of 10 kg available.
- Explicit human approval saved a 9 kg reservation, three prep targets, one audit event and revision 1. The receipt survived a reload.
- At a 390 px viewport, the graph scrolls within its panel instead of expanding the document width.
- No browser warning or error was observed during the final interaction checks.

The approved browser-test database was preserved in `../artifacts/kitchen-ui-qa-state/`; it is not the active database. The active `.kitchen-data/` was created as a fresh scenario for the user. No prior travel data was reset.

## Runtime notes

The optional macOS binary bundle was unusable in this environment. The working setup uses Homebrew's native Redis executable and the official FalkorDB module downloaded by the `falkordblite` package. No Docker or system Redis service is needed. Redis's OpenSSL 4 dependency remains installed; the machine's original OpenSSL 3 command links were restored. Startup and actual Cypher queries were verified, rather than relying on package installation alone.

The app releases its exclusive database lock on normal shutdown. After a hard process kill, do not remove a lock until confirming that no process is using that database. A new empty `KITCHEN_DATA_DIR` is the non-destructive way to rehearse a fresh scenario.

## Still unverified / not performed

- Account billing status was not independently inspected. Live Gemini recovery tool selection is now verified in the later section below; the earlier approval/persistence browser checks used guided mode.
- No public hosting, public repository publication, video upload or hackathon submission has been performed.
- This is synthetic demonstration data, not validated restaurant operations or food-safety guidance.

## Live Gemini verification — 18 October 2026

After the user saved private configuration and confirmed free-tier use, the local server was restarted successfully without resetting its database. One browser investigation completed in **Gemini agent · gemini-3.5-flash-lite** mode, not the guided fallback. The adapter only returns this mode after receiving valid model-selected function calls and completing the required graph tools.

The four-hop tomato investigation returned eight graph nodes, two connected services and 64 portions. The visible real MCP trace contained `tools/list`, `resolve_ingredient` and `trace_recipe_impact`. Resolution is an application-controlled preflight; the impact tool was selected by Gemini. Displayed facts remain formatted from graph results. No recovery approval or stock mutation was performed in this test. No key value was displayed or recorded in the verification output.

Screenshots are in `../artifacts/`: `kitchen-approved.png`, `kitchen-mobile.png`, `kitchen-live-final.png` (guided), and `kitchen-gemini-live.png` (successful live model investigation).

## Live Gemini recovery verification — 18 October 2026

During actual demo recording, a recovery run on the **isolated local server at port 4320** completed in **Gemini agent · gemini-3.5-flash-lite** mode. Live recovery tool selection is therefore verified; the earlier approval/persistence browser checks remain guided-mode checks.

The recorded real MCP trace contained:

| Call | Reported result count |
| --- | --- |
| `tools/list` | 4 tool definitions in the catalog |
| `resolve_ingredient` | 1 evidence row |
| `inspect_stock_reservations` | 3 evidence rows |
| `simulate_recovery` | 13 evidence rows |

The returned proposal showed Passata with 10 kg stock, 8 kg reserved, 2 kg free and an 8 kg requirement: a 6 kg shortfall. Canned tomatoes had 10 kg available against a 9 kg requirement, leaving 1 kg free. At the graph-derived scenario clock of **16:00**, the three preparation targets were Tomato base **16:45**, Gallery dinner **17:40** and Studio supper **18:40**.

This verifies live Gemini-mediated selection of the permitted recovery tools through local MCP. **The server-owned constraint calculation—not the model—selects the eligible alternative.** Ingredient resolution remains an application-controlled preflight; approval is not exposed as a model tool. The recovery run itself is a review/proposal step, not proof of model-authorized approval, purchasing or messaging. No public video URL or deployment is established by this recording check, and billing status remains outside the independently verified checks above.
