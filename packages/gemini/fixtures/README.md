# Mock fixtures (`GEMINI_MODE=mock`)

Mock mode never calls the network and is deterministic: the same request always gets the same answer.

- `generate/<tag>.json`: the JSON value `generate()` returns for that tag (validated by the caller's schema).
  Tag prefixes are tried too, so `generate/plan.json` serves `plan.parse` and `plan.repair.1`.
  With no fixture, a value is synthesized from the zod schema.
- `decide/<tag>.json`: `{ "rules": [{ "match": "<regex on instructions>", "noul": 0.9 } | { "match": "...", "choice": "kitchen" } | { "match": "...", "level": 2 }] }`.
  The first matching rule wins. Unmatched questions get probabilities derived from a hash of the request.

Point another package's tests at its own folder with `GEMINI_FIXTURES_DIR`.
