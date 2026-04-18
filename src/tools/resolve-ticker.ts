import { z } from "zod";
import { resolveTickerFromName } from "../data/edgar.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";

const inputSchema = {
  company_name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Company name or partial name, e.g. "Apple", "Berkshire Hathaway", "JP Morgan"',
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of matches to return (default 5)"),
};

const outputSchema = {
  matches: z.array(
    z.object({
      ticker: z.string(),
      cik: z.string(),
      company_name: z.string(),
      match_type: z.enum(["exact", "starts_with", "contains"]),
    }),
  ),
  query: z.string(),
  total: z.number(),
};

export const resolveTickerTool: McpTool<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "resolve_ticker",
  config: {
    title: "Resolve Company Name to Ticker",
    description:
      "Searches SEC EDGAR's company registry to find ticker symbols matching a company name or partial name. " +
      "Returns up to 20 matches ranked by match quality (exact → starts_with → contains). " +
      "Use this when you have a company name but need the ticker before calling get_facts. " +
      "Latency: under 3 seconds.",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "fast",
      pricing: { executeUsd: "0.001" },
    },
  },
  handler: async (args, _extra) => {
    try {
      const matches = await withTimeout(
        resolveTickerFromName(args.company_name, args.max_results ?? 5),
        8_000,
      );
      const result = {
        matches,
        query: args.company_name,
        total: matches.length,
      };
      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult = { matches: [], query: args.company_name, total: 0 };
      return {
        structuredContent: errorResult as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
