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
      provenance: {
        type: "reported",
        filing_type: "10-K",
        accession_number: "0000950170-24-014702",
        filed_date: "2024-01-29",
        source_url: expect.stringContaining("0000950170-24-014702-index.htm"),
      },
    });
  });

  test("marks derived Q4 periods with structured source provenance", async () => {
    const doc: CompanyFactsDoc = {
      cik: 320193,
      entityName: "Apple Inc.",
      facts: {
        "us-gaap": {
          Revenues: {
            label: "Revenue",
            description: null,
            units: {
              USD: [
                {
                  accn: "0000320193-25-000001",
                  cik: 320193,
                  end: "2025-09-27",
                  start: "2024-09-29",
                  val: 400,
                  form: "10-K",
                  filed: "2025-11-01",
                  decimals: -6,
                },
                {
                  accn: "0000320193-25-000002",
                  cik: 320193,
                  end: "2025-06-28",
                  start: "2024-09-29",
                  val: 300,
                  form: "10-Q",
                  filed: "2025-08-01",
                  decimals: -6,
                },
              ],
            },
          },
        },
      },
    };

    const submissions: SubmissionsDoc = {
      cik: "320193",
      entityType: "operating",
      sic: "3571",
      name: "Apple Inc.",
      fiscalYearEnd: "0927",
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
      "320193",
      "AAPL",
      "us-gaap/Revenues",
      "last_4_quarters",
      doc,
      submissions,
    );

    const derivedQ4 = result.facts.find((fact) => fact.period_label === "Q4 FY2025");
    expect(derivedQ4).toMatchObject({
      value: 100,
      value_normalized: 100,
      is_derived: true,
      provenance: {
        type: "derived",
        method: "annual_minus_nine_months",
        annual_source: {
          period_label: "FY2025",
          filing_type: "10-K",
          accession_number: "0000320193-25-000001",
          filed_date: "2025-11-01",
          source_url: expect.stringContaining("0000320193-25-000001-index.htm"),
        },
        subtracted_source: {
          period_label: "9M FY2025",
          filing_type: "10-Q",
          accession_number: "0000320193-25-000002",
          filed_date: "2025-08-01",
          source_url: expect.stringContaining("0000320193-25-000002-index.htm"),
        },
      },
    });
  });
});
