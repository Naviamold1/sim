import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createCodexRunner } from "./codex";
import { loadConfig, type Config } from "./config";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const config = loadConfigOrExit();

const runner = createCodexRunner(config);
const app = createApp({ config, runner });
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(
    `[model-api] listening on :${info.port} model=${config.CODEX_MODEL} bin=${config.CODEX_BIN} ` +
      `concurrency=${config.MODEL_API_CONCURRENCY} queue=${config.MODEL_API_QUEUE}`,
  );
});

function shutdown(signal: string) {
  console.log(`[model-api] ${signal}: shutting down`);
  server.close();
  runner.killAll();
  setTimeout(() => process.exit(0), 200).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
