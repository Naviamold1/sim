import { z } from "zod";
import { AiError, withDeadline, type AiProvider } from "./provider";

export interface HttpModelProviderOptions {
  /** Base URL of apps/model-api, e.g. http://localhost:8787 */
  url: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

/** Calls POST /v1/generate with the zod schema converted via z.toJSONSchema, then re-validates with zod. */
export function createHttpModelProvider(options: HttpModelProviderOptions): AiProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  const url = `${options.url.replace(/\/+$/, "")}/v1/generate`;
  return {
    async run(task, request, schema) {
      try {
        return await withDeadline(request.timeoutMs, async (signal) => {
          const response = await fetcher(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token}` },
            signal,
            body: JSON.stringify({ task, system: request.system, prompt: request.prompt,
              schema: z.toJSONSchema(schema), timeoutMs: request.timeoutMs }),
          });
          if (!response.ok) {
            throw new AiError(`Model API status ${response.status}`,
              response.status === 504 ? "timeout" : response.status === 422 ? "invalid" : "unavailable");
          }
          const envelope = z.object({ output: z.unknown() }).parse(await response.json());
          return schema.parse(envelope.output);
        }, request.signal);
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          throw new AiError("Invalid model response", "invalid");
        }
        throw new AiError("Model API unavailable", "unavailable");
      }
    },
  };
}
