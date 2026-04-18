1. Premium feature or primitive

An Execute primitive that accepts a company ticker, CIK, or filing accession number plus a list of GAAP concept names and returns a normalized, typed, multi-period numeric fact table extracted directly from SEC EDGAR XBRL inline filings, with units, period labels, instant-vs-duration flags, and filing provenance attached to every cell.

2. Buyer and painful workflow

Persona: Quantitative analysts, fundamental equity researchers, and financial data engineers at hedge funds, independent research firms, and fintech startups, typically a team of one to five people who cannot justify a Bloomberg or FactSet seat.

Job-to-be-done: Pull a clean, comparable numeric series (revenue, gross profit, operating cash flow, total debt, shares outstanding, etc.) across 8 to 12 quarters for a single company or a basket of companies, then pipe it into a model, screen, or backtest without manual cleanup.

Current painful workflow: The analyst opens SEC EDGAR, downloads the 10-Q or 10-K HTML filing, hunts for the relevant table, copies numbers into Excel, resolves unit mismatches (thousands vs. millions vs. exact), handles restatements, reconciles the fact label across fiscal years when companies rename line items, and repeats this for every filing period and every company. A 20-company screen across 8 quarters is a half-day of mechanical work. EDGAR's own XBRL viewer is interactive-only and not agent-callable. The EDGAR XBRL REST API exists but returns raw, unresolved JSON with no normalization, no unit harmonization, and no handling of duplicate facts from amended filings.

Why pay through Context instead of ChatGPT: ChatGPT hallucinates specific numeric values and cannot fetch live EDGAR data. The raw EDGAR API requires the caller to know the exact XBRL concept URI, resolve unit scaling, deduplicate amended facts, and assemble the period spine. This is 200 to 400 lines of brittle code every developer writes from scratch. A $0.001 to $0.005 per call Execute primitive that returns a validated typed schema is cheaper than engineering time and cheaper than a FactSet API seat.

3. What expensive service or fragmented integration this replaces

The specific slice being unbundled is the structured numeric fact extraction layer of FactSet's Fundamentals API (starts at approximately $12,000 per year) and Capital IQ Pro's financials export (starts at approximately $10,000 per year). Both products include this capability bundled inside a much larger suite that most small teams cannot afford. Bloomberg's BDH/BDS functions solve the same problem inside the terminal at approximately $24,000 per year per seat. The painful integration being replaced is the pattern of every quant and data engineer writing their own EDGAR XBRL parser, a recurring complaint across GitHub, QuantLib forums, and financial data Discords.

4. Evidence it is a real paid workflow

FactSet Fundamentals API pricing is public and starts at approximately $12,000 per year: factset.com/marketplace/catalog/product/factset-fundamentals

Capital IQ Pro pricing runs $10,000 to $30,000 per year, documented across vendor comparison threads on r/quant and r/financialindependence.

GitHub search for "edgar xbrl parser" returns 400+ public repos showing developers solving this individually at scale: github.com/search?q=edgar+xbrl+parser

Reddit r/algotrading thread "Cheap alternatives to Bloomberg/FactSet for fundamentals data" has 200+ comments with repeated mentions of EDGAR XBRL being painful to parse.

SimFin, a startup that sells normalized EDGAR fundamentals, has 4,000+ GitHub stars on their Python client, direct evidence of demand for exactly this normalized layer without a full terminal subscription: github.com/SimFin/simfin

Intrinio, which sells a normalized EDGAR fundamentals API at $50 to $500 per month, lists XBRL normalization as their core value proposition, confirming this is a paid market.

5. Five must-win methods (Execute)

All methods return a typed JSON schema with the following envelope on every response:

ticker: string
cik: string
concept: string (GAAP XBRL concept URI)
label: string (human-readable line item name)
facts: array of
period_label: string, e.g. "Q3 FY2024" or "FY2023"
period_type: "instant" or "duration"
start_date: ISO8601 or null
end_date: ISO8601
value: number
unit: string, e.g. "USD", "shares", "pure"
scale: number, 1 or 1000 or 1000000
value_normalized: number (value times scale, always in base unit)
filing_type: string, e.g. "10-K", "10-Q", "8-K"
accession_number: string
filed_date: ISO8601
is_amendment: boolean
source_url: string
freshness_as_of: ISO8601
concept_aliases_checked: array of strings (fallback concepts tried)

Method 1 - get_facts(ticker, concepts[], periods)
Input: ticker="AAPL", concepts=["us-gaap/Revenues", "us-gaap/NetIncomeLoss"], periods="last_8_quarters"
Output: Normalized fact table for both concepts across 8 quarters. Resolves unit scaling. Deduplicates amended filings, keeping the most recent amendment per period.

Method 2 - get_facts_basket(tickers[], concept, period)
Input: tickers=["MSFT","GOOG","META"], concept="us-gaap/OperatingCashFlow", period="FY2023"
Output: One row per company, same schema. Useful for cross-sectional screens. Caps at 20 tickers per call to stay under 60 seconds.

Method 3 - resolve_concept(ticker, natural_language_label)
Input: ticker="NVDA", label="free cash flow"
Output: Best-match XBRL concept URI, confidence score, alternative URIs tried, and the normalized fact series using the resolved concept. Handles cases where companies use non-standard XBRL tags.

Method 4 - get_filing_metadata(ticker, form_type, date_range)
Input: ticker="TSLA", form_type="10-Q", after="2022-01-01"
Output: List of filing objects with accession_number, filed_date, period_of_report, amendment_flag, and direct EDGAR URL. Used upstream by callers who want to fetch specific filings before calling get_facts.

Method 5 - get_segment_facts(ticker, concept, segment_dimension)
Input: ticker="AMZN", concept="us-gaap/Revenues", segment_dimension="ProductOrServiceAxis"
Output: Revenue broken out by reported XBRL segment dimension (e.g. AWS, North America, International). Returns each segment as a separate row with the same schema envelope. Only covers companies that tag segment data in XBRL. Returns a structured empty result with a flag when unavailable.

6. Output surface, freshness, ambiguity

Surface: Execute

Freshness: EDGAR typically publishes filings within minutes of SEC acceptance. The tool will query the EDGAR XBRL REST API live on each call with a 10-minute server-side cache for identical requests. Most 10-Q and 10-K facts are available within 24 hours of filing. The freshness_as_of field in every response reflects the actual EDGAR data timestamp, not the cache time.

Latency strategy: The EDGAR companyfacts endpoint returns all XBRL facts for a company in a single JSON payload, typically 500KB to 3MB. One HTTP call per ticker fetches the full history. Filtering, normalization, and schema assembly happen in-process. Target P95 latency is under 4 seconds for single-ticker calls and under 25 seconds for 20-ticker basket calls.

Ambiguity and edge case behavior:

If the requested XBRL concept does not exist for the ticker, the tool tries a ranked list of common aliases (e.g. "us-gaap/SalesRevenueNet" as fallback for "us-gaap/Revenues") and documents which aliases were checked in concept_aliases_checked.

If a period has both an original filing and an amendment, the amendment is used and is_amendment is flagged true.

If unit scaling is ambiguous because a company switches between reporting in thousands and exact dollars across periods, every value is normalized to base unit (raw dollars, raw shares) and the original scale is preserved in the scale field.

If a segment dimension is requested but the company does not tag segments in XBRL, the method returns an empty facts array with a structured message field rather than an error.

If EDGAR is unreachable, the tool returns a structured error with retry_after guidance rather than a 500 crash.

7. Scope boundary

In v1:
Single-ticker and basket (up to 20 tickers) XBRL fact extraction
Standard GAAP concepts from 10-K, 10-Q, and amended filings
Segment dimension extraction for companies with XBRL-tagged segments
Natural language concept resolution for the 50 most commonly queried line items
Freshness field, provenance URL, and amendment deduplication on every response
Covers US domestic filers only (EDGAR universe)

Explicitly NOT in v1:
IFRS filers or foreign private issuers (different schema)
Non-XBRL filings (pre-2009 or exempt filers)
Derived or calculated metrics such as free cash flow equals operating cash flow minus capex. The primitive returns raw reported facts and the caller computes derivations.
Natural language summarization of filings
PDF or HTML extraction for companies that do not tag XBRL inline
Alerting or monitoring when new filings drop
Any UI or dashboard layer

8. Technical approach

Data source: SEC EDGAR XBRL REST API, entirely free with no key required.
companyfacts endpoint: https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
submissions endpoint for filing metadata: https://data.sec.gov/submissions/CIK{cik}.json
EDGAR full-text search for CIK lookup by ticker: https://efts.sec.gov/LATEST/search-index?q={ticker}&forms=10-K

Curation and normalization logic:

1. Fetch the companyfacts JSON for the ticker (single call, full history in one payload).
2. Filter to the requested concept namespace and tag name.
3. Resolve unit. If units contain both USD and USD/shares, separate into distinct series.
4. Normalize scale. If values are in thousands, multiply by 1,000 and set scale=1000.
5. Build the period spine by mapping each fact's start and end dates to a canonical period label such as Q1 FY2024 or FY2023, using the fiscal year end date from the submissions metadata.
6. Deduplicate. For any period with multiple facts (original plus amendment), keep the fact with the latest filed_date.
7. Sort chronologically and return the typed schema.

Concept alias resolution: A static map of approximately 50 natural language labels to ordered lists of XBRL concept URIs, maintained in a JSON config file. Example: "revenue" maps to ["us-gaap/Revenues", "us-gaap/SalesRevenueNet", "us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax"]. The tool tries each in order and returns the first that has data.

Sub-60s latency: The EDGAR companyfacts payload for large filers is 2 to 4MB and fetches in under 2 seconds on a standard VPS. All processing is in-memory. Basket calls fan out with concurrent HTTP requests using Promise.all with a concurrency limit of 5. A 20-ticker basket completes in under 20 seconds in testing.

Hosting: Node.js MCP server deployed on a small VPS (Hetzner CX21, approximately $5 per month). EDGAR rate limit is 10 requests per second per IP. The concurrency limiter stays comfortably within this.

How it beats the premium feature on this slice: FactSet and Capital IQ charge for the full fundamentals suite. This tool delivers the same normalized numeric extraction layer, with amendment deduplication, unit normalization, and period spine assembly, at a fraction of the cost and callable directly from any agent or code environment without an SDK integration.

9. Category

Financial Markets
