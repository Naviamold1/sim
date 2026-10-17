import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { compileSchema, createCodexRunner } from "../src/codex";
import { loadConfig, type Config } from "../src/config";

const TOKEN = "test-token";
const FAKE_CODEX = resolve(import.meta.dirname, "fixtures/fake-codex.mjs");
const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "model-api-test-"));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function setup(mode: string, overrides: Record<string, string> = {}) {
  const env = {
    ...process.env,
    FAKE_CODEX_MODE: mode,
    FAKE_CODEX_PID_FILE: join(scratch, "pid"),
    FAKE_CODEX_RECORD: join(scratch, "record.json"),
  };
  const config: Config = loadConfig({
    MODEL_API_TOKEN: TOKEN,
    CODEX_BIN: FAKE_CODEX,
    ...overrides,
  });
  const runner = createCodexRunner(config, env);
  const app = createApp({ config, runner, log: () => {} });
  const generate = (body: unknown = {}, token: string | null = TOKEN) =>
    app.request("/v1/generate", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ task: "t", system: "be brief", prompt: "say hello", schema: SCHEMA, ...(body as object) }),
    });
  return { app, runner, generate };
}

const record = () => JSON.parse(readFileSync(join(scratch, "record.json"), "utf8"));
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux" && /State:\s+Z/.test(readFileSync(`/proc/${pid}/status`, "utf8"))) return false;
    return true;
  } catch {
    return false;
  }
};
async function waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return cond();
}

describe("POST /v1/generate", () => {
  it("returns schema-valid output and passes the expected codex args and stdin", async () => {
    const { generate } = setup("ok");
    const res = await generate();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { output: unknown; latencyMs: number };
    expect(json.output).toEqual({ answer: "hello" });
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);

    const rec = record();
    expect(rec.argv).toEqual(
      expect.arrayContaining(["exec", "-m", "gpt-6-luna", "-s", "read-only", "--ephemeral", "--ignore-user-config"]),
    );
    expect(rec.argv).toContain('model_reasoning_effort="low"');
    expect(rec.stdin).toContain("be brief");
    expect(rec.stdin).toContain("say hello");
    expect(rec.schema.$schema).toBeUndefined();
    expect(rec.schema.required).toEqual(["answer"]);
  });

  it("omits --ignore-user-config when disabled", async () => {
    const { generate } = setup("ok", { CODEX_IGNORE_USER_CONFIG: "0" });
    await generate();
    expect(record().argv).not.toContain("--ignore-user-config");
  });

  it("cleans up its temp dir", async () => {
    const { generate } = setup("ok");
    expect((await generate()).status).toBe(200);
    expect(existsSync(record().cwd)).toBe(false);
  });

  it("returns 422 when the output fails the schema", async () => {
    const res = await setup("invalid").generate();
    expect(res.status).toBe(422);
  });

  it("returns 422 when the output is not JSON", async () => {
    const res = await setup("badjson").generate();
    expect(res.status).toBe(422);
  });

  it("returns 502 when codex exits non-zero and surfaces stderr", async () => {
    const res = await setup("fail").generate();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain("not logged in");
  });

  it("returns 502 when the codex binary does not exist", async () => {
    const res = await setup("ok", { CODEX_BIN: join(scratch, "missing") }).generate();
    expect(res.status).toBe(502);
  });

  it("returns 504 on timeout, kills the process and removes the temp dir", async () => {
    const { generate } = setup("sleep");
    const res = await generate({ timeoutMs: 1000 });
    expect(res.status).toBe(504);

    const pid = Number(readFileSync(join(scratch, "pid"), "utf8"));
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
    expect(await waitFor(() => !existsSync(record().cwd))).toBe(true);
  });

  it("returns 503 immediately when the queue is full and 504 for queued requests that time out", async () => {
    const { app, generate } = setup("sleep", { MODEL_API_CONCURRENCY: "1", MODEL_API_QUEUE: "1" });
    const running = generate({ timeoutMs: 1500 });
    await waitFor(() => existsSync(join(scratch, "pid")));
    const queued = generate({ timeoutMs: 1500 });
    await waitFor(() => false, 100);

    const health = await (await app.request("/health")).json();
    expect(health).toEqual({ ok: true, running: 1, queued: 1 });

    const started = Date.now();
    const rejected = await generate();
    expect(rejected.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(500);

    expect((await running).status).toBe(504);
    expect((await queued).status).toBe(504);
    // the slot frees once the killed process has actually exited
    await expect
      .poll(async () => (await app.request("/health")).json())
      .toEqual({ ok: true, running: 0, queued: 0 });
  });

  it("kills the entire process group on deadline and releases its slot", async () => {
    const { app, generate } = setup("sleep-tree", { MODEL_API_CONCURRENCY: "1" });
    expect((await generate({ timeoutMs: 1000 })).status).toBe(504);
    const parentPid = Number(readFileSync(join(scratch, "pid"), "utf8"));
    const childPid = Number(readFileSync(join(scratch, "pid.child"), "utf8"));
    expect(await waitFor(() => !isAlive(parentPid) && !isAlive(childPid))).toBe(true);
    await expect.poll(async () => (await app.request("/health")).json())
      .toEqual({ ok: true, running: 0, queued: 0 });
    expect(existsSync(record().cwd)).toBe(false);
  });

  it("caps the caller's deadline at the configured maximum", async () => {
    const { generate } = setup("sleep", { MODEL_API_MAX_TIMEOUT_MS: "200" });
    const startedAt = Date.now();
    const res = await generate({ timeoutMs: 60_000 });
    expect(res.status).toBe(504);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    const pid = Number(readFileSync(join(scratch, "pid"), "utf8"));
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
    expect(await waitFor(() => !existsSync(record().cwd))).toBe(true);
  });

  it("returns 401 for a missing or wrong token", async () => {
    const { generate } = setup("ok");
    expect((await generate({}, null)).status).toBe(401);
    expect((await generate({}, "nope")).status).toBe(401);
    expect((await generate({}, "")).status).toBe(401);
    expect(existsSync(join(scratch, "record.json"))).toBe(false);
  });

  it("authenticates before reading or validating the body", async () => {
    const { app } = setup("ok");
    const res = await app.request("/v1/generate", {
      method: "POST",
      headers: { authorization: `Basic ${TOKEN}` },
      body: "{",
    });
    expect(res.status).toBe(401);
    expect(existsSync(join(scratch, "record.json"))).toBe(false);
  });

  it("rejects oversized bodies without spawning codex", async () => {
    const { generate } = setup("ok");
    expect((await generate({ prompt: "x".repeat(1024 * 1024) })).status).toBe(413);
    expect(existsSync(join(scratch, "record.json"))).toBe(false);
  });

  it("does not spawn for an already-aborted request", async () => {
    const { runner } = setup("ok");
    const abort = new AbortController();
    abort.abort();
    await expect(runner.run({
      system: "be brief", prompt: "hello", schema: SCHEMA, validate: compileSchema(SCHEMA),
    }, abort.signal)).rejects.toThrow();
    expect(existsSync(join(scratch, "record.json"))).toBe(false);
  });

  it("returns 400 for a bad body", async () => {
    const { generate, app } = setup("ok");
    expect((await generate({ prompt: "" })).status).toBe(400);
    expect((await generate({ prompt: " \n " })).status).toBe(400);
    expect((await generate({ system: " " })).status).toBe(400);
    expect((await generate({ task: " " })).status).toBe(400);
    expect((await generate({ task: "x".repeat(129) })).status).toBe(400);
    expect((await generate({ schema: "nope" })).status).toBe(400);
    expect((await generate({ timeoutMs: -5 })).status).toBe(400);
    expect((await generate({ timeoutMs: 1.5 })).status).toBe(400);
    expect((await generate({ timeoutMs: "1000" })).status).toBe(400);
    expect((await generate({ schema: { type: "not-a-type" } })).status).toBe(400);
    const notJson = await app.request("/v1/generate", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    for (const body of [null, [], 42, "hello"]) {
      const res = await app.request("/v1/generate", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    expect(existsSync(join(scratch, "record.json"))).toBe(false);
  });
});

describe("loadConfig", () => {
  it("requires a token and parses booleans", () => {
    expect(() => loadConfig({})).toThrow(/MODEL_API_TOKEN/);
    expect(loadConfig({ MODEL_API_TOKEN: "x", CODEX_IGNORE_USER_CONFIG: "false" }).CODEX_IGNORE_USER_CONFIG).toBe(false);
    expect(loadConfig({ MODEL_API_TOKEN: "x", MODEL_API_LOG_PROMPTS: "1" }).MODEL_API_LOG_PROMPTS).toBe(true);
    expect(loadConfig({ MODEL_API_TOKEN: "x" })).toMatchObject({ PORT: 8787, CODEX_MODEL: "gpt-6-luna" });
    expect(() => loadConfig({ MODEL_API_TOKEN: "x", PORT: "abc" })).toThrow(/PORT/);
  });
});
