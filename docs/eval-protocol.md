# Eval protocol: how we film and label test pairs

Goal: an honest number on inputs we did not prepare. The headline numbers are **false charges on clean re-shoots** and **charges for moved objects** (should be $0), then new-damage precision / recall / F1. Ours and the one-call Neon baseline are scored the same way.

## The set
- The cardboard apartment (plan: `packages/shared/fixtures/plans/demo-table.json`). Plain matte walls, one landmark per wall (window, outlet, poster) matching `Surface.landmarks`.
- One fixed lamp, phone exposure locked (long-press to lock AE/AF on iPhone).
- Marks about 1 cm or larger: dry-erase marker scratch, coffee-coloured sticker stain, a removable "hole" sticker. One movable chair.

## What we film
| Set | Count | Who changes things | Use |
|---|---|---|---|
| dev | ~4 pairs | team | tune thresholds (RoroDev) |
| test, change pairs | ~12 | **people outside the team** | the reported number |
| test, clean re-shoots | ~6 | nobody (nothing changes, new angle) | false-alarm number |

Freeze the test set at **14:30** and run it **once**. Never tune on test.

## One pair, step by step (about 3 minutes)
1. Reset the set: no marks except any deliberate pre-existing ones (write those on the card too).
2. **Move-in video:** slow pan, about 5 s per wall, start from the entry door.
3. Turn away. The outsider:
   - makes 0-2 marks wherever they like and may move the chair;
   - writes on a card, **before anyone sees any output**: pair id, each mark (wall + type), what moved (from wall -> to wall), or "nothing changed".
4. **Move-out video** from a different corner and a different path.
5. Photograph the card. Save files as `data/pairs/<pairId>/{plan.png, baseline.mp4, moveout.mp4, card.jpg}` (git-ignored; shared drive).
6. Enter the card into `packages/eval/label.html` -> download `data/labels/<pairId>.json` (commit the JSON, never the videos).

Pair ids: `dev-01`..., `test-01`..., `clean-01`... Clean re-shoots get `cleanReshoot: true` and empty changes.

## Running it
```
pnpm --filter @ledger/pipeline run:pair <plan> <baseline.mp4> <moveout.mp4>   # ours -> .data/units/<pairId>/diff.json
# baseline -> .data/eval/baseline/<pairId>.json (runBaseline in @ledger/eval)
pnpm eval --split test                                                       # -> eval/results.md
```

## Honesty rules
- Report raw counts next to percentages (n is small).
- Count every test pair, including the ones that fail or time out.
- Log each failure and fix in `eval/failures.md` (dev only).
