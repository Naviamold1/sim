import type {
  CandidateProfile,
  DirectorOutput,
  ElectionNarration,
  FocusGroupOutput,
  TurnInterpretation,
} from "@pb/sim";

/** Max lengths of model-written strings. */
export const LIMITS = {
  name: 40,
  party: 40,
  ideology: 60,
  slogan: 80,
  listItem: 60,
  bio: 300,
  summary: 200,
  actionDescription: 120,
  headline: 90,
  eventDescription: 280,
  quote: 220,
  story: 900,
} as const;

/** Collapses whitespace, trims, and cuts at `max` characters (ellipsis included), preferring a word boundary. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:.-]+$/, "")}…`;
}

/** Keeps the first entry per key. */
function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `fallbackName` replaces an empty name (the player's nickname). */
export function sanitizeProfile(profile: CandidateProfile, fallbackName: string): CandidateProfile {
  return {
    ...profile,
    name: clip(profile.name, LIMITS.name) || clip(fallbackName, LIMITS.name),
    party: clip(profile.party, LIMITS.party) || "Independent",
    ideology: clip(profile.ideology, LIMITS.ideology),
    positions: dedupeBy(profile.positions, (p) => p.issue),
    strengths: profile.strengths.map((s) => clip(s, LIMITS.listItem)).filter(Boolean),
    weaknesses: profile.weaknesses.map((s) => clip(s, LIMITS.listItem)).filter(Boolean),
    slogan: clip(profile.slogan, LIMITS.slogan),
    bio: clip(profile.bio, LIMITS.bio),
  };
}

export function sanitizeTurn(turn: TurnInterpretation): TurnInterpretation {
  return {
    ...turn,
    actions: turn.actions.map((a) => ({ ...a, description: clip(a.description, LIMITS.actionDescription) })),
    summary: turn.actions.some((action) => action.kind === "corruption")
      ? publicTurnSummary(turn)
      : clip(turn.summary, LIMITS.summary),
  };
}

export function publicTurnSummary(turn: TurnInterpretation): string {
  const kinds = [...new Set(turn.actions.filter((action) => action.kind !== "corruption").map((action) => action.kind))];
  return kinds.length > 0 ? `Campaign activity: ${kinds.join(", ")}.` : "No public campaign activity.";
}

export function sanitizeDirector(output: DirectorOutput): DirectorOutput {
  return {
    events: output.events.map((e) => ({
      ...e,
      headline: clip(e.headline, LIMITS.headline),
      description: clip(e.description, LIMITS.eventDescription),
    })),
    exposures: output.exposures.map((e) => ({
      ...e,
      headline: clip(e.headline, LIMITS.headline),
      description: clip(e.description, LIMITS.eventDescription),
    })),
  };
}

export function sanitizeFocusGroup(output: FocusGroupOutput): FocusGroupOutput {
  return {
    reactions: dedupeBy(output.reactions, (r) => r.personaId).map((r) => ({ ...r, quote: clip(r.quote, LIMITS.quote) })),
  };
}

export function sanitizeNarration(narration: ElectionNarration): ElectionNarration {
  return { headline: clip(narration.headline, LIMITS.headline), story: clip(narration.story, LIMITS.story) };
}
