import type { CompanyFactsDoc, SubmissionsDoc, TickerCikMap } from "../types.ts";
import Fuse from "fuse.js";

const EDGAR_BASE    = "https://data.sec.gov";
const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const USER_AGENT    = "EdgarNormalizerMCP/1.0 tekena157@gmail.com";
const DEFAULT_TIMEOUT_MS = 7_000;

// ── Typed error ───────────────────────────────────────────────────────────────

export class EdgarApiError extends Error {
  constructor(
    public readonly status_code: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "EdgarApiError";
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function edgarFetch<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
    });

    if (res.status === 404) {
      throw new EdgarApiError(404, url, `Not found — company may not have XBRL filings (404): ${url}`);
    }
    if (!res.ok) {
      throw new EdgarApiError(res.status, url, `EDGAR returned HTTP ${res.status}: ${url}`);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof EdgarApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // AbortError = timeout
    throw new EdgarApiError(0, url, `Request failed (${msg}): ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── In-process response caches ────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry<T> { doc: T; exp: number }
const factsCache = new Map<string, CacheEntry<CompanyFactsDoc>>();
const subsCache  = new Map<string, CacheEntry<SubmissionsDoc>>();

// ── Ticker → CIK cache ────────────────────────────────────────────────────────

let tickerCache: TickerCikMap | null = null;
let tickerCacheLoadedAt: string | null = null;

export async function warmTickerCache(): Promise<void> {
  try {
    const raw = await edgarFetch<Record<string, { cik_str: string | number; ticker: string; title: string }>>(
      TICKER_MAP_URL,
      15_000,
    );
    const map: TickerCikMap = {};
    for (const entry of Object.values(raw)) {
      map[entry.ticker.toLowerCase()] = {
        ...entry,
        cik_str: String(entry.cik_str), // EDGAR returns this as a number
      };
    }
    tickerCache = map;
    tickerCacheLoadedAt = new Date().toISOString();
    console.log(`[edgar] ticker cache loaded: ${Object.keys(map).length} entries`);
  } catch (err) {
    console.warn("[edgar] ticker cache failed to load:", (err as Error).message);
  }
}

export function getTickerCacheLoadedAt(): string | null {
  return tickerCacheLoadedAt;
}

export interface TickerMatch {
  ticker: string;
  cik: string;
  company_name: string;
  match_type: "exact" | "starts_with" | "contains";
}

export async function resolveTickerFromName(
  query: string,
  maxResults = 10,
): Promise<TickerMatch[]> {
  if (!tickerCache) await warmTickerCache();
  if (!tickerCache) throw new Error("Ticker cache unavailable — EDGAR may be unreachable");

  const q = query.toLowerCase().trim();
  
  // Prepare data for Fuse.js
  const entries = Object.values(tickerCache).map(entry => ({
    ...entry,
    name: entry.title.toLowerCase()
  }));

  // Configure Fuse.js for our needs
  const fuseOptions = {
    keys: [
      { name: 'title', weight: 0.9 }, 
      { name: 'ticker', weight: 0.1 }
    ],
    includeScore: true,
    threshold: 0.4, // Reduced threshold for better fuzzy matching
    distance: 100,
    maxPatternLength: 32,
    minMatchCharLength: 2, // Increased to avoid matching on single characters
    findAllMatches: false,
    isCaseSensitive: false,
    ignoreLocation: true, // Ignore where in the string the match occurs
    ignoreFieldNorm: false,
  };

  const fuse = new Fuse(entries, fuseOptions);
  // Get more results to have better candidates for sorting
  const fuzzyResults = fuse.search(q).slice(0, Math.max(30, maxResults * 3));

  // Categorize matches by type and keep track of score for sorting
  type ScoredMatch = TickerMatch & { score: number };
  
  const exact: ScoredMatch[]       = [];
  const startsWith: ScoredMatch[]  = [];
  const contains: ScoredMatch[]    = [];

  for (const result of fuzzyResults) {
    // Ensure score is defined (Fuse.js should always provide it with includeScore: true)
    const score = result.score ?? 1; // fallback to worst possible score if somehow undefined
    const entry = result.item;
    const name = entry.name; // Already lowercase
    
    let matchType: TickerMatch["match_type"] = "contains";
    let matchScore = score;

    // Improve categorization with additional checks
    if (name === q) {
      matchType = "exact";
      matchScore = 0; // Exact matches get score 0
    } else if (name.startsWith(q)) {
      matchType = "starts_with";
      // Starts-with keeps Fuse score
    } else if (name.includes(q)) {
      matchType = "contains";
      // Substring matches get a score boost
      matchScore = Math.min(score * 0.8, 0.9);
    }
    // Otherwise, it's a pure fuzzy match (matchType remains "contains")

    const match: TickerMatch = {
      ticker: entry.ticker.toUpperCase(),
      cik: entry.cik_str,
      company_name: entry.title,
      match_type: matchType,
    };
    
    if (matchType === "exact") {
      exact.push({ ...match, score: matchScore });
    } else if (matchType === "starts_with") {
      startsWith.push({ ...match, score: matchScore });
    } else {
      contains.push({ ...match, score: matchScore });
    }
  }

  // Sort each category by score (ascending - lower score is better match)
  exact.sort((a, b) => a.score - b.score);
  startsWith.sort((a, b) => a.score - b.score);
  contains.sort((a, b) => a.score - b.score);

  // Combine results: exact matches first, then starts-with, then contains/fuzzy
  const combined = [...exact, ...startsWith, ...contains];
  
  // Strip the score property before returning (not part of TickerMatch interface)
  const resultWithoutScore: TickerMatch[] = combined.map(({ score, ...rest }) => rest);
  
  return resultWithoutScore.slice(0, maxResults);
}

export async function resolveCikFromTicker(ticker: string): Promise<string> {
  if (!tickerCache) await warmTickerCache();
  if (!tickerCache) throw new Error("Ticker cache unavailable — EDGAR may be unreachable");

  const normalized = ticker.toLowerCase().replace(/\.$/, "");
  const entry = tickerCache[normalized];
  if (!entry) {
    throw new EdgarApiError(404, TICKER_MAP_URL, `Ticker "${ticker}" not found in EDGAR ticker map`);
  }
  return entry.cik_str;
}

// ── EDGAR API calls ───────────────────────────────────────────────────────────

export async function fetchCompanyFacts(cik: string): Promise<CompanyFactsDoc> {
  const cached = factsCache.get(cik);
  if (cached && cached.exp > Date.now()) return cached.doc;

  const paddedCik = cik.padStart(10, "0");
  const url = `${EDGAR_BASE}/api/xbrl/companyfacts/CIK${paddedCik}.json`;
  const doc = await edgarFetch<CompanyFactsDoc>(url);
  factsCache.set(cik, { doc, exp: Date.now() + CACHE_TTL_MS });
  return doc;
}

export async function fetchSubmissions(cik: string): Promise<SubmissionsDoc> {
  const cached = subsCache.get(cik);
  if (cached && cached.exp > Date.now()) return cached.doc;

  const paddedCik = cik.padStart(10, "0");
  const url = `${EDGAR_BASE}/submissions/CIK${paddedCik}.json`;
  const doc = await edgarFetch<SubmissionsDoc>(url);
  subsCache.set(cik, { doc, exp: Date.now() + CACHE_TTL_MS });
  return doc;
}

// Fetch additional paginated submission files for large filers (>1000 filings)
export async function fetchSubmissionsPage(filename: string): Promise<SubmissionsDoc["filings"]["recent"]> {
  const url = `${EDGAR_BASE}/submissions/${filename}`;
  return edgarFetch<SubmissionsDoc["filings"]["recent"]>(url);
}

// ── Concurrency-limited Promise.all ──────────────────────────────────────────

export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let i = 0;

  async function runNext(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      const task = tasks[idx];
      if (!task) continue;
      try {
        results[idx] = { status: "fulfilled", value: await task() };
      } catch (err) {
        results[idx] = { status: "rejected", reason: err };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runNext));
  return results;
}
