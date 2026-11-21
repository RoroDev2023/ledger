# Repo structure

Owners: **[R]** Rahim (RoroDev) · **[E]** Elmir · **[A]** Alex. Every stub file starts with `// [Owner] what goes here`.
Data flow: `web → lib/api.ts → api → pipeline / plan → gemini`. Everything imports types from `@ledger/shared`.

```
ledger/
├── AGENTS.md (CLAUDE.md → it) · Alex.md · Elmir.md · Rahim.md   plan + handoff logs
├── package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .env.example   [E]
├── .github/workflows/ci.yml                                        [E] typecheck + test + lint
├── docs/            proposal, decisions, demo script, hackathon guide, vendor refs, ideas/
├── eval/            results.md (pnpm eval) · failures.md (what broke, fix, did it help)
├── data/            (gitignored) pairs/<id>/{plan.png, baseline.mp4, moveout.mp4}, labels/
├── packages/
│   ├── shared/   [E] types.ts · schemas.ts (zod) · fixtures.ts · fixtures/plans/*.json
│   ├── gemini/   [R] generate · decide · keys · chunk · modes · cache · callLog · env · fixtures/ (mocks)
│   ├── plan/     [E] rasterize · parsePlan · scale · cleanup · surfaces · validate · repair · svg · build-fixtures
│   ├── pipeline/ [R] frames · landmarks · localize · hmm · findings · diff · price · progress · runPair · pricing.json
│   ├── eval/     [E] metrics · baseline · report · run · label.html
│   └── viewer/   [A] UnitModel · Walls · Floor · Pins · Minimap · geometry · colors
└── apps/
    ├── api/      [A] server · storage · queue · events · routes/{units,walkthroughs,jobs,results} · statement/{build,template}
    └── web/      [A] app/{page, demo, owner/new, units/[id]/{page,confirm,moveout,statement}} · components/ · lib/api.ts
```

Runtime output (gitignored): `.data/units/<unitId>/…`, `.data/cache/`, `.data/calls.jsonl`.

New packages have no third-party dependencies yet. Whoever adds one owns the `pnpm-lock.yaml` change (see AGENTS.md).
