import type { EdgarFact, PeriodFilter } from "../types.ts";

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// ── Fiscal year end parsing ───────────────────────────────────────────────────

// EDGAR fiscalYearEnd format: "--MM-DD" or "MM-DD" or null/empty
export function parseFiscalYearEnd(fyeString: string | undefined | null): number {
  if (!fyeString) return 12;
  // EDGAR returns "MMDD" (e.g. "0928") — handle this first
  const mmddMatch = fyeString.match(/^(\d{2})\d{2}$/);
  if (mmddMatch?.[1]) {
    const month = parseInt(mmddMatch[1], 10);
    if (!isNaN(month) && month >= 1 && month <= 12) return month;
  }
  // Also handle "--MM-DD" or "MM-DD" formats
  const dashMatch = fyeString.match(/(\d{2})-\d{2}$/);
  if (dashMatch?.[1]) {
    const month = parseInt(dashMatch[1], 10);
    if (!isNaN(month) && month >= 1 && month <= 12) return month;
  }
  return 12;
}

// ── Period label builder ──────────────────────────────────────────────────────

export function buildPeriodLabel(
  startDate: string | undefined | null,
  endDate: string,
  fiscalYearEndMonth: number,
): { label: string; periodType: "instant" | "duration" } {
  if (!startDate) {
    // Instant (point-in-time) fact
    return { label: `as_of_${endDate}`, periodType: "instant" };
  }

  const days = daysBetween(startDate, endDate);
  const endDateObj = new Date(endDate);
  const endMonth = endDateObj.getUTCMonth() + 1; // 1-based
  const endYear  = endDateObj.getUTCFullYear();

  // ── Annual: ~365 days ─────────────────────────────────────────────────────
  if (days >= 350 && days <= 380) {
    // Determine fiscal year: if endMonth <= fiscalYearEndMonth, FY = endYear; else FY = endYear+1
    // (e.g., Apple FY ends Sept; period ending Sept 2023 is FY2023; period ending Dec 2023 would be Q1 FY2024)
    const fyYear = endMonth <= fiscalYearEndMonth ? endYear : endYear + 1;
    return { label: `FY${fyYear}`, periodType: "duration" };
  }

  // ── Half-year: ~182 days ──────────────────────────────────────────────────
  if (days >= 167 && days <= 197) {
    const fyYear = endMonth <= fiscalYearEndMonth ? endYear : endYear + 1;
    // Determine whether first or second half relative to fiscal year end
    const monthsFromFYEnd = ((endMonth - fiscalYearEndMonth + 12) % 12) || 12;
    const half = monthsFromFYEnd <= 6 ? "H1" : "H2";
    return { label: `${half} FY${fyYear}`, periodType: "duration" };
  }

  // ── Quarterly: ~91 days ───────────────────────────────────────────────────
  if (days >= 76 && days <= 106) {
    return { label: buildQuarterLabel(endMonth, endYear, fiscalYearEndMonth), periodType: "duration" };
  }

  // ── YTD cumulative quarterly windows (common in 10-Q filings) ────────────
  // 9-month YTD (~274 days), 6-month YTD (~182 already handled above), etc.
  // These are NOT pure quarterly — label them explicitly so deduplication prefers pure quarters
  if (days >= 259 && days <= 289) {
    const fyYear = endMonth <= fiscalYearEndMonth ? endYear : endYear + 1;
    return { label: `9M FY${fyYear}`, periodType: "duration" };
  }

  // Fallback: raw date range
  return { label: `${startDate}_${endDate}`, periodType: "duration" };
}

function buildQuarterLabel(endMonth: number, endYear: number, fiscalYearEndMonth: number): string {
  // Months-since-fiscal-year-end (1-based, 1 = first month after FYE)
  const monthOffset = ((endMonth - fiscalYearEndMonth + 12) % 12) || 12;
  const quarter = Math.ceil(monthOffset / 3);

  // Fiscal year: if endMonth <= fiscalYearEndMonth, we're in current FY; otherwise next FY
  const fyYear = endMonth <= fiscalYearEndMonth ? endYear : endYear + 1;

  return `Q${quarter} FY${fyYear}`;
}

// ── Period filter ─────────────────────────────────────────────────────────────

export function filterByPeriodSpec(facts: EdgarFact[], periodSpec: PeriodFilter): EdgarFact[] {
  if (periodSpec === "all") return facts;

  const quarterMatch = periodSpec.match(/^last_(\d+)_quarters$/);
  if (quarterMatch) {
    const n = parseInt(quarterMatch[1] ?? "4", 10);
    // Prefer pure quarterly (~91-day) facts. Mark them by label pattern Q{n} FY{yyyy}
    const quarterlyFacts = facts.filter((f) => /^Q[1-4] FY\d{4}$/.test(f.period_label));
    // Sort by end_date descending, take N distinct period labels
    const sorted = [...quarterlyFacts].sort(
      (a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime(),
    );
    const seen = new Set<string>();
    const result: EdgarFact[] = [];
    for (const f of sorted) {
      if (!seen.has(f.period_label)) {
        seen.add(f.period_label);
        result.push(f);
        if (result.length === n) break;
      }
    }
    // Return in chronological order
    return result.sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());
  }

  // Exact period label match (e.g., "FY2023", "Q3 FY2024")
  return facts.filter((f) => f.period_label === periodSpec);
}
