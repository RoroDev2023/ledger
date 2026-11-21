# Elmir — agent handoff

Owns the workspace scaffold, shared contract, plan parser, fixtures, and evaluation (`packages/shared`, `packages/plan`, and `packages/eval`, E1–E5).

## 2026-11-21 11:21 ET · E3 plan images + plan accuracy (branch `elmir/e3-plan-images`)

- **PRs #7 and #9 are both in `main`** (Rahim merged #9 into the E2 branch, then #7 into main).
- **Listing-style plan images** `packages/shared/fixtures/plan-images/<name>.{svg,png}` drawn from each fixture by `pnpm --filter @ledger/plan plan-images` (`renderListingSvg`): thick walls, door swings, double-line windows, room names with sizes in feet, overall dimension lines, north arrow, no surface IDs. We drew them, so the exact answer is known and there is no rights issue. `demo-table.png` ("Unit 4B") is the printable plan for the demo table.
- **`scorePlan(parsed, truth)`** in `@ledger/eval`: rooms found, room names matched, doors/windows matched by relative position (scale-independent), median room-dimension error %.
- **`pnpm --filter @ledger/eval plan-eval`** parses every image with Argon via `@ledger/gemini` and writes `eval/plan-results.md`. Today it prints "no generate() yet (R1)" and exits; it runs as soon as R1 lands and a key is in `.env`.
- **Verified:** 33 tests, typecheck, lint; images checked by eye. **Not verified:** any live Argon call.
- **Next:** run plan-eval live when R1 + key exist; film dev pairs per `docs/eval-protocol.md`.

## 2026-11-21 11:11 ET · E4 eval + protocol + README (branch `elmir/e4-eval`, stacked on PR #7)

- **Matches the team-review changes on main (59f6dfe):** headline numbers are false charges on clean re-shoots and charges for moved objects; "not provable" = `not-visible` with reason starting "Not provable:" until the contract gets its own verdict.
- **`runBaseline(plan, {moveIn, moveOut}, model)`**: ONE Neon call with the plan's surface IDs and both video URIs (Files API upload is the caller's job), zod-validated, drops surfaces not in the plan. Needs R1 `generate` with `{type:'video', uri, mime_type}` parts.
- **`pnpm eval [--split test|dev]`**: reads `data/labels/*.json`, ours from `.data/units/<pairId>/diff.json`, baseline from `.data/eval/baseline/<pairId>.json`, cost/latency/question counts from `.data/calls.jsonl`; writes `eval/results.md` (headline table, P/R/F1 with raw counts, verdict confusion per system, cost table).
- **Rahim:** please write `diff.json` per pair at `.data/units/<pairId>/diff.json` (pairId = unitId for eval runs), and add `questions` to each calls.jsonl line as AGENTS.md now says.
- **`docs/eval-protocol.md`**: set rules, dev 4 / test 12 change + 6 clean, outsiders write the card before any output, freeze 14:30, file layout.
- **README.md**: pitch, pipeline, model jobs, proof, run, owners, "Built during the event", limits.
- **Verified:** 31 tests, typecheck, lint, `pnpm eval` runs with no labels. **Not verified:** live Neon call (no key).

## 2026-11-21 11:01 ET · E2 plan parsing (branch `elmir/e2-plan-parse`, stacked on E1)

- **`parsePlan(path, model, {unitId, ceilingHeightM?, knownMetersPerPixel?})`** in `@ledger/plan`: PDF -> PNG (pdftoppm, 200 dpi), Argon reads rooms / openings / dimension labels / fixtures on a **0-1000 grid** (Gemini's native pointing convention), code converts to pixels with the real image size, merges shared corners (5 px), snaps walls within ±3° to the axis, sets scale from the median label (drops >15% outliers; falls back to a known measurement, then an assumption with a warning), flips y so north is up, builds walls/IDs/areas, validates. On failure: up to 2 Carbon repair rounds with the errors; anything unresolved goes into `warnings`.
- **Needs from Rahim:** a `PlanModel` with `generate({model, parts, schema, tag})` returning a zod-validated object (exactly R1's `generate<T>`). `parts` are `{type:'text'}` / `{type:'image', data(base64), mime_type}`. Model IDs come from `MODEL_PLAN` / `MODEL_DEEP`.
- **`renderPlanSvg(plan)`**: top-down, north up, every wall labelled with `data-surface-id`, doors orange, windows blue. Fixture SVGs committed next to each JSON in `packages/shared/fixtures/plans/` (Alex: use for the minimap).
- **Verified:** 24 tests pass (incl. mocked Argon, the 2-round repair loop, outlier labels, header-based image size), typecheck and lint clean. **Not verified:** a live Argon call (no event key yet).
- **Next:** live Argon test on a real listing plan as soon as the key works; E4 labelling page (Codex is building `packages/eval/label.html`).

## 2026-11-21 10:58 ET · E1 scaffold + contract (branch `elmir/e1-scaffold-contract`)

- **Ready to use:** pnpm workspace (`packages/*`, `apps/*`), `tsconfig.base.json` (strict, NodeNext), vitest, eslint, GitHub Actions CI (typecheck + test + lint), `.env.example` with every `MODEL_*` var.
- **Contract:** `@ledger/shared` exports every type from AGENTS.md plus a matching zod schema (`FloorPlanSchema`, `FindingSchema`, `DiffItemSchema`, ...). A compile-time check fails the build if a schema drifts from its interface. Extras: `BBoxSchema` enforces `[ymin, xmin, ymax, xmax]` in [0,1], `scoreToSeverity()` (score 0-4 -> 1-5), `statementDueBy()` (+14 days), `loadPlanFixture(name)` / `listPlanFixtures()`.
- **Fixtures (start of E3):** `packages/shared/fixtures/plans/{demo-table,studio-l,one-bed-railroad}.json`, generated by `pnpm --filter @ledger/plan fixtures` from `packages/plan/src/build-fixtures.ts`. Hand-made shapes, NOT parsed from listings (each has a warning saying so). Surface IDs look like `living-room.wall-n`, `bedroom.floor`.
- **Plan geometry (start of E2):** `@ledger/plan` `buildPlan()` / `wallsFromRooms()` / `attachOpenings()`: room polygons -> walls with stable compass IDs, neighbors, areas minus openings. Argon parsing not started.
- **Eval (start of E4):** `@ledger/eval` `changeCounts`, `score`, `wronglyChargedUsd`, `PairLabel` label format.
- **Verified:** `pnpm -r typecheck`, `pnpm -r test` (15 tests), `pnpm lint` all pass locally.
- **For Rahim:** please review the contract PR; `Localization.surfaceId` accepts any non-empty string (incl. `'none'`).
- **For Alex:** `loadPlanFixture('demo-table')` gives you a 2-room plan with 4 openings for the viewer.
- **Next:** E2 Argon `parsePlan` + `plan.svg`, E3 the 3 listing-plan images, E4 label page + baseline.

## 2026-11-21 10:47 ET · Kickoff context

- At `main` commit `92dc57f`, [AGENTS.md](AGENTS.md#the-contract-packagessharedsrctypests) held the proposed types. The workspace scaffold and shared package were still planned deliverables.
- Next planned checkpoint is E1 by 11:15. Publish the shared TypeScript and Zod contract and link the PR here for Rahim's review. The noon plan fixture gives both Rahim and Alex a common set of surface IDs.
- For E4, the agreed comparison is one Neon call with the plan and both full videos. Confirm the organizer's ruling on pre-event test data before including any such pairs in the held-out split.
