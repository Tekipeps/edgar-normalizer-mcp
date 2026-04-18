import { z } from "zod";
import { resolveCikFromTicker, fetchSubmissions, fetchFilingContent } from "../data/edgar.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { FilingContentOutput } from "../types.ts";

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"TSLA\""),
  accession_number: z
    .string().min(1)
    .describe(
      "SEC accession number from get_filing_metadata, e.g. \"0001193125-24-012345\".",
    ),
  offset: z
    .number().min(0).default(0)
    .describe("Character offset to start reading from (for pagination). Default 0."),
  max_chars: z
    .number().min(500).max(50_000).default(8_000)
    .describe("Maximum characters to return per call. Default 8000, max 50000."),
};

const outputSchema = {
  ticker:           z.string(),
  cik:              z.string(),
  accession_number: z.string(),
  primary_document: z.string(),
  source_url:       z.string(),
  text:             z.string(),
  offset:           z.number(),
  chars_returned:   z.number(),
  total_chars:      z.number(),
  next_offset:      z.number().nullable(),
  has_more:         z.boolean(),
  freshness_as_of:  z.string(),
};

function buildDocUrl(cik: string, accn: string, doc: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${doc}`;
}

export const getFilingContentTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "get_filing_content",
  config: {
    title: "Fetch SEC Filing Document Text",
    description:
      "Fetches and returns the plain-text content of a specific SEC filing (10-K, 10-Q, 8-K, etc.) " +
      "given an accession number from get_filing_metadata. HTML tags are stripped; entity encoding decoded. " +
      "Supports pagination via offset + max_chars — call repeatedly with next_offset until has_more=false. " +
      "Returns source_url for direct reference. Latency: 3–10 seconds depending on document size.",
    inputSchema,
    outputSchema,
    _meta: {
      surface: "both",
      queryEligible: false,
      latencyClass: "slow",
      pricing: { executeUsd: "0.002" },
    },
  },
  handler: async (args, _extra) => {
    try {
      const ticker = args.ticker.toUpperCase();
      const freshness_as_of = new Date().toISOString();
      const cik = await resolveCikFromTicker(ticker);

      // Look up the primary document for this accession number
      const sub = await withTimeout(fetchSubmissions(cik), 8_000);
      const idx = sub.filings.recent.accessionNumber.indexOf(args.accession_number);
      const primaryDoc = idx >= 0 ? (sub.filings.recent.primaryDocument[idx] ?? "") : "";

      if (!primaryDoc) {
        throw new Error(
          `Accession number "${args.accession_number}" not found in recent filings for ${ticker}. ` +
          "It may be in older paginated history or the accession number may be incorrect.",
        );
      }

      const fullText = await withTimeout(
        fetchFilingContent(cik, args.accession_number, primaryDoc),
        12_000,
      );

      if (!fullText) {
        throw new Error(
          `Could not fetch content for "${primaryDoc}" (accession ${args.accession_number}). ` +
          "The document may not be in HTML/text format, or EDGAR returned an error.",
        );
      }

      const offset = args.offset ?? 0;
      const maxChars = args.max_chars ?? 8_000;
      const totalChars = fullText.length;
      const slice = fullText.slice(offset, offset + maxChars);
      const hasMore = offset + maxChars < totalChars;

      const result: FilingContentOutput = {
        ticker,
        cik,
        accession_number: args.accession_number,
        primary_document: primaryDoc,
        source_url: buildDocUrl(cik, args.accession_number, primaryDoc),
        text: slice,
        offset,
        chars_returned: slice.length,
        total_chars: totalChars,
        next_offset: hasMore ? offset + maxChars : null,
        has_more: hasMore,
        freshness_as_of,
      };

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: FilingContentOutput = {
        ticker: args.ticker, cik: "", accession_number: args.accession_number,
        primary_document: "", source_url: "", text: "",
        offset: args.offset ?? 0, chars_returned: 0, total_chars: 0,
        next_offset: null, has_more: false,
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
