# @pb/model-api

Small Hono service that serves the game's model (Luna 6, codex slug `gpt-6-luna`) by running `codex exec` once per request. The game server only talks HTTP to it.

**Requirement:** the `codex` CLI must be installed on the host and logged in (`codex login`) as the same user that runs this service. Without a login every request fails with 502 and codex's 401 output in `detail`.

## API

```
POST /v1/generate
Authorization: Bearer <MODEL_API_TOKEN>
{ task, system, prompt, schema, timeoutMs? }
-> 200 { output, latencyMs }
-> 400 bad body / invalid schema | 401 bad token | 422 output failed schema or unparsable
-> 502 codex exited non-zero | 503 queue full | 504 timeout

GET /health -> { ok: true, running, queued }
```

`schema` is a JSON Schema object (zod's `z.toJSONSchema` output works; the top-level `$schema` key is stripped). It is passed to codex as `--output-schema`, which for OpenAI models expects `additionalProperties: false` and every property listed in `required`. The output is also validated with Ajv here. `timeoutMs` is a deadline from request arrival (queue wait counts), clamped to `[1000, MODEL_API_MAX_TIMEOUT_MS]`.

## Environment

| Var | Default | |
|---|---|---|
| `MODEL_API_TOKEN` | required | bearer token |
| `PORT` | 8787 | |
| `CODEX_BIN` | `codex` | path to the codex binary |
| `CODEX_MODEL` | `gpt-6-luna` | |
| `CODEX_REASONING_EFFORT` | `low` | `model_reasoning_effort` |
| `CODEX_IGNORE_USER_CONFIG` | true | pass `--ignore-user-config` (auth still works) |
| `MODEL_API_CONCURRENCY` | 4 | parallel codex processes |
| `MODEL_API_QUEUE` | 16 | waiting requests before 503 |
| `MODEL_API_DEFAULT_TIMEOUT_MS` | 30000 | |
| `MODEL_API_MAX_TIMEOUT_MS` | 120000 | |
| `MODEL_API_LOG_PROMPTS` | false | log system and prompt text |

## Run

```sh
MODEL_API_TOKEN=secret pnpm --filter @pb/model-api start
```

Tests (use a fake codex, no network): `pnpm --filter @pb/model-api test`.

## Measure latency

With the service running:

```sh
MODEL_API_TOKEN=secret pnpm --filter @pb/model-api measure 10
```

Sends a small focus-group request N times (default 5) and prints per-call wall time plus min/median/mean/max. `MODEL_API_URL` overrides the target (default `http://localhost:8787`).
