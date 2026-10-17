// Usage: MODEL_API_TOKEN=... [MODEL_API_URL=http://localhost:8787] tsx scripts/measure.ts [runs=5]
const url = process.env.MODEL_API_URL ?? "http://localhost:8787";
const token = process.env.MODEL_API_TOKEN;
const runs = Number(process.argv[2] ?? 5);
if (!token) throw new Error("MODEL_API_TOKEN is required");

const body = {
  task: "measure-focus-group",
  system: "You simulate a focus group of voters reacting to a politician's campaign move.",
  prompt:
    "Year 2. The candidate promises to cut fuel taxes and attacks the incumbent for the housing crisis. " +
    "Give the overall mood and two short quotes from different voters.",
  schema: {
    type: "object",
    properties: {
      mood: { type: "string", enum: ["hostile", "skeptical", "neutral", "warm", "enthusiastic"] },
      quotes: {
        type: "array",
        items: {
          type: "object",
          properties: { voter: { type: "string" }, quote: { type: "string" } },
          required: ["voter", "quote"],
          additionalProperties: false,
        },
      },
    },
    required: ["mood", "quotes"],
    additionalProperties: false,
  },
};

const wall: number[] = [];
for (let i = 1; i <= runs; i++) {
  const start = Date.now();
  const res = await fetch(`${url}/v1/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - start;
  const json: unknown = await res.json();
  console.log(`#${i} status=${res.status} wall=${elapsed}ms`, res.ok ? "" : JSON.stringify(json));
  if (res.ok) wall.push(elapsed);
}

if (wall.length > 0) {
  const sorted = [...wall].sort((a, b) => a - b);
  const mean = Math.round(wall.reduce((a, b) => a + b, 0) / wall.length);
  console.log(
    `ok=${wall.length}/${runs} min=${sorted[0]}ms median=${sorted[Math.floor(sorted.length / 2)]}ms ` +
      `mean=${mean}ms max=${sorted[sorted.length - 1]}ms`,
  );
}
