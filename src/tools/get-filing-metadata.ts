import { z } from "zod";
import { resolveCikFromTicker, fetchSubmissions, fetchSubmissionsPage } from "../data/edgar.ts";
import { withTimeout, type McpTool } from "../lib/tool-utils.ts";
import type { FilingMeta, SubmissionsDoc } from "../types.ts";

const inputSchema = {
  ticker: z
    .string().min(1).max(10).toUpperCase()
    .describe("Stock ticker symbol, e.g. \"TSLA\""),
  form_type: z
    .enum(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "all"])
    .describe(
      "SEC form type to filter by. Base types (\"10-K\", \"10-Q\", \"8-K\") include their amendments. " +
      "Use the \"/A\" variants (\"10-K/A\", \"10-Q/A\", \"8-K/A\") to return amendments only. " +
      "Use \"all\" for every filing type."
    ),
  after: z
    .string().optional()
    .describe("ISO 8601 date — return filings filed on or after this date, e.g. \"2022-01-01\""),
  before: z
    .string().optional()
    .describe("ISO 8601 date — return filings filed on or before this date"),
  cursor: z
    .string().optional()
    .describe("Base64-encoded cursor from previous response, e.g. \"eyJpbmRleCI6MjB9\""),
  limit: z
    .number().min(1).max(100).default(20)
    .describe("Max filings to return per page"),
};

const outputSchema = {
  ticker:       z.string(),
  cik:          z.string(),
  filings:      z.array(z.object({
    accession_number: z.string(),
    form_type:        z.string(),
    filed_date:      z.string(),
    period_of_report: z.string(),
    primary_document: z.string(),
    edgar_url:        z.string(),
    is_amendment:     z.boolean(),
  })),
  total_count:   z.number(),
  next_cursor:   z.string().nullable(),
  has_more:     z.boolean(),
  freshness_as_of: z.string(),
};

function buildEdgarUrl(cik: string, accn: string): string {
  const noDashes = accn.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${noDashes}/${accn}-index.htm`;
}

function parseFilings(
  recent: SubmissionsDoc["filings"]["recent"],
  cik: string,
  formType: string,
  after?: string,
  before?: string,
): FilingMeta[] {
  const results: FilingMeta[] = [];
  const accessions = recent.accessionNumber;
  const dates      = recent.filingDate;
  const forms      = recent.form;
  const reports    = recent.reportDate;
  const primaryDoc = recent.primaryDocument;

  const n = accessions.length;
  for (let i = 0; i < n; i++) {
    const accn  = accessions[i] ?? "";
    const date  = dates[i] ?? "";
    const form  = forms[i] ?? "";
    const report = reports[i] ?? "";
    const doc   = primaryDoc[i] ?? "";

    if (formType !== "all") {
      const match = formType.endsWith("/A") ? form === formType : form.replace("/A", "") === formType;
      if (!match) continue;
    }

    if (after && date < after) continue;
    if (before && date > before) continue;

    results.push({
      accession_number:  accn,
      form_type:         form,
      filed_date:        date,
      period_of_report:  report,
      primary_document:  doc,
      edgar_url:         buildEdgarUrl(cik, accn),
      is_amendment:      form.endsWith("/A"),
    });
  }

  return results;
}

function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ index })).toString("base64");
}

function decodeCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    return typeof decoded.index === "number" ? decoded.index : 0;
  } catch {
    return 0;
  }
}

export const getFilingMetadataTool: McpTool<typeof inputSchema, typeof outputSchema> = {
  name: "get_filing_metadata",
  config: {
    title: "Get SEC EDGAR Filing Metadata",
    description:
      "Returns a list of SEC filings for a US-listed company with accession numbers, filing dates, " +
      "period of report, and direct EDGAR URLs. Supports filtering by form type (10-K, 10-Q, 8-K) and date range. " +
      "Handles large filers with paginated submission history. Latency: under 5 seconds.",
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
      const ticker = args.ticker.toUpperCase();
      const freshness_as_of = new Date().toISOString();
      const cik = await resolveCikFromTicker(ticker);

      const sub = await withTimeout(fetchSubmissions(cik), 8_000);

      let filings = parseFilings(sub.filings.recent, cik, args.form_type, args.after, args.before);

      // Paginate for large filers (>1000 filings in history)
      if (sub.filings.files.length > 0) {
        for (const file of sub.filings.files) {
          try {
            const page = await withTimeout(fetchSubmissionsPage(file.name), 7_000);
            const pageFilings = parseFilings(page, cik, args.form_type, args.after, args.before);
            filings = filings.concat(pageFilings);
          } catch {
            // Partial pagination failure — continue with what we have
          }
        }
      }

      // Sort by filed_date descending (most recent first)
      filings.sort((a, b) => b.filed_date.localeCompare(a.filed_date));

      // Cursor-based pagination
      const limit = args.limit ?? 20;
      const startIndex = args.cursor ? decodeCursor(args.cursor) : 0;
      const pagedFilings = filings.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < filings.length;
      const nextCursor = hasMore ? encodeCursor(startIndex + limit) : null;

      const result = {
        ticker,
        cik,
        filings: pagedFilings,
        total_count: filings.length,
        next_cursor: nextCursor,
        has_more: hasMore,
        freshness_as_of,
      };

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult = {
        ticker: args.ticker, cik: "", filings: [], total_count: 0,
        next_cursor: null, has_more: false,
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
