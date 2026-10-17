# Politics Battle

A 2-player politics simulation for a hackathon demo. Each player describes a politician in one long start prompt, then plays one 4-year cycle: at the end of each year they get a timed turn to write a free-text prompt (promises, campaigns, attacks, even corruption). AI interprets the prompts, a numeric electorate reacts, and an election after year 4 decides the winner.

- `spec.md`: the original vision (broader than v1)
- `implementation.md`: the v1 plan. Game flow, how the simulation and AI interact, scenario framework, model API, demo mode, milestones. **Read it before making changes.**

## Status
Planning stage. Only docs exist so far. The structure below is the target.

## Structure (planned)
pnpm workspace:
- `packages/sim`: state types, voting model, per-year pipeline, election tally. Pure TS, no IO.
- `packages/scenarios`: `ScenarioSchema` (zod), registry, one folder per scenario (map, segments, event pool, tuning).
- `packages/ai`: `AiProvider` interface, HTTP provider for the model API, prompts, zod output schemas, deterministic fallbacks.
- `apps/model-api`: Hono service serving Luna 6 by running `codex exec` under the hood.
- `apps/web`: Next.js custom server + socket.io. In-memory `GameRoom`s run the phase machine. Client: Tailwind, ShadCN, Zustand.

## Core rules
- **AI interprets, the simulation decides.** AI calls return validated, bounded structured output. Only `packages/sim` changes game state, using formulas and a seeded RNG. Never let model output write state directly.
- Every AI call must have a deterministic fallback so a turn never stalls.
- Scenarios are data. Adding one = a new folder + one registry line. AI output schemas are built from scenario ids.
- Keep it simple, type-safe, no `any`. Infer types from zod schemas.
- A full game must fit the demo timing in `implementation.md`.
