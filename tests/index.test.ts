import { describe, test, expect, beforeAll } from "bun:test";
import { warmTickerCache, getTickerCacheLoadedAt } from "../src/data/edgar.ts";
import { getFactsTool } from "../src/tools/get-facts.ts";
import { getFactsBasketTool } from "../src/tools/get-facts-basket.ts";
import { resolveConceptTool } from "../src/tools/resolve-concept.ts";
import { getFilingMetadataTool } from "../src/tools/get-filing-metadata.ts";
import { comparePeriodsTool } from "../src/tools/compare-periods.ts";
import { discoverXbrlConceptsTool } from "../src/tools/discover-xbrl-concepts.ts";
import { getFilingContentTool } from "../src/tools/get-filing-content.ts";
import { getSegmentFactsTool } from "../src/tools/get-segment-facts.ts";
import { resolveTickerTool } from "../src/tools/resolve-ticker.ts";
import type {
  ToolOutput,
  EdgarFact,
  ComparePeriodsOutput,
  XbrlConceptsOutput,
  FilingContentOutput,
  SegmentToolOutput,
} from "../src/types.ts";

const LIVE_EDGAR_TEST_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  console.log("Warming ticker cache...");
  await warmTickerCache();
  console.log("Cache ready");
}, 30000);

describe("get_facts", () => {
  test("basic revenue retrieval", async () => {
    const result = await getFactsTool.handler(
      {
        ticker: "AAPL",
        concepts: ["us-gaap/Revenues"],
        periods: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as unknown as ToolOutput<EdgarFact>;

    expect(data.ticker).toBe("AAPL");
    expect(data.facts.length).toBeGreaterThan(0);
    expect(data.facts[0]).toMatchObject({
      period_label: expect.any(String),
      value: expect.any(Number),
      unit: expect.any(String),
      scale: expect.any(Number),
      value_normalized: expect.any(Number),
      filing_type: expect.any(String),
      accession_number: expect.any(String),
      filed_date: expect.any(String),
      source_url: expect.any(String),
    });
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("natural language alias resolution", async () => {
    const result = await getFactsTool.handler(
      { ticker: "MSFT", concepts: ["revenue"], periods: "last_4_quarters" },
      undefined,
    );
    const data = result.structuredContent as unknown as ToolOutput<EdgarFact>;

    expect(data.facts.length).toBeGreaterThan(0);
    expect(data.concept_aliases_checked.length).toBeGreaterThan(0);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("explicit stale revenue concept falls back with explicit metadata", async () => {
    const result = await getFactsTool.handler(
      { ticker: "AAPL", concepts: ["us-gaap/Revenues"], periods: "last_8_quarters" },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(result.isError).toBeFalsy();
    expect(data.requested_concept).toBe("us-gaap/Revenues");
    expect(data.resolved_from_deprecated_concept).toBe(true);
    expect(data.concept).toContain("RevenueFromContractWithCustomerExcludingAssessedTax");
    expect([...new Set(data.facts.map((f: any) => f.period_label))]).toContain("Q4 FY2025");
    expect(data.facts.every((f: any) => f.requested_concept === "us-gaap/Revenues")).toBe(true);
  });

  test("multiple concepts", async () => {
    const result = await getFactsTool.handler(
      {
        ticker: "AAPL",
        concepts: ["us-gaap/Revenues", "us-gaap/NetIncomeLoss"],
        periods: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.facts.length).toBeGreaterThan(4);
    for (const fact of data.facts.slice(0, 4)) {
      expect(fact.concept).toEqual(expect.any(String));
      expect(fact.label).toEqual(expect.any(String));
    }
  });

  test("gross profit works as test case", async () => {
    const result = await getFactsTool.handler(
      {
        ticker: "AAPL",
        concepts: ["gross profit"],
        periods: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as unknown as ToolOutput<EdgarFact>;

    expect(data.facts.length).toBeGreaterThan(0);
  });

  test("invalid ticker returns error", async () => {
    const result = await getFactsTool.handler(
      {
        ticker: "XXXXXX",
        concepts: ["us-gaap/Revenues"],
        periods: "last_4_quarters",
      },
      undefined,
    );

    expect(result.isError).toBe(true);
    const data = result.structuredContent as any;
    expect(data.isError).toBe(true);
    expect(data.error_message).toContain("XXXXXX");
  });
});

describe("get_facts_basket", () => {
  test("multiple tickers single concept", async () => {
    const result = await getFactsBasketTool.handler(
      {
        tickers: ["AAPL", "MSFT", "GOOG"],
        concept: "us-gaap/Revenues",
        period: "FY2023",
      },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.rows.length).toBe(3);
    expect(data.rows.map((r: any) => r.ticker)).toEqual([
      "AAPL",
      "MSFT",
      "GOOG",
    ]);
  });

  test("basket with valid ticker", async () => {
    const result = await getFactsBasketTool.handler(
      { tickers: ["AAPL"], concept: "us-gaap/Revenues", period: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.rows.length).toBe(1);
    expect(data.rows[0].isError).toBe(false);
  });

  test("per-ticker errors don't fail basket", async () => {
    const result = await getFactsBasketTool.handler(
      {
        tickers: ["XXXXXX", "AAPL"],
        concept: "us-gaap/Revenues",
        period: "FY2023",
      },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.rows.length).toBe(2);
    expect(data.rows[0].isError).toBe(true);
    expect(data.rows[1].isError).toBe(false);
  });
});

describe("resolve_concept", () => {
  test("exact match returns found=true", async () => {
    const result = await resolveConceptTool.handler(
      { ticker: "AAPL", label: "revenue" },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.found).toBe(true);
    expect(data.concept_uri).toContain("us-gaap");
    expect(data.confidence).toBe("exact");
  });

  test("alias match returns found=true with confidence", async () => {
    const result = await resolveConceptTool.handler(
      { ticker: "NVDA", label: "free cash flow" },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.found).toBe(true);
    expect(data.confidence).toMatch(/exact|alias|fallback/);
  });

  test("graceful response for unrecognised label", async () => {
    const result = await resolveConceptTool.handler(
      { ticker: "AAPL", label: "synergy multiplier index" },
      undefined,
    );
    const data = result.structuredContent as any;

    // Mercury may or may not find something; either way the response must be well-formed.
    expect(result.isError).toBeFalsy();
    if (data.found) {
      expect(data.concept_uri).toBeDefined();
    } else {
      expect(data.suggestions).toBeDefined();
    }
  });

  test("returns sample fact", async () => {
    const result = await resolveConceptTool.handler(
      { ticker: "AAPL", label: "revenue" },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.sample_fact).toMatchObject({
      period_label: expect.any(String),
      value: expect.any(Number),
      unit: expect.any(String),
    });
  });
});

describe("get_filing_metadata", () => {
  test("basic filing retrieval", async () => {
    const result = await getFilingMetadataTool.handler(
      { ticker: "AAPL", form_type: "10-K", limit: 20 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.filings.length).toBeGreaterThan(0);
    expect(data.filings[0]).toMatchObject({
      accession_number: expect.any(String),
      form_type: expect.any(String),
      filed_date: expect.any(String),
      edgar_url: expect.any(String),
    });
  });

  test("pagination returns has_more", async () => {
    const result = await getFilingMetadataTool.handler(
      { ticker: "AAPL", form_type: "10-K", limit: 5 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.filings.length).toBe(5);
    expect(data.has_more).toBe(true);
    expect(data.next_cursor).toBeDefined();
    expect(data.total_count).toBeGreaterThan(5);
  });

  test("cursor pagination works", async () => {
    const first = await getFilingMetadataTool.handler(
      { ticker: "AAPL", form_type: "10-K", limit: 5 },
      undefined,
    );
    const firstData = first.structuredContent as any;
    const cursor = firstData.next_cursor;

    const second = await getFilingMetadataTool.handler(
      { ticker: "AAPL", form_type: "10-K", limit: 5, cursor },
      undefined,
    );
    const secondData = second.structuredContent as any;

    expect(secondData.filings[0].accession_number).not.toBe(
      firstData.filings[0].accession_number,
    );
  });

  test("form type filtering", async () => {
    const result = await getFilingMetadataTool.handler(
      { ticker: "MSFT", form_type: "10-Q", limit: 20 },
      undefined,
    );
    const data = result.structuredContent as any;

    for (const f of data.filings) {
      expect(f.form_type).toMatch(/10-Q/);
    }
  });

  test("returns amendment flag", async () => {
    const result = await getFilingMetadataTool.handler(
      { ticker: "TSLA", form_type: "10-K", limit: 20 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.filings[0].is_amendment).toBe(false);
  });
});

describe("resolve_ticker", () => {
  test("exact company name returns exact match first", async () => {
    const result = await resolveTickerTool.handler(
      { company_name: "Apple Inc.", max_results: 5 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches[0].match_type).toBe("exact");
    expect(data.matches[0].ticker).toBe("AAPL");
    expect(data.matches[0].cik).toBeDefined();
  });

  test("partial name returns starts_with matches", async () => {
    const result = await resolveTickerTool.handler(
      { company_name: "Microsoft", max_results: 5 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.matches.length).toBeGreaterThan(0);
    const msft = data.matches.find((m: any) => m.ticker === "MSFT");
    expect(msft).toBeDefined();
    expect(msft.match_type).toMatch(/exact|starts_with/);
  });

  test("respects max_results cap", async () => {
    const result = await resolveTickerTool.handler(
      { company_name: "bank", max_results: 3 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.matches.length).toBeLessThanOrEqual(3);
    expect(data.total).toBeLessThanOrEqual(3);
  });

  test("results include required fields", async () => {
    const result = await resolveTickerTool.handler(
      { company_name: "Tesla", max_results: 5 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.matches.length).toBeGreaterThan(0);
    for (const m of data.matches) {
      expect(m.ticker).toEqual(expect.any(String));
      expect(m.cik).toEqual(expect.any(String));
      expect(m.company_name).toEqual(expect.any(String));
      expect(["exact", "starts_with", "contains"]).toContain(m.match_type);
    }
  });

  test("no match returns empty array", async () => {
    const result = await resolveTickerTool.handler(
      { company_name: "zzz_nonexistent_corp_xyz", max_results: 5 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(result.isError).toBeFalsy();
    expect(data.matches).toEqual([]);
    expect(data.total).toBe(0);
  });

  test("query field echoes input", async () => {
    const result = await resolveTickerTool.handler(
      { company_name: "Nvidia", max_results: 5 },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.query).toBe("Nvidia");
  });
});

describe("cache", () => {
  test("ticker cache is warmed once", async () => {
    const cacheTime = getTickerCacheLoadedAt();
    expect(cacheTime).toBeDefined();

    const result = await getFactsTool.handler(
      {
        ticker: "AAPL",
        concepts: ["us-gaap/Revenues"],
        periods: "last_4_quarters",
      },
      undefined,
    );
    const data = result.structuredContent as unknown as ToolOutput<EdgarFact>;

    expect(data.facts.length).toBeGreaterThan(0);
  });
});

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("values are normalized (not raw)", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "MSFT", concept: "revenue", period_a: "FY2021", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    expect(data.period_a?.value_normalized).toBeGreaterThan(1e9);
    expect(data.period_b?.value_normalized).toBeGreaterThan(1e9);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("concept_aliases_checked populated", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "NVDA", concept: "net income", period_a: "FY2022", period_b: "FY2023" },
      undefined,
    );
    const data = result.structuredContent as unknown as ComparePeriodsOutput;

    expect(data.concept_aliases_checked.length).toBeGreaterThan(0);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("invalid ticker returns structured error", async () => {
    const result = await comparePeriodsTool.handler(
      { ticker: "XXXXXX", concept: "revenue", period_a: "FY2020", period_b: "FY2023" },
      undefined,
    );

    expect(result.isError).toBe(true);
    const data = result.structuredContent as unknown as ComparePeriodsOutput;
    expect(data.period_a).toBeNull();
    expect(data.period_b).toBeNull();
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);
});

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("search filter matches tag or label", async () => {
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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("segment_data_only returns only concepts with has_segment_data=true", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "AMZN", min_periods: 1, segment_data_only: true },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    expect(data.concepts.length).toBeGreaterThan(0);
    for (const c of data.concepts) {
      expect(c.has_segment_data).toBe(true);
    }
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("sorted by periods_count descending", async () => {
    const result = await discoverXbrlConceptsTool.handler(
      { ticker: "MSFT", min_periods: 1, segment_data_only: false },
      undefined,
    );
    const data = result.structuredContent as unknown as XbrlConceptsOutput;

    for (let i = 1; i < Math.min(data.concepts.length, 10); i++) {
      expect(data.concepts[i]!.periods_count).toBeLessThanOrEqual(data.concepts[i - 1]!.periods_count);
    }
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);
});

describe("get_filing_content", () => {
  let appleAccn = "";

  beforeAll(async () => {
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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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

    expect(secondData.text).not.toBe(firstData.text);
    expect(secondData.offset).toBe(2_000);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("plain text has no residual HTML tags in output", async () => {
    expect(appleAccn).toBeTruthy();
    const result = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: appleAccn, offset: 0, max_chars: 10_000 },
      undefined,
    );
    const data = result.structuredContent as unknown as FilingContentOutput;

    expect(data.text).not.toMatch(/<html/i);
    expect(data.text).not.toMatch(/<body/i);
    expect(data.text).not.toMatch(/<div/i);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("invalid accession number returns structured error", async () => {
    const result = await getFilingContentTool.handler(
      { ticker: "AAPL", accession_number: "0000000000-00-000000", offset: 0, max_chars: 5_000 },
      undefined,
    );

    expect(result.isError).toBe(true);
    const data = result.structuredContent as unknown as FilingContentOutput;
    expect(data.text).toBe("");
    expect(data.has_more).toBe(false);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("invalid ticker returns structured error", async () => {
    const result = await getFilingContentTool.handler(
      { ticker: "XXXXXX", accession_number: "0001193125-24-000001", offset: 0, max_chars: 5_000 },
      undefined,
    );

    expect(result.isError).toBe(true);
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);
});

describe("get_segment_facts discovery fallback", () => {
  test("response is well-formed when segment axis does not match concept data", async () => {
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
    if (!data.segments_available) {
      expect(data.facts).toEqual([]);
      if (data.message?.includes("Concepts with segment data found:")) {
        expect(data.message).toMatch(/us-gaap\//);
      }
    }
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

  test("segment facts still returned when data exists", async () => {
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

    expect(result.isError).toBeFalsy();
    if (data.segments_available) {
      expect(data.facts.length).toBeGreaterThan(0);
      const periodLabels = [...new Set(data.facts.map((f) => f.period_label))];
      expect(periodLabels).toHaveLength(4);
    }
    expect(data.ticker).toBe("AMZN");
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);

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
  }, LIVE_EDGAR_TEST_TIMEOUT_MS);
});
