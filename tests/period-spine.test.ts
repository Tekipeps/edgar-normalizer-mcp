import { describe, test, expect } from "bun:test";
import {
  buildPeriodLabel,
  filterByPeriodSpec,
  filterMultiByPeriodSpec,
  parseFiscalYearEnd,
} from "../src/lib/period-spine.ts";
import type { EdgarFact, SegmentFact } from "../src/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<EdgarFact> & { period_label: string; end_date: string }): EdgarFact {
  return {
    period_type: "duration",
    start_date: null,
    value: 1,
    unit: "USD",
    scale: 1,
    value_normalized: 1,
    filing_type: "10-Q",
    accession_number: "0001234567-24-000001",
    filed_date: "2024-01-01",
    is_amendment: false,
    provenance: {
      type: "reported",
      filing_type: "10-Q",
      accession_number: "0001234567-24-000001",
      filed_date: "2024-01-01",
      source_url: "https://example.com",
    },
    source_url: "https://example.com",
    ...overrides,
  };
}

function makeSegmentFact(label: string, end: string, member: string, val = 1): SegmentFact {
  return {
    ...makeFact({ period_label: label, end_date: end }),
    segment_dimension: "StatementBusinessSegmentsAxis",
    segment_member: member,
    value: val,
    value_normalized: val,
  };
}

// ── parseFiscalYearEnd ────────────────────────────────────────────────────────

describe("parseFiscalYearEnd", () => {
  test("parses MMDD format (EDGAR standard)", () => {
    expect(parseFiscalYearEnd("1231")).toBe(12);
    expect(parseFiscalYearEnd("0930")).toBe(9);
    expect(parseFiscalYearEnd("0628")).toBe(6);
  });

  test("parses --MM-DD format", () => {
    expect(parseFiscalYearEnd("--12-31")).toBe(12);
    expect(parseFiscalYearEnd("--09-30")).toBe(9);
  });

  test("returns 12 for null/empty", () => {
    expect(parseFiscalYearEnd(null)).toBe(12);
    expect(parseFiscalYearEnd("")).toBe(12);
    expect(parseFiscalYearEnd(undefined)).toBe(12);
  });
});

// ── buildPeriodLabel ──────────────────────────────────────────────────────────

describe("buildPeriodLabel", () => {
  test("quarterly period → Q label", () => {
    // Dec fiscal year end; period Jul–Sep = Q3
    const { label, periodType } = buildPeriodLabel("2024-07-01", "2024-09-30", 12);
    expect(label).toBe("Q3 FY2024");
    expect(periodType).toBe("duration");
  });

  test("annual period → FY label", () => {
    const { label } = buildPeriodLabel("2023-01-01", "2023-12-31", 12);
    expect(label).toBe("FY2023");
  });

  test("instant (no startDate) → as_of_ label", () => {
    const { label, periodType } = buildPeriodLabel(null, "2024-09-30", 12);
    expect(label).toBe("as_of_2024-09-30");
    expect(periodType).toBe("instant");
  });

  test("9-month YTD → 9M label", () => {
    const { label } = buildPeriodLabel("2024-01-01", "2024-09-30", 12);
    expect(label).toBe("9M FY2024");
  });

  test("non-December fiscal year end shifts quarter assignment", () => {
    // Apple FY ends in September; Oct–Dec = Q1 of next FY
    const { label } = buildPeriodLabel("2023-10-01", "2023-12-31", 9);
    expect(label).toBe("Q1 FY2024");
  });
});

// ── filterByPeriodSpec ────────────────────────────────────────────────────────

describe("filterByPeriodSpec", () => {
  const facts = [
    makeFact({ period_label: "Q1 FY2024", end_date: "2024-03-31" }),
    makeFact({ period_label: "Q2 FY2024", end_date: "2024-06-30" }),
    makeFact({ period_label: "Q3 FY2024", end_date: "2024-09-30" }),
    makeFact({ period_label: "Q4 FY2024", end_date: "2024-12-31" }),
    makeFact({ period_label: "Q1 FY2025", end_date: "2025-03-31" }),
    makeFact({ period_label: "FY2023",    end_date: "2023-12-31" }),
  ];

  test("last_4_quarters returns 4 most recent quarterly facts in chron order", () => {
    const result = filterByPeriodSpec(facts, "last_4_quarters");
    expect(result.map((f) => f.period_label)).toEqual([
      "Q2 FY2024", "Q3 FY2024", "Q4 FY2024", "Q1 FY2025",
    ]);
  });

  test("all returns every fact unchanged", () => {
    expect(filterByPeriodSpec(facts, "all")).toHaveLength(facts.length);
  });

  test("exact label match returns only that period", () => {
    const result = filterByPeriodSpec(facts, "FY2023");
    expect(result).toHaveLength(1);
    expect(result[0]!.period_label).toBe("FY2023");
  });

  test("exact label with no match returns empty array", () => {
    expect(filterByPeriodSpec(facts, "Q2 FY2022")).toHaveLength(0);
  });

  test("last_8_quarters caps at available quarterly facts", () => {
    const result = filterByPeriodSpec(facts, "last_8_quarters");
    // Only 5 quarterly facts available
    expect(result).toHaveLength(5);
  });

  test("annual facts are excluded from last_N_quarters", () => {
    const result = filterByPeriodSpec(facts, "last_4_quarters");
    expect(result.every((f) => /^Q[1-4]/.test(f.period_label))).toBe(true);
  });
});

// ── filterMultiByPeriodSpec ───────────────────────────────────────────────────

describe("filterMultiByPeriodSpec", () => {
  // 3 segments × 4 quarters = 12 segment facts
  const segFacts: SegmentFact[] = [
    "Q2 FY2024", "Q3 FY2024", "Q4 FY2024", "Q1 FY2025",
  ].flatMap((label, qi) => [
    makeSegmentFact(label, `2024-0${qi + 4}-30`.replace("0130", "0131"), "North America", 100 + qi),
    makeSegmentFact(label, `2024-0${qi + 4}-30`.replace("0130", "0131"), "International", 50 + qi),
    makeSegmentFact(label, `2024-0${qi + 4}-30`.replace("0130", "0131"), "AWS", 30 + qi),
  ]);

  test("last_4_quarters returns all members for each of 4 periods", () => {
    const result = filterMultiByPeriodSpec(segFacts, "last_4_quarters");
    // 4 periods × 3 members = 12
    expect(result).toHaveLength(12);
  });

  test("last_2_quarters returns 2 periods × all members", () => {
    const result = filterMultiByPeriodSpec(segFacts, "last_2_quarters");
    expect(result).toHaveLength(6);
    const labels = [...new Set(result.map((f) => f.period_label))];
    expect(labels).toHaveLength(2);
  });

  test("result is sorted chronologically by end_date", () => {
    const result = filterMultiByPeriodSpec(segFacts, "last_4_quarters");
    const ends = result.map((f) => f.end_date);
    const sorted = [...ends].sort();
    expect(ends).toEqual(sorted);
  });

  test("all returns every segment fact", () => {
    expect(filterMultiByPeriodSpec(segFacts, "all")).toHaveLength(segFacts.length);
  });

  test("exact label returns only facts for that period", () => {
    const result = filterMultiByPeriodSpec(segFacts, "Q3 FY2024");
    expect(result).toHaveLength(3);
    expect(result.every((f) => f.period_label === "Q3 FY2024")).toBe(true);
  });

  test("preserves all segment members (not just the first per period)", () => {
    const result = filterMultiByPeriodSpec(segFacts, "last_4_quarters");
    const q3members = result
      .filter((f) => f.period_label === "Q3 FY2024")
      .map((f) => f.segment_member);
    expect(q3members).toContain("North America");
    expect(q3members).toContain("International");
    expect(q3members).toContain("AWS");
  });
});
