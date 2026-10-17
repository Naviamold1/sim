import { AiError, type AiProvider } from "./provider";

/** A provider that is always unavailable, so every call runs its deterministic fallback. For tests and outages. */
export const fallbackProvider: AiProvider = {
  run: () => Promise.reject(new AiError("fallback provider", "unavailable")),
};
