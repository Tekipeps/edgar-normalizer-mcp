import { warmTickerCache, resolveCikFromTicker } from "./data/edgar.ts";
import { normalizeConceptFacts, normalizeWithAliasResolution, resolveConceptForTicker } from "./lib/orchestrator.ts";
import { getFilingMetadataTool } from "./tools/get-filing-metadata.ts";

// ── CLI entry ─────────────────────────────────────────────────────────────────
// Usage:
//   bun run query <ticker> <concept> [periods]          — get_facts
//   bun run query --resolve <ticker> <label>            — resolve_concept
//   bun run query --metadata <ticker> <form_type>       — get_filing_metadata

const args = process.argv.slice(2);

async function main() {
  await warmTickerCache();

  const mode = args[0];

  if (mode === "--resolve") {
    const ticker = args[1] ?? "";
    const label  = args.slice(2).join(" ");
    if (!ticker || !label) {
      console.error("Usage: bun run query --resolve <ticker> <label>");
      process.exit(1);
    }
    const result = await resolveConceptForTicker(ticker.toUpperCase(), label);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (mode === "--metadata") {
    const ticker   = args[1] ?? "";
    const formType = (args[2] ?? "all") as "10-K" | "10-Q" | "8-K" | "all";
    if (!ticker) {
      console.error("Usage: bun run query --metadata <ticker> <form_type>");
      process.exit(1);
    }
    const result = await getFilingMetadataTool.handler(
      { ticker: ticker.toUpperCase(), form_type: formType, limit: 20 },
      undefined,
    );
    console.log(result.content[0]?.text ?? "");
    return;
  }

  // Default: get_facts
  const ticker   = mode ?? "";
  const concept  = args[1] ?? "";
  const periods  = args[2] ?? "last_8_quarters";

  if (!ticker || !concept) {
    console.log("Usage:");
    console.log("  bun run query <ticker> <concept> [periods]");
    console.log("  bun run query --resolve <ticker> <label>");
    console.log("  bun run query --metadata <ticker> <form_type>");
    console.log("");
    console.log("Examples:");
    console.log("  bun run query AAPL us-gaap/Revenues last_8_quarters");
    console.log("  bun run query MSFT 'operating cash flow' last_4_quarters");
    console.log("  bun run query --resolve NVDA 'free cash flow'");
    console.log("  bun run query --metadata TSLA 10-Q");
    process.exit(0);
  }

  const cik = await resolveCikFromTicker(ticker.toUpperCase());
  const isUri = concept.includes("/");
  const result = isUri
    ? await normalizeConceptFacts(cik, ticker.toUpperCase(), concept, periods)
    : await normalizeWithAliasResolution(cik, ticker.toUpperCase(), concept, periods);

  if (result.facts.length === 0) {
    console.log(`No facts found for ${ticker} / ${concept} / ${periods}`);
    if (result.concept_aliases_checked.length > 0) {
      console.log("Concepts tried:", result.concept_aliases_checked.join(", "));
    }
    return;
  }

  // Pretty-print as markdown table
  const header = "| Period         | Value (normalized)   | Unit   | Filing  | Filed      | Amend |";
  const sep    = "|----------------|----------------------|--------|---------|------------|-------|";
  console.log(`\n${ticker} — ${result.label} (${result.concept})\n`);
  console.log(header);
  console.log(sep);
  for (const f of result.facts) {
    const val = f.value_normalized.toLocaleString("en-US", { maximumFractionDigits: 0 });
    console.log(
      `| ${f.period_label.padEnd(14)} | ${val.padStart(20)} | ${f.unit.padEnd(6)} | ${f.filing_type.padEnd(7)} | ${f.filed_date} | ${f.is_amendment ? "yes" : "no "} |`,
    );
  }
  console.log(`\nFreshness: ${result.freshness_as_of}`);
  console.log(`Concepts checked: ${result.concept_aliases_checked.join(", ")}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
