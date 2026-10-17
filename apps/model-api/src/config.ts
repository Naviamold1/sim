import { z } from "zod";

const flag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      const v = value?.trim().toLowerCase();
      if (v === undefined || v === "") return fallback;
      if (["1", "true", "yes", "on"].includes(v)) return true;
      if (["0", "false", "no", "off"].includes(v)) return false;
      ctx.addIssue({ code: "custom", message: `expected a boolean, got "${value}"` });
      return z.NEVER;
    });

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const ConfigSchema = z.object({
  PORT: int(8787),
  MODEL_API_TOKEN: z.string().min(1, "is required"),
  CODEX_BIN: z.string().min(1).default("codex"),
  CODEX_MODEL: z.string().min(1).default("gpt-6-luna"),
  CODEX_REASONING_EFFORT: z.string().min(1).default("low"),
  CODEX_IGNORE_USER_CONFIG: flag(true),
  MODEL_API_CONCURRENCY: int(4),
  MODEL_API_QUEUE: z.coerce.number().int().nonnegative().default(16),
  MODEL_API_DEFAULT_TIMEOUT_MS: int(30_000),
  MODEL_API_MAX_TIMEOUT_MS: int(120_000),
  MODEL_API_LOG_PROMPTS: flag(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid model-api configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
