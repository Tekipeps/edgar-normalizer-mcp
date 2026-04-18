import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { warmTickerCache, getTickerCacheLoadedAt } from "./data/edgar.ts";
import { registerAllTools } from "./tools/index.ts";

const START_TIME = Date.now();
const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
// const WEBSITE_API_KEY = process.env["WEBSITE_API_KEY"] ?? "";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "edgar-normalizer-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server);
  return server;
}

const app = express();
app.use(express.json());

// Health check — required by CTX
app.get("/health", (_req, res) => {
  res.json({
    status:           "ok",
    tool:             "edgar-normalizer-mcp",
    version:          "1.0.0",
    uptime:           Math.floor((Date.now() - START_TIME) / 1000),
    ticker_cache_at:  getTickerCacheLoadedAt(),
  });
});

// MCP endpoint
// TODO: uncomment createContextMiddleware() before CTX deployment
// import { createContextMiddleware } from "@ctxprotocol/sdk";
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => server.close());
  } catch (err) {
    console.error("[mcp] handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// CTX required 405s
app.get("/mcp",    (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use POST /mcp" }));
app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use POST /mcp" }));

// Survive unhandled EDGAR fetch rejections without crashing the server
process.on("unhandledRejection", (reason) => {
  console.warn("[edgar-normalizer-mcp] unhandled rejection:", reason);
});

// Pre-warm the ticker cache before accepting requests
warmTickerCache().then(() => {
  app.listen(PORT, () => {
    console.log(`edgar-normalizer-mcp running on http://localhost:${PORT}`);
  });
}).catch(() => {
  // Cache load failed — still start; it will lazy-load on first request
  app.listen(PORT, () => {
    console.warn(`edgar-normalizer-mcp running on http://localhost:${PORT} (ticker cache NOT loaded)`);
  });
});
