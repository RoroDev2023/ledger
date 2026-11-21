# Three-minute live demo

Set out the table setup, a card for the plan, a phone, a movable chair, and two removable marks to stand in for a scratch and a stain. Open `/demo`. Before presenting, fill the proof slide from `eval/results.md` and choose one documented fix from `eval/failures.md`.

| Time | On stage | What to say |
|---|---|---|
| 0:00–0:25 | Hand the judge the card. Ask them to sketch the table setup from above, marking the walls and one landmark. Photograph the sketch and upload it. | “At move-out, a tenant can ask a simple question. Can you show me this spot on the day I moved in? Your sketch gives us a place to look.” |
| 0:25–0:50 | Point out a wall on the parsed plan and its counterpart in 3D. Film the baseline with a slow pan. Upload it and show the move-in findings as they arrive. | “This is the record the tenant can review at move-in. A mark visible here already has a date and a surface.” |
| 0:50–1:10 | Turn away. Ask the judge to secretly place the scratch and stain wherever they choose and move the chair. Keep their choices out of the camera feed until the next walkthrough. | “Keep the locations to yourself. In a moment you can check exactly what the system caught.” |
| 1:10–1:35 | Start from another corner. Film the move-out walkthrough from a new angle and upload it. Show live progress. | “Frame ten on this pass might show a different wall from frame ten on the first pass. We use the plan and its landmarks to find views of the same surface.” |
| 1:35–2:25 | Open the 3D pins. Select a reported change, show its labeled before/after frames, and ask the judge to reveal the placements. Check all three against the output, including any miss. Open the draft statement and trace one line from evidence to verdict and charge. | “You can inspect the frames behind this verdict. A moved chair carries zero charge. For a deduction, the statement shows the repair calculation, total and review deadline.” |
| 2:25–3:00 | Show the held-out proof slide. Read the actual correct, false and missed damage counts and F1 for the pipeline and the one-call Neon baseline. Show the failure frame, the fix and its observed effect. | “Both systems saw the same pairs and used the same scorer. Here’s one frame that gave us trouble, what we changed on the dev split, and what still goes wrong.” |

If venue Wi-Fi fails and the team uses replay, announce the switch and identify the recorded pair before showing its results.

## Five likely judge questions

1. **Why build a floor plan if Neon can take both videos?** The plan gives both passes stable surface IDs. We test the value of that extra work against one Neon call with the plan and both full videos. The proof slide shows the measured difference.
2. **What if the chair hides the scratch?** We check visibility in both walkthroughs. If either lacks sufficient evidence for that surface, the verdict is `not-visible` and the statement carries no deduction for it.
3. **Who decides what a repair costs?** Code applies a configured flat fee or a per-area rate, with depreciation where applicable. The demo rates are placeholders. The owner reviews the calculation and supporting frames before using the draft.
4. **Can the tenant challenge the move-in record?** The planned sign-off flow lets the tenant review the owner's findings and add a walkthrough. Its findings become part of the evidence at move-out.
5. **How do you know the system generalizes beyond this table?** We tune thresholds on dev pairs, then score held-out, independently labeled changes once. We report counts alongside percentages so judges can see the sample size and inspect the failures.
