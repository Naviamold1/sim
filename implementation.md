# Politics Battle: implementation plan (v1, hackathon demo)

Refines `spec.md` into a small, buildable demo. Anything in the spec not listed here (AI opponents, incumbent government, multiple terms, 4-player rooms) is deferred.

## v1 scope
- 2 players, head to head, over plain sockets
- no incumbent government, no AI opponents
- one 4-year cycle ending in an election that decides the winner
- every player action is a free-text prompt interpreted by AI
- scenario framework + 1 scenario
- model: Luna 6, served through our own model API that wraps Codex CLI
- whole session under 10 minutes

## Game flow
1. **Home**: create a room (get a code) or join with code + nickname.
2. **Lobby**: host picks a scenario (+ country size if we keep it). Second player joins. Host starts.
3. **Start prompt**, one long prompt per player, ~2 min: who you are (class, background), party/ideology, platform, style, anything else. AI turns it into a candidate profile. Both players see each other's public profile.
4. **Year loop**, x4:
   - **Year sim**: events happen, the electorate reacts (see pipeline below).
   - **End-of-year screen**: recap, map, poll, focus-group quotes, "why the poll moved" breakdown.
   - **Turn, 45s**: each player writes a prompt (campaign moves, promises, statements, media, rallies, attacks, even corruption). A player who sends nothing does nothing that year.
   - **Resolve**: prompts are interpreted and applied, feeding the next year.
5. **Election** after the year-4 turn: full tally, region-by-region reveal, turnout. Winner screen + 4-year summary, including any corruption exposed.

Timing: ~2 min start + 4 x (45s turn + ~20s resolve/recap) + election ≈ 7 min.

```
lobby -> startPrompt -> [yearSim -> yearRecap -> turn -> resolving] x4 -> election -> end
```

## Demo mode (5-minute presentation)
A `timing` preset in room config. Normal play keeps the timings above, demo uses:

| Segment | Time |
|---|---|
| Intro: pitch + show the two candidates being created | 0:30 |
| Start prompts (pre-written, pasted), profiles appear | 0:45 |
| 4 years x (20s turn + ~15s resolve/recap) | 2:20 |
| Election reveal | 0:30 |
| Wrap: "why the poll moved" view, how the sim works | 0:45 |
| **Total** | **~4:50** |

What makes it fit:
- **Turn ends when both players submit.** The timer is a cap (20s demo, 45s normal), not a wait.
- **Speculative work during the turn.** The director call only needs world state, so it runs while players type. Each `interpretTurn` starts the moment that player submits. After the second submit, only the focus group call is on the critical path.
- **Recap is readable before the poll lands.** Events + action summaries show first, the poll and quotes fill in when the focus group returns.
- **Scripted prompts.** Both presenters paste rehearsed prompts, including one big corruption case so the exposure lands mid-demo.
- **Rehearsed seed.** Use a room seed found in rehearsal where the exposure fires in year 3 and the race stays close until the reveal. No rigging in code, just a chosen seed.
- **Replay mode as a safety net.** Rooms log every AI output. `replay=<gameId>` re-runs a recorded game with zero model calls, so a slow Codex or dead wifi doesn't kill the demo. A screen recording is the last fallback.
- **Layout.** Two browser windows side by side on one screen, or one presenter laptop + a phone as player 2.

Hard requirement: one focus group call must return in ≤ ~10s. Measure Codex + Luna 6 latency first (milestone 2). If it's too slow: cut personas to 6-8, shorten prompts, or merge the focus group into the director call for demo mode.

## How the simulation works

### Core rule: AI interprets, the simulation decides
The AI never writes game state. Every AI call returns a small structured object, validated with zod, whose values are enums and bounded numbers. The simulation turns those into state changes with fixed formulas, caps and a seeded RNG. So:
- a player can't prompt-inject "I get 100% of the vote". The interpreter can only emit known action kinds with bounded intensity, and the sim enforces budgets.
- the numbers are explainable. Every change is tagged with its source (event, action, focus group), which powers the "why the poll moved" view.
- a game can be replayed: seed + logged AI outputs = the same result.

### State
**Candidate** (one per player)
- `positions[issue]` in -1..1, where they stand
- `trust` 0..1, `charisma` 0..1, `credibility` 0..1 (drops on flip-flops and broken promises)
- `visibility[region]` 0..1, how known they are in each region
- `funds`, spent on media and rallies
- `history`: past actions and promises, `corruptionCases`: `{ size, yearTaken, exposed }`

**Segment** (from the scenario, region x class x age, e.g. "Manchester, working class, 18-34")
- `share` of the population
- `positions[issue]` and `salience[issue]` (weights summing to 1, what they care about)
- `engagement` 0..1, the likelihood of voting at all
- `affinity[candidate]` -1..1, accumulated gut feeling, mostly moved by the focus group

**Voters**: `countrySize` numeric voters split across segments by share. Each voter = segment values + small seeded Gaussian noise. Voters are plain numbers, no LLM. More voters = smoother maps and closer seat counts, never more AI cost.

**World**: year, active events, global issue salience modifiers (an economic crash raises economy salience everywhere).

### Voting model
For voter `i` and candidate `c`:

```
distance(i,c) = Σ_k salience_ik * |position_ik - position_ck|
U(i,c)        = -α*distance + β*trust_c*credibility_c + γ*affinity_seg(c) + δ*visibility_c[region]
```

- turnout: `P(vote) = sigmoid(a*engagement_i + b*max_c U(i,c) - t)`. Voters who dislike both candidates or don't care stay home.
- choice: `P(c | votes) = softmax(U(i,·) / τ)`
- **poll**: sample ~1000 voters, add ±2-3% noise. Shown each year.
- **election**: every voter draws once with the room seed, then the scenario's electoral system tallies (`fptp-regions`: winner per region gets that region's seats; `proportional`: national vote share).

α, β, γ, δ, τ live in a single tuning config, overridable per scenario.

### Per-year pipeline
```
prompts ─▶ interpretTurn (AI) ─▶ applyActions (sim)
                                      │
           corruption rolls (sim) ◀───┤
                                      ▼
            director (AI) ─▶ applyEvents (sim)
                                      │
                                      ▼
          focusGroup (AI) ─▶ applyReactions (sim)
                                      │
                                      ▼
                 recompute voters ─▶ poll ─▶ recap
```

**0. Start (once).** `buildProfile(startPrompt, scenario)` returns initial positions per issue, charisma, a trust baseline, a background tag (worker, billionaire, lawyer...), strengths and weaknesses. The sim clamps it and gives both players equal starting funds and visibility, so a self-description can't buy an advantage. Background tags apply small scenario-defined modifiers (e.g. billionaire: +funds, -trust with working-class segments).

**1. Interpret turns (AI, 2 calls in parallel).** Input: the player's prompt, their candidate state and history, the opponent's public profile, the scenario's region/segment/issue ids. Output, schema built from the scenario so ids are enums:
```ts
{ actions: Array<{
    kind: "statement" | "promise" | "reform" | "media" | "rally" | "attack" | "corruption"
    issue?: IssueId
    stance?: number            // -1..1
    target?: RegionId | SegmentId | "national"
    channel?: "tv" | "social"
    intensity: 1 | 2 | 3
    corruptionSize?: "small" | "medium" | "big"
  }>
  flipFlop: boolean            // contradicts earlier positions
  summary: string              // one line shown in the recap
}
```
Vague prompts become low intensity. Contradictory or impossible ones get flagged.

**2. Apply actions (sim).** Each turn has 5 action points (sum of intensity). Extra actions are dropped, unaffordable ones are scaled down.
- `statement` / `promise` / `reform`: moves `positions[issue]` toward `stance` by `0.1 * intensity` and raises that issue's salience in targeted segments. Promises are stored. `flipFlop` costs credibility.
- `media`: TV = broad visibility gain, expensive. Social = targeted, cheap, stronger with young segments.
- `rally`: visibility + engagement in one region.
- `attack`: opponent trust down, small own-trust cost (voters dislike negativity).
- `corruption`: immediate funds/visibility boost scaled by size, and a case is stored.

**3. Corruption rolls (sim, seeded).** Every open case rolls exposure each year: small 10%, medium 25%, big 45% (scenario-tunable), +5% per year since taken. Exposure is decided by the sim, not the AI, so it's fair and reproducible. An exposed case is handed to the director to narrate and hits trust by size.

**4. Director (AI, 1 call).** Input: year, world state, the scenario's event pool and era flavor, any exposures to narrate, both candidates' recent actions. Output: 1-2 events, each either
- a **template event** from the scenario pool by id + severity 1-3 + target regions, applied with the template's predefined issue impacts, or
- a **custom event** with its own impact vector, every component capped at ±0.15.

Each event has a headline + 1-2 sentence description. The sim applies impacts: salience shifts, segment position shifts, engagement changes (a disaster raises engagement in affected regions). Rare events (pandemic) are weighted in the template pool and the director can't exceed the scenario's rarity limits.

**5. Focus group (AI, 1 batched call).** The sim picks 8-16 personas: the most populous segments plus coverage of every region and class. Each persona is the segment rendered as a person ("34, warehouse worker in Leeds, rent up 20%, cares about cost of living and immigration"). Input: personas, this year's events, both candidates' actions in plain language, current leanings. Output per persona:
```ts
{ segmentId, affinityDelta: { [candidate]: number },  // -0.2..0.2
  engagementDelta: number,                            // -0.1..0.1
  salienceShift?: { issue, delta },                   // up to ±0.1
  quote: string }
```
This is the layer the formulas can't capture: tone, authenticity, how a scandal or a well-handled crisis lands. Deltas apply fully to the persona's segment and at 30% to segments sharing its class in other regions (spillover). Segments without a persona drift slowly toward their neighbours.

**6. Recompute, poll, recap.** Voters are regenerated from updated segments, a poll runs, and the recap combines event headlines, action summaries, quotes and the per-source breakdown.

**Election year.** The year-4 turn resolves through steps 1-5, then the full election runs instead of a poll. `electionNarration` (AI) writes the results story.

### Fallbacks
If any AI call fails validation twice or times out, a deterministic fallback runs: keyword-based action parsing, a weighted random template event, a skipped focus group (no affinity change). The game never stalls on the model.

## Scenario framework
A scenario is one typed module in `packages/scenarios/<id>/`, validated by a zod `ScenarioSchema`:
- **meta**: id, name, era, country, blurb
- **map**: regions with SVG paths (simplified real geography), population share, seats, urban/rural mix
- **segments**: region x class x age with baseline positions, salience, engagement
- **issues**: axes used (subset or extension of the default set)
- **electoral system**: `fptp-regions` | `proportional`
- **event pool**: templates (id, weight, rarity, issue impacts, target filter) + director prompt flavor
- **backgrounds**: modifiers per candidate background tag
- **starting state**: economy, mood, headlines for the opening recap
- **tuning** (optional): voting model constants, corruption risks, starting funds

Registry: `packages/scenarios/index.ts` exports `scenarios` as a `const` record, so scenario ids are inferred as a union type. AI output schemas are built from the scenario (region/segment/issue enums), so types follow the data. Adding a scenario = add a folder + one registry line. A test validates every scenario.

**v1 scenario**: one real country with real regions and fictional archetypal parties. Country TBD.

## Model API (`apps/model-api`)
Our own small HTTP service that serves Luna 6 by driving Codex CLI. The game server only talks HTTP to it, so swapping Codex for a hosted API later changes nothing in the game.

```
POST /v1/generate
Authorization: Bearer <MODEL_API_TOKEN>
{ task: string, system: string, prompt: string, schema: JSONSchema, timeoutMs?: number }
-> 200 { output: unknown, latencyMs: number }
-> 422 output failed schema | 504 timeout | 503 queue full

GET /health
```

Per request:
1. Create an empty temp dir and write `schema.json`.
2. Spawn `codex exec -m luna-6 --output-schema schema.json --sandbox read-only --skip-git-repo-check -o out.json` with the prompt on stdin, cwd = temp dir. Verify exact flags against the installed Codex version.
3. Read and parse `out.json`, validate against the schema, return it. Delete the temp dir.

Operational:
- concurrency pool (default 4 parallel `codex` processes, env-configurable) + bounded queue
- per-request timeout kills the process
- logs task, latency, failures. No prompt logging by default.
- Hono on Node, deployed on a machine where `codex` is installed and logged in

Game side: `packages/ai` has `AiProvider { run<T>(task, prompt, schema: ZodType<T>): Promise<T> }`. `HttpModelProvider` converts zod -> JSON Schema (`z.toJSONSchema`), calls `/v1/generate`, re-validates with zod. `FallbackProvider` exists for tests and outages.

Per year that's ~4 calls (2 interpret, 1 director, 1 focus group), the two interpret calls run in parallel. Latency per Codex call decides the resolve time. Measure early.

## Architecture
pnpm workspace:
- `packages/sim`: state types, voting model, pipeline steps, tally. Pure, no IO.
- `packages/scenarios`: schema, registry, scenarios.
- `packages/ai`: provider interface, HTTP provider, prompts, output schemas, fallbacks.
- `apps/model-api`: Codex-backed model service.
- `apps/web`: Next.js custom server + socket.io. In-memory `rooms: Map<code, GameRoom>`. `GameRoom` holds authoritative state and runs the phase machine on timers. Server emits full state per phase. Client: Tailwind + ShadCN + Zustand fed by the socket.

Deploy: `apps/web` on one VM / Railway (Vercel can't hold sockets). `apps/model-api` on the machine with Codex, same box is fine.

## UI
Main screen: map in the center, poll below, events + focus-group quotes on the side, 45s prompt box with a countdown. Plus the start prompt screen and the election reveal.

Before building real components: 2-3 static mocks, published for review, pick one. True black background, white text, dense, no card chrome, no continuously repainting animations (countdown is a number that ticks once per second).

## Milestones
1. Workspace scaffold.
2. `apps/model-api` + one real call. Measure Luna 6 latency via Codex (decides resolve timing).
3. `sim` + `scenarios` (schema, registry, v1 scenario) + vitest.
4. `ai` (prompts, schemas, HTTP provider, fallbacks).
5. `GameRoom` + socket server.
6. UI mocks -> pick -> implement.
7. Demo mode: timing preset, early turn end, speculative director call, replay mode.
8. Rehearse: pick the seed, finalize scripted prompts, record a backup video, time a full run.

## Verification
- `pnpm test`: scenario schema validity, tally per electoral system, seeded determinism, action budget enforcement, corruption risk grows with case size and time.
- Model API: schema-valid response, timeout kills the process, queue rejects when full.
- Script: 2 socket.io bot clients play a full game with `FallbackProvider`, then with the model API. Assert the election resolves and the session is under 10 min.
- Manual: two browser tabs, full game. One player commits a big corruption case and it gets exposed at some point.

## Open questions
- Does `codex exec -m luna-6` work with your Codex login, or is Luna 6 reached another way?
- Solo mode: if only 1 human joins, does AI play the second candidate, or require 2 humans?
- Which real country for the v1 scenario?
- Keep a country-size choice, or let the scenario fix the voter count?
- Do players see each other's turn prompts after resolve, or only the effects?
