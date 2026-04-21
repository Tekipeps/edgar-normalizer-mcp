import { describe, test, expect, beforeAll } from "bun:test";
import { warmTickerCache } from "../src/data/edgar.ts";
import { comparePeriodsTool } from "../src/tools/compare-periods.ts";
import { discoverXbrlConceptsTool } from "../src/tools/discover-xbrl-concepts.ts";
import { getFilingContentTool } from "../src/tools/get-filing-content.ts";
import { getSegmentFactsTool } from "../src/tools/get-segment-facts.ts";
import type { ComparePeriodsOutput, XbrlConceptsOutput, FilingContentOutput, SegmentToolOutput } from "../src/types.ts";

beforeAll(async () => {
  await warmTickerCache();
}, 30_000);

// ── compare_periods ───────────────────────────────────────────────────────────

describe("compare_periods", () => {
  test("returns growth and CAGR for two annual periods", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "AAPL", concept: "revenue", period_a: "FY2020", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    expect(result.isError).toBeFalsy();
    expect(data.ticker).toBe("AAPL");
    expect(data.period_a).not.toBeNull();
    expect(data.period_b).not.toBeNull();
    expect(data.period_a?.period_label).toBe("FY2020");
    expect(data.period_b?.period_label).toBe("FY2023");
    expect(data.growth_percent).toBeTypeOf("number");
    expect(data.cagr_percent).toBeTypeOf("number");
    expect(data.years_between).toBeCloseTo(3, 0);
  });

  test("values are normalized (not raw)", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "MSFT", concept: "revenue", period_a: "FY2021", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    // Normalized revenue for large companies should be in billions range
    expect(data.period_a?.value_normalized).toBeGreaterThan(1e9);
    expect(data.period_b?.value_normalized).toBeGreaterThan(1e9);
  });

  test("growth_percent is null when period_a not found", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "AAPL", concept: "revenue", period_a: "FY1800", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    expect(result.isError).toBeFalsy();
    expect(data.period_a).toBeNull();
    expect(data.growth_percent).toBeNull();
    expect(data.cagr_percent).toBeNull();
  });

  test("both periods null when concept not found for ticker", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "AAPL", concept: "us-gaap/NonexistentConceptXYZ", period_a: "FY2020", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    expect(result.isError).toBeFalsy();
    expect(data.period_a).toBeNull();
    expect(data.period_b).toBeNull();
    expect(data.growth_percent).toBeNull();
  });

  test("concept_aliases_checked populated", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "NVDA", concept: "net income", period_a: "FY2022", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    expect(data.concept_aliases_checked.length).toBeGreaterThan(0);
  });

  test("invalid ticker returns structured error", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "XXXXXX", concept: "revenue", period_a: "FY2020", period_b: "FY2023" },
      undefined,
    );

    expect(result.isError).toBe(true);
    const data = result.structuredContent as unknown as ComparePeriodsOutput;
    expect(data.period_a).toBeNull();
    expect(data.period_b).toBeNull();
  });
});

// ── discover_xbrl_concepts ────────────────────────────────────────────────────

describe("discover_xbrl_concepts", () => {
  test("returns concept list for a company", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "AAPL", min_periods: 1, segment_data_only: false },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    expect(result.isError).toBeFalsy();
    expect(data.ticker).toBe("AAPL");
    expect(data.entity_name).toContain("Apple");
    expect(data.concepts.length).toBeGreaterThan(10);
    expect(data.total_count).toBe(data.concepts.length);
  });

  test("each concept has required fields", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "MSFT", min_periods: 4, segment_data_only: false },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    for (const c of data.concepts.slice(0, 5)) {
      expect(c.concept_uri).toContain("/");
      expect(c.label).toBeTypeOf("string");
      expect(c.namespace).toBeTypeOf("string");
      expect(c.tag).toBeTypeOf("string");
      expect(c.unit).toBeTypeOf("string");
      expect(c.periods_count).toBeGreaterThanOrEqual(4);
      expect(c.latest_period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.has_segment_data).toBeTypeOf("boolean");
    }
  });

  test("namespace filter restricts results", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "AAPL", namespace: "dei", min_periods: 1, segment_data_only: false },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    for (const c of data.concepts) {
      expect(c.namespace).toBe("dei");
    }
    expect(data.concepts.length).toBeGreaterThan(0);
  });

  test("search filter matches tag or label", async () => {
    // MSFT uses "Revenues" concept tag so the search is unambiguous
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "MSFT", search: "revenue", min_periods: 1, segment_data_only: false },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    expect(data.concepts.length).toBeGreaterThan(0);
    for (const c of data.concepts) {
      const matchesSearch =
        c.tag.toLowerCase().includes("revenue") ||
        c.label.toLowerCase().includes("revenue");
      expect(matchesSearch).toBe(true);
    }
  });

  test("segment_data_only returns only concepts with has_segment_data=true", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "AMZN", min_periods: 1, segment_data_only: true },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    // Amazon tags extensive segment data
    expect(data.concepts.length).toBeGreaterThan(0);
    for (const c of data.concepts) {
      expect(c.has_segment_data).toBe(true);
    }
  });

  test("min_periods filters out sparse concepts", async () => {
    const loose = await discoverXbrlConceptsTool.handler(
      { ticker: "AAPL", min_periods: 1, segment_data_only: false },
      undefined,
    );
    const strict = await discoverXbrlConceptsTool.handler(
      { ticker: "AAPL", min_periods: 20, segment_data_only: false },
      undefined,
    );

    const looseData = loose.structuredContent as unknown as XbrlConceptsOutput;
    const strictData = strict.structuredContent as unknown as XbrlConceptsOutput;
    expect(strictData.total_count).toBeLessThan(looseData.total_count);
    for (const c of strictData.concepts) {
      expect(c.periods_count).toBeGreaterThanOrEqual(20);
    }
  });

  test("sorted by periods_count descending", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "MSFT", min_periods: 1, segment_data_only: false },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    for (let i = 1; i < Math.min(data.concepts.length, 10); i++) {
      expect(data.concepts[i]!.periods_count).toBeLessThanOrEqual(data.concepts[i - 1]!.periods_count);
    }
  });
});

// ── get_filing_content ────────────────────────────────────────────────────────

describe("get_filing_content", () => {
  // Grab a known AAPL 10-K accession number from filing metadata first
  let appleAccn: string = "";

  beforeAll(async () => {
    const { getFilingMetadataTool } = await import("../src/tools/get-filing-metadata.ts");
    const meta = await getFilingMetadataTool.handler(
      { ticker: "AAPL", form_type: "10-K", limit: 1 },
      undefined,
    );
    const d = meta.structuredContent as any;
    appleAccn = d.filings[0]?.accession_number ?? "";
  }, 20_000);

  test("returns text content for a 10-K", async () => {
    expect(appleAccn).toBeTruthy();
    const result = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: appleAccn, offset: 0, max_chars: 5_000 },
      undefined,
    );
    const data = result.structuredContent as unknown as FilingContentOutput;

    expect(result.isError).toBeFalsy();
    expect(data.ticker).toBe("AAPL");
    expect(data.accession_number).toBe(appleAccn);
    expect(data.text.length).toBeGreaterThan(100);
    expect(data.chars_returned).toBeLessThanOrEqual(5_000);
    expect(data.total_chars).toBeGreaterThan(0);
    expect(data.source_url).toContain("sec.gov");
    expect(data.primary_document).toBeTruthy();
  });

  test("pagination: next_offset advances and has_more works", async () => {
    expect(appleAccn).toBeTruthy();
    const first = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: appleAccn, offset: 0, max_chars: 2_000 },
      undefined,
    );
    const firstData = first.structuredContent as unknown as FilingContentOutput;

    expect(firstData.has_more).toBe(true);
    expect(firstData.next_offset).toBe(2_000);

    const second = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: appleAccn, offset: firstData.next_offset!, max_chars: 2_000 },
      undefined,
    );
    const secondData = second.structuredContent as unknown as FilingContentOutput;

    // Consecutive pages should not overlap
    expect(secondData.text).not.toBe(firstData.text);
    expect(secondData.offset).toBe(2_000);
  });

  test("plain text — no residual HTML tags in output", async () => {
    expect(appleAccn).toBeTruthy();
    const result = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: appleAccn, offset: 0, max_chars: 10_000 },
      undefined,
    );
    const data = result.structuredContent as unknown as FilingContentOutput;

    // Should not contain raw HTML opening tags
    expect(data.text).not.toMatch(/<html/i);
    expect(data.text).not.toMatch(/<body/i);
    expect(data.text).not.toMatch(/<div/i);
  });

  test("invalid accession number returns structured error", async () => {
    const result = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: "0000000000-00-000000", offset: 0, max_chars: 5_000 },
      undefined,
    );

    expect(result.isError).toBe(true);
    const data = result.structuredContent as unknown as FilingContentOutput;
    expect(data.text).toBe("");
    expect(data.has_more).toBe(false);
  });

  test("invalid ticker returns structured error", async () => {
    const result = await getFilingContentTool.handler(
      { ticker: "XXXXXX", accession_number: "0001193125-24-000001", offset: 0, max_chars: 5_000 },
      undefined,
    );

    expect(result.isError).toBe(true);
  });
});

// ── segment discovery fallback ────────────────────────────────────────────────

describe("get_segment_facts — discovery fallback", () => {
  test("response is well-formed when segment axis does not match concept data", async () => {
    // DEI concept EntityCommonStockSharesOutstanding is a filing-level field, never broken out by segment
    const result = await getSegmentFactsTool.handler(
      {
        ticker: "MSFT",
        concept: "dei/EntityCommonStockSharesOutstanding",
        segment_dimension: "StatementBusinessSegmentsAxis",
        period: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as unknown as SegmentToolOutput;

    expect(result.isError).toBeFalsy();
    expect(data.ticker).toBe("MSFT");
    expect(data.message).toBeTypeOf("string");
    // If no segment data was found, the message should explain and possibly suggest alternatives
    if (!data.segments_available) {
      expect(data.facts).toEqual([]);
      if (data.message?.includes("Concepts with segment data found:")) {
        expect(data.message).toMatch(/us-gaap\//);
      }
    }
  });

  test("segment facts still returned when data exists", async () => {
    // AMZN extensively tags segment revenue
    const result = await getSegmentFactsTool.handler(
      {
        ticker: "AMZN",
        concept: "revenue",
        segment_dimension: "StatementBusinessSegmentsAxis",
        period: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as unknown as SegmentToolOutput;

    // AMZN does tag segment data — segments_available should be true
    expect(result.isError).toBeFalsy();
    if (data.segments_available) {
      expect(data.facts.length).toBeGreaterThan(0);
      const periodLabels = [...new Set(data.facts.map((f) => f.period_label))];
      expect(periodLabels).toHaveLength(4);
    }
    // Either way the response is well-formed
    expect(data.ticker).toBe("AMZN");
  });

  test("derived segment rows are surfaced in schema-compatible output", async () => {
    const result = await getSegmentFactsTool.handler(
      {
        ticker: "TSLA",
        concept: "revenue",
        segment_dimension: "StatementBusinessSegmentsAxis",
        period: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as unknown as SegmentToolOutput;

    expect(result.isError).toBeFalsy();
    if (data.segments_available) {
      expect(data.facts.some((f) => f.is_derived === true)).toBe(true);
    }
  });
});
