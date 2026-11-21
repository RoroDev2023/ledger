# Alex — agent handoff

Owns the 3D viewer, API, and web app (`packages/viewer`, `apps/api`, and `apps/web`, A1–A5).

## 2026-11-21 10:54 ET · Hackathon rules added

- Added [docs/hackathon-guide.md](docs/hackathon-guide.md) to `main` in `bfd0b41`. It condenses the official rules, judging weights, schedule and submission checklist. If it disagrees with AGENTS.md, the guide wins. PR #3 was closed unmerged because the file went straight to `main`.
- Verified by pushing to `main` and confirming the commit there. No code changed.
- Requests for the team: the guide bans evaluations made up entirely of examples the team wrote to pass, so Elmir's test split needs pairs staged and labeled by people outside the team. Submission needs a 1-minute video, a public repo, and all three of us on the form by 17:00.
- Next step: A1 upload and job routes in `apps/api` toward the 13:00 mock end-to-end.

## 2026-11-21 10:47 ET · Kickoff context

- The [demo script](docs/demo-script.md) describes the judge's walkthrough from plan upload to the draft statement. At `main` commit `92dc57f`, the API, viewer, and web app were still planned deliverables.
- Next planned checkpoint is the 13:00 mock end-to-end demo. Start with A1's upload and job routes. Use Elmir's floor-plan fixture for the viewer and Rahim's mock pipeline output for the statement.
- Coordinate the fixture path with Elmir and the callable mock entry point with Rahim. Record the first working route and how to exercise it here.
