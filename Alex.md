# Alex — agent handoff

Owns the 3D viewer, API, and web app (`packages/viewer`, `apps/api`, and `apps/web`, A1–A5).

## 2026-11-21 13:05 ET · Live Argon works on the test PDF (2 fixes in review)

- `.env` now holds the event key (record mode). Rahim's smoke: all 5 models answer live (3.7–6.6 s).
- **PR #23 (Rahim's package):** live plan parsing always failed with `HTTP 400 Invalid JSON payload` because `z.tuple` became draft-07 `items: [a, b]`. `toResponseSchema` now rewrites it. With it, Argon parsed `unit-4b.pdf` in 11.6 s: 4 rooms within 0.3–0.8%, 4/4 doors, 4/4 windows within 1 cm, scale from labels.
- **PR #24 (Elmir's package, stacked on #23):** Argon returned "KITCHEΝ" with a Greek capital Nu, so the room id became `kitche`. `cleanName()` maps Greek/Cyrillic look-alikes to Latin and sentence-cases ALL-CAPS labels before ids are built. The live answer is recorded in `.data/recordings`, so the re-run used the same reading. Also fixed my truth file (no fixtures are drawn; Argon correctly found none).
- Result: `pnpm --filter @ledger/api check-plan apps/api/test/plans/unit-4b.pdf` → all checks pass, unit `unit-4b-argon` viewable in 3D.
- Next step: `/demo` page (A4).

## 2026-11-21 12:45 ET · Real plan parsing wired in, checked on a drawn PDF

- Branch `alex/plan-pdf-check` (viewer branch + main). `apps/api/test/plans/unit-4b.{pdf,png,truth.json}`: a listing-style 4-room L-shaped plan (46.5 m², 4 doors, 4 windows, dimension labels, north arrow) drawn by `apps/api/scripts/make-test-plan.py`, with the true geometry and a perfect Argon reading on the 0-1000 grid.
- `apps/api/src/planParser.ts`: PDF -> PNG (pdftoppm, or macOS `sips` when poppler is missing) -> Elmir's `parsePlan` with Rahim's `gemini` client. `PLAN_PARSER=argon` makes `POST /units` use it. API server and scripts now load `<repo>/.env`.
- `pnpm --filter @ledger/api check-plan <pdf> [--truth]` parses and grades against `*.truth.json`, then saves the unit so `/units/<id>` shows it in 3D. With `--truth` (no key): 4/4 rooms within 0.3%, 4/4 doors, 4/4 windows, scale from labels. **Live Argon not run yet: no GEMINI_API_KEY on this machine.**
- Viewer bugs found on this real plan and fixed: (1) camera aimed at (0,0,0) when OrbitControls mounted after the effect, so plans not starting at the origin were off-center and top-down was blank; target now passed at creation, 3/3 fresh runs correct. (2) drei `<Html>` drops the first overlay it creates (first room label always missing); an empty first `<Html>` takes the hit, verified by screenshot.
- For Elmir: `loadPlanImage` uses pdftoppm only (absent on our Macs) and maps `.webp` to `image/jpeg`.
- Next step: live Argon run on unit-4b.pdf once we have a key, then `/demo`.

## 2026-11-21 12:20 ET · Viewer tested on tricky plans

- Branch `alex/a2-viewer`. Added `packages/viewer/src/samples.ts`: 11 synthetic plans (every verdict, 6 pins on one wall, L shape, angled bay, building rotated 30°, coordinates at 120/80 m, 1 × 1.2 m closet, 18 × 11 m loft with 6 windows, doors at wall ends and overlapping openings, clean unit, unknown surface ids). 77 viewer tests now. `/lab?case=<id>&view=top&select=<surfaceId>` renders any of them. The unit page also takes `?view=top&select=<surfaceId>`.
- Screenshotted every case with headless Chrome and fixed what looked wrong: inward walls now use a point-in-polygon probe (the centroid method can point the wrong way in concave rooms); pins spread by wall length with alternating height; text tags only on charged, selected or hovered pins, plus a color legend; the camera frame is at least 3.5 m so it stays outside small rooms; top-down is a near-orthographic plan view with low walls.
- Not done: a production `next build` (dev only so far). The red "Issues" badge in dev is drei `<Html>` double-mounting under React strict mode.
- Next step: `/demo` page (A4).

## 2026-11-21 12:00 ET · A2 3D viewer (WIP on `alex/a2-viewer`)

- `packages/viewer`: `geometry.ts` (plan -> wall boxes split around doors/windows, floors, pin anchors, cutaway test) with 21 tests across all fixtures; `colors.ts` (verdict -> pin color/label, "Not provable" overrides the verdict); `<UnitModel plan items selected onSelect view />` in React Three Fiber with an architect's cutaway (walls between camera and room drop to stubs), pins with cost tags, click to select, and a 3D / top-down toggle.
- `apps/web` is now a real Next.js 16 app (`pnpm --filter @ledger/web dev`, port 3000, webpack mode because the workspace packages use `.js` import paths). `/units/<id>` shows the 3D map next to the evidence panel (verdict, reason, cost, before/after frames with the damage box). Before move-out it shows the move-in record.
- API: `GET /units/:id/frames/:frameId` serves real frames from `walkthroughs/<wid>/frames/` or a labeled placeholder SVG.
- Repo: `.next/` gitignored and excluded from eslint; `agentRules: false` stops `next dev` from writing an AGENTS.md into apps/web.
- Verified: viewer 21 + API 49 tests, repo typecheck and lint; headless-Chrome screenshot of `/units/demo-3d` shows walls, door/window gaps, cutaway and all 4 pins.
- For Rahim: write keyframes to `walkthroughs/<wid>/frames/<frameId>.jpg` with frame ids starting `<wid>-` and the panel shows them with no other change.
- Next step: `/demo` page (A4) using `<UnitModel>`, SSE progress and the Decisions panel.

## 2026-11-21 11:55 ET · A1 merged (PR #10)

- Merged `alex/a1-api` into `main` after CI passed. Includes the API, 48 API tests, the hand-test script and the browser test page at `http://localhost:3001/` (`pnpm --filter @ledger/api dev`).
- Fixed a flaky CI test: two simultaneous uploads have no guaranteed arrival order. Tests now check that uploads sent one after another run in that order, and that four simultaneous uploads never run at the same time.
- Next step: A2 viewer + A4 `/demo` page for the 13:00 mock end-to-end.

## 2026-11-21 11:40 ET · API tests + hand-test script

- Branch `alex/a1-api` (PR #10). Added `apps/api/test/scenarios.test.ts` (46 API tests in total): 3 floor plans, upload validation, re-filmed baseline, tenant addendum, serial job order, SSE replay, pipeline crashes, Decisions totals and the statement charging rules. Mutation-checked: 9 deliberate breaks, all caught except a redundant cent-rounding step.
- **Fixes found by the tests:** the API now validates pipeline findings and diffs against the shared contract *before* saving them (it used to save bad data, e.g. severity 9). Statement lines are rounded to cents so they always add up to the total. The Decisions counter keeps growing across a job.
- `pnpm --filter @ledger/api try` runs every scenario against a running API and prints a ✓/✗ report. In mock mode a plan file named after a fixture (`studio-l.png`, `one-bed-railroad.pdf`) loads that plan.
- For Rahim: `PipelineAdapter.parsePlan` takes an optional `originalName` (mock only, safe to ignore). Bad pipeline output now fails the job with `pipeline returned invalid findings: 0.severity ...`.
- Next step: A2 viewer + A4 `/demo` page.

## 2026-11-21 11:20 ET · A1 API server with mock pipeline

- Branch `alex/a1-api`. `apps/api` is a working Hono server: `pnpm --filter @ledger/api dev` (PORT 3001, data in `<repo>/.data`).
  - `POST /units` (multipart `plan`, optional `unitId`) -> `{ unit, plan }` · `GET /units/:id` · `GET|PATCH /units/:id/plan` (ceilingHeightM, roomNames)
  - `POST /units/:id/walkthroughs` (multipart `video`, `kind`, optional `capturedAt`) -> `{ jobId, walkthroughId }`. A move-out upload also runs the diff and writes the statement.
  - `GET /jobs/:id/events` SSE: `progress {stage, done, total}`, `decisions {calls, questions, lastLatencyMs, avgLatencyMs}`, `done`, `error`. Past events replay on reconnect.
  - `GET /units/:id/findings?kind=baseline|move-out` · `/diff` · `/statement` · `/statement.html`
- **Pipeline adapter** (`apps/api/src/pipeline.ts`): `PipelineAdapter { parsePlan, runWalkthrough, runDiff }` with `onProgress` / `onDecisions` hooks. `mockPipeline()` is the default: plan from a fixture (`MOCK_PLAN`, default `demo-table`), deterministic findings and a diff with one charged stain, one pre-existing scuff, one not-provable hole and a moved chair.
- **Statement** (`statement/build.ts`): charges only `new-damage` that isn't "Not provable:" and has cost > 0. Everything else is listed at $0. Totals are summed in cents. `dueBy` comes from `statementDueBy`.
- Verified: 5 vitest tests (full mock flow over SSE, bad ids, PATCH, charging rules), a curl smoke test against the live server, repo-wide typecheck and lint.
- **Requests:** Rahim, please export `runWalkthrough` / `runDiff` matching `PipelineAdapter` (or tell me your signatures) and call the hooks per stage and per Decisions call. Elmir, I'll wire `parsePlan` + `renderPlanSvg` once PR #7 merges.
- Next step: A2 viewer + A4 `/demo` page on the mock API for the 13:00 checkpoint.

## 2026-11-21 11:12 ET · Team review adopted

- Applied Elmir's review to `AGENTS.md` and `docs/demo-script.md` on `main` (`59f6dfe`): the 2-pair proof rule (otherwise not provable, $0), the same-region check with a 2×2 split, Decisions question counts and latency in `calls.jsonl`, a premade or real listing plan instead of the judge's sketch, the judge's card shown next to the verdicts, an outsider-staged test set (~12 change pairs + 6 clean re-shoots), and the scope cuts. Logged in `docs/decisions.md` on this branch.
- **New for my lane:** a Decisions panel on `/demo` (questions asked, response times) fed from SSE, a slot for the judge's card photo on the compare step, and not-provable pins showing $0 and the reason. Cut: phone capture page, tenant confirm page, PDF.
- Request for Rahim: add `questions` to each `calls.jsonl` row and emit not provable as `not-visible` with a reason starting "Not provable:" until we agree on a contract change.
- Next step: A1 in `apps/api`.

## 2026-11-21 11:15 ET · Full repo skeleton

- Branch `alex/project-structure`, stacked on Elmir's `elmir/e1-scaffold-contract` (PR #4). Adds stub packages `gemini`, `pipeline`, `viewer`, `apps/api` and `apps/web`, the missing `plan`/`eval` files, `eval/results.md`, `eval/failures.md` and [docs/structure.md](docs/structure.md). Each stub starts with `// [Owner] purpose`, so the owners fill in the code.
- Verified: `pnpm install`, `pnpm -r typecheck` (8 packages), `pnpm -r test`, `pnpm lint` all pass. The lockfile change only adds workspace links, no third-party packages.
- Requests: Rahim and Elmir, the stubs in your folders are placeholders, so rename or delete freely. Merge PR #4 first, then this one.
- Next step: A1 in `apps/api` (Hono, upload routes, job queue, SSE) against `demo-table.json`, using a stub pipeline until Rahim's mock lands.

## 2026-11-21 10:54 ET · Hackathon rules added

- Added [docs/hackathon-guide.md](docs/hackathon-guide.md) to `main` in `bfd0b41`. It condenses the official rules, judging weights, schedule and submission checklist. If it disagrees with AGENTS.md, the guide wins. PR #3 was closed unmerged because the file went straight to `main`.
- Verified by pushing to `main` and confirming the commit there. No code changed.
- Requests for the team: the guide bans evaluations made up entirely of examples the team wrote to pass, so Elmir's test split needs pairs staged and labeled by people outside the team. Submission needs a 1-minute video, a public repo, and all three of us on the form by 17:00.
- Next step: A1 upload and job routes in `apps/api` toward the 13:00 mock end-to-end.

## 2026-11-21 10:47 ET · Kickoff context

- The [demo script](docs/demo-script.md) describes the judge's walkthrough from plan upload to the draft statement. At `main` commit `92dc57f`, the API, viewer, and web app were still planned deliverables.
- Next planned checkpoint is the 13:00 mock end-to-end demo. Start with A1's upload and job routes. Use Elmir's floor-plan fixture for the viewer and Rahim's mock pipeline output for the statement.
- Coordinate the fixture path with Elmir and the callable mock entry point with Rahim. Record the first working route and how to exercise it here.
