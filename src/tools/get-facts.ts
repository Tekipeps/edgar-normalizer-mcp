import { z } from "zod";
import { resolveCikFromTicker, fetchCompanyFacts, fetchSubmissions } from "../data/edgar.ts";
import { normalizeConceptFacts, normalizeWithAliasResolution } from "../lib/orchestrator.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { EdgarFact, ToolOutput } from "../types.ts";

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"AAPL\", \"MSFT\""),
  concepts: z
    .array(z.string().min(1)).min(1).max(10)
    .describe("XBRL concept URIs (e.g. \"us-gaap/Revenues\") or natural language labels (e.g. \"revenue\"). Max 10."),
  periods: z
    .string().default("last_8_quarters")
    .describe("Period filter: \"last_4_quarters\", \"last_8_quarters\", \"last_12_quarters\", \"last_1_years\", \"last_4_years\", \"all\", \"FY2023\", or \"Q3 FY2024\""),
};

const outputSchema = {
  ticker:                  z.string(),
  cik:                     z.string(),
  concept:                 z.string(),
  label:                   z.string(),
  facts:                   z.array(z.object({
    concept:          z.string(),
    label:            z.string(),
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
    is_derived:       z.boolean().optional(),
    source_url:       z.string(),
  })),
  freshness_as_of:         z.string(),
  concept_aliases_checked: z.array(z.string()),
  isError:                 z.boolean().optional(),
  error_message:           z.string().optional(),
};

type GetFactsFact = EdgarFact & {
  concept: string;
  label: string;
};

type GetFactsOutput = ToolOutput<GetFactsFact>;

export const getFactsTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "get_facts",
  config: {
    title: "Get EDGAR XBRL Financial Facts",
    description:
      "Returns a normalized, multi-period numeric fact table for one or more GAAP concepts for a US-listed company. " +
      "Fetches directly from SEC EDGAR XBRL API. Handles unit normalization, scale harmonization, and amendment deduplication. " +
      "Latency: under 4 seconds for single ticker. Does not support IFRS filers or pre-2009 non-XBRL companies.",
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

      // Fetch shared EDGAR documents once; reuse across all concepts.
      const [doc, sub] = await Promise.all([
        withTimeout(fetchCompanyFacts(cik), 9_000),
        withTimeout(fetchSubmissions(cik), 9_000),
      ]);

      const results: ToolOutput<EdgarFact>[] = await withTimeout(
        Promise.all(
          args.concepts.map((concept) => {
            const isUri = concept.includes("/");
            return isUri
              ? withTimeout(normalizeConceptFacts(cik, ticker, concept, args.periods, doc, sub), 10_000)
              : withTimeout(normalizeWithAliasResolution(cik, ticker, concept, args.periods, doc, sub), 10_000);
          }),
        ),
        18_000,
      );

      // Keep top-level summary fields for backwards compatibility, but annotate each row
      // with its own concept so multi-concept responses remain unambiguous.
      const merged: GetFactsOutput = {
        ticker,
        cik,
        concept: results.map((r) => r.concept).join(", "),
        label:   results.map((r) => r.label).join(", "),
        facts:   results.flatMap((r) =>
          r.facts.map((fact) => ({
            ...fact,
            concept: r.concept,
            label: r.label,
          })),
        ),
        freshness_as_of:         results[0]?.freshness_as_of ?? new Date().toISOString(),
        concept_aliases_checked: results.flatMap((r) => r.concept_aliases_checked),
      };

      return {
        structuredContent: merged as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(merged) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult = {
        ticker: args.ticker,
        cik: "",
        concept: args.concepts.join(", "),
        label: args.concepts.join(", "),
        facts: [],
        freshness_as_of: new Date().toISOString(),
        concept_aliases_checked: [],
        isError: true,
        error_message: msg,
      };
      return {
        structuredContent: errorResult as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
  },
};
