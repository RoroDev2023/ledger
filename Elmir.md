# Elmir — agent handoff

Owns the workspace scaffold, shared contract, plan parser, fixtures, and evaluation (`packages/shared`, `packages/plan`, and `packages/eval`, E1–E5).

## 2026-11-21 11:50 ET · From Rahim: `uploadFile` is available for the Neon baseline

- `import { uploadFile, gemini } from '@ledger/gemini'` (branch `rahim/r1-files-upload`, stacked on PR #14). `await uploadFile('data/pairs/<id>/baseline.mp4', 'video/mp4')` returns `{ uri, mime_type }` once the file is ACTIVE and usable. Your `runBaseline` takes `{ uri, mime }`, so pass `{ uri: f.uri, mime: f.mime_type }`, and pass `gemini` as the `BaselineModel`.
- It handles videos over the 100 MB inline cap (Files API limit: 2 GB per file, 48 h lifetime). Re-running the eval within 47 h reuses the upload. `GEMINI_MODE=mock` returns a fake URI with no network. Uploads appear in `calls.jsonl` as `model: "files-api"`, `tag: "upload"` with 0 tokens, so `summarizeCalls` will show a `files-api` row. Filter it out if you only want model costs.
## 2026-11-21 12:20 ET · Alex's test plan read live; loadPlanImage fixes for #20

- **Live on Alex's own test plan** (`apps/api/test/plans/unit-4b.pdf`, 4-room L shape, drawn by Alex), via a local merge of main + #20 + #12 and his `check-plan` script: rooms 4/4 within 0.8% area, doors 4/4 and windows 4/4 within 9 cm, scale from labels, 15.4 s. Fixtures 0/5 (not used for pricing).
- **Fixed in #12 (asked by Alex):** `loadPlanImage` falls back to macOS `sips` when pdftoppm is missing; real MIME types and header-based sizes for WEBP and GIF (tests added). Alex's API can call `parsePlan` on the PDF directly once #12 is in.
- **#12 is needed before #20 works live:** without it every Argon call 400s on the tuple schema.
## 2026-11-21 11:56 ET · E5 proof slide generator (branch `elmir/e5-proof-slide`, stacked on #12)

- `pnpm eval` now also writes `eval/results.json`. `pnpm --filter @ledger/eval proof-slide` renders `eval/proof-slide.{html,png}` (1280x720) from it: false charges on clean re-shoots, dollars charged for moved objects, new damage found (+ precision, not-provable count), and the latest entry of `eval/failures.md` as "a failure we fixed".
- Colours follow whichever system actually did better on each metric (grey on a tie), never assumed. `--sample` renders a layout preview stamped "SAMPLE NUMBERS"; sample files are git-ignored.
- At freeze: `pnpm eval --split test && pnpm --filter @ledger/eval proof-slide` -> drop the PNG into the deck.
- #11 closed as superseded by #12 (same commits, rebased on the new main).

## 2026-11-21 11:47 ET · Integration test with R1: plan parsing works live through packages/gemini

- Local merge of main + Rahim's #14 (client) + #17 (uploadFile) + my #12: typecheck clean, **113 tests pass** across shared, plan, gemini, eval and api.
- **Bug found and fixed:** our `z.tuple` points made the Gemini API return HTTP 400 "Invalid JSON payload". Points are plain 2-number arrays now. With the fix, **plan-eval live through R1: rooms 7/7, doors+windows 13/13, dimension error 0.4-1.8%, ~8 s per plan** (`eval/plan-results.md`; 3 clean drawings, not a benchmark).
- **Rahim, important:** `BBoxSchema` (shared contract) is also a `z.tuple`; as a Carbon response schema it will 400 the same way. Suggest fixing it once in `toResponseSchema`: turn array-form `items` into an object `items` with min/maxItems. Contract stays unchanged.
- `plan-eval` and `baseline` now load `.env` themselves (`process.loadEnvFile`), and plan-eval writes to the repo-root `eval/`.

## 2026-11-21 11:35 ET · Demo/eval kit + baseline runner (branch `elmir/e4-kit`, includes #11)

- **`eval/kit/demo-table-kit.pdf`** (`pnpm --filter @ledger/eval kit [plan]`): page 1 the Unit 4B plan to put next to the shoebox; page 2 two judge cards listing every wall and floor with its surface ID (new mark / already there / object moved, plus "nothing changed"). Print a stack before filming test pairs.
- **`pnpm --filter @ledger/eval baseline <pairId> [plan]`**: uploads `data/pairs/<pairId>/{baseline,moveout}.mp4` via `@ledger/gemini`, runs the Neon baseline, writes `.data/eval/baseline/<pairId>.json`. **Rahim:** it needs `generate()` and `uploadFile(path, mime) -> { uri }` exported from `packages/gemini`; until then it prints that and exits.
- **Status:** R1 (`packages/gemini`) not on any branch at 11:34, so no repo code can call Gemini yet; plan-eval and baseline both wait on it.
- **Verified:** typecheck, lint, 34 tests; kit PDF rendered and checked by eye.

## 2026-11-21 11:33 ET · First LIVE Gemini calls (event key in git-ignored `.env`)

- Key works: Hydrogen 1.0 s, Neon (paid tier) 3.0 s, **Decisions API 0.5 s** with sensible answers. Billing is on.
- **Argon on our 3 listing-style plan images** (same prompt as parsePlan, JSON schema enforced): rooms 7/7, doors+windows 13/13, median dimension error 0.1-3.2%, 8-10 s per plan. Scored with the repo's `planFromArgon` + `scorePlan`. Without a response schema Argon once returned malformed JSON, so R1's schema enforcement matters.
- Two bugs found and fixed (see `eval/failures.md`): cropped PNG for wide plans (square canvas now), NaN scale when two labels disagree (longest label now).
- These live calls were exploration from a throwaway script outside the repo; repo code still calls Gemini only through `packages/gemini` (plan-eval waits for R1).

## 2026-11-21 11:21 ET · E3 plan images + plan accuracy (branch `elmir/e3-plan-images`)

- **PRs #7 and #9 are both in `main`** (Rahim merged #9 into the E2 branch, then #7 into main).
- **Listing-style plan images** `packages/shared/fixtures/plan-images/<name>.{svg,png}` drawn from each fixture by `pnpm --filter @ledger/plan plan-images` (`renderListingSvg`): thick walls, door swings, double-line windows, room names with sizes in feet, overall dimension lines, north arrow, no surface IDs. We drew them, so the exact answer is known and there is no rights issue. `demo-table.png` ("Unit 4B") is the printable plan for the demo table.
- **`scorePlan(parsed, truth)`** in `@ledger/eval`: rooms found, room names matched, doors/windows matched by relative position (scale-independent), median room-dimension error %.
- **`pnpm --filter @ledger/eval plan-eval`** parses every image with Argon via `@ledger/gemini` and writes `eval/plan-results.md`. Today it prints "no generate() yet (R1)" and exits; it runs as soon as R1 lands and a key is in `.env`.
- **Verified:** 33 tests, typecheck, lint; images checked by eye. **Not verified:** any live Argon call.
- **Next:** run plan-eval live when R1 + key exist; film dev pairs per `docs/eval-protocol.md`.
## 2026-11-21 11:39 ET · Decisions API before/after spike (synthetic) -> `docs/ideas/decisions-before-after-spike.md`

- Concrete new-damage wording separates scratch from clean re-shoot 6/6 at 0.5 (clean 0.13-0.18, scratch 0.56-0.87); the generic wording missed every scratch. "Same region?" confused two plain walls (0.83): every wall needs a distinct landmark, named in the question.
- **Rahim:** suggested wording for R4/R5 is in the doc. **Everyone:** set design must give each wall one landmark.
- Not verified on real footage yet (needs dev-01).

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
