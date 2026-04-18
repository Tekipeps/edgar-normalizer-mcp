import { z } from "zod";
import { resolveCikFromTicker, pLimit } from "../data/edgar.ts";
import {
  normalizeConceptFacts,
  normalizeWithAliasResolution,
} from "../lib/orchestrator.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { BasketOutput, BasketRow } from "../types.ts";

const inputSchema = {
  tickers: z
    .array(z.string().min(1).max(10))
    .min(1)
    .max(20)
    .describe(
      'List of stock ticker symbols (max 20), e.g. ["AAPL", "MSFT", "GOOG"]',
    ),
  concept: z
    .string()
    .min(1)
    .describe(
      'XBRL concept URI (e.g. "us-gaap/Revenues") or natural language label (e.g. "revenue")',
    ),
  period: z
    .string()
    .min(1)
    .describe(
      'Exact period label to extract per company, e.g. "FY2023" or "Q3 FY2024"',
    ),
};

const outputSchema = {
  concept: z.string(),
  period: z.string(),
  rows: z.array(
    z.object({
      ticker: z.string(),
      cik: z.string(),
      concept: z.string(),
      period_label: z.string(),
      value_normalized: z.number().nullable(),
      unit: z.string().nullable(),
      filing_type: z.string().nullable(),
      filed_date: z.string().nullable(),
      is_amendment: z.boolean().nullable(),
      source_url: z.string().nullable(),
      isError: z.boolean(),
      error_message: z.string().optional(),
    }),
  ),
  freshness_as_of: z.string(),
  concept_aliases_checked: z.array(z.string()),
};

// Process tickers in batches of 5 (EDGAR rate limit: 10 req/s)
async function processBatch(
  tickers: string[],
  concept: string,
  period: string,
): Promise<BasketRow[]> {
  const rows: BasketRow[] = [];

  // Run up to 5 concurrently
  const tasks = tickers.map((ticker) => async (): Promise<BasketRow> => {
    const upper = ticker.toUpperCase();
    try {
      const cik = await resolveCikFromTicker(upper);
      const isUri = concept.includes("/");
      const result = isUri
        ? await withTimeout(
            normalizeConceptFacts(cik, upper, concept, period),
            12_000,
          )
        : await withTimeout(
            normalizeWithAliasResolution(cik, upper, concept, period),
            12_000,
          );

      const fact = result.facts[0] ?? null;
      return {
        ticker: upper,
        cik,
        concept: result.concept,
        period_label: fact?.period_label ?? period,
        value_normalized: fact?.value_normalized ?? null,
        unit: fact?.unit ?? null,
        filing_type: fact?.filing_type ?? null,
        filed_date: fact?.filed_date ?? null,
        is_amendment: fact?.is_amendment ?? null,
        source_url: fact?.source_url ?? null,
        isError: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ticker: upper,
        cik: "",
        concept,
        period_label: period,
        value_normalized: null,
        unit: null,
        filing_type: null,
        filed_date: null,
        is_amendment: null,
        source_url: null,
        isError: true,
        error_message: msg,
      };
    }
  });

  const settled = await pLimit(tasks, 5);
  for (const r of settled) {
    if (r.status === "fulfilled") rows.push(r.value);
  }

  return rows;
}

export const getFactsBasketTool: McpTool<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: "get_facts_basket",
  config: {
    title: "Get EDGAR Facts for a Basket of Tickers",
    description:
      "Returns one normalized financial fact row per company for a cross-sectional screen. " +
      "Accepts up to 20 US-listed tickers. Fetches from SEC EDGAR XBRL with concurrency limit to respect rate limits. " +
      "Latency: up to 25 seconds for 20 tickers. Per-ticker failures return error rows without failing the entire basket.",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: false,
      latencyClass: "slow",
      pricing: { executeUsd: "0.010" },
    },
  },
  handler: async (args, _extra) => {
    try {
      const freshness_as_of = new Date().toISOString();
      const rows = await withTimeout(
        processBatch(args.tickers, args.concept, args.period),
        27_000,
      );

      const allAliases = [
        ...new Set(rows.map((r) => r.concept).filter(Boolean)),
      ];

      const result: BasketOutput = {
        concept: args.concept,
        period: args.period,
        rows,
        freshness_as_of,
        concept_aliases_checked: allAliases,
      };

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: BasketOutput = {
        concept: args.concept,
        period: args.period,
        rows: [],
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
