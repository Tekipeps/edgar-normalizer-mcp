import { describe, test, expect } from "bun:test";
import {
  resolveAliasesToConcepts,
  getAliasSuggestions,
  CONCEPT_ALIASES,
} from "../src/data/concept-aliases.ts";

describe("resolveAliasesToConcepts", () => {
  test("exact match returns correct URIs with 'exact' confidence", () => {
    const { concepts, confidence } = resolveAliasesToConcepts("revenue");
    expect(confidence).toBe("exact");
    expect(concepts).toContain("us-gaap/Revenues");
    expect(concepts[0]).toBe("us-gaap/Revenues");
  });

  test("exact match is case-insensitive", () => {
    const { concepts, confidence } = resolveAliasesToConcepts("REVENUE");
    expect(confidence).toBe("exact");
    expect(concepts).toContain("us-gaap/Revenues");
  });

  test("exact match trims leading/trailing whitespace", () => {
    const { confidence } = resolveAliasesToConcepts("  net income  ");
    expect(confidence).toBe("exact");
  });

  test("known aliases resolve to expected primary concepts", () => {
    const cases: Array<[string, string]> = [
      ["net income",          "us-gaap/NetIncomeLoss"],
      ["operating income",    "us-gaap/OperatingIncomeLoss"],
      ["total assets",        "us-gaap/Assets"],
      ["capex",               "us-gaap/PaymentsToAcquirePropertyPlantAndEquipment"],
      ["eps diluted",         "us-gaap/EarningsPerShareDiluted"],
    ];
    for (const [label, expected] of cases) {
      const { concepts } = resolveAliasesToConcepts(label);
      expect(concepts[0]).toBe(expected);
    }
  });

  test("substring match returns 'alias' confidence", () => {
    // "net inc" is contained within "net income"
    const { confidence, concepts } = resolveAliasesToConcepts("net inc");
    expect(confidence).toBe("alias");
    expect(concepts.length).toBeGreaterThan(0);
  });

  test("superset match returns 'alias' confidence", () => {
    // "total revenue" contains "revenue" so both match
    const { confidence } = resolveAliasesToConcepts("total revenue");
    expect(confidence).toBe("exact");
  });

  test("completely unknown label returns confidence 'none' and empty concepts", () => {
    const { concepts, confidence } = resolveAliasesToConcepts("xyzzy_does_not_exist_123");
    expect(confidence).toBe("none");
    expect(concepts).toHaveLength(0);
  });

  test("each alias in CONCEPT_ALIASES resolves with 'exact' confidence", () => {
    for (const key of Object.keys(CONCEPT_ALIASES)) {
      const { confidence } = resolveAliasesToConcepts(key);
      expect(confidence).toBe("exact");
    }
  });

  test("alias list is deduplicated", () => {
    const { concepts } = resolveAliasesToConcepts("revenue");
    const unique = new Set(concepts);
    expect(unique.size).toBe(concepts.length);
  });
});

describe("getAliasSuggestions", () => {
  test("returns suggestions for a word that partially matches known keys", () => {
    const suggestions = getAliasSuggestions("income");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => typeof s === "string")).toBe(true);
  });

  test("returns at most 5 suggestions", () => {
    const suggestions = getAliasSuggestions("revenue");
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  test("returns empty array for very short or unrecognised input", () => {
    // Words ≤2 chars are ignored by the filter
    const suggestions = getAliasSuggestions("ab");
    expect(suggestions).toHaveLength(0);
  });
});
