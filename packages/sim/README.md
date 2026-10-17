# Simulation integration

`@pb/sim` is synchronous, deterministic TypeScript with no IO. The existing public exports and AI payload shapes are preserved. Candidate sides are always `a` and `b`; ids come from the parsed scenario. All shares, turnout, trust and visibility are fractions, not percentages. Breakdown deltas are **percentage points**.

## Resolution lifecycle

1. `createGame(scenario, seed, { a: { nickname, profile }, b: { nickname, profile } })` returns year **0**. Profiles are bounded again by the simulation; missing positions become neutral. Starting funds and visibility are fixed, except for scenario-authored background modifiers.
2. Call `beginYear(state, scenario, { turns: { a: null, b: null }, director })` for the opening year. It returns `{ state, pending }`; this intermediate state's `year` remains **0**.
3. Select personas from that returned state with `selectPersonas(state, scenario)`, ask the focus group, and call `finishYear(state, scenario, pending, focusGroup)`. It returns `{ state, recap }`, now at year **1**, with one poll and recap. Empty reactions are a valid deterministic simulation fallback.
4. Collect the year-1 turn and repeat `beginYear`/`finishYear`. A missing submission is `null`, not an invented action. The year-N turn is stored with history year **N** and applied in resolution **N + 1**.
5. After finishing year **4**, collect the fourth/final turn and resolve once more. The resulting state is year **5** (`YEARS + 1`), with `pending.final` / `recap.final` true. This is a campaign finale, **not a fifth player turn**. No yearly income is awarded in the finale.
6. Call `runElection(state, scenario)` after the finale. It returns the complete result without mutating state. There are four player turns, five polls/recaps, and one election. The room owns phase/timer enforcement and must not begin or finish the same pending resolution twice.

Both pipeline functions clone their incoming state. Keep the intermediate state and its matching pending object together. `finishYear` rejects mismatched years; `beginYear` rejects turns during the opening resolution and attempts to resolve past the finale. Scenario identities must match.

## Speculation and corruption

`rollCorruption(state, scenario)` can run during the turn to brief a speculative director. Its draws depend only on the seed, current turn year and case id, not call order. It returns exposure descriptions but does not mutate cases.

`beginYear` applies actions **before** rolling corruption on its working copy. Existing cases reproduce the speculative rolls. Newly taken cases, including corruption in the final turn, face an immediate base-risk roll. Older cases add `corruptionRiskPerYear * (state.year - yearTaken)` to their size's base risk. Already exposed cases never roll again.

New exposures that were absent from the speculative director prompt receive default simulation narration. Narration cannot invent an exposure or change the mechanical hit; unknown case ids are ignored. Exposure marks the actual case and reduces trust/credibility exactly once. Final-turn corruption is not risk-free.

## Bounds and attribution

- A turn has five points by default. Intensities clamp to 1–3, a remaining partial budget scales the last affordable action, and subsequent actions are dropped. Paid actions also scale to whole affordable points. Funds never become negative.
- Unknown action kinds, issue/target/channel/size ids and non-finite intensities are dropped. Policy stances, profile stats, custom event vectors and reaction deltas are bounded again independently of AI schema validation.
- Custom events apply each issue's aggregate delta at most ±0.15, even with repeated issue entries or severity 3. Template severity multiplies scenario-authored impacts; target filters and `maxPerGame` are enforced. At most two director event slots are processed per resolution. Empty custom region lists mean national; entirely unknown targets are rejected.
- Focus group reactions are accepted once per selected persona, with bounded deltas and scenario-configured same-class, other-region spillover. Salience is nonnegative and normalized after each shift. Unselected segments drift toward sampled neighbours.
- Every mechanical mutation is captured by the contribution ledger. Non-noise entries telescope to the change in representative-segment expected vote share. Including the noise entry, the full breakdown telescopes to the displayed poll movement from the previous poll (or initial expected share for year 1).

## Election and polling

`runPoll` is a seeded sample with bounded noise. `expectedShare` is candidate a's noiseless representative-segment share, useful for attribution; the actual electorate adds fixed seeded per-voter position/engagement noise. Election turnout and choice each receive one independent draw per voter. Polls, personas, corruption and election use separate seeded streams, so speculative/repeated reads do not consume election randomness.

`fptp-regions` awards every region's seats to its vote winner. `proportional` allocates the total national seats by largest remainder of national votes, then reconciles the regional reveal allocations to those national totals while preserving each region's seat count. Consequently proportional regional seats are not independent local proportional tallies. Seat ties use national votes, then a deterministic seeded tie-break. Zero-turnout results remain finite with national shares 0.5/0.5 and the same tie rules.

## Client redaction

**GameState and PendingYear are authoritative server objects, not public socket payloads.** Before emitting a player view, redact the opponent's unexposed corruption cases, secret applied actions, dropped covert actions, private funds/history details and secret contribution labels/deltas. Do not broadcast raw interpretation summaries or descriptions without the AI/web privacy policy. `AppliedAction.secret` and `Contribution.secret` mark covert effects; exposure events are public. Replays may retain full server records but must not expose them to the opposing client mid-game.

## Verification

From the workspace root:

```sh
pnpm exec vitest run packages/sim packages/scenarios
pnpm --filter @pb/sim --filter @pb/scenarios typecheck
```
