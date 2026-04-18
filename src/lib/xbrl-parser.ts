// Parse EDGAR iXBRL companion documents (_htm.xml) for segment dimension context.
//
// EDGAR's _htm.xml files use no namespace prefix on xbrli elements (e.g. bare
// <context>, <startDate>) but do use xbrldi: on explicitMember. Regexes below
// match both prefixed and bare forms via (?:\w+:)?.

function memberTagToLabel(tag: string): string {
  const local = tag.includes(":") ? tag.split(":")[1]! : tag;
  const stripped = local.endsWith("SegmentMember")
    ? local.slice(0, -"SegmentMember".length)
    : local.endsWith("Member")
    ? local.slice(0, -"Member".length)
    : local;
  // Split camelCase: "NorthAmerica" → "North America", "AWS" stays "AWS"
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Parse an EDGAR iXBRL companion document (_htm.xml).
 *
 * Returns a map keyed by `"${rawVal}::${startDate ?? ''}::${endDate}"` → human-readable
 * segment member label. The key matches the `raw.val + raw.start + raw.end` fields from
 * EDGAR companyfacts, since both come from the same unscaled XBRL source.
 *
 * axis:             partial name of the XBRL axis (e.g. "StatementBusinessSegmentsAxis")
 * conceptLocalName: tag name without namespace (e.g. "RevenueFromContractWithCustomerExcludingAssessedTax")
 */
export function buildXbrlSegmentMap(
  xml: string,
  axis: string,
  conceptLocalName: string,
): Map<string, string> {
  interface CtxEntry { startDate?: string; endDate?: string; memberName: string }
  const segContexts = new Map<string, CtxEntry>();

  // Match context blocks — prefix optional (Amazon files use bare <context id="c-200">)
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

  if (segContexts.size === 0) return new Map();

  const result = new Map<string, string>();
  const factRe = new RegExp(
    `<[^:>\\s]+:${conceptLocalName}(\\s[^>]*)>([^<]+)<`,
    "g",
  );
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

    const key = `${val}::${ctx.startDate ?? ""}::${ctx.endDate}`;
    if (!result.has(key)) result.set(key, ctx.memberName);
  }

  return result;
}
