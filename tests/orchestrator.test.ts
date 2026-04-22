import { describe, expect, test } from "bun:test";
import { normalizeConceptFacts } from "../src/lib/orchestrator.ts";
import type { CompanyFactsDoc, SubmissionsDoc } from "../src/types.ts";

describe("normalizeConceptFacts", () => {
  test("preserves EDGAR magnitude instead of rescaling decimals metadata", async () => {
    const doc: CompanyFactsDoc = {
      cik: 1318605,
      entityName: "Tesla, Inc.",
      facts: {
        "us-gaap": {
          NetCashProvidedByUsedInOperatingActivities: {
            label: "Net Cash Provided By Used In Operating Activities",
            description: null,
            units: {
              USD: [
                {
                  accn: "0000950170-24-014702",
                  cik: 1318605,
                  end: "2023-12-31",
                  start: "2023-01-01",
                  val: 13256000000,
                  form: "10-K",
                  filed: "2024-01-29",
                  decimals: -3,
                },
              ],
            },
          },
        },
      },
    };

    const submissions: SubmissionsDoc = {
      cik: "1318605",
      entityType: "operating",
      sic: "3711",
      name: "Tesla, Inc.",
      fiscalYearEnd: "1231",
      filings: {
        recent: {
          accessionNumber: [],
          filingDate: [],
          reportDate: [],
          form: [],
          primaryDocument: [],
          isXBRL: [],
          isInlineXBRL: [],
        },
        files: [],
      },
    };

    const result = await normalizeConceptFacts(
      "1318605",
      "TSLA",
      "us-gaap/NetCashProvidedByUsedInOperatingActivities",
      "FY2023",
      doc,
      submissions,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      value: 13256000000,
      scale: 1,
      value_normalized: 13256000000,
    });
  });
});
