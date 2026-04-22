// ── Raw EDGAR shapes ──────────────────────────────────────────────────────────

export interface EdgarFactRaw {
  accn:      string;
  cik:       number;
  entityName?: string;
  loc?:      string;
  end:       string;
  start?:    string;       // absent for instant (point-in-time) facts
  val:       number;
  form:      string;
  filed:     string;
  frame?:    string;       // EDGAR populates this inconsistently
  decimals:  number | "INF";
}

export interface CompanyFactsDoc {
  cik:        number;
  entityName: string;
  facts:      Record<string, Record<string, {
    label:       string | null;
    description: string | null;
    units:       Record<string, EdgarFactRaw[]>;
  }>>;
}

export interface SubmissionsRecent {
  accessionNumber:  string[];
  filingDate:       string[];
  reportDate:       string[];
  form:             string[];
  primaryDocument:  string[];
  isXBRL:           number[];
  isInlineXBRL:     number[];
}

export interface SubmissionsDoc {
  cik:           string;
  entityType:    string;
  sic:           string;
  name:          string;
  fiscalYearEnd: string;   // format: "--MM-DD"
  filings: {
    recent: SubmissionsRecent;
    files:  Array<{ name: string; filingCount: number; filingFrom: string; filingTo: string }>;
  };
}

export interface TickerEntry {
  cik_str: string;
  ticker:  string;
  title:   string;
}

export type TickerCikMap = Record<string, TickerEntry>;

// ── Normalized output shapes ──────────────────────────────────────────────────

export interface EdgarFact {
  period_label:      string;
  period_type:       "instant" | "duration";
  start_date:        string | null;
  end_date:          string;
  value:             number;
  unit:              string;
  scale:             number;
  value_normalized:  number;
  filing_type:       string;
  accession_number:  string;
  filed_date:        string;
  is_amendment:      boolean;
  is_derived?:       boolean;   // true when value is computed from annual − 9-month YTD
  provenance:        FactProvenance;
  source_url:        string;
}

export interface SegmentFact extends EdgarFact {
  segment_dimension: string;
  segment_member:    string;
}

export interface FilingMeta {
  accession_number:  string;
  form_type:         string;
  filed_date:        string;
  period_of_report:  string;
  primary_document:  string;
  edgar_url:         string;
  is_amendment:      boolean;
}

// ── Tool output envelope ──────────────────────────────────────────────────────

export interface ToolOutput<T = EdgarFact> {
  ticker:                  string;
  cik:                     string;
  concept:                 string;
  label:                   string;
  facts:                   T[];
  freshness_as_of:         string;
  concept_aliases_checked: string[];
  requested_concept?:      string;
  resolved_from_deprecated_concept?: boolean;
  isError?:                boolean;
  error_message?:          string;
  staleness_warning?:      string;
}

export interface SegmentToolOutput extends ToolOutput<SegmentFact> {
  segments_available: boolean;
  message?:           string;
}

export interface BasketRow {
  ticker:           string;
  cik:              string;
  concept:          string;
  period_label:     string;
  value_normalized: number | null;
  unit:             string | null;
  filing_type:      string | null;
  filed_date:       string | null;
  is_amendment:     boolean | null;
  provenance:       FactProvenance | null;
  source_url:       string | null;
  isError:          boolean;
  error_message?:   string;
}

export interface BasketOutput {
  concept:                 string;
  period:                  string;
  rows:                    BasketRow[];
  freshness_as_of:         string;
  concept_aliases_checked: string[];
}

export interface ConceptResolution {
  found:                   boolean;
  concept_uri?:            string;
  label?:                  string;
  confidence?:             "exact" | "alias" | "fallback";
  aliases_tried:           string[];
  periods_available?:      number;
  sample_fact?:            EdgarFact | null;
  suggestions?:            string[];
}

export interface XbrlConceptSummary {
  concept_uri:             string;
  label:                   string;
  namespace:               string;
  tag:                     string;
  unit:                    string;
  periods_count:           number;
  latest_period_end:       string;
  latest_value_normalized: number;
  has_segment_data:        boolean;
}

export interface XbrlConceptsOutput {
  ticker:          string;
  cik:             string;
  entity_name:     string;
  concepts:        XbrlConceptSummary[];
  total_count:     number;
  freshness_as_of: string;
}

export interface PeriodPoint {
  period_label:     string;
  end_date:         string;
  value_normalized: number;
  unit:             string;
  filing_type:      string;
  filed_date:       string;
  provenance:       FactProvenance;
}

export interface ReportedFactProvenance {
  type:             "reported";
  filing_type:      string;
  accession_number: string;
  filed_date:       string;
  source_url:       string;
}

export interface DerivedFactProvenance {
  type:   "derived";
  method: "annual_minus_nine_months";
  annual_source: {
    period_label:      string;
    filing_type:       string;
    accession_number:  string;
    filed_date:        string;
    source_url:        string;
  };
  subtracted_source: {
    period_label:      string;
    filing_type:       string;
    accession_number:  string;
    filed_date:        string;
    source_url:        string;
  };
}

export type FactProvenance = ReportedFactProvenance | DerivedFactProvenance;

export interface ComparePeriodsOutput {
  ticker:                  string;
  cik:                     string;
  concept:                 string;
  label:                   string;
  period_a:                PeriodPoint | null;
  period_b:                PeriodPoint | null;
  growth_percent:          number | null;
  cagr_percent:            number | null;
  years_between:           number | null;
  freshness_as_of:         string;
  concept_aliases_checked: string[];
}

export interface FilingContentOutput {
  ticker:          string;
  cik:             string;
  accession_number: string;
  primary_document: string;
  source_url:      string;
  text:            string;
  offset:          number;
  chars_returned:  number;
  total_chars:     number;
  next_offset:     number | null;
  has_more:        boolean;
  freshness_as_of: string;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type PeriodFilter =
  | "last_4_quarters"
  | "last_8_quarters"
  | "last_12_quarters"
  | "all"
  | string;   // e.g. "FY2023", "Q3 FY2024", "last_1_years", "last_4_years"
