import { mkdir, open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { AiCallRecord } from "@pb/ai";
import { gameIdSchema, nicknameSchema } from "../shared/protocol";

const headerSchema = z.object({ kind: z.literal("header"), version: z.literal(1), gameId: gameIdSchema, scenarioId: z.string(), seed: z.string(), nicknames: z.object({ a: nicknameSchema, b: nicknameSchema }) });
const promptSchema = z.object({ kind: z.literal("prompt"), side: z.enum(["a", "b"]), year: z.number().int().min(0).max(4), prompt: z.string().max(12000) });
const aiSchema = z.object({ kind: z.literal("ai"), record: z.object({ key: z.string(), task: z.enum(["buildProfile", "interpretTurn", "director", "focusGroup", "electionNarration"]), source: z.enum(["model", "fallback"]), latencyMs: z.number(), output: z.unknown() }) });
const endSchema = z.object({ kind: z.literal("end") });
const entrySchema = z.discriminatedUnion("kind", [headerSchema, promptSchema, aiSchema, endSchema]);
export type ReplayHeader = z.infer<typeof headerSchema>;
export interface ReplayData { header: ReplayHeader; outputs: ReadonlyMap<string, unknown>; prompts: ReadonlyMap<string, string> }

export class ReplayStore {
  readonly directory: string;
  constructor(directory = resolve(process.cwd(), ".politics-battle/replays")) { this.directory = resolve(directory); }

  async create(header: ReplayHeader): Promise<ReplayWriter> {
    gameIdSchema.parse(header.gameId);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const handle = await open(resolve(this.directory, `${header.gameId}.jsonl`), "wx", 0o600);
    const writer = new ReplayWriter(handle);
    writer.write(header);
    await writer.flush();
    return writer;
  }

  async load(gameId: string): Promise<ReplayData> {
    gameIdSchema.parse(gameId);
    const path = resolve(this.directory, `${gameId}.jsonl`);
    if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error("Replay exceeds size limit");
    const entries = (await readFile(path, "utf8")).trim().split("\n").map((line) => entrySchema.parse(JSON.parse(line) as unknown));
    const header = entries[0];
    if (header?.kind !== "header" || entries.at(-1)?.kind !== "end") throw new Error("Replay is incomplete");
    const outputs = new Map<string, unknown>();
    const prompts = new Map<string, string>();
    for (const entry of entries) {
      if (entry.kind === "ai") outputs.set(entry.record.key, entry.record.output);
      if (entry.kind === "prompt") prompts.set(`${entry.year}:${entry.side}`, entry.prompt);
    }
    return { header, outputs, prompts };
  }
}

export class ReplayWriter {
  private queue: Promise<unknown> = Promise.resolve();
  private failure: unknown;
  private closed = false;
  constructor(private readonly handle: Awaited<ReturnType<typeof open>>) {}
  write(entry: ReplayHeader | z.infer<typeof promptSchema> | z.infer<typeof endSchema> | { kind: "ai"; record: AiCallRecord }): void {
    if (this.closed) return;
    const line = `${JSON.stringify(entry)}\n`;
    this.queue = this.queue.then(() => this.handle.write(line)).catch((error: unknown) => { this.failure = error; });
  }
  async flush(): Promise<void> { await this.queue; if (this.failure) throw this.failure; }
  async close(complete = false): Promise<void> {
    if (this.closed) return;
    if (complete) this.write({ kind: "end" });
    this.closed = true;
    try { await this.flush(); await this.handle.sync(); } finally { await this.handle.close(); }
  }
}
