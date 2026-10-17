import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { compileSchema, RunnerError, withoutSchemaKey, type Runner } from "./codex";
import type { Config } from "./config";
import { DeadlineError, Pool, PoolFullError } from "./pool";

const MIN_TIMEOUT_MS = 1000;
const LOG_REASON_CHARS = 500;

const GenerateRequestSchema = z.object({
  task: z.string().trim().min(1).max(128),
  system: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  schema: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().positive().optional(),
});

export type AppDeps = {
  config: Config;
  runner: Runner;
  log?: (line: string) => void;
};

function tryCompile(schema: Record<string, unknown>) {
  try {
    return { ok: true as const, validate: compileSchema(schema) };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function tokenMatches(header: string | undefined, expected: string): boolean {
  const match = header?.match(/^Bearer (.+)$/);
  // Comparing fixed-length digests keeps the comparison constant-time regardless of input length.
  return match?.[1] !== undefined && timingSafeEqual(digest(match[1]), digest(expected));
}

export function createApp({ config, runner, log = console.log }: AppDeps) {
  const pool = new Pool(config.MODEL_API_CONCURRENCY, config.MODEL_API_QUEUE);
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, ...pool.stats }));

  app.use("/v1/generate", async (c, next) => {
    if (!tokenMatches(c.req.header("authorization"), config.MODEL_API_TOKEN)) {
      log("[model-api] task=- status=401");
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
  app.use("/v1/generate", bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: "request body too large" }, 413),
  }));

  app.post("/v1/generate", async (c) => {
    const startedAt = Date.now();
    let task = "-";
    let queueWaitMs = 0;

    const respond = (status: 400 | 401 | 422 | 502 | 503 | 504, error: string, reason?: string) => {
      const latencyMs = Date.now() - startedAt;
      const suffix = reason ? ` reason=${JSON.stringify(reason.slice(-LOG_REASON_CHARS))}` : "";
      log(`[model-api] task=${task} status=${status} latencyMs=${latencyMs} queueWaitMs=${queueWaitMs}${suffix}`);
      return c.json({ error, ...(reason ? { detail: reason } : {}) }, status);
    };

    const body = GenerateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return respond(400, "bad request", z.prettifyError(body.error));
    const req = body.data;
    task = JSON.stringify(req.task);

    const schema = withoutSchemaKey(req.schema);
    const compiled = tryCompile(schema);
    if (!compiled.ok) return respond(400, "invalid JSON schema", compiled.error);
    const validate = compiled.validate;

    if (config.MODEL_API_LOG_PROMPTS) log(`[model-api] task=${task} system=${req.system}\nprompt=${req.prompt}`);

    const timeoutMs = Math.min(
      Math.max(req.timeoutMs ?? config.MODEL_API_DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS),
      config.MODEL_API_MAX_TIMEOUT_MS,
    );

    try {
      const output = await pool.run((ctx) => {
        queueWaitMs = ctx.queueWaitMs;
        return runner.run({ system: req.system, prompt: req.prompt, schema, validate }, ctx.signal);
      }, startedAt + timeoutMs);

      const latencyMs = Date.now() - startedAt;
      log(`[model-api] task=${task} status=200 latencyMs=${latencyMs} queueWaitMs=${queueWaitMs}`);
      return c.json({ output, latencyMs });
    } catch (err) {
      if (err instanceof PoolFullError) return respond(503, "queue full");
      if (err instanceof DeadlineError) return respond(504, "timeout", `after ${timeoutMs}ms`);
      if (err instanceof RunnerError) {
        return err.kind === "invalid_output"
          ? respond(422, "model output failed schema", err.message)
          : respond(502, "codex failed", err.message);
      }
      return respond(502, "internal error", String(err));
    }
  });

  return app;
}
