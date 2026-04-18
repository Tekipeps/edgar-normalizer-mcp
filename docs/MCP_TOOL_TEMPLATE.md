# MCP Tool Project Template

A reference template derived from the BrandAvailabilityChecker project. Follow these patterns when creating a new CTX-compatible MCP tool.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Server | Express 5 |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.27 |
| CTX SDK | `@ctxprotocol/sdk` ^0.8 |
| Schema | Zod v3 |
| LLM Synthesis | Mercury 2 only (`mercury-2` via InceptionLabs API) |
| Database (optional) | Prisma + PostgreSQL |

---

## Directory Structure

```
my-mcp-tool/
├── src/
│   ├── index.ts                  # Server entry: MCP + Express setup
│   ├── types.ts                  # All TypeScript interfaces
│   ├── cli.ts                    # Local query CLI (for dev testing)
│   ├── tools/
│   │   ├── index.ts              # McpTool interface, tool registry, registerAllTools()
│   │   ├── my-tool.ts            # One file per tool — inputSchema, outputSchema, handler
│   │   └── another-tool.ts
│   ├── lib/
│   │   └── orchestrator.ts       # Main business logic orchestrator (phases)
│   ├── data/
│   │   └── source-a.ts           # One file per external data source
│   └── synthesis/
│       └── mercury.ts            # Mercury 2 LLM synthesis with json_schema output
├── prisma/                       # Optional — only if using a database
│   ├── schema.prisma
│   ├── index.ts                  # Prisma client singleton
│   └── migrations/
├── .env.example
├── .dockerignore
├── package.json
└── tsconfig.json
```

---

## `package.json`

```json
{
  "name": "my-mcp-tool",
  "version": "1.0.0",
  "description": "MCP tool: one-line description of what this tool does",
  "module": "src/index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "dev":      "bun run --watch src/index.ts",
    "start":    "bun run src/index.ts",
    "query":    "bun run src/cli.ts",
    "compile":  "bun build --compile --minify --target=bun src/index.ts --outfile=dist/server",
    "test":     "bun test",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "@ctxprotocol/sdk":            "^0.8.4",
    "@modelcontextprotocol/sdk":   "^1.27.1",
    "express":                     "^5.2.1",
    "zod":                         "^3.25.0"
  },
  "devDependencies": {
    "@types/bun":     "latest",
    "@types/express": "^5.0.0",
    "@types/node":    "^25.0.0"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  }
}
```

> Add `@prisma/client`, `pg`, `@prisma/adapter-pg` only if the tool uses a database.

---

## `.env.example`

```dotenv
PORT=3000
INCEPTION_API_KEY=your_inception_key_here
WEBSITE_API_KEY=your_website_api_key_here   # optional — only for website-facing API routes
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mydb  # optional
```

---

## `src/index.ts` — Server Entry

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { registerAllTools } from "./tools/index.ts";

const START_TIME = Date.now();
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const MY_API_KEY = process.env["MY_API_KEY"] ?? "";

// Fail fast — never start without required secrets
if (!MY_API_KEY) {
  console.error("ERROR: MY_API_KEY is required");
  process.exit(1);
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: "my-mcp-tool", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server);
  return server;
}

const app = express();
app.use(express.json());

// Health endpoint — required by CTX
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    tool: "my-mcp-tool",
    version: "1.0.0",
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
  });
});

// MCP endpoint — createContextMiddleware() handles RS256 JWT verification for paid tools
// Uncomment when deploying to CTX:  import { createContextMiddleware } from "@ctxprotocol/sdk";
app.post(
  "/mcp",
  // createContextMiddleware(),
  async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("finish", () => server.close());
    } catch (err) {
      console.error("MCP handler error:", err);
      if (!res.headersSent)
        res.status(500).json({ error: "Internal server error" });
    }
  },
);

// CTX checklist: these two 405s are required
app.get("/mcp",    (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use POST" }));
app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use POST" }));

app.listen(PORT, () =>
  console.log(`my-mcp-tool running on http://localhost:${PORT}`),
);
```

---

## `src/tools/index.ts` — Tool Registry

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { myTool } from "./my-tool.ts";
// import { anotherTool } from "./another-tool.ts";

// Shared interface — every tool file exports a value of this type
export interface McpTool<T extends z.ZodRawShape, U extends z.ZodRawShape> {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: T;
    outputSchema: U;
    _meta?: {
      surface?: "both" | "mcp" | "ctx";
      queryEligible?: boolean;
      latencyClass?: "fast" | "normal" | "slow";
      pricing?: {
        executeUsd?: string;
        queryUsd?: string;
      };
    };
  };
  handler: (
    args: z.infer<z.ZodObject<T>>,
    extra: unknown,
  ) => Promise<{
    structuredContent: Record<string, unknown>;
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>;
}

export const tools: McpTool<any, any>[] = [
  myTool,
  // anotherTool,
];

export function registerAllTools(server: McpServer) {
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.handler);
  }
}
```

---

## `src/tools/my-tool.ts` — Individual Tool

```typescript
import { z } from "zod";
import { runMyOrchestrator } from "../lib/orchestrator.ts";
import type { McpTool } from "./index.ts";

const MY_API_KEY = process.env["MY_API_KEY"] ?? "";

// ── Input schema ──────────────────────────────────────────────────────────────

const inputSchema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe("The primary input for this tool."),
  depth: z
    .enum(["quick", "standard", "deep"])
    .optional()
    .default("standard")
    .describe("Analysis depth: quick (~5s), standard (~15s), deep (~25s)."),
};

// ── Output schema — must mirror MyToolOutput in types.ts ─────────────────────

const outputSchema = {
  query:        z.string(),
  generated_at: z.string(),
  risk_score:   z.number(),
  summary:      z.string(),
  results:      z.array(
    z.object({
      id:     z.string(),
      value:  z.string(),
      status: z.string(),
    }),
  ),
  insights:   z.array(z.string()),
  next_steps: z.array(z.string()),
};

// ── Tool definition ───────────────────────────────────────────────────────────

export const myTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "my_tool_name",          // snake_case — used in MCP protocol
  config: {
    title: "My Tool Title",
    description:
      "One clear sentence describing what this tool does, what data sources it uses, and what it returns. Mention the cost model and what it replaces if applicable.",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",      // "fast" <5s | "normal" 5–15s | "slow" >15s
      pricing: {
        executeUsd: "0.010",     // set pricing before CTX submission
      },
    },
  },
  handler: async (args, _extra) => {
    // 28s timeout guard — CTX SLA is 30s
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Analysis timed out — please retry")),
        28_000,
      ),
    );

    try {
      if (!MY_API_KEY) throw new Error("MY_API_KEY is required");

      const result = await Promise.race([
        runMyOrchestrator(args, MY_API_KEY),
        timeoutPromise,
      ]);

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // structuredContent must always be returned — even on error
      return {
        structuredContent: {
          query:        args.query,
          generated_at: new Date().toISOString(),
          risk_score:   50,
          summary:      `Error: ${msg}`,
          results:      [],
          insights:     [],
          next_steps:   [],
        } as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
```

---

## `src/types.ts` — Shared Interfaces

```typescript
// ── Data layer types ───────────────────────────────────────────────────────────

export interface MyDataResult {
  id:     string;
  value:  string;
  status: "found" | "not_found" | "error";
}

// ── LLM synthesis output ───────────────────────────────────────────────────────

export interface MySynthesisResult {
  risk_score:  number;   // 0–100
  summary:     string;
  insights:    string[];
  next_steps:  string[];
}

// ── Tool input / output ────────────────────────────────────────────────────────

export interface MyToolInput {
  query: string;
  depth?: "quick" | "standard" | "deep";
}

export interface MyToolOutput {
  query:        string;
  generated_at: string;
  risk_score:   number;
  summary:      string;
  results:      MyDataResult[];
  insights:     string[];
  next_steps:   string[];
}
```

---

## `src/lib/orchestrator.ts` — Phased Orchestrator

```typescript
import { fetchSourceA } from "../data/source-a.ts";
import { synthesizeMercury } from "../synthesis/mercury.ts";
import type { MyToolInput, MyToolOutput } from "../types.ts";

export async function runMyOrchestrator(
  input: MyToolInput,
  apiKey: string,
): Promise<MyToolOutput> {
  const { query, depth = "standard" } = input;
  const dev = process.env["NODE_ENV"] !== "production";
  const t1 = Date.now();

  // ── Phase 1: Parallel data fetch ──────────────────────────────────────────
  const [sourceAResults] = await Promise.all([
    fetchSourceA(query, depth).then((r) => {
      if (dev) console.log(`  source-a: ${Date.now() - t1}ms`);
      return r;
    }),
    // add more sources here
  ]);
  if (dev) console.log(`Phase 1 — data fetch: ${Date.now() - t1}ms`);

  // ── Phase 2: LLM synthesis ────────────────────────────────────────────────
  const t2 = Date.now();
  const synthesis = await synthesizeMercury(query, sourceAResults, apiKey);
  if (dev) console.log(`Phase 2 — synthesis: ${Date.now() - t2}ms`);

  return {
    query,
    generated_at: new Date().toISOString(),
    risk_score:   synthesis.risk_score  ?? 0,
    summary:      synthesis.summary     ?? "",
    results:      sourceAResults,
    insights:     synthesis.insights    ?? [],
    next_steps:   synthesis.next_steps  ?? [],
  };
}
```

---

## `src/data/source-a.ts` — Data Source Pattern

```typescript
import type { MyDataResult } from "../types.ts";

const TIMEOUT_MS = 6_000;

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSourceA(
  query: string,
  depth: "quick" | "standard" | "deep" = "standard",
): Promise<MyDataResult[]> {
  const ITEM_SETS: Record<typeof depth, string[]> = {
    quick:    ["item1", "item2"],
    standard: ["item1", "item2", "item3"],
    deep:     ["item1", "item2", "item3", "item4", "item5"],
  };

  const items = ITEM_SETS[depth];

  const results = await Promise.allSettled(
    items.map((item) => checkItem(query, item)),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { id: items[i] ?? "", value: "", status: "error" };
  });
}

async function checkItem(query: string, item: string): Promise<MyDataResult> {
  const url = `https://api.example.com/check?q=${encodeURIComponent(query)}&item=${item}`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 404) {
      return { id: item, value: "", status: "not_found" };
    }
    if (res.ok) {
      const data = (await res.json()) as { value: string };
      return { id: item, value: data.value, status: "found" };
    }
    return { id: item, value: "", status: "error" };
  } catch {
    return { id: item, value: "", status: "error" };
  }
}
```

---

## `src/synthesis/mercury.ts` — Mercury 2 Synthesis

```typescript
import type { MyDataResult, MySynthesisResult } from "../types.ts";

const BASE_URL  = "https://api.inceptionlabs.ai/v1";
const MODEL     = "mercury-2";
const TIMEOUT_MS = 28_000;

export async function synthesizeMercury(
  query:   string,
  results: MyDataResult[],
  apiKey:  string,
): Promise<MySynthesisResult> {
  // Keep prompt payload lean — truncate if needed
  const dataPayload = JSON.stringify({ query, results }, null, 2).slice(0, 90_000);

  // Declare the exact JSON shape Mercury must return
  const responseSchema = {
    name: "MySynthesisResult",
    strict: true,
    schema: {
      type: "object",
      properties: {
        risk_score:  { type: "number" },
        summary:     { type: "string" },
        insights:    { type: "array", items: { type: "string" } },
        next_steps:  { type: "array", items: { type: "string" } },
      },
      required: ["risk_score", "summary", "insights", "next_steps"],
      additionalProperties: false,
    },
  };

  const systemPrompt = "You are an expert analyst. Analyze the provided data and return a structured risk assessment.";
  const userPrompt   = `Analyze this data for "${query}":\n\n${dataPayload}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens:      2048,
        temperature:     0.2,
        response_format: { type: "json_schema", json_schema: responseSchema },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Mercury API error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const text = data.choices[0]?.message?.content ?? "";

    try {
      return JSON.parse(text) as MySynthesisResult;
    } catch {
      throw new Error(`Mercury returned invalid JSON. Raw (first 500): ${text.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
```

---

## CTX Submission Checklist

Before submitting to CTX, verify each item:

- [ ] `outputSchema` declared in `registerTool` config
- [ ] `structuredContent` returned on both **success** and **error** paths
- [ ] `_meta.pricing.executeUsd` set to a non-zero string
- [ ] `createContextMiddleware()` uncommented on `POST /mcp`
- [ ] 28s timeout guard in every tool handler
- [ ] `GET /health` returns `{ status: "ok", ... }`
- [ ] `GET /mcp` returns 405
- [ ] `DELETE /mcp` returns 405
- [ ] Server deployed with an HTTPS endpoint

---

## Development Workflow

```bash
# Start dev server (port 3001 to avoid conflicts)
PORT=3001 MY_API_KEY=your_key bun run dev

# Test a query via CLI
PORT=3001 MY_API_KEY=your_key bun run query "test input" quick

# Health check
curl http://localhost:3001/health

# Type check
bun run typecheck

# Production build (single binary)
bun run compile
```

---

## Key Conventions

**Latency classes**
- `fast` — < 5s (no LLM, simple lookups)
- `normal` — 5–15s (parallel fetches, maybe light LLM)
- `slow` — > 15s (full LLM synthesis, deep data fetch)

**Depth tiers**
- `quick` — minimal data, fastest response
- `standard` — balanced default
- `deep` — maximum coverage, longest runtime

**Timeout strategy**
- External HTTP calls: 6–8s per request
- LLM synthesis: 28s
- Tool handler total: 28s (races against CTX's 30s SLA)

**Error handling**
- Always return `structuredContent` even on errors — CTX requires it
- Set `isError: true` in the return value when the tool fails
- Never throw from the handler — catch at the outermost level

**Environment variables**
- Access as `process.env["KEY"] ?? ""` — never destruct
- Validate required keys at startup with `process.exit(1)` on missing
- Never log secret values

**LLM model**
- Mercury 2 (`mercury-2`) exclusively — no Gemini, no other providers
- Always use `response_format: { type: "json_schema" }` for structured output
- Keep `temperature: 0.2` for deterministic analysis outputs
