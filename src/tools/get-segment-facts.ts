import { z } from "zod";
import { resolveCikFromTicker } from "../data/edgar.ts";
import { extractSegmentFacts } from "../lib/orchestrator.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { SegmentToolOutput } from "../types.ts";

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"AMZN\""),
  concept: z
    .string().min(1)
    .describe(
      "XBRL concept URI or natural language label to break out by segment. " +
      "Natural language labels (e.g. \"revenue\", \"net income\") are resolved via alias lookup before querying. " +
      "Explicit URIs (e.g. \"us-gaap/Revenues\") also work and will fall back to aliases if the exact tag is not found.",
    ),
  segment_dimension: z
    .string().min(1)
    .describe(
      "XBRL axis dimension name, e.g. \"ProductOrServiceAxis\", \"StatementBusinessSegmentsAxis\", \"GeographicAreasAxis\". " +
      "Only companies that explicitly tag segment data in XBRL will return results.",
    ),
};

const outputSchema = {
  ticker:                  z.string(),
  cik:                     z.string(),
  concept:                 z.string(),
  label:                   z.string(),
  segments_available:      z.boolean(),
  message:                 z.string().optional(),
  facts:                   z.array(z.object({
    period_label:      z.string(),
    period_type:       z.enum(["instant", "duration"]),
    start_date:        z.string().nullable(),
    end_date:          z.string(),
    value:             z.number(),
    unit:              z.string(),
    scale:             z.number(),
    value_normalized:  z.number(),
    filing_type:       z.string(),
    accession_number:  z.string(),
    filed_date:        z.string(),
    is_amendment:      z.boolean(),
    source_url:        z.string(),
    segment_dimension: z.string(),
    segment_member:    z.string(),
  })),
  freshness_as_of:         z.string(),
  concept_aliases_checked: z.array(z.string()),
};

export const getSegmentFactsTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "get_segment_facts",
  config: {
    title: "Get EDGAR XBRL Segment Financial Facts",
    description:
      "Returns a financial concept broken out by reported XBRL segment dimension (e.g. business segment, geography, product line). " +
      "Only covers companies that explicitly tag segment data in their XBRL filings. " +
      "Returns segments_available=false with an explanation when segment data is unavailable via the EDGAR REST API. " +
      "Common axes: ProductOrServiceAxis, StatementBusinessSegmentsAxis, GeographicAreasAxis. " +
      "Latency: under 6 seconds.",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.003" },
    },
  },
  handler: async (args, _extra) => {
    try {
      const ticker = args.ticker.toUpperCase();
      const cik = await resolveCikFromTicker(ticker);

      const result: SegmentToolOutput = await withTimeout(
        extractSegmentFacts(cik, ticker, args.concept, args.segment_dimension),
        15_000,
      );

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: SegmentToolOutput = {
        ticker: args.ticker, cik: "", concept: args.concept, label: args.concept,
        segments_available: false, facts: [],
        freshness_as_of: new Date().toISOString(),
        concept_aliases_checked: [],
        message: msg,
      };
      return {
        structuredContent: errorResult as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
