import type { Scenario } from "@pb/scenarios";
import { issueLines, scenarioHeader, systemPrompt, untrusted, type Prompt } from "./common";

const MAX_PROMPT_CHARS = 4000;

export function buildProfilePrompt(scenario: Scenario, input: { nickname: string; prompt: string }): Prompt {
  const backgrounds = scenario.backgrounds.map((b) => `- ${b.id}: ${b.name} — ${b.description}`).join("\n");
  const prompt = `${scenarioHeader(scenario)}

Turn the player's self-description into a candidate profile.

Issues (positions run from -1 to +1):
${issueLines(scenario)}

Backgrounds (pick the id that fits best):
${backgrounds}

Player nickname: ${input.nickname}
Player description:
${untrusted(input.prompt, MAX_PROMPT_CHARS)}

Rules:
- name: the name the player gives, otherwise the nickname. party: the party they name, otherwise "Independent". ideology: 2-4 words.
- positions: only for issues the text states or clearly implies (strong explicit stances 0.6-0.9, mild 0.2-0.5); leave the other issues out.
- charisma and trust: 0.3-0.7 from the described style and track record; no superlatives push them higher than 0.7.
- strengths and weaknesses: up to 3 short phrases each. slogan: short, from the text if given.
- bio: 1-2 neutral public sentences. It must not reveal secrets or plans to cheat.`;
  return { system: systemPrompt("the candidate-profile builder"), prompt };
}
