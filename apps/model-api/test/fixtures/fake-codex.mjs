#!/usr/bin/env node
// Stand-in for `codex exec`. Behaviour is chosen with FAKE_CODEX_MODE:
// ok | invalid | badjson | sleep | fail
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const flagValue = (flag) => argv[argv.indexOf(flag) + 1];
const outFile = flagValue("-o");
const schemaFile = flagValue("--output-schema");
const stdin = readFileSync(0, "utf8");

if (process.env.FAKE_CODEX_RECORD) {
  writeFileSync(
    process.env.FAKE_CODEX_RECORD,
    JSON.stringify({ argv, stdin, cwd: process.cwd(), schema: JSON.parse(readFileSync(schemaFile, "utf8")) }),
  );
}

switch (process.env.FAKE_CODEX_MODE ?? "ok") {
  case "ok":
    writeFileSync(outFile, JSON.stringify({ answer: "hello" }));
    break;
  case "invalid":
    writeFileSync(outFile, JSON.stringify({ answer: 42 }));
    break;
  case "badjson":
    writeFileSync(outFile, "not json {");
    break;
  case "fail":
    console.error("Error: not logged in");
    process.exit(3);
    break;
  case "sleep":
  case "sleep-tree":
    if (process.env.FAKE_CODEX_MODE === "sleep-tree") {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(`${process.env.FAKE_CODEX_PID_FILE}.child`, String(child.pid));
    }
    if (process.env.FAKE_CODEX_PID_FILE) writeFileSync(process.env.FAKE_CODEX_PID_FILE, String(process.pid));
    setInterval(() => {}, 1000);
    break;
}
