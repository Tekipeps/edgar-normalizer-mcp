import { z } from "zod";
import { resolveCikFromTicker } from "../data/edgar.ts";
import { discoverXbrlConcepts } from "../lib/orchestrator.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { XbrlConceptsOutput } from "../types.ts";

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"AAPL\""),
  namespace: z
    .string().optional()
    .describe(
      "Filter by XBRL namespace, e.g. \"us-gaap\", \"dei\", \"invest\". " +
      "Omit to return all namespaces.",
    ),
  search: z
    .string().optional()
    .describe(
      "Case-insensitive substring filter on concept tag name or label, e.g. \"revenue\", \"segment\", \"cash\".",
    ),
  min_periods: z
    .number().min(1).max(100).default(1)
    .describe("Only include concepts with at least this many distinct periods of data. Default 1."),
  segment_data_only: z
    .boolean().default(false)
    .describe(
      "If true, only return concepts that appear to have XBRL segment-level breakdowns " +
      "(multiple values reported per period, indicating dimensional tagging).",
    ),
};

const outputSchema = {
  ticker:       z.string(),
  cik:          z.string(),
  entity_name:  z.string(),
  concepts:     z.array(z.object({
    concept_uri:             z.string(),
    label:                   z.string(),
    namespace:               z.string(),
    tag:                     z.string(),
    unit:                    z.string(),
    periods_count:           z.number(),
    latest_period_end:       z.string(),
    latest_value_normalized: z.number(),
    has_segment_data:        z.boolean(),
  })),
  total_count:     z.number(),
  freshness_as_of: z.string(),
};

export const discoverXbrlConceptsTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "discover_xbrl_concepts",
  config: {
    title: "Discover XBRL Concepts Available for a Company",
    description:
      "Returns all XBRL concepts (financial line items) that a company has reported in EDGAR, " +
      "with period counts, latest values, and a flag for concepts with segment-level breakdowns. " +
      "Use this to explore what data is available before calling get_facts or get_segment_facts. " +
      "Filter by namespace (e.g. \"us-gaap\"), keyword search, minimum period count, or segment data only. " +
      "Results are sorted by period count descending (most data-rich first). " +
      "Latency: 5–10 seconds (fetches full company facts).",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.002" },
    },
  },
  handler: async (args, _extra) => {
    try {
      const ticker = args.ticker.toUpperCase();
      const cik = await resolveCikFromTicker(ticker);

      const result: XbrlConceptsOutput = await withTimeout(
        discoverXbrlConcepts(
          cik, ticker,
          args.namespace,
          args.search,
          args.min_periods ?? 1,
          args.segment_data_only ?? false,
        ),
        25_000,
      );

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: XbrlConceptsOutput = {
        ticker: args.ticker, cik: "", entity_name: "",
        concepts: [], total_count: 0,
        freshness_as_of: new Date().toISOString(),
      };
      return {
        structuredContent: errorResult as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
