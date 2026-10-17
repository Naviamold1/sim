import type { Action, ActionKind, Channel, CorruptionSize, Side } from "./inputs";
import type { ElectoralSystem } from "@pb/scenarios";

/** Number of simulated years. Resolution `YEARS + 1` is the campaign finale that ends in the election. */
export const YEARS = 4;

/** issue id -> value */
export type IssueValues = Record<string, number>;
export type PerSide<T> = Record<Side, T>;

export interface CorruptionCase {
  id: string;
  size: CorruptionSize;
  /** Turn year in which the case was taken (the turn at the end of year N has year N). */
  yearTaken: number;
  exposed: boolean;
  yearExposed: number | null;
  description: string;
}

export interface PromiseRecord {
  year: number;
  issue: string;
  stance: number;
  description: string;
  broken: boolean;
}

export interface AppliedAction {
  kind: ActionKind;
  issue: string | null;
  stance: number | null;
  /** Resolved target: region id, segment id or "national". */
  target: string;
  channel: Channel | null;
  /** Intensity after budget/funds scaling. */
  intensity: number;
  requestedIntensity: number;
  cost: number;
  description: string;
  /** Covert (corruption). Only the owner may see it before exposure. */
  secret: boolean;
}

export interface DroppedAction {
  action: Action;
  reason: "budget" | "funds" | "invalid";
}

export interface TurnRecord {
  /** Turn year (the turn written at the end of year N). */
  year: number;
  submitted: boolean;
  summary: string;
  flipFlop: boolean;
  applied: AppliedAction[];
  dropped: DroppedAction[];
}

export interface Candidate {
  side: Side;
  nickname: string;
  name: string;
  party: string;
  ideology: string;
  /** Background id from the scenario. */
  background: string;
  bio: string;
  slogan: string;
  strengths: string[];
  weaknesses: string[];
  positions: IssueValues;
  trust: number;
  charisma: number;
  credibility: number;
  /** region id -> 0..1 */
  visibility: Record<string, number>;
  funds: number;
  promises: PromiseRecord[];
  history: TurnRecord[];
  corruptionCases: CorruptionCase[];
}

export interface SegmentState {
  id: string;
  positions: IssueValues;
  salience: IssueValues;
  engagement: number;
  affinity: PerSide<number>;
}

export interface AppliedEvent {
  id: string;
  year: number;
  kind: "template" | "custom" | "exposure";
  templateId: string | null;
  severity: number;
  /** Affected region ids. Empty = national. */
  regions: string[];
  headline: string;
  description: string;
  /** Candidate the event is about (exposures). */
  side: Side | null;
}

export interface Exposure {
  side: Side;
  caseId: string;
  size: CorruptionSize;
  yearTaken: number;
  description: string;
}

export interface WorldState {
  /** Global salience modifiers from events, added on top of segment salience. */
  salienceModifiers: IssueValues;
  /** template id -> times fired this game */
  templateUses: Record<string, number>;
  /** Every event so far, oldest first. */
  events: AppliedEvent[];
}

export interface PollResult {
  year: number;
  /** Share of decided voters, sums to 1. */
  national: PerSide<number>;
  /** Estimated turnout 0..1. */
  turnout: number;
  /** region id -> share of decided voters. */
  regions: Record<string, PerSide<number>>;
}

export type ContributionSource = "action" | "corruption" | "exposure" | "event" | "focusGroup" | "drift" | "noise";

/** One line of "why the poll moved". */
export interface Contribution {
  source: ContributionSource;
  /** Candidate whose action/scandal caused it, null for world effects. */
  side: Side | null;
  label: string;
  /** Change in expected national share, in percentage points. delta.b === -delta.a. */
  delta: PerSide<number>;
  /** Only visible to `side` (covert corruption effects). */
  secret: boolean;
}

export interface Quote {
  segmentId: string;
  regionId: string;
  /** e.g. "34, warehouse worker, Leeds" */
  persona: string;
  quote: string;
}

/** Result of the first half of a year: actions, exposures and events applied. */
export interface PendingYear {
  year: number;
  final: boolean;
  /** Candidate a's expected share (0..1) before anything this year was applied. */
  startShare: number;
  turns: PerSide<TurnRecord | null>;
  exposures: Exposure[];
  events: AppliedEvent[];
  breakdown: Contribution[];
}

export interface YearRecap extends PendingYear {
  quotes: Quote[];
  poll: PollResult;
}

export interface GameState {
  seed: string;
  scenarioId: string;
  /** Last resolved year. 0 after createGame, YEARS + 1 after the finale. */
  year: number;
  candidates: PerSide<Candidate>;
  segments: Record<string, SegmentState>;
  world: WorldState;
  polls: PollResult[];
  recaps: YearRecap[];
}

export interface Persona {
  /** = segment id */
  id: string;
  segmentId: string;
  regionId: string;
  classId: string;
  ageId: string;
  age: number;
  occupation: string;
  /** e.g. "34, warehouse worker, Leeds" */
  label: string;
  /** Full rendering for the focus group prompt: who they are, what they care about, what they face. */
  description: string;
  /** Plain-language current leaning, e.g. "leans towards Jane Doe" / "undecided, may not vote". */
  leaning: string;
}

export interface RegionResult {
  regionId: string;
  votes: PerSide<number>;
  eligible: number;
  turnout: number;
  winner: Side;
  seats: PerSide<number>;
}

export interface ElectionResult {
  system: ElectoralSystem;
  regions: RegionResult[];
  national: { votes: PerSide<number>; share: PerSide<number>; turnout: number };
  seats: PerSide<number>;
  winner: Side;
}
