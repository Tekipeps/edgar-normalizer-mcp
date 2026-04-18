import { describe, test, expect, beforeAll } from "bun:test";
import { warmTickerCache, getTickerCacheLoadedAt } from "../src/data/edgar.ts";
import { getFactsTool } from "../src/tools/get-facts.ts";
import { getFactsBasketTool } from "../src/tools/get-facts-basket.ts";
import { resolveConceptTool } from "../src/tools/resolve-concept.ts";
import { getFilingMetadataTool } from "../src/tools/get-filing-metadata.ts";
import { resolveTickerTool } from "../src/tools/resolve-ticker.ts";
import type { ToolOutput, EdgarFact } from "../src/types.ts";

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
  });

  test("natural language alias resolution", async () => {
    const result = await getFactsTool.handler(
      { ticker: "MSFT", concepts: ["revenue"], periods: "last_4_quarters" },
      undefined,
    );
    const data = result.structuredContent as unknown as ToolOutput<EdgarFact>;

    expect(data.facts.length).toBeGreaterThan(0);
    expect(data.concept_aliases_checked.length).toBeGreaterThan(0);
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
    const data = result.structuredContent as unknown as ToolOutput<EdgarFact>;

    expect(data.facts.length).toBeGreaterThan(4);
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

  test("not-found returns suggestions", async () => {
    const result = await resolveConceptTool.handler(
      { ticker: "AAPL", label: "synergy multiplier index" },
      undefined,
    );
    const data = result.structuredContent as any;

    expect(data.found).toBe(false);
    expect(data.suggestions).toBeDefined();
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
