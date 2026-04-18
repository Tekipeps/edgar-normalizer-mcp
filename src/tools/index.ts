import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpTool } from "../lib/tool-utils.ts";
export type { McpTool } from "../lib/tool-utils.ts";
export { withTimeout } from "../lib/tool-utils.ts";

// Tool imports
import { getFactsTool } from "./get-facts.ts";
import { getFactsBasketTool } from "./get-facts-basket.ts";
import { resolveConceptTool } from "./resolve-concept.ts";
import { getFilingMetadataTool } from "./get-filing-metadata.ts";
import { getSegmentFactsTool } from "./get-segment-facts.ts";
import { resolveTickerTool } from "./resolve-ticker.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: McpTool<any, any>[] = [
  getFactsTool,
  getFactsBasketTool,
  resolveConceptTool,
  resolveTickerTool,
  getFilingMetadataTool,
  getSegmentFactsTool,
];

export function registerAllTools(server: McpServer): void {
  for (const tool of tools) {
    server.registerTool(tool.name, tool.config, tool.handler);
  }
}
