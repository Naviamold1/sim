import { createGameAi, fallbackProvider } from "../packages/ai/src/index";
import { getScenario } from "../packages/scenarios/src/index";
import { beginYear, createGame, finishYear, rollCorruption, runElection, selectPersonas, type PerSide, type TurnInterpretation } from "../packages/sim/src/index";

const scenario = getScenario("uk");
const startPrompts = {
  a: "I am Alex Morgan, a working-class nurse and trade-union organiser. I want investment in public services, affordable housing, higher taxes on the wealthy, and a greener economy.",
  b: "I am Sam Blake, a lawyer and small-business campaigner. I want lower taxes, less bureaucracy, controlled immigration, and support for businesses.",
};
const scripts: PerSide<string[]> = {
  a: [
    "Promise affordable housing and investment in public services. Rally in London.",
    "Campaign on social media for a greener economy.",
    "Rally in Scotland and promise better public services.",
    "Make a final statement for honest government and affordable housing.",
  ],
  b: [
    "Promise lower taxes and campaign on television.",
    "Take a big bribe from a developer to boost campaign funds.",
    "Rally in the North West and defend my economic record.",
    "Run a final television campaign for lower taxes and business growth.",
  ],
};
const limit = Number(process.argv[2] ?? 100);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Seed search limit must be an integer from 1 to 1000");

let best: { seed: string; exposureYear: number; nationalShare: PerSide<number>; seats: PerSide<number>; winner: "a" | "b"; searched: number; closeRace: boolean } | null = null;
let searched = 0;
for (let attempt = 1; attempt <= limit; attempt++) {
  searched = attempt;
  const seed = `rehearsal-${attempt}`;
  const ai = createGameAi({ provider: fallbackProvider, scenario });
  const profiles = await Promise.all((["a", "b"] as const).map((side) =>
    ai.buildProfile(`profile:${side}`, { nickname: side === "a" ? "Alex" : "Sam", prompt: startPrompts[side] })));
  const [profileA, profileB] = profiles;
  if (!profileA || !profileB) throw new Error("Candidate profiles missing");
  let state = createGame(scenario, seed, {
    a: { nickname: "Alex", profile: profileA.output }, b: { nickname: "Sam", profile: profileB.output },
  });
  for (let resolution = 1; resolution <= 5; resolution++) {
    const turns: PerSide<TurnInterpretation | null> = { a: null, b: null };
    if (resolution > 1) {
      for (const side of ["a", "b"] as const) {
        const prompt = scripts[side][resolution - 2];
        if (!prompt) throw new Error("Rehearsal prompt missing");
        turns[side] = (await ai.interpretTurn(`turn:${state.year}:${side}`, { state, side, prompt })).output;
      }
    }
    const director = await ai.director(`director:${resolution}`, { state, exposures: rollCorruption(state, scenario) });
    const begun = beginYear(state, scenario, { turns, director: director.output });
    const focus = await ai.focusGroup(`focus:${resolution}`, { state: begun.state, pending: begun.pending, personas: selectPersonas(begun.state, scenario) });
    state = finishYear(begun.state, scenario, begun.pending, focus.output).state;
  }
  const election = runElection(state, scenario);
  const exposureYear = state.candidates.b.corruptionCases.find((entry) => entry.exposed)?.yearExposed;
  const shareA = election.national.share.a;
  if (exposureYear === 3 && (!best || Math.abs(shareA - 0.5) < Math.abs(best.nationalShare.a - 0.5))) {
    best = { seed, exposureYear, nationalShare: election.national.share, seats: election.seats, winner: election.winner, searched: attempt, closeRace: shareA >= 0.45 && shareA <= 0.55 };
    if (best.closeRace) break;
  }
}
if (best) {
  console.log(JSON.stringify({ ...best, searched, mode: "deterministic-fallback" }));
  if (!best.closeRace) console.error("Year-3 exposure found, but these prompts did not produce a 45–55% popular-vote split. Rehearse different campaign strategies; game rules were not changed.");
} else {
  console.error(`No year-3 exposure found in ${limit} unmodified seeds.`);
  process.exitCode = 1;
}
