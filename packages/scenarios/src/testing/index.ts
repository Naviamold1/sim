import { defineScenario } from "../define";
import type { ScenarioInput } from "../schema";

type Seg = ScenarioInput["segments"][number];

const issues = ["economy", "immigration", "environment"] as const;
type IssueKey = (typeof issues)[number];

function segment(
  regionId: string,
  classId: string,
  ageId: string,
  share: number,
  positions: Record<IssueKey, number>,
  salience: Record<IssueKey, number>,
  engagement: number,
): Seg {
  return {
    id: `${regionId}-${classId}-${ageId}`,
    regionId,
    classId,
    ageId,
    share,
    positions,
    salience,
    engagement,
    concerns: `${classId} life in the ${regionId}`,
  };
}

/**
 * Tiny, hand-checkable scenario for unit tests: 2 regions x 2 classes x 2 ages, 3 issues.
 * Not registered in the scenario registry.
 */
export const testScenario = defineScenario({
  meta: { id: "test", name: "Testland", era: "Present day", country: "Testland", blurb: "A tiny test country." },
  map: {
    viewBox: "0 0 100 200",
    regions: [
      { id: "north", name: "North", path: "M0 0 H100 V100 H0 Z", label: { x: 50, y: 50 }, share: 0.4, seats: 4, urban: 0.3 },
      { id: "south", name: "South", path: "M0 100 H100 V200 H0 Z", label: { x: 50, y: 150 }, share: 0.6, seats: 6, urban: 0.8 },
    ],
  },
  classes: [
    { id: "working", name: "Working class", occupations: ["warehouse worker", "nurse"] },
    { id: "middle", name: "Middle class", occupations: ["accountant", "teacher"] },
  ],
  ages: [
    { id: "young", name: "18-39", min: 18, max: 39, socialReach: 1.5 },
    { id: "old", name: "40+", min: 40, max: 85, socialReach: 0.6 },
  ],
  issues: [
    { id: "economy", name: "Economy", negLabel: "Bigger state", posLabel: "Free market" },
    { id: "immigration", name: "Immigration", negLabel: "More open", posLabel: "More restrictive" },
    { id: "environment", name: "Environment", negLabel: "Green first", posLabel: "Growth first" },
  ],
  segments: [
    segment("north", "working", "young", 0.1, { economy: -0.5, immigration: 0.1, environment: -0.2 }, { economy: 0.5, immigration: 0.2, environment: 0.3 }, 0.45),
    segment("north", "working", "old", 0.14, { economy: -0.3, immigration: 0.6, environment: 0.3 }, { economy: 0.4, immigration: 0.5, environment: 0.1 }, 0.7),
    segment("north", "middle", "young", 0.06, { economy: 0.1, immigration: -0.2, environment: -0.4 }, { economy: 0.4, immigration: 0.2, environment: 0.4 }, 0.55),
    segment("north", "middle", "old", 0.1, { economy: 0.4, immigration: 0.3, environment: 0.2 }, { economy: 0.5, immigration: 0.3, environment: 0.2 }, 0.75),
    segment("south", "working", "young", 0.12, { economy: -0.4, immigration: -0.3, environment: -0.5 }, { economy: 0.5, immigration: 0.1, environment: 0.4 }, 0.4),
    segment("south", "working", "old", 0.12, { economy: -0.2, immigration: 0.4, environment: 0.1 }, { economy: 0.5, immigration: 0.4, environment: 0.1 }, 0.65),
    segment("south", "middle", "young", 0.16, { economy: 0.2, immigration: -0.5, environment: -0.6 }, { economy: 0.3, immigration: 0.2, environment: 0.5 }, 0.6),
    segment("south", "middle", "old", 0.2, { economy: 0.5, immigration: 0.2, environment: 0.1 }, { economy: 0.6, immigration: 0.25, environment: 0.15 }, 0.8),
  ],
  electoralSystem: "fptp-regions",
  events: {
    flavor: "A quiet, fictional parliamentary democracy.",
    templates: [
      {
        id: "flood",
        name: "Flooding",
        weight: 3,
        rarity: "common",
        maxPerGame: 2,
        impacts: { salience: { environment: 0.08 }, engagement: 0.05 },
        target: { maxUrban: 0.5 },
        headline: "Floods hit {region}",
        description: "Rivers burst their banks across {region}.",
      },
      {
        id: "crash",
        name: "Market crash",
        weight: 2,
        rarity: "uncommon",
        maxPerGame: 1,
        impacts: { salience: { economy: 0.1 }, positions: { economy: -0.05 }, engagement: 0.03 },
        target: { national: true },
        headline: "Markets crash",
        description: "Share prices tumble and pensions take a hit.",
      },
      {
        id: "pandemic",
        name: "Pandemic",
        weight: 0.3,
        rarity: "rare",
        maxPerGame: 1,
        impacts: { salience: { economy: 0.05 }, engagement: -0.03 },
        target: { national: true },
        headline: "Pandemic lockdown",
        description: "A new virus forces a national lockdown.",
      },
    ],
  },
  backgrounds: [
    { id: "worker", name: "Worker", description: "Came up through ordinary jobs.", modifiers: { affinity: [{ classIds: ["working"], delta: 0.05 }] } },
    {
      id: "billionaire",
      name: "Billionaire",
      description: "Self-made tycoon.",
      modifiers: { funds: 60, trust: -0.05, affinity: [{ classIds: ["working"], delta: -0.08 }] },
    },
    { id: "lawyer", name: "Lawyer", description: "Courtroom veteran.", modifiers: { charisma: 0.05 } },
  ],
  start: {
    economy: "Flat growth",
    mood: "Restless",
    headlines: [{ headline: "Election in four years", description: "Two newcomers enter the race." }],
  },
  tuning: { voterCount: 4_000, pollSample: 500 },
});
