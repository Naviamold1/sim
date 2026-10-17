# Politics Battle

A two-player, four-year campaign simulation. Describe a fictional politician, react to events with free-text campaign moves, and fight an election across a simplified UK map.

**AI interprets; the simulation decides.** Profiles, actions, events, and voter reactions are schema-validated. A seeded TypeScript simulation enforces budgets, exposes corruption, computes polls, and counts votes. Every model task has a deterministic fallback.

## Quick start

Requires Node.js **22.12+** and pnpm **10.34.7**. Enable pnpm with `corepack enable` if necessary.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000` in two browser tabs or on two devices on the same network. Create a room, share its code, and join as the second player. The host starts the campaign. The default demo timing caps character creation at 45 seconds and turns at 20 seconds; both submissions finish the phase early.

Without model credentials the game uses deterministic keyword interpretation and template events. This is a playable offline safety net, not a language model: keep prompts explicit (for example, “rally in London”, “promise lower taxes”, or “take a big bribe”).

## Live model mode

Run the model API on a machine with an installed, logged-in Codex CLI. The default model slug is `gpt-6-luna`, configurable with `CODEX_MODEL`. No credentials are shipped with this repository.

In one terminal:

```sh
export MODEL_API_TOKEN='your-own-private-token'
pnpm dev:model
```

In a second terminal, export the same token and enable the HTTP provider:

```sh
export MODEL_API_TOKEN='your-own-private-token'
export MODEL_API_URL='http://127.0.0.1:8787'
pnpm dev
```

Use `CODEX_BIN` when the executable is outside `PATH`. `.env.example` documents example values; shell exports are the portable way to configure both services. Do not put a model API token in a `NEXT_PUBLIC_*` variable. The browser never calls the model API directly.

Measure actual model latency before presenting:

```sh
MODEL_API_TOKEN='your-own-private-token' pnpm --filter @pb/model-api measure 5
```

Use `pnpm smoke -- --http-model` only when both services' model environment variables are configured; inspect the reported model/fallback counts, not just whether the election completes.

The model API has its own concurrency pool, bounded queue, process deadline, and schema validation. See `apps/model-api/README.md` for its complete configuration. The UI remains playable if calls fail or time out, but a fallback is not evidence that the live model met the demo latency requirement.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Next.js + Socket.IO game server, fallback unless configured |
| `pnpm dev:model` | Codex-backed HTTP model service on port 8787 |
| `pnpm dev:all` | Both services, using exported environment variables |
| `pnpm typecheck` | Strict TypeScript across every package |
| `pnpm test` | Simulation, scenario, AI, model API, and room tests |
| `pnpm build` | Production Next.js build |
| `pnpm start` | Production custom server, after building |
| `pnpm smoke` | Two Socket.IO bots complete a full campaign |
| `pnpm rehearse` | Search unmodified seeds for a year-3 corruption exposure; reports whether the vote is close |

## Architecture

- `packages/scenarios`: Zod scenario schema, registry, UK map, electorate archetypes, event templates, and tuning. These are fictional game inputs, not election forecasts or measured demographic opinions.
- `packages/sim`: pure seeded simulation, action-point and funds budgets, exposure rolls, bounded event/reaction application, poll sampling, regional/proportional tallies, and contribution ledger.
- `packages/ai`: scenario-specific structured outputs, HTTP provider, retries/deadlines, deterministic fallbacks, and validated replay outputs.
- `apps/model-api`: Hono service spawning isolated, read-only `codex exec` processes and validating their outputs.
- `apps/web`: authoritative in-memory rooms, private reconnect tokens, Socket.IO protocol, replay records, and a responsive Next.js election desk.

The sim performs an opening year resolution before the first turn. The four end-of-year turns feed the next resolution; the last is a campaign finale followed immediately by the election, not a fifth playable year. Poll movement is measured in percentage points and distinguishes game effects from sampling noise.

## Demo and deployment

See `docs/demo.md` for a presentation script and replay/rehearsal guidance. Scenarios define voter counts and electoral systems; the lobby does not offer arbitrary country sizes or solo opponents.

Run the web custom server on a persistent Node host, not a serverless function. Rooms live in memory and disappear on restart; durable recordings are a replay safety net, not resumable live-room storage. Mount a persistent, private replay directory if deploying. Use HTTPS, protect the model API with a firewall and token, and restrict Socket.IO origins before exposing the demo to untrusted traffic. Room codes are invitations; reconnect tokens are private credentials.

Web environment: `PORT` (3000), `HOST` (`0.0.0.0`), `REPLAY_DIR` (working-directory-relative `.politics-battle/replays`), and `ALLOWED_ORIGINS` (comma-separated exact origins; same-origin by default). Because pnpm runs the web package in `apps/web`, its default replay directory is `apps/web/.politics-battle/replays`. `SERVER_ONLY=1` skips Next.js for socket-only checks.

`implementation.md` is the v1 design; `spec.md` contains broader ideas deliberately excluded from v1.
