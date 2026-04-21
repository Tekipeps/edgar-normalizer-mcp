import {
  fetchCompanyFacts,
  fetchSubmissions,
  fetchXbrlDoc,
  resolveCikFromTicker,
} from "../data/edgar.ts";
import { extractXbrlSegmentEntries } from "./xbrl-parser.ts";
import {
  resolveAliasesToConcepts,
  getAliasSuggestions,
} from "../data/concept-aliases.ts";
import { resolveConceptViaMercury } from "../synthesis/mercury.ts";
import { buildPeriodLabel, filterByPeriodSpec, filterMultiByPeriodSpec, parseFiscalYearEnd } from "./period-spine.ts";
import type {
  CompanyFactsDoc,
  EdgarFact,
  EdgarFactRaw,
  PeriodFilter,
  SubmissionsDoc,
  SegmentFact,
  SegmentToolOutput,
  ToolOutput,
  ConceptResolution,
  XbrlConceptSummary,
  XbrlConceptsOutput,
  ComparePeriodsOutput,
  PeriodPoint,
} from "../types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseConceptUri(conceptUri: string): { namespace: string; tagName: string } {
  const slash = conceptUri.indexOf("/");
  if (slash === -1) return { namespace: "us-gaap", tagName: conceptUri };
  return { namespace: conceptUri.slice(0, slash), tagName: conceptUri.slice(slash + 1) };
}

function normalizeConceptLabel(tagName: string, rawLabel: string | null | undefined): string {
  const label = rawLabel?.trim();
  return label ? label : tagName;
}

function isAnnualQuery(periodSpec: PeriodFilter): boolean {
  return /last_\d+_years?/.test(periodSpec) || /^FY\d{4}$/.test(periodSpec);
}

function isRelativePeriodQuery(periodSpec: PeriodFilter): boolean {
  return /^last_\d+_(quarters|years?)$/.test(periodSpec);
}

function scoreConceptCandidate(rawFacts: EdgarFactRaw[], periodSpec: PeriodFilter): number {
  const latestFiled = Math.max(...rawFacts.map((f) => new Date(f.filed).getTime()));
  if (!isAnnualQuery(periodSpec)) return latestFiled;

  return (
    Math.max(
      0,
      ...rawFacts
        .filter((f) => {
          const days = f.start
            ? Math.round((new Date(f.end).getTime() - new Date(f.start).getTime()) / 86_400_000)
            : 0;
          return days >= 350 && days <= 380;
        })
        .map((f) => new Date(f.end).getTime()),
    ) || latestFiled
  );
}

function rankAvailableConceptCandidates(
  doc: CompanyFactsDoc,
  conceptUris: string[],
  periodSpec: PeriodFilter,
): Array<{ conceptUri: string; latestFiled: number }> {
  const candidates: Array<{ conceptUri: string; latestFiled: number }> = [];

  for (const conceptUri of conceptUris) {
    const { namespace, tagName } = parseConceptUri(conceptUri);
    const conceptData = doc.facts[namespace]?.[tagName];
    if (!conceptData) continue;
    const primaryUnit = selectPrimaryUnit(conceptData.units, conceptUri);
    const rawFacts = conceptData.units[primaryUnit] ?? [];
    if (rawFacts.length === 0) continue;
    candidates.push({
      conceptUri,
      latestFiled: scoreConceptCandidate(rawFacts, periodSpec),
    });
  }

  candidates.sort((a, b) => b.latestFiled - a.latestFiled);
  return candidates;
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

// ── Q4 derivation helper ──────────────────────────────────────────────────────
// For companies that only report Q4 in their annual 10-K (e.g. Apple), there is no
// standalone quarterly XBRL fact for Q4. Derive it as FY − 9M YTD when both exist.
// Only applies to USD flow concepts (not per-share, not balance-sheet instants).

function deriveQ4Facts(allFacts: EdgarFact[], unit: string): EdgarFact[] {
  if (unit !== "USD") return [];

  const annualByFY    = new Map<string, EdgarFact>(); // "FY2024" → annual fact
  const nineMonthByFY = new Map<string, EdgarFact>(); // "FY2024" → 9M YTD fact
  const hasQ4         = new Set<string>();            // FY labels that already have Q4

  for (const f of allFacts) {
    if (/^FY\d{4}$/.test(f.period_label))    annualByFY.set(f.period_label, f);
    if (/^9M FY\d{4}$/.test(f.period_label)) nineMonthByFY.set(f.period_label.slice(3), f);
    if (/^Q4 FY\d{4}$/.test(f.period_label)) hasQ4.add(f.period_label.slice(3));
  }

  const derived: EdgarFact[] = [];
  for (const [fyLabel, annual] of annualByFY) {
    if (hasQ4.has(fyLabel)) continue;
    const nineM = nineMonthByFY.get(fyLabel);
    if (!nineM || !annual.start_date || !nineM.start_date) continue;

    const q4Val = annual.value - nineM.value;
    derived.push({
      ...annual,
      period_label:     `Q4 ${fyLabel}`,
      start_date:       nineM.end_date,
      value:            q4Val,
      value_normalized: q4Val * annual.scale,
      is_derived:       true,
    });
  }
  return derived;
}

function deriveQ4SegmentFacts(allFacts: SegmentFact[], unit: string): SegmentFact[] {
  if (unit !== "USD") return [];

  const factsByMember = new Map<string, SegmentFact[]>();
  for (const fact of allFacts) {
    const existing = factsByMember.get(fact.segment_member) ?? [];
    existing.push(fact);
    factsByMember.set(fact.segment_member, existing);
  }

  const derived: SegmentFact[] = [];

  for (const memberFacts of factsByMember.values()) {
    const annualByFY = new Map<string, SegmentFact>();
    const nineMonthByFY = new Map<string, SegmentFact>();
    const hasQ4 = new Set<string>();

    for (const fact of memberFacts) {
      if (/^FY\d{4}$/.test(fact.period_label)) annualByFY.set(fact.period_label, fact);
      if (/^9M FY\d{4}$/.test(fact.period_label)) nineMonthByFY.set(fact.period_label.slice(3), fact);
      if (/^Q4 FY\d{4}$/.test(fact.period_label)) hasQ4.add(fact.period_label.slice(3));
    }

    for (const [fyLabel, annual] of annualByFY) {
      if (hasQ4.has(fyLabel)) continue;
      const nineM = nineMonthByFY.get(fyLabel);
      if (!nineM || !annual.start_date || !nineM.start_date) continue;

      const q4Val = annual.value - nineM.value;
      derived.push({
        ...annual,
        period_label: `Q4 ${fyLabel}`,
        start_date: nineM.end_date,
        value: q4Val,
        value_normalized: q4Val * annual.scale,
        is_derived: true,
      });
    }
  }

  return derived;
}

async function normalizeWithExplicitFallback(
  cik: string,
  ticker: string,
  requestedConcept: string,
  conceptLabel: string,
  periodSpec: PeriodFilter,
  doc: CompanyFactsDoc,
  sub: SubmissionsDoc,
  currentConceptScore: number,
): Promise<ToolOutput<EdgarFact> | null> {
  const { concepts } = resolveAliasesToConcepts(conceptLabel);
  const tried = [requestedConcept, ...concepts.filter((uri) => uri !== requestedConcept)];
  const fallbackCandidates = rankAvailableConceptCandidates(
    doc,
    tried.filter((uri) => uri !== requestedConcept),
    periodSpec,
  );

  const bestFallback = fallbackCandidates[0];
  if (!bestFallback || bestFallback.latestFiled <= currentConceptScore) return null;

  const result = await normalizeConceptFacts(
    cik,
    ticker,
    bestFallback.conceptUri,
    periodSpec,
    doc,
    sub,
  );

  return {
    ...result,
    requested_concept: requestedConcept,
    resolved_from_deprecated_concept: true,
    concept_aliases_checked: tried,
    staleness_warning:
      `Requested concept "${requestedConcept}" is stale for ${ticker}. ` +
      `Returned "${result.concept}" instead based on fresher EDGAR data.`,
  };
}

// ── Core normalization pipeline ───────────────────────────────────────────────

export async function normalizeConceptFacts(
  cik: string,
  ticker: string,
  conceptUri: string,
  periodSpec: PeriodFilter,
  prefetchedDoc?: CompanyFactsDoc,
  prefetchedSubmissions?: SubmissionsDoc,
): Promise<ToolOutput<EdgarFact>> {
  const freshness_as_of = new Date().toISOString();

  // Step 1: Fetch companyfacts (or reuse pre-fetched)
  const [doc, sub] = await Promise.all([
    prefetchedDoc ? Promise.resolve(prefetchedDoc) : fetchCompanyFacts(cik),
    prefetchedSubmissions ? Promise.resolve(prefetchedSubmissions) : fetchSubmissions(cik),
  ]);

  const fiscalYearEndMonth = parseFiscalYearEnd(sub.fiscalYearEnd);

  // Step 2: Filter to requested concept
  const { namespace, tagName } = parseConceptUri(conceptUri);
  const conceptData = doc.facts[namespace]?.[tagName];
  const conceptLabel = normalizeConceptLabel(tagName, conceptData?.label);

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
  const currentConceptScore = scoreConceptCandidate(rawFacts, periodSpec);

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

  // Step 7: Sort chronologically, synthesize missing Q4s, then apply period filter
  const allFacts = [...periodMap.values()]
    .map((e) => e.fact)
    .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());

  const q4Derived = deriveQ4Facts(allFacts, primaryUnit);
  const allFactsWithQ4 = q4Derived.length > 0
    ? [...allFacts, ...q4Derived].sort(
        (a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime(),
      )
    : allFacts;

  const filtered = filterByPeriodSpec(allFactsWithQ4, periodSpec);

  // Warn if the most recent fact is over 2 years old — company may have switched concepts
  const latestFact = allFactsWithQ4[allFactsWithQ4.length - 1];
  const twoYearsAgo = Date.now() - 2 * 365.25 * 24 * 3600 * 1000;
  const requestedConceptIsStale =
    !!latestFact && new Date(latestFact.filed_date).getTime() < twoYearsAgo;
  const staleness_warning =
    requestedConceptIsStale
      ? `Most recent data for "${conceptUri}" is from ${latestFact.filed_date}. The company may have adopted a different XBRL concept (e.g. RevenueFromContractWithCustomerExcludingAssessedTax replaced Revenues after ASC 606).`
      : undefined;

  const shouldAttemptExplicitFallback =
    periodSpec !== "all" &&
    (
      (isRelativePeriodQuery(periodSpec) && requestedConceptIsStale) ||
      (!isRelativePeriodQuery(periodSpec) && filtered.length === 0)
    );

  if (shouldAttemptExplicitFallback) {
    const fallbackResult = await normalizeWithExplicitFallback(
      cik,
      ticker,
      conceptUri,
      conceptLabel,
      periodSpec,
      doc,
      sub,
      currentConceptScore,
    );
    if (fallbackResult) return fallbackResult;
  }

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
  prefetchedSubmissions?: SubmissionsDoc,
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

  for (const conceptUri of concepts) tried.push(conceptUri);
  const candidates = rankAvailableConceptCandidates(doc, concepts, periodSpec);

  if (candidates.length > 0) {
    const best = candidates[0]!;
    const result = await normalizeConceptFacts(
      cik,
      ticker,
      best.conceptUri,
      periodSpec,
      doc,
      prefetchedSubmissions,
    );
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
      label: normalizeConceptLabel(tagName, conceptData.label),
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
  periodSpec: PeriodFilter = "last_4_quarters",
): Promise<SegmentToolOutput> {
  const freshness_as_of = new Date().toISOString();
  const [doc, sub] = await Promise.all([fetchCompanyFacts(cik), fetchSubmissions(cik)]);
  const fiscalYearEndMonth = parseFiscalYearEnd(sub.fiscalYearEnd);

  // Build the list of URIs to try: aliases first (if the input matches a known label),
  // then the raw URI as a fallback so explicit URIs still work.
  const { concepts: aliasedConcepts } = resolveAliasesToConcepts(conceptUri);
  const candidateUris = aliasedConcepts.length > 0
    ? [...new Set([...aliasedConcepts, conceptUri])]
    : [conceptUri];

  const tried: string[] = [];
  type ConceptEntry = { label: string | null; description: string | null; units: Record<string, EdgarFactRaw[]> };
  const candidates: Array<{ uri: string; data: ConceptEntry; latestFiled: number }> = [];

  for (const uri of candidateUris) {
    tried.push(uri);
    const { namespace, tagName } = parseConceptUri(uri);
    const data = doc.facts[namespace]?.[tagName];
    if (!data) continue;
    const primaryUnit = selectPrimaryUnit(data.units, uri);
    const rawFacts = data.units[primaryUnit] ?? [];
    if (rawFacts.length === 0) continue;
    const latestFiled = Math.max(...rawFacts.map((f) => new Date(f.filed).getTime()));
    candidates.push({ uri, data, latestFiled });
  }

  candidates.sort((a, b) => b.latestFiled - a.latestFiled);
  const best = candidates[0];
  const resolvedUri = best?.uri ?? conceptUri;
  const conceptData = best?.data;
  const { tagName: resolvedTagName } = parseConceptUri(resolvedUri);
  const conceptLabel = normalizeConceptLabel(resolvedTagName, conceptData?.label);

  if (!conceptData) {
    return {
      ticker, cik, concept: conceptUri, label: conceptUri,
      facts: [], freshness_as_of, concept_aliases_checked: tried,
      segments_available: false,
      message: `Concept "${conceptUri}" not found for ${ticker} (tried: ${tried.join(", ")})`,
    };
  }

  const primaryUnit = selectPrimaryUnit(conceptData.units, resolvedUri);
  const rawFacts: EdgarFactRaw[] = conceptData.units[primaryUnit] ?? [];
  const scale = resolveScale(rawFacts, primaryUnit);
  const { tagName: conceptLocalName } = parseConceptUri(resolvedUri);

  // XBRL-primary extraction: segment-level dimensional facts are NOT in companyfacts
  // for many companies (e.g. Amazon). They exist only in the _htm.xml companion docs.
  // Fetch up to 4 recent iXBRL 10-Q/10-K filings and extract segment entries directly.
  const SEGMENT_AXES = [
    _segmentDimension,
    ...["StatementBusinessSegmentsAxis", "SegmentReportingInformationBySegmentAxis", "BusinessSegmentsAxis"]
      .filter((a) => a !== _segmentDimension),
  ];

  const recent = sub.filings.recent;
  const filingCandidates: Array<{ accn: string; primaryDoc: string; filedDate: string; form: string }> = [];
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    if (recent.isInlineXBRL[i] !== 1) continue;
    const form = recent.form[i] ?? "";
    if (!["10-Q", "10-K", "10-Q/A", "10-K/A"].includes(form)) continue;
    const a = recent.accessionNumber[i];
    const p = recent.primaryDocument[i];
    const d = recent.filingDate[i];
    if (a && p && d) filingCandidates.push({ accn: a, primaryDoc: p, filedDate: d, form });
  }

  const recentIxbrlFilings = [
    ...filingCandidates.filter((f) => !f.form.endsWith("/A")),
    ...filingCandidates.filter((f) => f.form.endsWith("/A")),
  ].slice(0, 4);

  const xmlTexts = await Promise.all(
    recentIxbrlFilings.map((f) => fetchXbrlDoc(cik, f.accn, f.primaryDoc)),
  );

  const xbrlSegmentFacts: SegmentFact[] = [];
  const seenPeriodMember = new Set<string>();

  for (let i = 0; i < xmlTexts.length; i++) {
    const xml = xmlTexts[i];
    const filing = recentIxbrlFilings[i]!;
    if (!xml) continue;

    for (const axis of SEGMENT_AXES) {
      const entries = extractXbrlSegmentEntries(xml, axis, conceptLocalName);
      if (entries.length === 0) continue;

      for (const entry of entries) {
        const key = `${entry.memberName}::${entry.startDate ?? ""}::${entry.endDate}`;
        if (seenPeriodMember.has(key)) continue;
        seenPeriodMember.add(key);

        const { label: periodLabel, periodType } = buildPeriodLabel(
          entry.startDate, entry.endDate, fiscalYearEndMonth,
        );
        xbrlSegmentFacts.push({
          period_label: periodLabel,
          period_type: periodType,
          start_date: entry.startDate ?? null,
          end_date: entry.endDate,
          value: entry.val,
          unit: primaryUnit,
          scale,
          value_normalized: entry.val * scale,
          filing_type: filing.form,
          accession_number: filing.accn,
          filed_date: filing.filedDate,
          is_amendment: filing.form.endsWith("/A"),
          source_url: buildSourceUrl(cik, filing.accn),
          segment_dimension: axis,
          segment_member: entry.memberName,
        });
      }
      break; // found a working axis for this filing; don't try fallbacks
    }
  }

  if (xbrlSegmentFacts.length > 0) {
    xbrlSegmentFacts.sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());
    const q4Derived = deriveQ4SegmentFacts(xbrlSegmentFacts, primaryUnit);
    const allFactsWithQ4 = q4Derived.length > 0
      ? [...xbrlSegmentFacts, ...q4Derived].sort(
          (a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime(),
        )
      : xbrlSegmentFacts;
    const filteredFacts = filterMultiByPeriodSpec(allFactsWithQ4, periodSpec);
    if (filteredFacts.length > 0) {
      return {
        ticker, cik, concept: resolvedUri, label: conceptLabel,
        facts: filteredFacts, freshness_as_of, concept_aliases_checked: tried,
        segments_available: true,
      };
    }
  }

  // XBRL extraction found nothing — no dimension context in companion docs.
  const suggested = discoverSegmentConcepts(doc, fiscalYearEndMonth).slice(0, 8);
  const suggestionNote = suggested.length > 0
    ? ` Concepts with segment data found: ${suggested.map((s) => s.concept_uri).join(", ")}.`
    : "";
  return {
    ticker, cik, concept: resolvedUri, label: conceptLabel,
    facts: [], freshness_as_of, concept_aliases_checked: tried,
    segments_available: false,
    message: `Segment data for "${resolvedUri}" in ${ticker} could not be extracted from iXBRL ` +
      `companion documents (axis: "${_segmentDimension}").${suggestionNote}`,
  };
}

// ── Segment concept discovery ─────────────────────────────────────────────────
// Scans companyfacts for concepts that have multiple values per period, indicating
// segment-level XBRL tagging. Returns them sorted by most-recent data.

function discoverSegmentConcepts(
  doc: CompanyFactsDoc,
  fiscalYearEndMonth: number,
): XbrlConceptSummary[] {
  const results: XbrlConceptSummary[] = [];
  for (const [ns, tags] of Object.entries(doc.facts)) {
    for (const [tag, data] of Object.entries(tags)) {
      const primaryUnit = selectPrimaryUnit(data.units, `${ns}/${tag}`);
      const rawFacts = data.units[primaryUnit] ?? [];
      if (rawFacts.length === 0) continue;

      // Check for segment-like multi-entry periods
      const periodFormMap = new Map<string, number>();
      for (const raw of rawFacts) {
        const key = `${raw.end}::${raw.form}`;
        periodFormMap.set(key, (periodFormMap.get(key) ?? 0) + 1);
      }
      const hasSegmentData = [...periodFormMap.values()].some((c) => c > 1);
      if (!hasSegmentData) continue;

      const sorted = [...rawFacts].sort((a, b) => b.end.localeCompare(a.end));
      const latest = sorted[0]!;
      const scale = resolveScale(rawFacts, primaryUnit);
      results.push({
        concept_uri: `${ns}/${tag}`,
        label: normalizeConceptLabel(tag, data.label),
        namespace: ns,
        tag,
        unit: primaryUnit,
        periods_count: new Set(rawFacts.map((f) => f.end)).size,
        latest_period_end: latest.end,
        latest_value_normalized: latest.val * scale,
        has_segment_data: true,
      });
    }
  }
  results.sort((a, b) => b.latest_period_end.localeCompare(a.latest_period_end));
  // Suppress unused param warning
  void fiscalYearEndMonth;
  return results;
}

// ── Discover XBRL concepts ────────────────────────────────────────────────────

export async function discoverXbrlConcepts(
  cik: string,
  ticker: string,
  namespace?: string,
  search?: string,
  minPeriods = 1,
  segmentOnly = false,
): Promise<XbrlConceptsOutput> {
  const freshness_as_of = new Date().toISOString();
  const [doc, sub] = await Promise.all([fetchCompanyFacts(cik), fetchSubmissions(cik)]);
  const fiscalYearEndMonth = parseFiscalYearEnd(sub.fiscalYearEnd);

  const concepts: XbrlConceptSummary[] = [];
  const nsFilter = namespace?.toLowerCase();
  const searchLower = search?.toLowerCase();

  for (const [ns, tags] of Object.entries(doc.facts)) {
    if (nsFilter && ns.toLowerCase() !== nsFilter) continue;
    for (const [tag, data] of Object.entries(tags)) {
      if (searchLower && !tag.toLowerCase().includes(searchLower) && !(data.label ?? "").toLowerCase().includes(searchLower)) continue;

      const primaryUnit = selectPrimaryUnit(data.units, `${ns}/${tag}`);
      const rawFacts = data.units[primaryUnit] ?? [];
      if (rawFacts.length === 0) continue;

      // Deduplicate by period label to count distinct periods
      const periodSet = new Set<string>();
      for (const raw of rawFacts) {
        const { label: periodLabel } = buildPeriodLabel(raw.start, raw.end, fiscalYearEndMonth);
        periodSet.add(periodLabel);
      }
      if (periodSet.size < minPeriods) continue;

      // Detect segment data
      const periodFormMap = new Map<string, number>();
      for (const raw of rawFacts) {
        const key = `${raw.end}::${raw.form}`;
        periodFormMap.set(key, (periodFormMap.get(key) ?? 0) + 1);
      }
      const hasSegmentData = [...periodFormMap.values()].some((c) => c > 1);
      if (segmentOnly && !hasSegmentData) continue;

      const sorted = [...rawFacts].sort((a, b) => b.end.localeCompare(a.end));
      const latest = sorted[0]!;
      const scale = resolveScale(rawFacts, primaryUnit);

      concepts.push({
        concept_uri: `${ns}/${tag}`,
        label: normalizeConceptLabel(tag, data.label),
        namespace: ns,
        tag,
        unit: primaryUnit,
        periods_count: periodSet.size,
        latest_period_end: latest.end,
        latest_value_normalized: latest.val * scale,
        has_segment_data: hasSegmentData,
      });
    }
  }

  concepts.sort((a, b) => b.periods_count - a.periods_count || b.latest_period_end.localeCompare(a.latest_period_end));

  return {
    ticker,
    cik,
    entity_name: doc.entityName,
    concepts,
    total_count: concepts.length,
    freshness_as_of,
  };
}

// ── Compare two periods ───────────────────────────────────────────────────────

export async function compareConceptPeriods(
  cik: string,
  ticker: string,
  conceptLabel: string,
  periodA: string,
  periodB: string,
): Promise<ComparePeriodsOutput> {
  const freshness_as_of = new Date().toISOString();

  const result = await normalizeWithAliasResolution(cik, ticker, conceptLabel, "all");

  const toPoint = (label: string): PeriodPoint | null => {
    const fact = result.facts.find((f) => f.period_label === label);
    if (!fact) return null;
    return {
      period_label: fact.period_label,
      end_date: fact.end_date,
      value_normalized: fact.value_normalized,
      unit: fact.unit,
      filing_type: fact.filing_type,
      filed_date: fact.filed_date,
    };
  };

  const a = toPoint(periodA);
  const b = toPoint(periodB);

  let growth_percent: number | null = null;
  let cagr_percent: number | null = null;
  let years_between: number | null = null;

  if (a && b && a.value_normalized !== 0) {
    const msA = new Date(a.end_date).getTime();
    const msB = new Date(b.end_date).getTime();
    years_between = Math.round(((msB - msA) / (365.25 * 86_400_000)) * 100) / 100;
    growth_percent = Math.round(((b.value_normalized - a.value_normalized) / Math.abs(a.value_normalized)) * 10_000) / 100;
    if (years_between > 0) {
      cagr_percent = Math.round((((b.value_normalized / a.value_normalized) ** (1 / years_between)) - 1) * 10_000) / 100;
    }
  }

  return {
    ticker,
    cik,
    concept: result.concept,
    label: result.label,
    period_a: a,
    period_b: b,
    growth_percent,
    cagr_percent,
    years_between,
    freshness_as_of,
    concept_aliases_checked: result.concept_aliases_checked,
  };
}
