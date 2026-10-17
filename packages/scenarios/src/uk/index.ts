import { defineScenario } from "../define";
import type { Segment } from "../schema";

const regions = [
  { id: "north-east", name: "North East", share: 0.04, seats: 4, urban: 0.65, label: { x: 180, y: 200 }, path: "M155 165 L205 175 L210 225 L165 230 Z" },
  { id: "north-west", name: "North West", share: 0.11, seats: 11, urban: 0.75, label: { x: 130, y: 250 }, path: "M105 200 L155 210 L165 290 L110 300 Z" },
  { id: "yorkshire", name: "Yorkshire and the Humber", share: 0.08, seats: 8, urban: 0.65, label: { x: 200, y: 265 }, path: "M165 230 L220 225 L245 295 L165 290 Z" },
  { id: "east-midlands", name: "East Midlands", share: 0.07, seats: 7, urban: 0.55, label: { x: 205, y: 330 }, path: "M165 295 L245 300 L255 355 L175 365 Z" },
  { id: "west-midlands", name: "West Midlands", share: 0.09, seats: 9, urban: 0.7, label: { x: 140, y: 345 }, path: "M110 305 L165 295 L175 365 L120 385 Z" },
  { id: "east", name: "East of England", share: 0.08, seats: 8, urban: 0.5, label: { x: 275, y: 365 }, path: "M250 315 L310 325 L320 395 L255 410 L255 355 Z" },
  { id: "south-west", name: "South West", share: 0.09, seats: 9, urban: 0.4, label: { x: 120, y: 440 }, path: "M115 390 L185 410 L165 450 L40 490 L65 455 Z" },
  { id: "london", name: "London", share: 0.14, seats: 14, urban: 1, label: { x: 235, y: 405 }, path: "M220 390 L250 390 L255 415 L220 420 Z" },
  { id: "south-east", name: "South East", share: 0.13, seats: 13, urban: 0.7, label: { x: 245, y: 445 }, path: "M180 370 L220 380 L215 425 L260 420 L300 400 L315 440 L245 465 L170 450 L190 410 Z" },
  { id: "wales", name: "Wales", share: 0.05, seats: 5, urban: 0.4, label: { x: 75, y: 355 }, path: "M65 295 L105 310 L115 385 L65 405 L40 365 Z" },
  { id: "scotland", name: "Scotland", share: 0.09, seats: 9, urban: 0.45, label: { x: 125, y: 115 }, path: "M65 25 L160 15 L205 75 L170 120 L200 165 L150 195 L95 170 L60 115 L85 80 Z" },
  { id: "northern-ireland", name: "Northern Ireland", share: 0.03, seats: 3, urban: 0.5, label: { x: 35, y: 235 }, path: "M15 210 L60 200 L75 235 L45 265 L10 250 Z" },
];
const classes = [
  { id: "working", name: "Working class", occupations: ["care worker", "warehouse worker", "bus driver"] },
  { id: "middle", name: "Middle class", occupations: ["teacher", "engineer", "shop manager"] },
  { id: "affluent", name: "Affluent", occupations: ["company director", "consultant", "landowner"] },
];
const ages = [
  { id: "young", name: "18–34", min: 18, max: 34, socialReach: 1.6 },
  { id: "adult", name: "35–64", min: 35, max: 64, socialReach: 1 },
  { id: "older", name: "65+", min: 65, max: 90, socialReach: 0.5 },
];
const segments: Segment[] = regions.flatMap((region) => classes.flatMap((socialClass, classIndex) => ages.map((age, ageIndex) => {
  const young = ageIndex === 0;
  const older = ageIndex === 2;
  return {
    id: `${region.id}-${socialClass.id}-${age.id}`,
    regionId: region.id, classId: socialClass.id, ageId: age.id,
    share: region.share * ([0.45, 0.4, 0.15][classIndex] ?? 0) * ([0.28, 0.47, 0.25][ageIndex] ?? 0),
    positions: {
      economy: -0.55 + classIndex * 0.45,
      healthcare: -0.7 + classIndex * 0.25,
      housing: young ? -0.65 : older ? 0.2 : -0.2,
      immigration: (older ? 0.45 : young ? -0.35 : 0.1) - region.urban * 0.2,
      environment: (young ? -0.55 : older ? 0.15 : -0.15) + classIndex * 0.05,
    },
    salience: young
      ? { economy: 0.25, healthcare: 0.15, housing: 0.3, immigration: 0.1, environment: 0.2 }
      : older
        ? { economy: 0.25, healthcare: 0.3, housing: 0.1, immigration: 0.25, environment: 0.1 }
        : { economy: 0.3, healthcare: 0.25, housing: 0.2, immigration: 0.15, environment: 0.1 },
    engagement: (young ? 0.42 : older ? 0.78 : 0.62) + classIndex * 0.04,
    concerns: young ? "High rents, insecure work and the climate" : older ? "NHS waiting lists, pensions and local services" : "Household bills, mortgages and reliable public services",
  };
})));

export const uk = defineScenario({
  meta: {
    id: "uk", name: "United Kingdom: A Divided Kingdom", country: "United Kingdom", era: "Fictional present day",
    blurb: "Two fictional challengers compete across 12 UK regions. Stylized population weights, a schematic map and 100 winner-takes-region seats: not a forecast or a constituency simulation.",
  },
  map: { viewBox: "0 0 340 510", regions }, classes, ages,
  issues: [
    { id: "economy", name: "Economy", negLabel: "Public investment and redistribution", posLabel: "Lower taxes and a smaller state" },
    { id: "healthcare", name: "Healthcare", negLabel: "Expand public NHS provision", posLabel: "More private provision and competition" },
    { id: "housing", name: "Housing", negLabel: "Build homes and protect renters", posLabel: "Protect property owners and local planning control" },
    { id: "immigration", name: "Immigration", negLabel: "More open migration", posLabel: "Tighter migration controls" },
    { id: "environment", name: "Environment", negLabel: "Faster green transition", posLabel: "Prioritize near-term growth and energy costs" },
  ],
  segments, electoralSystem: "fptp-regions",
  events: {
    flavor: "A fictional contemporary UK campaign: pressure on the NHS, rents, bills, regional inequality and the green transition. Invent archetypal parties, never claim real politicians did these things.",
    templates: [
      { id: "cost-of-living", name: "Household bills surge", weight: 5, rarity: "common", maxPerGame: 3, impacts: { salience: { economy: 0.08 }, positions: { economy: -0.03 }, engagement: 0.03 }, target: { national: true }, headline: "Household bills squeeze family budgets", description: "Energy and food prices rise as wages struggle to keep pace." },
      { id: "nhs-waiting-lists", name: "NHS waiting lists", weight: 4, rarity: "common", maxPerGame: 2, impacts: { salience: { healthcare: 0.08 }, positions: { healthcare: -0.03 }, engagement: 0.04 }, target: { national: true }, headline: "NHS waiting lists dominate the debate", description: "Patients and staff demand a credible plan for local services." },
      { id: "rent-surge", name: "Rents surge", weight: 4, rarity: "common", maxPerGame: 2, impacts: { salience: { housing: 0.08 }, positions: { housing: -0.04 }, engagement: 0.03 }, target: { minUrban: 0.65 }, headline: "Renters in {region} face another increase", description: "Housing shortages put pressure on households and councils in {region}." },
      { id: "regional-investment", name: "New investment", weight: 3, rarity: "common", maxPerGame: 2, impacts: { salience: { economy: 0.05 }, engagement: 0.02 }, target: {}, headline: "New jobs promised in {region}", description: "A major employer announces an investment plan, sparking debate about who will benefit." },
      { id: "channel-debate", name: "Migration debate", weight: 2, rarity: "uncommon", maxPerGame: 2, impacts: { salience: { immigration: 0.08 }, engagement: 0.04 }, target: { national: true }, headline: "Migration policy returns to the headlines", description: "Campaigners clash over border management, labour shortages and humanitarian obligations." },
      { id: "flooding", name: "Severe flooding", weight: 2, rarity: "uncommon", maxPerGame: 1, impacts: { salience: { environment: 0.1 }, positions: { environment: -0.04 }, engagement: 0.06 }, target: { maxUrban: 0.7 }, headline: "Flooding disrupts {region}", description: "Communities demand flood defences and emergency support after days of heavy rain." },
      { id: "pandemic", name: "Public health emergency", weight: 0.2, rarity: "rare", maxPerGame: 1, impacts: { salience: { healthcare: 0.12, economy: 0.04 }, engagement: -0.03 }, target: { national: true }, headline: "Public health emergency tests national resilience", description: "A fictional outbreak forces difficult choices about health, jobs and public services." },
    ],
  },
  backgrounds: [
    { id: "worker", name: "Worker", description: "A career in ordinary jobs and community organizing.", modifiers: { affinity: [{ classIds: ["working"], delta: 0.05 }] } },
    { id: "billionaire", name: "Billionaire", description: "A wealthy business founder running as an outsider.", modifiers: { funds: 60, trust: -0.05, affinity: [{ classIds: ["working"], delta: -0.08 }, { classIds: ["affluent"], delta: 0.04 }] } },
    { id: "lawyer", name: "Lawyer", description: "A courtroom advocate experienced in public argument.", modifiers: { charisma: 0.05 } },
    { id: "public-servant", name: "Public servant", description: "A career delivering local public services.", modifiers: { trust: 0.03 } },
  ],
  start: {
    economy: "Sluggish growth and stretched household budgets", mood: "Restless, divided and looking for credible change",
    headlines: [{ headline: "Two new challengers enter a four-year race", description: "With established parties offstage, two fictional movements must earn the trust of a divided electorate." }],
  },
  tuning: {},
});
