import { z } from "zod";

/** Lowercase snake/kebab id, safe for enums in AI output schemas. */
const IdSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, "ids are lowercase [a-z0-9_-]")
  .refine((id) => !["constructor", "prototype", "national"].includes(id), "reserved id");

const unit = z.number().min(0).max(1);
const signed = z.number().min(-1).max(1);

/** Map from issue id to a value. Keys are checked against `issues` in the scenario refinement. */
const IssueValues = z.record(IdSchema, z.number());

export const IssueSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** What a position of -1 means, e.g. "Higher taxes, bigger state". */
  negLabel: z.string(),
  /** What a position of +1 means, e.g. "Lower taxes, smaller state". */
  posLabel: z.string(),
});

export const RegionSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** SVG path `d` in the scenario's `map.viewBox` coordinate space. */
  path: z.string().min(1),
  /** Label anchor in viewBox coordinates. */
  label: z.object({ x: z.number(), y: z.number() }),
  /** Share of the national population, all regions sum to 1. */
  share: unit,
  /** Seats awarded by `fptp-regions` (winner takes all in the region). */
  seats: z.number().int().positive(),
  /** 0 = fully rural, 1 = fully urban. */
  urban: unit,
});

export const SocialClassSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Example occupations used to render focus group personas. */
  occupations: z.array(z.string()).min(1),
});

export const AgeGroupSchema = z.object({
  id: IdSchema,
  name: z.string(),
  min: z.number().int().min(16),
  max: z.number().int().max(110),
  /** Social media reaches this group more strongly (multiplier on social media effects). */
  socialReach: z.number().min(0).max(2),
});

export const SegmentSchema = z.object({
  id: IdSchema,
  regionId: IdSchema,
  classId: IdSchema,
  ageId: IdSchema,
  /** Share of the national population. All segments sum to 1, and segments of a region sum to its share. */
  share: unit,
  /** Baseline position per issue, -1..1. */
  positions: IssueValues,
  /** Baseline salience per issue, non-negative, sums to 1. */
  salience: IssueValues,
  /** Baseline likelihood of voting at all. */
  engagement: unit,
  /** One line of everyday context for personas, e.g. "rent up 20%, two jobs". */
  concerns: z.string(),
});

const ImpactSchema = z.object({
  /** Additive salience shift per issue (re-normalized afterwards). */
  salience: IssueValues.default({}),
  /** Additive segment position shift per issue. */
  positions: IssueValues.default({}),
  /** Additive engagement shift. */
  engagement: z.number().min(-0.3).max(0.3).default(0),
});

export const EventTemplateSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** Relative draw weight for fallbacks and a hint for the director. */
  weight: z.number().positive(),
  rarity: z.enum(["common", "uncommon", "rare"]),
  /** Hard cap on how many times this template can fire in one game. */
  maxPerGame: z.number().int().positive(),
  /** Impacts at severity 1. Severity s multiplies them by s. */
  impacts: ImpactSchema,
  /** Which regions the event may target. Empty lists mean no restriction. */
  target: z.object({
    regions: z.array(IdSchema).default([]),
    /** Only regions with urban >= minUrban / <= maxUrban. */
    minUrban: unit.default(0),
    maxUrban: unit.default(1),
    /** National events always apply to every region. */
    national: z.boolean().default(false),
  }),
  /** Fallback headline/description; `{region}` is replaced with target region names. */
  headline: z.string(),
  description: z.string(),
});

const AffinityModifierSchema = z.object({
  classIds: z.array(IdSchema).default([]),
  ageIds: z.array(IdSchema).default([]),
  regionIds: z.array(IdSchema).default([]),
  /** Added to the segment's affinity for this candidate. Empty filters match every segment. */
  delta: z.number().min(-0.5).max(0.5),
});

export const BackgroundSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  modifiers: z.object({
    funds: z.number().default(0),
    trust: z.number().min(-0.2).max(0.2).default(0),
    charisma: z.number().min(-0.2).max(0.2).default(0),
    affinity: z.array(AffinityModifierSchema).default([]),
  }),
});

export const TuningSchema = z.object({
  /** Utility weights: U = -alpha*distance + beta*trust*credibility + gamma*affinity + delta*visibility. */
  alpha: z.number(),
  beta: z.number(),
  gamma: z.number(),
  delta: z.number(),
  /** Softmax temperature for candidate choice. */
  tau: z.number().positive(),
  /** Turnout: P(vote) = sigmoid(turnoutA*engagement + turnoutB*maxU - turnoutT). */
  turnoutA: z.number(),
  turnoutB: z.number(),
  turnoutT: z.number(),
  /** Number of simulated voters. */
  voterCount: z.number().int().positive(),
  /** Std dev of per-voter Gaussian noise on positions and engagement. */
  voterNoise: z.number().min(0),
  pollSample: z.number().int().positive(),
  /** Max absolute poll noise on a share, e.g. 0.025 = ±2.5 points. */
  pollNoise: unit,
  actionPoints: z.number().int().positive(),
  startingFunds: z.number().min(0),
  /** Funds added to each candidate at the start of every turn. */
  yearlyIncome: z.number().min(0),
  startingVisibility: unit,
  /** Base exposure chance per year per case size, plus `corruptionRiskPerYear` per year since taken. */
  corruptionRisk: z.object({ small: unit, medium: unit, big: unit }),
  corruptionRiskPerYear: unit,
  /** Funds gained when taking a case. */
  corruptionFunds: z.object({ small: z.number().min(0), medium: z.number().min(0), big: z.number().min(0) }),
  /** Trust lost when a case is exposed. */
  corruptionTrustHit: z.object({ small: unit, medium: unit, big: unit }),
  /** Cost per intensity point. */
  costs: z.object({ tv: z.number().min(0), social: z.number().min(0), rally: z.number().min(0) }),
  /** Focus group spillover to same-class segments in other regions. */
  spillover: unit,
  /** Fraction a segment without a persona drifts toward its region/class neighbours each year. */
  drift: unit,
  /** Starting trust/charisma are clamped into these bands. */
  trustBand: z.tuple([unit, unit]),
  charismaBand: z.tuple([unit, unit]),
});

export const ScenarioSchema = z
  .object({
    meta: z.object({
      id: IdSchema,
      name: z.string(),
      era: z.string(),
      country: z.string(),
      blurb: z.string(),
    }),
    map: z.object({
      viewBox: z.string().regex(/^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/),
      regions: z.array(RegionSchema).min(2),
    }),
    classes: z.array(SocialClassSchema).min(1),
    ages: z.array(AgeGroupSchema).min(1),
    issues: z.array(IssueSchema).min(2),
    segments: z.array(SegmentSchema).min(2),
    electoralSystem: z.enum(["fptp-regions", "proportional"]),
    events: z.object({
      /** Era/country flavor injected into the director prompt. */
      flavor: z.string(),
      templates: z.array(EventTemplateSchema).min(3),
    }),
    backgrounds: z.array(BackgroundSchema).min(1),
    start: z.object({
      economy: z.string(),
      mood: z.string(),
      headlines: z.array(z.object({ headline: z.string(), description: z.string() })).min(1),
    }),
    tuning: TuningSchema.partial().default({}),
  })
  .superRefine((s, ctx) => {
    const issueIds = new Set(s.issues.map((i) => i.id));
    const regionIds = new Set(s.map.regions.map((r) => r.id));
    const classIds = new Set(s.classes.map((c) => c.id));
    const ageIds = new Set(s.ages.map((a) => a.id));
    const issue = (msg: string) => ctx.addIssue({ code: "custom", message: msg });
    const near = (x: number, y: number) => Math.abs(x - y) < 1e-3;
    for (const age of s.ages) if (age.min > age.max) issue(`age ${age.id}: min exceeds max`);
    for (const band of [s.tuning.trustBand, s.tuning.charismaBand]) {
      if (band && band[0] > band[1]) issue("tuning bands must be ascending");
    }
    const risks = s.tuning.corruptionRisk;
    if (risks && (risks.small > risks.medium || risks.medium > risks.big)) issue("corruption risk must grow with size");
    for (const segment of s.segments) if (regionIds.has(segment.id)) issue(`segment id overlaps region ${segment.id}`);

    for (const [name, list] of [
      ["issue", s.issues],
      ["region", s.map.regions],
      ["class", s.classes],
      ["age", s.ages],
      ["segment", s.segments],
      ["event template", s.events.templates],
      ["background", s.backgrounds],
    ] as const) {
      const ids = list.map((x) => ("id" in x ? x.id : ""));
      if (new Set(ids).size !== ids.length) issue(`duplicate ${name} id`);
    }

    const regionShare = s.map.regions.reduce((sum, r) => sum + r.share, 0);
    if (!near(regionShare, 1)) issue(`region shares sum to ${regionShare}, expected 1`);
    const segmentShare = s.segments.reduce((sum, g) => sum + g.share, 0);
    if (!near(segmentShare, 1)) issue(`segment shares sum to ${segmentShare}, expected 1`);

    for (const r of s.map.regions) {
      const sum = s.segments.filter((g) => g.regionId === r.id).reduce((acc, g) => acc + g.share, 0);
      if (!near(sum, r.share)) issue(`segments of region ${r.id} sum to ${sum}, expected ${r.share}`);
    }

    const checkIssueKeys = (where: string, values: Record<string, number>, complete: boolean) => {
      for (const k of Object.keys(values)) if (!issueIds.has(k)) issue(`${where}: unknown issue ${k}`);
      if (complete) for (const k of issueIds) if (!(k in values)) issue(`${where}: missing issue ${k}`);
    };

    for (const g of s.segments) {
      if (!regionIds.has(g.regionId)) issue(`segment ${g.id}: unknown region ${g.regionId}`);
      if (!classIds.has(g.classId)) issue(`segment ${g.id}: unknown class ${g.classId}`);
      if (!ageIds.has(g.ageId)) issue(`segment ${g.id}: unknown age ${g.ageId}`);
      checkIssueKeys(`segment ${g.id} positions`, g.positions, true);
      checkIssueKeys(`segment ${g.id} salience`, g.salience, true);
      if (Object.values(g.positions).some((v) => !signed.safeParse(v).success)) {
        issue(`segment ${g.id}: positions must be in -1..1`);
      }
      const sal = Object.values(g.salience);
      if (sal.some((v) => v < 0)) issue(`segment ${g.id}: negative salience`);
      const salSum = sal.reduce((a, b) => a + b, 0);
      if (!near(salSum, 1)) issue(`segment ${g.id}: salience sums to ${salSum}, expected 1`);
    }

    for (const t of s.events.templates) {
      if (t.target.minUrban > t.target.maxUrban) issue(`event ${t.id}: minUrban exceeds maxUrban`);
      if (!t.target.national && !s.map.regions.some((region) =>
        (t.target.regions.length === 0 || t.target.regions.includes(region.id)) &&
        region.urban >= t.target.minUrban && region.urban <= t.target.maxUrban)) issue(`event ${t.id}: no eligible region`);
      checkIssueKeys(`event ${t.id} salience`, t.impacts.salience, false);
      checkIssueKeys(`event ${t.id} positions`, t.impacts.positions, false);
      for (const r of t.target.regions) if (!regionIds.has(r)) issue(`event ${t.id}: unknown region ${r}`);
    }

    for (const b of s.backgrounds) {
      for (const m of b.modifiers.affinity) {
        for (const c of m.classIds) if (!classIds.has(c)) issue(`background ${b.id}: unknown class ${c}`);
        for (const a of m.ageIds) if (!ageIds.has(a)) issue(`background ${b.id}: unknown age ${a}`);
        for (const r of m.regionIds) if (!regionIds.has(r)) issue(`background ${b.id}: unknown region ${r}`);
      }
    }
  });

/** Authoring shape (defaults optional). */
export type ScenarioInput = z.input<typeof ScenarioSchema>;
/** Parsed scenario with defaults applied. */
export type Scenario = z.output<typeof ScenarioSchema>;
export type Tuning = z.output<typeof TuningSchema>;
export type Issue = z.output<typeof IssueSchema>;
export type Region = z.output<typeof RegionSchema>;
export type SocialClass = z.output<typeof SocialClassSchema>;
export type AgeGroup = z.output<typeof AgeGroupSchema>;
export type Segment = z.output<typeof SegmentSchema>;
export type EventTemplate = z.output<typeof EventTemplateSchema>;
export type Background = z.output<typeof BackgroundSchema>;
export type ElectoralSystem = Scenario["electoralSystem"];
