import { z } from "zod";
import { resolveCikFromTicker } from "../data/edgar.ts";
import { compareConceptPeriods } from "../lib/orchestrator.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { ComparePeriodsOutput } from "../types.ts";

const periodPoint = z.object({
  period_label:     z.string(),
  end_date:         z.string(),
  value_normalized: z.number(),
  unit:             z.string(),
  filing_type:      z.string(),
  filed_date:       z.string(),
}).nullable();

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"MSFT\""),
  concept: z
    .string().min(1)
    .describe(
      "XBRL concept URI or natural language label, e.g. \"revenue\", \"us-gaap/Revenues\", \"net income\".",
    ),
  period_a: z
    .string().min(1)
    .describe(
      "Earlier period label to compare from, e.g. \"FY2020\", \"Q1 FY2022\". " +
      "Must match a period_label returned by get_facts.",
    ),
  period_b: z
    .string().min(1)
    .describe(
      "Later period label to compare to, e.g. \"FY2024\", \"Q1 FY2024\". " +
      "Must match a period_label returned by get_facts.",
    ),
};

const outputSchema = {
  ticker:                  z.string(),
  cik:                     z.string(),
  concept:                 z.string(),
  label:                   z.string(),
  period_a:                periodPoint,
  period_b:                periodPoint,
  growth_percent:          z.number().nullable(),
  cagr_percent:            z.number().nullable(),
  years_between:           z.number().nullable(),
  freshness_as_of:         z.string(),
  concept_aliases_checked: z.array(z.string()),
};

export const comparePeriodsTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "compare_periods",
  config: {
    title: "Compare Two Periods for a Financial Concept",
    description:
      "Given a ticker and a financial concept (e.g. \"revenue\", \"operating income\"), returns the values at two " +
      "specific period labels and computes total growth % and CAGR between them. " +
      "Period labels must be exact (e.g. \"FY2020\", \"Q3 FY2022\") — use get_facts first to see available labels. " +
      "Returns null for growth/CAGR when a period is not found or the base value is zero. " +
      "Latency: under 8 seconds.",
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
      const cik = await resolveCikFromTicker(ticker);

      const result: ComparePeriodsOutput = await withTimeout(
        compareConceptPeriods(cik, ticker, args.concept, args.period_a, args.period_b),
        22_000,
      );

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: ComparePeriodsOutput = {
        ticker: args.ticker, cik: "", concept: args.concept, label: args.concept,
        period_a: null, period_b: null,
        growth_percent: null, cagr_percent: null, years_between: null,
        freshness_as_of: new Date().toISOString(),
        concept_aliases_checked: [],
      };
      return {
        structuredContent: errorResult as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
