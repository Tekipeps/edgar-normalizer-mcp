import type { CompanyFactsDoc, SubmissionsDoc, TickerCikMap } from "../types.ts";

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
