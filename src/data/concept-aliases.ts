// Maps natural language labels → ordered XBRL concept URIs (try first = preferred)
// Format: "namespace/TagName"
export const CONCEPT_ALIASES: Record<string, string[]> = {
  // ── Income statement ──────────────────────────────────────────────────────
  "revenue":                      ["us-gaap/Revenues", "us-gaap/SalesRevenueNet", "us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax"],
  "net revenue":                  ["us-gaap/Revenues", "us-gaap/SalesRevenueNet", "us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax"],
  "total revenue":                ["us-gaap/Revenues", "us-gaap/SalesRevenueNet", "us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax"],
  "revenues from contracts":      ["us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap/Revenues"],
  "cost of revenue":              ["us-gaap/CostOfRevenue", "us-gaap/CostOfGoodsAndServicesSold", "us-gaap/CostOfGoodsSold"],
  "cogs":                         ["us-gaap/CostOfRevenue", "us-gaap/CostOfGoodsAndServicesSold", "us-gaap/CostOfGoodsSold"],
  "cost of goods sold":           ["us-gaap/CostOfGoodsSold", "us-gaap/CostOfRevenue", "us-gaap/CostOfGoodsAndServicesSold"],
  "gross profit":                 ["us-gaap/GrossProfit"],
  "operating income":             ["us-gaap/OperatingIncomeLoss"],
  "operating profit":             ["us-gaap/OperatingIncomeLoss"],
  "ebit":                         ["us-gaap/OperatingIncomeLoss"],
  "research and development":     ["us-gaap/ResearchAndDevelopmentExpense"],
  "r&d":                          ["us-gaap/ResearchAndDevelopmentExpense"],
  "r&d expense":                  ["us-gaap/ResearchAndDevelopmentExpense"],
  "selling general and administrative": ["us-gaap/SellingGeneralAndAdministrativeExpense"],
  "sg&a":                         ["us-gaap/SellingGeneralAndAdministrativeExpense"],
  "interest expense":             ["us-gaap/InterestExpense", "us-gaap/InterestAndDebtExpense"],
  "net interest expense":         ["us-gaap/InterestExpense", "us-gaap/InterestAndDebtExpense"],
  "income tax expense":           ["us-gaap/IncomeTaxExpenseBenefit"],
  "tax provision":                ["us-gaap/IncomeTaxExpenseBenefit"],
  "net income":                   ["us-gaap/NetIncomeLoss", "us-gaap/ProfitLoss"],
  "net earnings":                 ["us-gaap/NetIncomeLoss", "us-gaap/ProfitLoss"],
  "net profit":                   ["us-gaap/NetIncomeLoss", "us-gaap/ProfitLoss"],
  "depreciation":                 ["us-gaap/DepreciationDepletionAndAmortization", "us-gaap/Depreciation"],
  "depreciation and amortization":["us-gaap/DepreciationDepletionAndAmortization"],
  "d&a":                          ["us-gaap/DepreciationDepletionAndAmortization"],
  "stock-based compensation":     ["us-gaap/ShareBasedCompensation", "us-gaap/AllocatedShareBasedCompensationExpense"],
  "share-based compensation":     ["us-gaap/ShareBasedCompensation", "us-gaap/AllocatedShareBasedCompensationExpense"],
  "eps basic":                    ["us-gaap/EarningsPerShareBasic"],
  "earnings per share basic":     ["us-gaap/EarningsPerShareBasic"],
  "eps diluted":                  ["us-gaap/EarningsPerShareDiluted"],
  "earnings per share diluted":   ["us-gaap/EarningsPerShareDiluted"],

  // ── Balance sheet — assets ────────────────────────────────────────────────
  "total assets":                 ["us-gaap/Assets"],
  "cash":                         ["us-gaap/CashAndCashEquivalentsAtCarryingValue", "us-gaap/CashCashEquivalentsAndShortTermInvestments"],
  "cash and equivalents":         ["us-gaap/CashAndCashEquivalentsAtCarryingValue", "us-gaap/CashCashEquivalentsAndShortTermInvestments"],
  "accounts receivable":          ["us-gaap/AccountsReceivableNetCurrent", "us-gaap/ReceivablesNetCurrent"],
  "inventory":                    ["us-gaap/InventoryNet"],
  "current assets":               ["us-gaap/AssetsCurrent"],
  "goodwill":                     ["us-gaap/Goodwill"],
  "intangible assets":            ["us-gaap/IntangibleAssetsNetExcludingGoodwill", "us-gaap/FiniteLivedIntangibleAssetsNet"],
  "ppe":                          ["us-gaap/PropertyPlantAndEquipmentNet"],
  "property plant equipment":     ["us-gaap/PropertyPlantAndEquipmentNet"],
  "fixed assets":                 ["us-gaap/PropertyPlantAndEquipmentNet"],
  "operating lease right of use asset": ["us-gaap/OperatingLeaseRightOfUseAsset"],
  "deferred tax":                 ["us-gaap/DeferredTaxAssetsNetNoncurrent", "us-gaap/DeferredIncomeTaxAssetsNet"],

  // ── Balance sheet — liabilities ───────────────────────────────────────────
  "total liabilities":            ["us-gaap/Liabilities"],
  "current liabilities":          ["us-gaap/LiabilitiesCurrent"],
  "accounts payable":             ["us-gaap/AccountsPayableCurrent"],
  "deferred revenue":             ["us-gaap/DeferredRevenueNoncurrent", "us-gaap/DeferredRevenueCurrent"],
  "total debt":                   ["us-gaap/LongTermDebtAndCapitalLeaseObligations", "us-gaap/LongTermDebt", "us-gaap/DebtAndCapitalLeaseObligations"],
  "long-term debt":               ["us-gaap/LongTermDebt", "us-gaap/LongTermDebtNoncurrent"],
  "short-term debt":              ["us-gaap/ShortTermBorrowings", "us-gaap/DebtCurrent"],
  "current debt":                 ["us-gaap/DebtCurrent", "us-gaap/ShortTermBorrowings"],
  "capital lease obligations":    ["us-gaap/FinanceLeaseLiability", "us-gaap/CapitalLeaseObligations"],
  "finance lease liability":      ["us-gaap/FinanceLeaseLiability"],
  "convertible notes":            ["us-gaap/ConvertibleDebt", "us-gaap/ConvertibleLongTermNotesPayable"],
  "convertible debt":             ["us-gaap/ConvertibleDebt", "us-gaap/ConvertibleLongTermNotesPayable"],
  "noncontrolling interest":      ["us-gaap/MinorityInterest", "us-gaap/NoncontrollingInterestMember"],
  "minority interest":            ["us-gaap/MinorityInterest"],

  // ── Balance sheet — equity ────────────────────────────────────────────────
  "total equity":                 ["us-gaap/StockholdersEquity", "us-gaap/StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  "shareholders equity":          ["us-gaap/StockholdersEquity"],
  "stockholders equity":          ["us-gaap/StockholdersEquity"],
  "retained earnings":            ["us-gaap/RetainedEarningsAccumulatedDeficit"],
  "common stock":                 ["us-gaap/CommonStockValue"],
  "additional paid-in capital":   ["us-gaap/AdditionalPaidInCapital"],
  "apic":                         ["us-gaap/AdditionalPaidInCapital"],
  "treasury stock":               ["us-gaap/TreasuryStockValue"],
  "book value per share":         ["us-gaap/BookValuePerShareBasic", "us-gaap/BookValuePerShare"],

  // ── Cash flow ─────────────────────────────────────────────────────────────
  "operating cash flow":          ["us-gaap/NetCashProvidedByUsedInOperatingActivities"],
  "cash from operations":         ["us-gaap/NetCashProvidedByUsedInOperatingActivities"],
  "capex":                        ["us-gaap/PaymentsToAcquirePropertyPlantAndEquipment"],
  "capital expenditures":         ["us-gaap/PaymentsToAcquirePropertyPlantAndEquipment"],
  "purchases of ppe":             ["us-gaap/PaymentsToAcquirePropertyPlantAndEquipment"],
  // free cash flow is derived — return both underlying concepts
  "free cash flow":               ["us-gaap/NetCashProvidedByUsedInOperatingActivities", "us-gaap/PaymentsToAcquirePropertyPlantAndEquipment"],
  "cash from investing":          ["us-gaap/NetCashProvidedByUsedInInvestingActivities"],
  "net cash used in investing":   ["us-gaap/NetCashProvidedByUsedInInvestingActivities"],
  "cash from financing":          ["us-gaap/NetCashProvidedByUsedInFinancingActivities"],
  "net cash used in financing":   ["us-gaap/NetCashProvidedByUsedInFinancingActivities"],
  "dividends paid":               ["us-gaap/PaymentsOfDividends", "us-gaap/PaymentsOfDividendsCommonStock"],
  "cash dividends":               ["us-gaap/PaymentsOfDividends", "us-gaap/PaymentsOfDividendsCommonStock"],

  // ── Shares ────────────────────────────────────────────────────────────────
  "shares outstanding":           ["us-gaap/CommonStockSharesOutstanding", "us-gaap/WeightedAverageNumberOfSharesOutstandingBasic"],
  "basic shares":                 ["us-gaap/WeightedAverageNumberOfSharesOutstandingBasic"],
  "diluted shares":               ["us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding"],

  // ── Other ─────────────────────────────────────────────────────────────────
  "employees":                    ["us-gaap/EntityNumberOfEmployees"],
  "employee headcount":           ["us-gaap/EntityNumberOfEmployees"],
};

export interface AliasResolution {
  concepts:   string[];
  confidence: "exact" | "alias" | "none";
}

export function resolveAliasesToConcepts(label: string): AliasResolution {
  const normalized = label.toLowerCase().trim();

  // Exact match
  if (normalized in CONCEPT_ALIASES) {
    const concepts = CONCEPT_ALIASES[normalized];
    return { concepts: concepts ?? [], confidence: "exact" };
  }

  // Substring match — find all keys that contain the input or vice versa
  const matches: string[] = [];
  for (const key of Object.keys(CONCEPT_ALIASES)) {
    if (key.includes(normalized) || normalized.includes(key)) {
      const aliases = CONCEPT_ALIASES[key];
      if (aliases) matches.push(...aliases);
    }
  }

  if (matches.length > 0) {
    return { concepts: [...new Set(matches)], confidence: "alias" };
  }

  return { concepts: [], confidence: "none" };
}

export function getAliasSuggestions(label: string): string[] {
  const normalized = label.toLowerCase().trim();
  const keys = Object.keys(CONCEPT_ALIASES);
  return keys
    .filter((k) => {
      const words = normalized.split(/\s+/);
      return words.some((w) => w.length > 2 && k.includes(w));
    })
    .slice(0, 5);
}
