// Parse EDGAR iXBRL companion documents (_htm.xml) for segment dimension context.
//
// EDGAR's _htm.xml files use no namespace prefix on xbrli elements (e.g. bare
// <context>, <startDate>) but do use xbrldi: on explicitMember. Regexes below
// match both prefixed and bare forms via (?:\w+:)?.

export function memberTagToLabel(tag: string): string {
  const local = tag.includes(":") ? tag.split(":")[1]! : tag;
  const stripped = local.endsWith("SegmentMember")
    ? local.slice(0, -"SegmentMember".length)
    : local.endsWith("Member")
    ? local.slice(0, -"Member".length)
    : local;
  // Split camelCase: "NorthAmerica" → "North America", "AWS" stays "AWS"
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** A segment-level fact extracted directly from an XBRL instance document. */
export interface XbrlSegmentEntry {
  val:        number;
  startDate:  string | undefined;
  endDate:    string;
  memberName: string; // human-readable (e.g. "North America", "AWS")
}

/**
 * Extract ALL segment-level facts for a concept directly from an XBRL companion document.
 *
 * Unlike buildXbrlSegmentMap (which builds a lookup for companyfacts enrichment),
 * this function returns first-class fact entries with values, dates, and member labels.
 * EDGAR's companyfacts API omits dimensional (segment-level) facts for many companies,
 * so this is the authoritative source for segment data.
 *
 * axis:             partial name of the XBRL axis (e.g. "StatementBusinessSegmentsAxis")
 * conceptLocalName: tag name without namespace (e.g. "RevenueFromContractWithCustomerExcludingAssessedTax")
 */
export function extractXbrlSegmentEntries(
  xml: string,
  axis: string,
  conceptLocalName: string,
): XbrlSegmentEntry[] {
  interface CtxEntry { startDate?: string; endDate?: string; memberName: string }
  const segContexts = new Map<string, CtxEntry>();

  const ctxRe = /<(?:\w+:)?context\s[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?context>/g;
  let cm: RegExpExecArray | null;
  while ((cm = ctxRe.exec(xml)) !== null) {
    const ctxId = cm[1]!;
    const body  = cm[2]!;

    const memberRe = new RegExp(
      `<[^:>\\s]+:explicitMember[^>]+dimension="[^"]*${axis}[^"]*"[^>]*>([^<]+)<`,
    );
    const mm = memberRe.exec(body);
    if (!mm) continue;

    const startM = /<(?:\w+:)?startDate>(\d{4}-\d{2}-\d{2})<\//.exec(body);
    const endM   = /<(?:\w+:)?endDate>(\d{4}-\d{2}-\d{2})<\//.exec(body);
    const instM  = /<(?:\w+:)?instant>(\d{4}-\d{2}-\d{2})<\//.exec(body);

    segContexts.set(ctxId, {
      startDate:  startM?.[1],
      endDate:    (endM ?? instM)?.[1],
      memberName: memberTagToLabel(mm[1]!.trim()),
    });
  }

  if (segContexts.size === 0) return [];

  const result: XbrlSegmentEntry[] = [];
  const seen = new Set<string>();
  const factRe = new RegExp(`<[^:>\\s]+:${conceptLocalName}(\\s[^>]*)>([^<]+)<`, "g");
  let fm: RegExpExecArray | null;
  while ((fm = factRe.exec(xml)) !== null) {
    const attrs = fm[1]!;
    const body  = fm[2]!.trim();

    const ctxM = /contextRef="([^"]+)"/.exec(attrs);
    if (!ctxM) continue;

    const ctx = segContexts.get(ctxM[1]!);
    if (!ctx?.endDate) continue;

    const val = Number(body);
    if (isNaN(val)) continue;

    // Deduplicate by val + period (same fact may appear multiple times in large XMLs)
    const dedupeKey = `${val}::${ctx.startDate ?? ""}::${ctx.endDate}::${ctx.memberName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    result.push({ val, startDate: ctx.startDate, endDate: ctx.endDate, memberName: ctx.memberName });
  }

  return result;
}

/**
 * Build a val::start::end → memberName lookup for enriching pre-existing fact lists.
 * Used when segment facts are already known (from companyfacts) and only labels are missing.
 */
export function buildXbrlSegmentMap(
  xml: string,
  axis: string,
  conceptLocalName: string,
): Map<string, string> {
  const entries = extractXbrlSegmentEntries(xml, axis, conceptLocalName);
  const result = new Map<string, string>();
  for (const e of entries) {
    const key = `${e.val}::${e.startDate ?? ""}::${e.endDate}`;
    if (!result.has(key)) result.set(key, e.memberName);
  }
  return result;
}
