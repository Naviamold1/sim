import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { Config } from "./config";

export type JsonObject = Record<string, unknown>;

export type GenerateInput = {
  system: string;
  prompt: string;
  schema: JsonObject;
  validate: ValidateFunction;
};

export type Runner = {
  run(input: GenerateInput, signal: AbortSignal): Promise<unknown>;
  killAll(): void;
};

/** "invalid_output" -> 422 (model answered badly), "codex_failed" -> 502 (codex itself failed). */
export class RunnerError extends Error {
  constructor(
    readonly kind: "invalid_output" | "codex_failed",
    message: string,
  ) {
    super(message);
  }
}

const PREAMBLE =
  "Respond only with the final JSON object matching the schema. Do not run commands or read files.";
const STDERR_TAIL_CHARS = 2000;
const errorFormatter = new Ajv2020();

/** zod's toJSONSchema adds a top-level $schema that Ajv's 2020 build may not know. */
export function withoutSchemaKey(schema: JsonObject): JsonObject {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

/** Throws if the schema is not a valid JSON Schema. */
export function compileSchema(schema: JsonObject): ValidateFunction {
  return new Ajv2020({ strict: false, allErrors: true }).compile(schema);
}

export function buildStdin({ system, prompt }: Pick<GenerateInput, "system" | "prompt">): string {
  return `${PREAMBLE}\n\n=== SYSTEM ===\n${system}\n\n=== PROMPT ===\n${prompt}\n`;
}

function killGroup(child: ChildProcess) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function createCodexRunner(config: Config, env: NodeJS.ProcessEnv = process.env): Runner {
  const children = new Set<ChildProcess>();

  const args = (): string[] => [
    "exec",
    "-m", config.CODEX_MODEL,
    "--output-schema", "schema.json",
    "-s", "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color", "never",
    "-o", "out.json",
    "-c", `model_reasoning_effort="${config.CODEX_REASONING_EFFORT}"`,
    ...(config.CODEX_IGNORE_USER_CONFIG ? ["--ignore-user-config"] : []),
  ];

  async function execute(dir: string, input: GenerateInput, signal: AbortSignal): Promise<unknown> {
    await writeFile(join(dir, "schema.json"), JSON.stringify(withoutSchemaKey(input.schema)));
    signal.throwIfAborted();

    const child = spawn(config.CODEX_BIN, args(), {
      cwd: dir,
      env,
      detached: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    children.add(child);

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    });
    child.stdin?.on("error", () => {}); // EPIPE if codex dies before reading stdin
    child.stdin?.end(buildStdin(input));

    const onAbort = () => killGroup(child);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

    try {
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, sig) => resolve({ code, signal: sig }));
        },
      );
      signal.throwIfAborted();
      if (exit.code !== 0) {
        const how = exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
        throw new RunnerError("codex_failed", `codex exited with ${how}: ${stderr.trim()}`);
      }
    } catch (err) {
      if (err instanceof RunnerError || signal.aborted) throw err;
      throw new RunnerError("codex_failed", `could not run ${config.CODEX_BIN}: ${String(err)}`);
    } finally {
      signal.removeEventListener("abort", onAbort);
      killGroup(child); // reap any stragglers from the process group
      children.delete(child);
    }

    let output: unknown;
    try {
      output = JSON.parse(await readFile(join(dir, "out.json"), "utf8"));
    } catch {
      throw new RunnerError("invalid_output", "codex produced no parsable JSON output");
    }
    if (!input.validate(output)) {
      const reason = errorFormatter.errorsText(input.validate.errors);
      throw new RunnerError("invalid_output", `output failed schema: ${reason}`);
    }
    signal.throwIfAborted();
    return output;
  }

  return {
    async run(input, signal) {
      signal.throwIfAborted();
      const dir = await mkdtemp(join(tmpdir(), "model-api-"));
      try {
        return await execute(dir, input, signal);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    killAll() {
      for (const child of children) killGroup(child);
    },
  };
}
