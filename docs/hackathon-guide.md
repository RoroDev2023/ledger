# Gemini 4 NYC Hackathon — official rules (condensed from the participant guide)

Source: Cerebral Valley participant guide, pasted Sat Nov 21 2026. If this file and AGENTS.md disagree, this file wins.

## Requirements for every project
- Build for **one** of the two problem statements (we're on **One: 5 Sigma**).
- Use **at least two Gemini 4 models** (Argon, Carbon, Neon, Hydrogen), **each with a clear job**.
- Must go beyond a text box: voice, camera, video, images, documents or generated media must be **central** to how it works.

### Problem Statement One: 5 Sigma (ours)
Pick a real task today's agents struggle with, build a Gemini 4 system that does it reliably, then **prove it**: an eval on inputs you didn't prepare for, compared against a simple baseline. Judges will ask:
- What's the baseline (single model call, existing tool, or how people do it today), and how much better are we?
- How was the test set built to reflect real use (messy inputs, edge cases, not the happy path)?
- Where does it still fail, and what did we change after seeing those failures?

### Problem Statement Two: Element 119 (not ours)
Media (video/audio/images/docs) as core input, Gemini 4 + Decisions API pushed to the limit; show where it breaks.

### Not allowed
Text-only chatbots · demos that only run on scripted inputs · **evaluations made up entirely of examples the team wrote to pass**.

### Bonus: Shopify (shop.dev)
Commerce experience from product discovery to shopping agent. Extra prize, open to everyone. Shopify SEs on-site and in Discord.

## Rules
- Repo **must be public**.
- Team of 1–4.
- Demo must only show features, code and functionality **built during the hackathon**; judges must be able to tell what was made at the event. Otherwise: **immediate disqualification**.
- New work only. No existing projects.
- Disqualified if it violates legal/ethical/platform policy or uses code, data or assets we don't have rights to.

### Banned project types
AI mental health advisor · basic RAG · **Streamlit apps** · **image analyzers** · AI-for-education chatbot · AI job screener · AI nutrition coach · personality analyzers · AI medical advice · **anything where a dashboard is the main feature** · sports analyzers/coaches.

## Schedule (Sat Nov 21, ET)
| Time | |
|---|---|
| 9:00 | Doors, breakfast |
| 10:00 | Kick-off |
| 10:30 | Hacking begins |
| 13:00 | Lunch |
| **17:00** | **Submissions due** |
| 17:00–18:45 | Round 1 judging |
| 18:00 | Dinner |
| 19:00–20:00 | Final round (top 6, on stage) |
| 20:15 | Winners |
| 22:00 | Doors close |

## Submission
Form: https://cerebralvalley.ai/e/gemini-4-nyc/hackathon/submit
- **1-minute demo video** showing only what we built today.
- Double-check: repo is public, demo link works, **all team members added** to the submission.

## Judging
**Round 1** (judging rooms): 3 min live demo + 2 min Q&A.
| Criterion | Weight | What they look for |
|---|---|---|
| Live demo | 35% | Works live on real, unrehearsed inputs. Not slides or Figma. |
| Proof it works | 25% | Evidence beyond the demo: test vs baseline, honest failure analysis, or a plan the agent checks its own output against. |
| Creativity | 20% | Tackles a problem others avoid; goes beyond text in a way that matters. |
| Gemini 4 + Decisions API use | 20% | ≥2 models with clear jobs plus the Decisions API; how far it pushes reasoning, speed or multimodality. |

**Round 2:** top 6 teams on stage, same format, **equal weighting** (25% each).

## Logistics
- Venue: The Malin Chelsea, 220 W 26th St, New York, NY 10001. Bring photo ID.
- Wi-Fi: `Hackathon` / `hackathon`
- Discord: https://discord.gg/PsCut7tdC (#announcements, #questions: ping @CV)
- Model changelogs: Argon 10-13-2026, Carbon 11-10-2026, Decisions API 11-11-2026, Hydrogen 11-12-2026, Neon 11-18-2026 (aistudio.google.com/docs/changelog)
