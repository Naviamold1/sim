# AI boundary

`createGameAi` preserves the five task methods consumed by the web server. Outputs are validated against scenario-bound schemas before reaching the simulation. The simulation remains responsible for all state changes and outcomes.

- Defaults: two attempts, 4000ms per attempt, 8000ms total per task. `totalTimeoutMs` is optional; the hard maximum is 10000ms and attempts are capped at three. Providers receive an optional `AiRequest.signal`; the wrapper also enforces deadlines for providers that ignore cancellation.
- `createHttpModelProvider({ url, token })` calls `POST /v1/generate`, sends the JSON schema and remaining attempt timeout, and revalidates the response. An optional `fetch` override supports transport tests. Errors never include tokens, prompts or response bodies.
- Every task has a deterministic fallback. Profile/turn parsing uses conservative keywords; director selection is keyed by game seed and year; focus groups return zero deltas; election narration reports only the supplied tally. Fallbacks never mutate game state.
- `onRecord` receives a detached, validated output with key, task, source and latency. Store these records **server-side**: turn outputs include private corruption actions. A failing recorder cannot block a turn.
- `replay` accepts a map keyed by call key, containing either raw outputs (the existing contract) or full `AiCallRecord` values. Records must match key/task and have valid metadata; all outputs are revalidated against the current scenario/call schema. Missing/invalid entries use local deterministic fallbacks, never the live provider. Replayed successes have source `replay`; local recovery has source `fallback`.
- Public prompts project only public actions/events and explicitly exposed cases, never full state, private funds or hidden case descriptions. Covert turns use mechanically generated public summaries and descriptions rather than copying the model's possibly leaky text. Only owner-private action descriptions retain covert details.

Validation: `pnpm --filter @pb/ai typecheck` and `pnpm --filter @pb/ai test`.
