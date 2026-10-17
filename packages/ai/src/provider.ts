import type { z } from "zod";

export type AiTask = "buildProfile" | "interpretTurn" | "director" | "focusGroup" | "electionNarration";

export interface AiRequest {
  system: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function withDeadline<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: (error: AiError) => void = () => {};
  const abort = () => {
    controller.abort();
    rejectDeadline(new AiError("AI deadline exceeded", "timeout"));
  };
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(abort, timeoutMs);
  });
  parent?.addEventListener("abort", abort, { once: true });
  try {
    if (parent?.aborted) abort();
    return await Promise.race([deadline, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new AiError("AI request aborted", "timeout");
      return work(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}

/** Transport to a model. Returns output validated against `schema` or throws. */
export interface AiProvider {
  run<T>(task: AiTask, request: AiRequest, schema: z.ZodType<T>): Promise<T>;
}

/** Thrown by providers when the model is unreachable, slow, or returns invalid output. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "timeout" | "invalid",
  ) {
    super(message);
    this.name = "AiError";
  }
}
