# Plan parsing: live Gemini 4 Argon on the test plans

Plans and ground truth come from `apps/api/scripts/make-test-plan.py`. Each run is graded by
`pnpm --filter @ledger/api check-plan apps/api/test/plans/<plan>.pdf` (room count, each room's area within 5%,
total area, door and window counts and widths, and every door/window within 30 cm of its true position).
All runs on 2026-11-21 with `GEMINI_CACHE=0` (fresh Argon calls).

| Plan | What it tests | Prompt: trace the **inside** of walls (2 runs) | Prompt: trace the wall **center line** (1 run) |
|---|---|---|---|
| unit-4b | 4 rooms, L-shaped unit | 6/10, 6/11 checks · small rooms 14–17% too small | **11/11** · openings within 7 cm |
| studio-ft | feet-and-inch labels | 6/9, 6/10 · small rooms ~10% too small | **10/10** · within 3 cm |
| two-bed-hall | 6 rooms, hallway, 6 doors | 12/12, 13/13 | **13/13** · within 4 cm |
| l-living | non-rectangular L room | 9/9, 6/10 · rooms 5–9% too small | **10/10** · within 2 cm |
| scan-2b | crooked, noisy, blurred scan | 11/12, 12/13 · hall 13% too big | 6/13 · rooms ~6% too big, hall 17.5% |

**Fix kept:** the dimension labels (the scale) measure wall center lines, so rooms traced along the inside of the
walls lost half a wall on every side, worst for small rooms. Asking for center lines fixed every clean plan.

**Still fails:** the scanned plan. Its scale is right (within 0.7% of the clean plan), but on blurred thick walls Argon
traces slightly outside the center line, rooms come out ~6% large and their corners don't meet exactly. The
1.2 m hall is worst because a few centimeters of tracing is a large share of its width. Door and window positions
stay within 16 cm on the scan in every run.

**Also seen:** the same PDF can parse differently between runs (unit-4b: 100% in one earlier run, 14–17% off on
small rooms in the next two), so each plan needs more than one run to judge.

## Our own videos: conference room (video/IMG_0022 move-in, IMG_0023 move-out; not committed)

Ground truth from the frames: a yellow mark on the concrete column is in **both** videos (pre-existing); the only
new thing at move-out is a **sheet of paper stuck on the wall light** by the door.

| Comparison | What happened | Result |
|---|---|---|
| Per-wall findings + diff (R4/R5), plan without wall landmarks | frames 1.5–31.5 s all placed on the west wall; findings looked at the wrong frames | **missed the paper**, $0 |
| Same, with wall landmarks from the plan | south (door) wall got 0 frames; the paper isn't in the damage checklist | **missed the paper**, column mark as "not visible" |
| **Spot check** (`apps/api/src/spotCheck.ts`): screen every move-out frame, match the move-in frame by picture, two-view rule | paper flagged at 32–34.5 s, 2/2 pairs say new (0.89, 0.89); column mark 2/2 pairs say unchanged (0.10, 0.14) | **paper: new, $85; column mark: pre-existing, $0** in 41 s |

What changed after the failures: frames are no longer filed by wall before looking for damage; the move-out is
screened frame by frame and each suspect spot is matched to the move-in by picture. The wall label is only used to
name the line (it called the light's wall "east"; check against the room).
