# EdgarNormalizerMCP — CLI Test Commands

```bash
# Usage forms:
#   bun run query <ticker> <concept> [periods]
#   bun run query --resolve <ticker> <label>
#   bun run query --metadata <ticker> <form_type>
```

---

## get_facts — XBRL URI concept

```bash
# 1. Default period (last_8_quarters)
bun run query AAPL us-gaap/Revenues

# 2. last_4_quarters
bun run query MSFT us-gaap/NetIncomeLoss last_4_quarters

# 3. last_12_quarters
bun run query JPM us-gaap/Assets last_12_quarters

# 4. All periods — full history
bun run query GOOG us-gaap/NetIncomeLoss all

# 5. Specific fiscal year
bun run query AMZN us-gaap/Revenues FY2023

# 6. Specific quarter
bun run query NVDA us-gaap/Revenues "Q3 FY2024"

# 7. Balance sheet concept
bun run query TSLA us-gaap/StockholdersEquity last_8_quarters

# 8. Operating income
bun run query META us-gaap/OperatingIncomeLoss last_4_quarters

# 9. Cash concept
bun run query AAPL us-gaap/CashAndCashEquivalentsAtCarryingValue last_8_quarters

# 10. R&D expense
bun run query MSFT us-gaap/ResearchAndDevelopmentExpense last_8_quarters

# 11. EPS
bun run query AAPL us-gaap/EarningsPerShareBasic last_8_quarters

# 12. Gross profit
bun run query AMZN us-gaap/GrossProfit last_4_quarters

# 13. Liabilities
bun run query JPM us-gaap/Liabilities last_4_quarters

# 14. Invalid ticker — expect structured error, not crash
bun run query XXXXXX us-gaap/Revenues

# 15. Valid ticker, concept with no data — expect empty facts + concepts tried
bun run query GME us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax all
```

---

## get_facts — Natural language concept (alias resolution)

```bash
# 16. "revenue" — most common alias
bun run query AAPL revenue

# 17. "operating income"
bun run query TSLA "operating income" last_4_quarters

# 18. "net income"
bun run query NVDA "net income" last_8_quarters

# 19. "free cash flow" — tests alias fallback chain
bun run query MSFT "free cash flow" last_8_quarters

# 20. "total assets"
bun run query BAC "total assets" last_4_quarters

# 21. "gross profit"
bun run query AMZN "gross profit" last_8_quarters

# 22. "research and development"
bun run query GOOG "research and development" last_4_quarters

# 23. "earnings per share"
bun run query AAPL "earnings per share" last_8_quarters

# 24. "deferred revenue" — less common, tests deeper alias map
bun run query AMZN "deferred revenue" last_8_quarters

# 25. Completely unknown label — expect no facts + aliases checked printed
bun run query AAPL "quantum revenue multiplier"
```

---

## resolve_concept

```bash
# 26. Common label — expect exact match, confidence=exact
bun run query --resolve AAPL revenue

# 27. Alias label — expect confidence=alias
bun run query --resolve NVDA "free cash flow"

# 28. Ambiguous label — check suggestions array
bun run query --resolve AMZN income

# 29. Multi-word label
bun run query --resolve MSFT "operating income"

# 30. Uncommon metric — tests fallback path
bun run query --resolve AMZN "deferred revenue"

# 31. Cost of revenue
bun run query --resolve TSLA "cost of revenue"

# 32. Balance sheet label
bun run query --resolve JPM "total assets"

# 33. Not-found label — expect found=false with suggestions
bun run query --resolve AAPL "synergy multiplier index"

# 34. Different ticker same label — CIK resolution varies
bun run query --resolve GME revenue

# 35. Short common word
bun run query --resolve META sales
```

---

## get_filing_metadata

```bash
# 36. 10-K filings
bun run query --metadata AAPL 10-K

# 37. 10-Q filings
bun run query --metadata MSFT 10-Q

# 38. 8-K filings — high-frequency filer
bun run query --metadata JPM 8-K

# 39. All form types
bun run query --metadata TSLA all

# 40. Smaller filer — tests paginated submission history
bun run query --metadata GME 10-K

# 41. Large filer with many filings
bun run query --metadata AMZN all

# 42. Recent filer
bun run query --metadata RIVN 10-K

# 43. Invalid ticker — expect structured error
bun run query --metadata XXXXXX 10-K

# 44. 10-Q for bank
bun run query --metadata BAC 10-Q

# 45. Default form type (all)
bun run query --metadata NVDA all
```

---

## Edge cases & stress

```bash
# 46. Lowercase ticker — CLI should auto-uppercase
bun run query aapl us-gaap/Revenues last_4_quarters

# 47. Mixed case natural language label
bun run query AAPL "Revenue" last_4_quarters

# 48. Resolve with lowercase ticker
bun run query --resolve aapl revenue

# 49. Metadata with lowercase ticker
bun run query --metadata tsla 10-K

# 50. No args — expect usage printed, no crash
bun run query
```

---

## get_filing_metadata — Cursor pagination

```bash
# 51. First page — limit=20 default, returns next_cursor and has_more
bun run query --metadata AAPL 10-K

# 52. First page with explicit limit
bun run query --metadata MSFT 10-K 20

# 53. Custom limit smaller
bun run query --metadata AAPL 10-K 10

# 54. Limit exceeds total — has_more false, next_cursor null
bun run query --metadata AAPL 10-K 50

# 55. Second page using cursor — from test 51: use next_cursor value
# bun run query --metadata AAPL 10-K 20 eyJpbmRleCI6MjB9

# 56. Third page — from test 55 next_cursor
# bun run query --metadata AAPL 10-K 20 eyJpbmRleCI6NDB9

# 57. Invalid cursor — should reset to start (index 0)
# bun run query --metadata AAPL 10-K 20 invalid-cursor

# 58. Large limit=100 max
bun run query --metadata AAPL 10-K 100

# 59. All filings with pagination
bun run query --metadata AMZN all 20

# 60. Second page all
# bun run query --metadata AMZN all 20 eyJpbmRleCI6MjB9
```

Note: Replace cursor placeholders `eyJpbmRleCI6MjB9` etc. with actual `next_cursor` values from previous responses.
```
