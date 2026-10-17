"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getScenario, scenarioIds, scenarios, type Scenario } from "@pb/scenarios";
import type { Side } from "@pb/sim";
import { createRoomSchema, joinRoomSchema, type PublicCandidate, type RoomState } from "../shared/protocol";
import { useGameStore } from "../lib/game-store";
import { formatTime, remainingSeconds, useServerClock } from "../lib/use-clock";
import { Button } from "./ui/button";

const sides: Side[] = ["a", "b"];
const phaseLabels = { lobby: "Assembly", startPrompt: "Meet the candidates", yearSim: "Year in motion", yearRecap: "The year in review", turn: "Your next move", resolving: "Decisions have consequences", election: "Election night", end: "The country has decided" };
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const number = (value: number) => new Intl.NumberFormat("en-GB").format(value);

export function ElectionDesk() {
  const store = useGameStore();
  const now = useServerClock();
  useEffect(() => { store.initialize(); }, [store.initialize]);
  const room = store.room;
  const seconds = room ? remainingSeconds(room.deadline, now) : null;
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Politics Battle home">POLITICS<span>BATTLE<span className="brand-dot">.</span></span></a>
        <div className="masthead-edition"><span className="eyebrow">The election desk</span><span>Two candidates. One country.</span></div>
        <div className="connection" role="status"><span className={`status-dot ${store.connection}`} />{store.connection === "connected" ? "Live connection" : store.connection === "connecting" ? "Connecting" : "Reconnecting"}{room && <span className="room-code">{room.code}</span>}</div>
      </header>
      {store.error && <div className="error-banner" role="alert"><span>{store.error}</span><Button variant="ghost" onClick={store.clearError} aria-label="Dismiss error">×</Button></div>}
      {store.connection === "offline" && room && <div className="offline-banner" role="status">Connection interrupted. Your seat is saved; the server clock keeps running. We’ll reconnect automatically.</div>}
      <main id="main">
        {room?.error && <div className="error-banner" role="alert"><div><strong>The campaign could not finish.</strong><p>{room.error.message}</p><p>Your connection is intact. You can start a fresh contest below.</p></div><Button variant="outline" onClick={store.leave}>Return home →</Button></div>}
        {!room ? <Home /> : <>
          <div className="edition-line"><span>{getScenario(room.scenarioId).meta.country} / {room.timing === "demo" ? "Demo edition" : "Full campaign"}{room.replay ? " / Recorded replay" : ""}</span><span>Room {room.code} · You are candidate {room.self.toUpperCase()}</span></div>
          <div className="page-heading"><div><span className="eyebrow">{room.phase === "lobby" ? "Before the campaign" : room.phase === "startPrompt" ? "The opening statement" : room.phase === "election" || room.phase === "end" ? "The final count" : `Campaign year ${Math.min(room.year, 4)} / 4`}</span><h1>{phaseLabels[room.phase]}</h1></div>{seconds !== null && <div className={`clock ${seconds <= 10 ? "urgent" : ""}`} role="timer" aria-label={`${seconds} seconds remaining`}><span className="eyebrow">{room.phase === "election" ? "Results incoming" : "Phase closes in"}</span><strong>{formatTime(seconds)}</strong></div>}</div>
          <PhaseRail room={room} />
          {room.phase === "lobby" ? <Lobby room={room} /> : room.phase === "startPrompt" ? <StartPrompt room={room} seconds={seconds} /> : <Campaign room={room} now={now} seconds={seconds} />}
        </>}
        {room?.phase === "end" && room.election && !room.error && !room.replay && <section className="replay-record"><span className="eyebrow">Campaign recording</span><p>Replay ID <code>{room.gameId}</code></p><p className="muted">Recorded prompts and AI outputs replay without model calls. A second player still joins the room.</p><Button variant="outline" onClick={() => { store.leave(); window.history.replaceState(null, "", `/?replay=${room.gameId}`); }}>Replay this campaign ↗</Button></section>}
      </main>
      <footer className="site-footer"><span>POLITICS BATTLE / A living electorate</span><span>AI interprets. The simulation decides.</span></footer>
    </div>
  );
}

function Home() {
  const { createRoom, joinRoom, pending, connection } = useGameStore();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [timing, setTiming] = useState<"demo" | "normal">("demo");
  const [scenarioId, setScenarioId] = useState<string>(scenarioIds[0] ?? "uk");
  const [seed, setSeed] = useState("");
  const [replay, setReplay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setSeed(query.get("seed") ?? "");
    setReplay(query.get("replay") ?? "");
    if (query.get("seed") || query.get("replay")) setAdvanced(true);
    const invite = query.get("room");
    if (invite) { setCode(invite.toUpperCase()); setMode("join"); }
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (mode === "create") {
      const result = createRoomSchema.safeParse({ nickname, scenarioId, timing, ...(seed.trim() ? { seed: seed.trim() } : {}), ...(replay.trim() ? { replay: replay.trim() } : {}) });
      if (!result.success) { setError(result.error.issues[0]?.message ?? "Check your room details."); return; }
      createRoom(result.data);
    } else {
      const result = joinRoomSchema.safeParse({ code, nickname });
      if (!result.success) { setError("Enter a nickname and a six-character room code (A–Z, 2–9)."); return; }
      joinRoom(result.data);
    }
  }
  const scenario = getScenario(scenarioIds.find((id) => id === scenarioId) ?? scenarioIds[0]!);
  return <>
    <div className="edition-line"><span>A two-player political simulation</span><span>Four years. Every choice counts.</span></div>
    <section className="home-grid">
      <div className="home-intro"><span className="eyebrow"><span className="coral-text">01</span> / The race starts here</span><h1>Power is<br />a moving<br /><em>target.</em></h1><p className="home-deck">Build a candidate. Make your promises.<br />Find out what the country really thinks.</p><div className="home-facts"><div><strong>02</strong><span>rival candidates</span></div><div><strong>04</strong><span>years to persuade</span></div><div><strong>01</strong><span>decisive election</span></div></div></div>
      <div className="home-map"><div className="section-heading"><span className="eyebrow">The battleground</span><span>{scenario.meta.country}</span></div><GeographicMap scenario={scenario} /><div className="map-caption">Different regions. Different priorities.<br />No voter is a guaranteed vote.</div></div>
      <section className="entry-panel" aria-label="Enter the campaign"><div className="entry-tabs" role="group" aria-label="Room action"><button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Create a room <span>↗</span></button><button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Join a room <span>↗</span></button></div><form onSubmit={submit}>
        <label htmlFor="nickname">Your nickname</label><input id="nickname" autoComplete="nickname" placeholder="How should we call you?" maxLength={32} required value={nickname} onChange={(event) => setNickname(event.target.value)} />
        {mode === "join" ? <><label htmlFor="room-code">Room code</label><input id="room-code" className="code-input" autoCapitalize="characters" autoComplete="off" placeholder="ABC234" maxLength={6} minLength={6} required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></> : <>
          <label htmlFor="scenario">The battleground</label><select id="scenario" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{scenarioIds.map((id) => <option key={id} value={id}>{scenarios[id].meta.name}</option>)}</select>
          <fieldset className="timing-choice"><legend>Campaign pace</legend><label className={timing === "demo" ? "selected" : ""}><input type="radio" name="timing" value="demo" checked={timing === "demo"} onChange={() => setTiming("demo")} /><span><strong>Demo</strong><small>20-second turns / ~5 min</small></span></label><label className={timing === "normal" ? "selected" : ""}><input type="radio" name="timing" value="normal" checked={timing === "normal"} onChange={() => setTiming("normal")} /><span><strong>Normal</strong><small>45-second turns / ~7 min</small></span></label></fieldset>
          <button type="button" className="text-button advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Rehearsal & replay <span>{advanced ? "−" : "+"}</span></button>{advanced && <div className="advanced-fields"><label htmlFor="seed">Seed <span className="muted">optional</span></label><input id="seed" value={seed} maxLength={128} onChange={(event) => setSeed(event.target.value)} placeholder="A repeatable starting point" /><label htmlFor="replay">Replay game ID <span className="muted">optional</span></label><input id="replay" value={replay} onChange={(event) => setReplay(event.target.value)} placeholder="Recorded game UUID" /></div>}
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" className="full-width" disabled={pending || connection !== "connected"}>{pending ? "Reserving your seat…" : mode === "create" ? "Open the campaign →" : "Join the campaign →"}</Button><p className="entry-note">Bring an opponent. No accounts. No spectators.<br />Reload this tab to reconnect. Open a new tab for player two.</p>
      </form></section>
    </section><div className="home-bottom"><span className="eyebrow">Not just left vs right.</span><p>Campaign in your own words. Respond to a changing world. Win trust, lose ground, or risk it all. The electorate has the final say.</p></div>
  </>;
}

function PhaseRail({ room }: { room: RoomState }) {
  const index = room.phase === "lobby" ? -1 : room.phase === "startPrompt" ? 0 : room.phase === "election" || room.phase === "end" ? 5 : Math.min(room.year, 4);
  return <nav className="phase-rail" aria-label="Campaign progress">{["The candidates", "Year 01", "Year 02", "Year 03", "Year 04", "Election"].map((label, position) => <span key={label} aria-current={index === position ? "step" : undefined} className={index === position ? "current" : index > position ? "complete" : ""}><span>{index > position ? "✓" : String(position + 1).padStart(2, "0")}</span>{label}</span>)}</nav>;
}

function Lobby({ room }: { room: RoomState }) {
  const { startGame, pending, connection, leave } = useGameStore();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const scenario = getScenario(room.scenarioId);
  const ready = room.players.length === 2 && room.players.every((player) => player.connected);
  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/?room=${room.code}`); setCopied(true); }
    catch { setCopyError(true); }
  }
  return <section className="lobby-grid"><div><span className="eyebrow">Your invitation to the opposition</span><div className="invite-code">{room.code}</div><p className="lede">A campaign needs a rival.<br />Share this code. Let the contest begin.</p><Button variant="outline" onClick={copyInvite}>{copied ? "Invite link copied ✓" : "Copy invite link ↗"}</Button>{copyError && <p role="status" className="muted">Copy unavailable. Share the room code instead.</p>}<div className="lobby-players">{sides.map((side) => { const player = room.players.find((entry) => entry.side === side); return <div className={`player-line side-${side}`} key={side}><span className="candidate-mark">{side.toUpperCase()}</span><div><strong>{player?.nickname ?? "Awaiting the opposition"}</strong><small>{room.host === side ? "Host" : "Challenger"}{room.self === side ? " · You" : ""}</small></div><span className="player-ready">{player?.connected ? "Ready" : player ? "Reconnecting" : "Seat open"}</span></div>; })}</div>{room.host === room.self ? <Button disabled={!ready || pending || connection !== "connected"} onClick={startGame}>{pending ? "Starting…" : ready ? "Start the campaign →" : "Waiting for two connected players"}</Button> : <p className="waiting-note" role="status">{ready ? "Both candidates are ready. Waiting for the host to start." : "Waiting for both candidates to connect."}</p>}<button type="button" className="text-button leave-link" onClick={leave}>Leave this room</button></div><aside className="lobby-brief"><span className="eyebrow">The briefing / {scenario.meta.era}</span><h2>{scenario.meta.name}</h2><p>{scenario.meta.blurb}</p><GeographicMap scenario={scenario} /><dl className="brief-facts"><div><dt>Electoral system</dt><dd>{scenario.electoralSystem === "fptp-regions" ? "Regional winner-takes-all" : "Proportional"}</dd></div><div><dt>Campaign pace</dt><dd>{room.timing === "demo" ? "Demo / 20s turns" : "Normal / 45s turns"}</dd></div><div><dt>Starting mood</dt><dd>{scenario.start.mood}</dd></div></dl></aside></section>;
}

function StartPrompt({ room, seconds }: { room: RoomState; seconds: number | null }) {
  const scenario = getScenario(room.scenarioId);
  return <section className="start-grid"><div><span className="eyebrow">Give the country someone to vote for</span><h2 className="display-heading">Who are you,<br /><em>really?</em></h2><p className="lede">Your background. Your beliefs. Your big promises. Write the politician you want to become.</p><div className="prompt-hints"><p><span>01</span><strong>A life before politics</strong>Where did you come from? What shaped you?</p><p><span>02</span><strong>A vision for the country</strong>Your party, priorities, and policy positions.</p><p><span>03</span><strong>A way of doing things</strong>A fiery outsider? A quiet dealmaker? Your call.</p></div></div><div><PromptEditor key="start" room={room} seconds={seconds} /><div className="opening-context"><span className="eyebrow">The country you inherit</span><h3>{scenario.start.economy}</h3><p>{scenario.start.mood}</p>{scenario.start.headlines.slice(0, 2).map((headline) => <p key={headline.headline}><strong>{headline.headline}</strong><br />{headline.description}</p>)}</div></div></section>;
}

function PromptEditor({ room, seconds }: { room: RoomState; seconds: number | null }) {
  const { submitPrompt, pending, connection } = useGameStore();
  const [prompt, setPrompt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmPass, setConfirmPass] = useState(false);
  const player = room.players.find((entry) => entry.side === room.self);
  const submitted = player?.submitted || confirmed;
  const intro = room.phase === "startPrompt";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (room.phase !== "startPrompt" && room.phase !== "turn") return;
    if (!intro && !prompt.trim() && !confirmPass) { setConfirmPass(true); return; }
    submitPrompt({ phase: room.phase, year: room.year, prompt });
  }
  useEffect(() => { if (player?.submitted) setConfirmed(true); }, [player?.submitted]);
  return <section className={`prompt-editor side-${room.self}`}><div className="section-heading"><span className="eyebrow">{intro ? "Your candidate statement" : `Your move / Year ${room.year}`}</span><span className="private-label">Only you can see this</span></div>{submitted ? <div className="submitted-message" role="status"><span className="submitted-check">✓</span><h3>Statement on the record.</h3><p>{room.players.every((entry) => entry.submitted) ? "Both statements are in. The simulation is resolving your decisions." : "Waiting for your opponent. Both submissions end the clock early."}</p></div> : <form onSubmit={submit}><label htmlFor="campaign-prompt" className="sr-only">{intro ? "Describe your politician" : "Your campaign action"}</label><textarea id="campaign-prompt" value={prompt} maxLength={12000} required={intro} onChange={(event) => { setPrompt(event.target.value); setConfirmPass(false); }} placeholder={intro ? "I’m a former teacher from a northern industrial town. My party stands for…" : "Make a promise. Hold a rally. Challenge your opponent. Tell us your next move…"} rows={intro ? 11 : 5} disabled={pending || seconds === 0} /><div className="editor-meta"><span>{intro ? "A full character, in your own words." : "Free text. Real consequences."}</span><span>{number(prompt.length)} / 12,000</span></div>{confirmPass && <p className="form-error" role="status">No action this year? Submit again to pass your turn.</p>}<Button type="submit" className="full-width" disabled={pending || connection !== "connected" || seconds === 0 || (intro && !prompt.trim())}>{pending ? "Submitting…" : seconds === 0 ? "Time’s up — awaiting the server" : intro ? "Meet your electorate →" : confirmPass ? "Confirm: pass this year →" : "Put the plan in motion →"}</Button></form>}</section>;
}

function Campaign({ room, now, seconds }: { room: RoomState; now: number; seconds: number | null }) {
  const scenario = getScenario(room.scenarioId);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const isElection = room.phase === "election" || room.phase === "end";
  const [revealStart, setRevealStart] = useState<number | null>(null);
  useEffect(() => {
    if (room.phase === "election") setRevealStart((previous) => previous ?? room.serverNow);
    if (room.phase !== "election") setRevealStart(null);
  }, [room.phase, room.serverNow]);
  const results = room.election?.regions ?? [];
  const revealDuration = room.deadline && revealStart ? Math.min(5000, Math.max(1000, room.deadline - revealStart)) : 5000;
  const revealCount = room.phase === "end" ? results.length : room.phase === "election" && revealStart ? Math.min(results.length, Math.floor(Math.max(0, now - revealStart) / revealDuration * results.length) + 1) : 0;
  const revealed = new Set(results.slice(0, revealCount).map((result) => result.regionId));
  const allRevealed = room.phase === "end" || (results.length > 0 && revealCount >= results.length);
  const selected = scenario.map.regions.find((region) => region.id === selectedRegion);
  const selectedResult = results.find((region) => region.regionId === selectedRegion);
  const selectedPoll = selectedRegion ? room.poll?.regions[selectedRegion] : null;
  const winner = room.election && allRevealed ? room.candidates?.[room.election.winner] : null;
  return <>
    {winner && <section className={`winner-banner side-${room.election!.winner}`} aria-live="polite"><span className="eyebrow">Election called / {room.election!.winner === room.self ? "You won" : "Your opponent won"}</span><h2>{winner.name} takes the country.</h2><p>{room.narration?.headline ?? `${winner.party} wins the ${scenario.electoralSystem === "fptp-regions" ? "regional seat count" : "popular vote"}.`}</p></section>}
    <div className="desk-grid">
      <aside className="candidate-column"><div className="section-heading"><h2 className="eyebrow">The contenders</h2><span>Head to head</span></div>{sides.map((side) => <CandidateProfile key={side} candidate={room.candidates?.[side] ?? null} side={side} self={room.self} scenario={scenario} />)}{room.ownCandidate?.side === room.self && !isElection && <section className="private-ledger"><span className="eyebrow">Your private campaign ledger</span><p>Available funds <strong>{number(Math.round(room.ownCandidate.funds))}</strong></p><p>Active promises <strong>{room.ownCandidate.promises.filter((promise) => !promise.broken).length}</strong></p>{room.ownCandidate.corruptionCases.length > 0 && <details><summary>Your confidential cases ({room.ownCandidate.corruptionCases.length})</summary>{room.ownCandidate.corruptionCases.map((entry) => <p key={entry.id}>{entry.description} <small>Year {entry.yearTaken} · {entry.exposed ? "Exposed" : "Not public"}</small></p>)}</details>}</section>}</aside>
      <section className="map-column"><div className="section-heading"><h2 className="eyebrow">{isElection ? "The live count" : "The electoral map"}</h2><span>{isElection ? `${revealCount} / ${results.length || scenario.map.regions.length} declared` : "Select a region"}</span></div><GeographicMap scenario={scenario} room={room} selectedRegion={selectedRegion} onSelect={setSelectedRegion} revealed={isElection ? revealed : undefined} />
        <div className="map-legend"><span><i className="legend-swatch coral" />Candidate A</span><span><i className="legend-swatch blue" />Candidate B</span><span><i className="legend-swatch neutral" />{isElection ? "Undeclared" : "No poll / tied"}</span></div>
        <div className="region-inspector" aria-live="polite">{selected ? <><div><span className="eyebrow">{selected.name}</span><span>{selected.seats} seats · {percent(selected.share)} of electorate</span></div>{isElection ? selectedResult && revealed.has(selected.id) ? <p><span className="coral-text">A {number(selectedResult.votes.a)}</span><span className="blue-text">B {number(selectedResult.votes.b)}</span><span>Turnout {percent(selectedResult.turnout)}</span></p> : <p>Awaiting declaration.</p> : selectedPoll ? <p><span className="coral-text">A {percent(selectedPoll.a)}</span><span className="blue-text">B {percent(selectedPoll.b)}</span><span>{Math.abs(selectedPoll.a - selectedPoll.b) < .05 ? "Too close to call" : `Candidate ${selectedPoll.a > selectedPoll.b ? "A" : "B"} leads`}</span></p> : <p>The first regional poll is still to come.</p>}</> : <p>Click or keyboard-select a region to inspect {isElection ? "its result" : "the local race"}.</p>}</div>
        <PollBoard room={room} revealed={revealed} allRevealed={allRevealed} />
        {!isElection && (room.phase === "turn" ? <PromptEditor key={`turn-${room.year}`} room={room} seconds={seconds} /> : <div className="phase-status" role="status"><span className="eyebrow">{room.phase === "yearRecap" ? "Read the room" : "The simulation is working"}</span><h3>{room.phase === "yearRecap" ? "Your next move is coming." : room.phase === "resolving" ? "The electorate is weighing your decisions." : "A year is unfolding across the country."}</h3><p>{room.phase === "yearRecap" ? "Review the headlines, listen to voters, and plan your response." : "Events and action summaries arrive first. Polling and voter voices follow."}</p></div>)}
      </section>
      <aside className="news-column"><NewsFeed room={room} scenario={scenario} /><PollMovement room={room} /><FocusQuotes room={room} /></aside>
    </div>{isElection && <ElectionSummary room={room} allRevealed={allRevealed} />}
  </>;
}

function GeographicMap({ scenario, room, selectedRegion, onSelect, revealed }: { scenario: Scenario; room?: RoomState; selectedRegion?: string | null; onSelect?: (id: string) => void; revealed?: Set<string> }) {
  return <svg className={`geographic-map ${onSelect ? "interactive-map" : ""}`} viewBox={scenario.map.viewBox} role={onSelect ? "group" : "img"} aria-label={`${scenario.meta.country} electoral regions`}><title>{`${scenario.meta.country} electoral map`}</title>{scenario.map.regions.map((region) => {
    const poll = room?.poll?.regions[region.id];
    const result = room?.election?.regions.find((entry) => entry.regionId === region.id);
    const leader = revealed ? revealed.has(region.id) ? result?.winner : null : poll && poll.a !== poll.b ? poll.a > poll.b ? "a" : "b" : null;
    const label = `${region.name}, ${region.seats} seats${leader ? `, candidate ${leader.toUpperCase()} ${revealed ? "wins" : "leads"}` : revealed ? ", undeclared" : ""}`;
    return <g key={region.id}><path d={region.path} className={`map-region ${leader ? `map-${leader}` : "map-neutral"} ${selectedRegion === region.id ? "map-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? label : undefined} aria-pressed={onSelect ? selectedRegion === region.id : undefined} onClick={onSelect ? () => onSelect(region.id) : undefined} onKeyDown={onSelect ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(region.id); } } : undefined}><title>{label}</title></path>{onSelect && <text x={region.label.x} y={region.label.y} className="map-label" aria-hidden="true">{region.name}</text>}</g>;
  })}</svg>;
}

function CandidateProfile({ candidate, side, self, scenario }: { candidate: PublicCandidate | null; side: Side; self: Side; scenario: Scenario }) {
  return <section className={`candidate-profile side-${side}`}><div className="candidate-topline"><span className="candidate-mark">{side.toUpperCase()}</span><span className="eyebrow">{self === side ? "Your campaign" : "The opposition"}</span></div><h3>{candidate?.name ?? `Candidate ${side.toUpperCase()}`}</h3><p className="party-name">{candidate?.party ?? "Profile incoming"}</p>{candidate && <><blockquote>“{candidate.slogan}”</blockquote><div className="candidate-metrics">{[["Trust", candidate.trust], ["Charisma", candidate.charisma], ["Credibility", candidate.credibility]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{Math.round(Number(value) * 100)}</strong></div>)}</div><details className="profile-details"><summary>Read the candidate profile</summary><p>{candidate.bio}</p><p><strong>Ideology</strong> {candidate.ideology}</p><p><strong>Strengths</strong> {candidate.strengths.join(" · ")}</p><p><strong>Weaknesses</strong> {candidate.weaknesses.join(" · ")}</p><div className="issue-positions">{scenario.issues.map((issue) => <div key={issue.id}><strong>{issue.name}</strong><p>{(candidate.positions[issue.id] ?? 0) < -.15 ? issue.negLabel : (candidate.positions[issue.id] ?? 0) > .15 ? issue.posLabel : "Centrist position"}</p></div>)}</div></details></>}</section>;
}

function PollBoard({ room, revealed, allRevealed }: { room: RoomState; revealed: Set<string>; allRevealed: boolean }) {
  const election = room.phase === "election" || room.phase === "end";
  const declared = room.election?.regions.filter((region) => revealed.has(region.regionId)) ?? [];
  const votes = { a: declared.reduce((sum, region) => sum + region.votes.a, 0), b: declared.reduce((sum, region) => sum + region.votes.b, 0) };
  const total = votes.a + votes.b;
  const shares = election ? total > 0 ? { a: votes.a / total, b: votes.b / total } : null : room.poll?.national;
  const seats = { a: declared.reduce((sum, region) => sum + region.seats.a, 0), b: declared.reduce((sum, region) => sum + region.seats.b, 0) };
  return <section className="poll-board"><div className="section-heading"><h2 className="eyebrow">{election ? "Declared popular vote" : "National voting intention"}</h2><span>{election ? allRevealed ? "Final result" : "Partial results" : room.recap?.pending ? "Updating" : "Decided voters"}</span></div><div className="poll-numbers">{sides.map((side) => <div className={`side-${side}`} key={side}><span>{room.candidates?.[side].party ?? `Candidate ${side.toUpperCase()}`}</span><strong>{shares ? percent(shares[side]) : "—"}</strong><small>{election ? `${number(votes[side])} votes · ${seats[side]} seats` : room.candidates?.[side].name ?? "Awaiting the first poll"}</small></div>)}</div><div className="poll-bar" aria-hidden="true"><span className="coral" style={{ width: `${shares ? shares.a * 100 : 50}%` }} /><span className={shares ? "blue" : "neutral"} style={{ flex: 1 }} /><i /></div><div className="poll-footnote"><span>{election && room.election && allRevealed ? `Turnout ${percent(room.election.national.turnout)}` : !election && room.poll ? `Estimated turnout ${percent(room.poll.turnout)}` : "Waiting for the electorate"}</span><span>{election ? "Actual votes, not a forecast" : "Polls are a snapshot, not a promise"}</span></div></section>;
}

function NewsFeed({ room, scenario }: { room: RoomState; scenario: Scenario }) {
  const events = room.recap?.events ?? [];
  return <section className="news-feed"><div className="section-heading"><h2 className="eyebrow">On the wire</h2><span className="live-label">● Live</span></div>{events.length ? events.map((event, index) => <article key={`${event.id}-${index}`}><span className={`news-tag ${event.kind === "exposure" ? "coral-text" : ""}`}>{event.kind === "exposure" ? "Investigation" : event.regions.length ? "Regional report" : "National report"} / {String(index + 1).padStart(2, "0")}</span><h3>{event.headline}</h3><p>{event.description}</p></article>) : scenario.start.headlines.slice(0, 3).map((headline, index) => <article key={headline.headline}><span className="news-tag">Opening dispatch / {String(index + 1).padStart(2, "0")}</span><h3>{headline.headline}</h3><p>{headline.description}</p></article>)}</section>;
}

function PollMovement({ room }: { room: RoomState }) {
  const entries = room.recap?.breakdown.filter((entry) => !entry.secret || entry.side === room.self) ?? [];
  return <section className="movement-section"><div className="section-heading"><h2 className="eyebrow">Why the poll moved</h2></div><p className="section-caption">Impact on your national share · percentage points</p>{entries.length ? entries.map((entry, index) => { const delta = entry.delta[room.self]; return <div className="movement-row" key={`${entry.label}-${index}`}><div><span>{entry.label}</span><small>{entry.source === "focusGroup" ? "Voter response" : entry.source}{entry.secret ? " · Private" : ""}</small></div><strong className={delta > 0 ? "positive" : delta < 0 ? "negative" : "muted"}>{delta > 0 ? "+" : ""}{delta.toFixed(2)}</strong></div>; }) : <p className="empty-copy">Every shift has a story. The breakdown arrives with your first year’s results.</p>}</section>;
}

function FocusQuotes({ room }: { room: RoomState }) {
  return <section className="focus-section"><div className="section-heading"><h2 className="eyebrow">Voices from the country</h2></div>{room.recap?.quotes.length ? room.recap.quotes.map((quote, index) => <figure key={`${quote.segmentId}-${index}`}><blockquote>“{quote.quote}”</blockquote><figcaption>{quote.persona}</figcaption></figure>) : <p className="empty-copy">{room.recap?.pending ? "The focus group is weighing in. Voter voices will arrive shortly." : "Listen closely. The first focus group follows the first year."}</p>}</section>;
}

function ElectionSummary({ room, allRevealed }: { room: RoomState; allRevealed: boolean }) {
  const { leave } = useGameStore();
  const exposures = room.recaps.flatMap((recap) => recap.events.filter((event) => event.kind === "exposure"))
    .map((event) => ({ ...event, year: Math.min(event.year, 4) }));
  const history = room.recaps.filter((recap) => !recap.final && recap.year >= 1 && recap.year <= 4);
  return <section className="election-summary"><div className="summary-heading"><div><span className="eyebrow">The campaign, on the record</span><h2>Four years to get here.</h2></div>{room.phase === "end" && <Button variant="outline" onClick={leave}>Start a new contest ↗</Button>}</div>{allRevealed && room.narration && <p className="election-story">{room.narration.story}</p>}<div className="history-grid">{[1, 2, 3, 4].map((year) => { const recap = history.find((entry) => entry.year === year); return <article key={year}><span className="eyebrow">Year {String(year).padStart(2, "0")}</span><h3>{recap?.events[0]?.headline ?? "The campaign continues"}</h3>{recap?.poll && <p className="history-poll"><span className="coral-text">A {percent(recap.poll.national.a)}</span><span className="blue-text">B {percent(recap.poll.national.b)}</span></p>}<p>{recap?.events[0]?.description ?? "No public event recorded."}</p></article>; })}</div><div className="exposure-summary"><span className="eyebrow">The accountability file</span><h3>{exposures.length ? `${exposures.length} exposed case${exposures.length === 1 ? "" : "s"}. Nothing stays buried forever.` : "No corruption cases were publicly exposed."}</h3>{exposures.map((event, index) => <p key={`${event.id}-${index}`}><strong>Year {event.year} / {event.headline}</strong><br />{event.description}</p>)}<p className="muted">This record includes public investigations only.</p></div></section>;
}
