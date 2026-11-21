# LEDGER

**An agent that won't charge what it can't prove.** LEDGER compares an apartment's move-in and move-out walkthrough videos and writes a draft itemized deposit statement. Every charge is backed by before/after frames of the same spot.

Built at the Gemini 4 NYC Hackathon (Cerebral Valley x Google DeepMind), Nov 21 2026. Problem Statement One, "5 Sigma".

## How it works

1. **Plan.** The owner uploads a 2D floor plan. Gemini 4 Argon reads rooms, doors, windows and dimension labels. Plain code builds the walls, scale, areas and a 3D model, so no wall is invented by a model.
2. **Pin every frame to the plan.** Both walkthroughs are cut into sharp keyframes. The Decisions API (`gemini-decision-1`) decides which room and wall each frame shows. We never compare video to video, because both passes share the same plan.
3. **Check each surface.** The Decisions API runs a damage checklist per wall with calibrated probabilities. Gemini 4 Carbon takes a second look only at uncertain cases.
4. **Prove it or don't charge.** For each surface, before/after frame pairs must first pass "same region?". A charge needs **at least 2 agreeing pairs**. Otherwise the surface is *not provable* and costs $0. A moved chair costs $0.
5. **Statement.** Code computes amounts from a fixed price table. The statement shows the before/after frames per line and the due date (move-out + 14 days, NY GOL 7-108). It is a draft for review, not legal advice.

| Model | Job |
|---|---|
| Gemini 4 Argon | Read the floor plan |
| Decisions API | Room and wall per frame, damage checklist, same-region and changed checks |
| Gemini 4 Carbon | Second look on uncertain calls, plan repair |
| Gemini 4 Hydrogen | Landmarks and objects per keyframe |
| Gemini 4 Neon | The evaluation baseline (one call, plan + both videos) |

## Proof

`eval/results.md`: LEDGER vs one Neon call that also gets the plan, on test pairs where **people outside the team staged the changes** and wrote the ground truth first. Headline numbers: false charges on clean re-shoots, and charges for moved objects. Protocol: [`docs/eval-protocol.md`](docs/eval-protocol.md). Failures and fixes: [`eval/failures.md`](eval/failures.md).

## Run it

```bash
pnpm install
cp .env.example .env              # add GEMINI_API_KEY; GEMINI_MODE=mock runs without API calls
pnpm -r typecheck && pnpm -r test
pnpm dev                          # api + web
pnpm --filter @ledger/pipeline run:pair <plan> <baseline.mp4> <moveout.mp4>
pnpm eval                         # writes eval/results.md
```

## Repo

| Path | What | Owner |
|---|---|---|
| `packages/shared` | The contract: TypeScript types + zod schemas, plan fixtures | Elmir |
| `packages/plan` | Plan parsing (Argon), geometry, surface IDs, `plan.svg` | Elmir |
| `packages/eval` | Labelling page, Neon baseline, metrics, `eval/results.md` | Elmir |
| `packages/gemini` | The only place that calls Gemini: client, Decisions wrapper, mock/record/replay, call log | Rahim |
| `packages/pipeline` | Frames, localization, findings, diff, pricing | Rahim |
| `packages/viewer`, `apps/api`, `apps/web` | 3D viewer, API, web app and demo screen | Alex |

## Built during the event

Everything in this repository was written on Nov 21 2026 during the hackathon. The commit history is the record. No code was copied from earlier projects. The floor-plan fixtures in `packages/shared/fixtures/plans/` are hand-made shapes, not parsed listings.

## Limits

- Small test set (about 12 change pairs and 6 clean re-shoots), so we report raw counts.
- Tested on a tabletop model apartment with marks about 1 cm or larger. Real apartments, glare and very small marks are not yet measured.
- Repair prices are placeholders in one config file.
- Not legal advice. The statement is a draft for the owner and tenant to review.
