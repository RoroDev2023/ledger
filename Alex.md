# Alex — agent handoff

Owns the 3D viewer, API, and web app (`packages/viewer`, `apps/api`, and `apps/web`, A1–A5).

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
