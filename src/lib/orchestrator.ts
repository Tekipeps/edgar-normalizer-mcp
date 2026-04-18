import {
  fetchCompanyFacts,
  fetchSubmissions,
  resolveCikFromTicker,
} from "../data/edgar.ts";
import {
  resolveAliasesToConcepts,
  getAliasSuggestions,
} from "../data/concept-aliases.ts";
import { resolveConceptViaMercury } from "../synthesis/mercury.ts";
import { buildPeriodLabel, filterByPeriodSpec, parseFiscalYearEnd } from "./period-spine.ts";
import type {
  CompanyFactsDoc,
  EdgarFact,
  EdgarFactRaw,
  PeriodFilter,
  SegmentFact,
  SegmentToolOutput,
  ToolOutput,
  ConceptResolution,
} from "../types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseConceptUri(conceptUri: string): { namespace: string; tagName: string } {
  const slash = conceptUri.indexOf("/");
  if (slash === -1) return { namespace: "us-gaap", tagName: conceptUri };
  return { namespace: conceptUri.slice(0, slash), tagName: conceptUri.slice(slash + 1) };
}

function buildSourceUrl(cik: string, accn: string): string {
  const noDashes = accn.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${noDashes}/${accn}-index.htm`;
}

// Determine scale from the `decimals` field.
// EDGAR: decimals=-3 means values are in thousands; decimals=-6 in millions.
// "INF" means exact (usually share counts).
function resolveScale(raw: EdgarFactRaw[], unit: string): number {
  // Sample up to 20 facts to determine consistent scale
  const sample = raw.slice(0, 20);
  const decimalsSample = sample
    .map((f) => (f.decimals === "INF" ? 0 : typeof f.decimals === "number" ? f.decimals : 0))
    .filter((d) => d !== 0);

  if (decimalsSample.length > 0) {
    // Use mode of decimals values
    const counts = new Map<number, number>();
    for (const d of decimalsSample) counts.set(d, (counts.get(d) ?? 0) + 1);
    let modeDecimals = 0;
    let maxCount = 0;
    for (const [d, c] of counts) {
      if (c > maxCount) { maxCount = c; modeDecimals = d; }
    }
    if (modeDecimals === -3) return 1_000;
    if (modeDecimals === -6) return 1_000_000;
    if (modeDecimals <= -9) return 1_000_000_000;
    return 1;
  }

  // Heuristic fallback for USD values with no decimals field
  if (unit === "USD") {
    const values = raw.slice(0, 20).map((f) => Math.abs(f.val)).filter((v) => v > 0);
    if (values.length === 0) return 1;
    // Use average of sample instead of sorting full array
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    if (avg > 0 && avg < 1e8) return 1_000;
  }

  return 1;
}

function selectPrimaryUnit(units: Record<string, EdgarFactRaw[]>, conceptUri: string): string {
  // EPS concepts live under USD/shares
  if (conceptUri.includes("EarningsPerShare") || conceptUri.includes("BookValuePerShare")) {
    if ("USD/shares" in units) return "USD/shares";
  }
  // Prefer USD for monetary, shares for share count concepts
  if ("USD" in units) return "USD";
  if ("shares" in units) return "shares";
  // Fallback: unit with most facts
  let best = "";
  let bestCount = 0;
  for (const [unit, facts] of Object.entries(units)) {
    if (facts.length > bestCount) { bestCount = facts.length; best = unit; }
  }
  return best;
}

// ── Core normalization pipeline ───────────────────────────────────────────────

export async function normalizeConceptFacts(
  cik: string,
  ticker: string,
  conceptUri: string,
  periodSpec: PeriodFilter,
  prefetchedDoc?: CompanyFactsDoc,
): Promise<ToolOutput<EdgarFact>> {
  const freshness_as_of = new Date().toISOString();

  // Step 1: Fetch companyfacts (or reuse pre-fetched)
  const [doc, sub] = await Promise.all([
    prefetchedDoc ? Promise.resolve(prefetchedDoc) : fetchCompanyFacts(cik),
    fetchSubmissions(cik),
  ]);

  const fiscalYearEndMonth = parseFiscalYearEnd(sub.fiscalYearEnd);

  // Step 2: Filter to requested concept
  const { namespace, tagName } = parseConceptUri(conceptUri);
  const conceptData = doc.facts[namespace]?.[tagName];
  const conceptLabel = conceptData?.label ?? tagName;

  if (!conceptData) {
    return {
      ticker, cik, concept: conceptUri, label: conceptLabel,
      facts: [], freshness_as_of, concept_aliases_checked: [conceptUri],
    };
  }

  // Step 3: Resolve units — pick primary unit series
  const primaryUnit = selectPrimaryUnit(conceptData.units, conceptUri);
  const rawFacts: EdgarFactRaw[] = conceptData.units[primaryUnit] ?? [];

  // Step 4: Normalize scale
  const scale = resolveScale(rawFacts, primaryUnit);

  // Step 5: Build period spine + Step 6: Deduplicate
  // Group by period label, keep most recently filed per period
  const periodMap = new Map<string, { fact: EdgarFact; filedMs: number; count: number }>();

  for (const raw of rawFacts) {
    const { label: periodLabel, periodType } = buildPeriodLabel(
      raw.start,
      raw.end,
      fiscalYearEndMonth,
    );

    const isAmendment = raw.form.endsWith("/A");
    const filedMs = new Date(raw.filed).getTime();

    const fact: EdgarFact = {
      period_label:     periodLabel,
      period_type:      periodType,
      start_date:       raw.start ?? null,
      end_date:         raw.end,
      value:            raw.val,
      unit:             primaryUnit,
      scale,
      value_normalized: raw.val * scale,
      filing_type:      raw.form,
      accession_number: raw.accn,
      filed_date:       raw.filed,
      is_amendment:     isAmendment,
      source_url:       buildSourceUrl(cik, raw.accn),
    };

    const existing = periodMap.get(periodLabel);
    if (!existing) {
      periodMap.set(periodLabel, { fact, filedMs, count: 1 });
    } else if (filedMs > existing.filedMs) {
      // Keep most recent filing for this period; flag as amendment if period had multiple filings
      periodMap.set(periodLabel, {
        fact: { ...fact, is_amendment: fact.is_amendment || existing.count > 0 },
        filedMs,
        count: existing.count + 1,
      });
    } else {
      periodMap.set(periodLabel, { ...existing, count: existing.count + 1 });
    }
  }

  // Step 7: Sort chronologically + apply period filter
  const allFacts = [...periodMap.values()]
    .map((e) => e.fact)
    .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());

  const filtered = filterByPeriodSpec(allFacts, periodSpec);

  // Warn if the most recent fact is over 2 years old — company may have switched concepts
  const latestFact = allFacts[allFacts.length - 1];
  const twoYearsAgo = Date.now() - 2 * 365.25 * 24 * 3600 * 1000;
  const staleness_warning =
    latestFact && new Date(latestFact.filed_date).getTime() < twoYearsAgo
      ? `Most recent data for "${conceptUri}" is from ${latestFact.filed_date}. The company may have adopted a different XBRL concept (e.g. RevenueFromContractWithCustomerExcludingAssessedTax replaced Revenues after ASC 606).`
      : undefined;

  return {
    ticker, cik, concept: conceptUri, label: conceptLabel,
    facts: filtered, freshness_as_of, concept_aliases_checked: [conceptUri],
    ...(staleness_warning ? { staleness_warning } : {}),
  };
}

// ── Alias resolution variant ──────────────────────────────────────────────────

export async function normalizeWithAliasResolution(
  cik: string,
  ticker: string,
  label: string,
  periodSpec: PeriodFilter,
  prefetchedDoc?: CompanyFactsDoc,
): Promise<ToolOutput<EdgarFact>> {
  const { concepts, confidence: _c } = resolveAliasesToConcepts(label);

  if (concepts.length === 0) {
    return {
      ticker, cik, concept: label, label,
      facts: [], freshness_as_of: new Date().toISOString(),
      concept_aliases_checked: [],
      isError: true,
      error_message: `No XBRL concept mapping found for "${label}"`,
    };
  }

  // Fetch doc once, try concepts in order
  const doc = prefetchedDoc ?? await fetchCompanyFacts(cik);
  const tried: string[] = [];

  // Collect all candidates with data, then pick the one with the most recent filing
  const candidates: Array<{ conceptUri: string; latestFiled: number }> = [];
  for (const conceptUri of concepts) {
    tried.push(conceptUri);
    const { namespace, tagName } = parseConceptUri(conceptUri);
    const conceptData = doc.facts[namespace]?.[tagName];
    if (!conceptData) continue;
    const primaryUnit = selectPrimaryUnit(conceptData.units, conceptUri);
    const rawFacts = conceptData.units[primaryUnit] ?? [];
    if (rawFacts.length === 0) continue;
    const latestFiled = Math.max(...rawFacts.map((f) => new Date(f.filed).getTime()));
    candidates.push({ conceptUri, latestFiled });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.latestFiled - a.latestFiled);
    const best = candidates[0]!;
    const result = await normalizeConceptFacts(cik, ticker, best.conceptUri, periodSpec, doc);
    return { ...result, concept_aliases_checked: tried };
  }

  // None found
  return {
    ticker, cik, concept: label, label,
    facts: [], freshness_as_of: new Date().toISOString(),
    concept_aliases_checked: tried,
    isError: false, // not an error — company just doesn't have this data
  };
}

// ── Concept resolution (for resolve_concept tool) ─────────────────────────────

export async function resolveConceptForTicker(
  ticker: string,
  label: string,
): Promise<ConceptResolution> {
  const cik = await resolveCikFromTicker(ticker);
  const { concepts, confidence } = resolveAliasesToConcepts(label);

  const [doc, sub] = await Promise.all([fetchCompanyFacts(cik), fetchSubmissions(cik)]);
  const fiscalYearEndMonth = parseFiscalYearEnd(sub.fiscalYearEnd);

  let conceptsToTry = concepts;

  // Static alias map had no match — ask Mercury 2 to resolve the label
  if (conceptsToTry.length === 0) {
    // Pass concept names present in this company's EDGAR data as candidates
    const availableConcepts: string[] = [];
    for (const [ns, tags] of Object.entries(doc.facts)) {
      for (const tag of Object.keys(tags)) {
        availableConcepts.push(`${ns}/${tag}`);
      }
    }
    const mercuryResult = await resolveConceptViaMercury(label, availableConcepts);
    if (!mercuryResult) {
      return {
        found: false,
        aliases_tried: [],
        suggestions: getAliasSuggestions(label),
      };
    }
    // Use Mercury's answer as the concept list to try
    conceptsToTry = [mercuryResult.concept_uri, ...mercuryResult.alternatives].filter(Boolean);
  }

  const tried: string[] = [];

  for (const conceptUri of conceptsToTry) {
    tried.push(conceptUri);
    const { namespace, tagName } = parseConceptUri(conceptUri);
    const conceptData = doc.facts[namespace]?.[tagName];
    if (!conceptData) continue;

    const primaryUnit = selectPrimaryUnit(conceptData.units, conceptUri);
    const rawFacts: EdgarFactRaw[] = conceptData.units[primaryUnit] ?? [];
    if (rawFacts.length === 0) continue;

    const scale = resolveScale(rawFacts, primaryUnit);

    // Get the most recent fact as a sample
    const mostRecent = [...rawFacts].sort(
      (a, b) => new Date(b.filed).getTime() - new Date(a.filed).getTime(),
    )[0];

    let sampleFact: EdgarFact | null = null;
    if (mostRecent) {
      const { label: periodLabel, periodType } = buildPeriodLabel(
        mostRecent.start, mostRecent.end, fiscalYearEndMonth,
      );
      sampleFact = {
        period_label: periodLabel, period_type: periodType,
        start_date: mostRecent.start ?? null, end_date: mostRecent.end,
        value: mostRecent.val, unit: primaryUnit, scale,
        value_normalized: mostRecent.val * scale,
        filing_type: mostRecent.form, accession_number: mostRecent.accn,
        filed_date: mostRecent.filed, is_amendment: mostRecent.form.endsWith("/A"),
        source_url: buildSourceUrl(cik, mostRecent.accn),
      };
    }

    const periodsSet = new Set(rawFacts.map((f) => f.end));

    return {
      found: true,
      concept_uri: conceptUri,
      label: conceptData.label,
      confidence: tried.length === 1 ? confidence as "exact" | "alias" : "fallback",
      aliases_tried: tried,
      periods_available: periodsSet.size,
      sample_fact: sampleFact,
    };
  }

  return {
    found: false,
    aliases_tried: tried,
    suggestions: getAliasSuggestions(label),
  };
}

// ── Segment facts ─────────────────────────────────────────────────────────────

export async function extractSegmentFacts(
  cik: string,
  ticker: string,
  conceptUri: string,
  _segmentDimension: string,
): Promise<SegmentToolOutput> {
  const freshness_as_of = new Date().toISOString();
  const [doc, sub] = await Promise.all([fetchCompanyFacts(cik), fetchSubmissions(cik)]);
  const fiscalYearEndMonth = parseFiscalYearEnd(sub.fiscalYearEnd);

  const { namespace, tagName } = parseConceptUri(conceptUri);
  const conceptData = doc.facts[namespace]?.[tagName];

  if (!conceptData) {
    return {
      ticker, cik, concept: conceptUri, label: tagName,
      facts: [], freshness_as_of, concept_aliases_checked: [conceptUri],
      segments_available: false,
      message: `Concept "${conceptUri}" not found for ${ticker}`,
    };
  }

  const primaryUnit = selectPrimaryUnit(conceptData.units, conceptUri);
  const rawFacts: EdgarFactRaw[] = conceptData.units[primaryUnit] ?? [];
  const scale = resolveScale(rawFacts, primaryUnit);

  // Detect potential segment facts: group by end_date + form, look for periods
  // with more entries than expected (consolidated = 1 entry per period/form combo)
  const periodFormMap = new Map<string, EdgarFactRaw[]>();
  for (const raw of rawFacts) {
    const key = `${raw.end}::${raw.form}`;
    const existing = periodFormMap.get(key) ?? [];
    existing.push(raw);
    periodFormMap.set(key, existing);
  }

  const segmentGroups = [...periodFormMap.values()].filter((g) => g.length > 1);

  if (segmentGroups.length === 0) {
    return {
      ticker, cik, concept: conceptUri, label: conceptData.label,
      facts: [], freshness_as_of, concept_aliases_checked: [conceptUri],
      segments_available: false,
      message: `${ticker} does not appear to tag segment data for "${conceptUri}" in XBRL. Segment breakdown unavailable via EDGAR REST API.`,
    };
  }

  // Build segment facts from groups with multiple entries per period
  const segmentFacts: SegmentFact[] = [];
  for (const group of segmentGroups) {
    for (let i = 0; i < group.length; i++) {
      const raw = group[i];
      if (!raw) continue;
      const { label: periodLabel, periodType } = buildPeriodLabel(
        raw.start, raw.end, fiscalYearEndMonth,
      );
      segmentFacts.push({
        period_label: periodLabel, period_type: periodType,
        start_date: raw.start ?? null, end_date: raw.end,
        value: raw.val, unit: primaryUnit, scale,
        value_normalized: raw.val * scale,
        filing_type: raw.form, accession_number: raw.accn,
        filed_date: raw.filed, is_amendment: raw.form.endsWith("/A"),
        source_url: buildSourceUrl(cik, raw.accn),
        segment_dimension: _segmentDimension,
        segment_member: `segment_${i + 1}`,
      });
    }
  }

  segmentFacts.sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());

  return {
    ticker, cik, concept: conceptUri, label: conceptData.label,
    facts: segmentFacts, freshness_as_of, concept_aliases_checked: [conceptUri],
    segments_available: true,
  };
}
