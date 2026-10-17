# Demo rehearsal

## Before presenting

1. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm smoke`.
2. Measure live model latency. Focus-group calls must complete in roughly ten seconds; failures that use a fallback do not count as a successful latency measurement.
3. Play a live two-browser game. Keep both player windows visible, check mobile width, and test a refresh/reconnect.
4. Rehearse with a fixed room seed. Choose a naturally occurring exposure and close race; never force an exposure or a winner in production code.
5. Keep the completed game's replay ID and record a screen-capture backup. Recordings include private campaign material: store them privately.

## Five-minute running order

| Time | Present |
| --- | --- |
| 0:00–0:30 | Explain “AI interprets; the simulation decides.” Create a demo room and join. |
| 0:30–1:15 | Paste the two candidate descriptions; compare profiles. |
| 1:15–3:35 | Play four turns. Highlight events, voter quotes, and the sampled poll. |
| 3:35–4:05 | Watch regional election results and turnout. |
| 4:05–4:50 | Explain poll-movement contributions, corruption risk, and deterministic replay. |

Timers are caps, so presenters should submit together rather than wait for expiry.

## Scripted candidate descriptions

### Player A

> I am Alex Morgan, a working-class nurse and trade-union organiser. My fictional party is the Common Ground Alliance. I want investment in public services, more affordable housing, higher taxes on the wealthy, and a greener economy. I speak plainly, hold local town halls, and admit trade-offs rather than promising miracles.

### Player B

> I am Sam Blake, a lawyer and small-business campaigner. My fictional party is the Renewal Party. I want lower taxes, less bureaucracy, controlled immigration, and practical support for businesses. I campaign on competence, economic growth, and honest government, with a confident television style.

## Scripted turns

These work best with a real model. Fallback mode recognises keywords but intentionally has much less nuance. Adapt region/issue names to the scenario if adding another country.

| Year | Player A | Player B |
| --- | --- | --- |
| 1 | Promise affordable housing and investment in public services. Rally in London. | Promise lower taxes and campaign on television. |
| 2 | Campaign on social media for a greener economy. | Take a big bribe from a developer to boost campaign funds. |
| 3 | Rally in Scotland and promise better public services. | Rally in the North West and defend my economic record. |
| 4 | Make a final statement for honest government and affordable housing. | Run a final television campaign for lower taxes and business growth. |

Big corruption has a higher exposure risk, but an individual seeded campaign may not expose it before the election. Rehearse first, or explain that no exposure is a legitimate outcome. AI can narrate an exposure only after the simulation rolls it.

## Replay safety net

`pnpm rehearse` searches up to 100 seeds using the fallback interpreter and the scripted strategies. It reports whether the popular vote is within 45–55%; it does not change the simulation to guarantee a close race. In the October 17, 2026 fallback rehearsal, `rehearsal-18` produced a year-3 exposure but a roughly 61–39 popular-vote split, so it is suitable for checking exposure, **not** a close-race presentation. Live-model outputs may produce different results; record and validate a full live game separately.

The completed game identifies its recording with a game ID. Supply `?replay=<gameId>` when creating a new room, then join with the other player and start it. Keep the replay directory on the same server or restore it privately from backup. Replay reuses the recorded seed, prompts, and validated AI outputs and must not contact the model service.

Replay is for recorded games; it cannot recover a live room lost after a process restart. Confirm the complete replay works before going on stage. If the server or network itself is unavailable, use the screen recording instead.
