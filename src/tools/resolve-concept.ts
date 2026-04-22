import { z } from "zod";
import { resolveConceptForTicker } from "../lib/orchestrator.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import { factProvenanceSchema } from "./provenance-schema.ts";
import type { ConceptResolution } from "../types.ts";

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"NVDA\""),
  label: z
    .string().min(1).max(200)
    .describe("Natural language financial metric name, e.g. \"free cash flow\", \"revenue\", \"operating income\""),
};

const outputSchema = {
  found:              z.boolean(),
  concept_uri:        z.string().optional(),
  label:              z.string().optional(),
  confidence:         z.enum(["exact", "alias", "fallback"]).optional(),
  aliases_tried:      z.array(z.string()),
  periods_available:  z.number().optional(),
  sample_fact:        z.object({
    period_label:     z.string(),
    period_type:      z.enum(["instant", "duration"]),
    start_date:       z.string().nullable(),
    end_date:         z.string(),
    value:            z.number(),
    unit:             z.string(),
    scale:            z.number(),
    value_normalized: z.number(),
    filing_type:      z.string(),
    accession_number: z.string(),
    filed_date:       z.string(),
    is_amendment:     z.boolean(),
    provenance:       factProvenanceSchema,
    source_url:       z.string(),
  }).nullable().optional(),
  suggestions:        z.array(z.string()).optional(),
};

export const resolveConceptTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "resolve_concept",
  config: {
    title: "Resolve Natural Language Label to XBRL Concept",
    description:
      "Resolves a natural language financial metric name (e.g. \"revenue\", \"free cash flow\") to the best-matching " +
      "XBRL concept URI for a specific company, then returns the most recent fact value and the number of periods available. " +
      "Useful before calling get_facts to discover the right concept URI. " +
      "Returns suggestions when no match is found. Latency: under 8 seconds.",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "normal",
      pricing: { executeUsd: "0.002" },
    },
  },
  handler: async (args, _extra) => {
    try {
      const ticker = args.ticker.toUpperCase();
      const result: ConceptResolution = await withTimeout(
        resolveConceptForTicker(ticker, args.label),
        15_000,
      );

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: ConceptResolution = {
        found: false,
        aliases_tried: [],
        suggestions: [],
      };
      return {
        structuredContent: errorResult as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
