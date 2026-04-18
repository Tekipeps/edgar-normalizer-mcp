// Mercury 2 via InceptionLabs API — used exclusively for XBRL concept resolution
// when the static alias map has no match.

const MERCURY_API_URL = "https://api.inceptionlabs.ai/v1/chat/completions";
const MODEL = "mercury-2";

interface MercuryConceptResult {
  concept_uri: string; // e.g. "us-gaap/GoodwillImpairmentLoss"
  confidence: "exact" | "alias" | "fallback";
  alternatives: string[];
  reasoning: string;
}

const jsonSchema = {
  name: "xbrl_concept_resolution",
  strict: true,
  schema: {
    type: "object",
    properties: {
      concept_uri: { type: "string" },
      confidence: { type: "string", enum: ["exact", "alias", "fallback"] },
      alternatives: { type: "array", items: { type: "string" } },
      reasoning: { type: "string" },
    },
    required: ["concept_uri", "confidence", "alternatives", "reasoning"],
    additionalProperties: false,
  },
};

export async function resolveConceptViaMercury(
  label: string,
  availableConcepts: string[],
  timeoutMs = 10_000,
): Promise<MercuryConceptResult | null> {
  const apiKey = process.env["INCEPTION_API_KEY"] ?? "";
  if (!apiKey) return null;

  const conceptList = availableConcepts.slice(0, 200).join("\n");

  const systemPrompt =
    "You are an XBRL financial taxonomy expert. " +
    "Given a natural language financial metric label and a list of available XBRL concept URIs " +
    "(format: namespace/TagName), identify the best-matching concept URI. " +
    "Return concept_uri as 'namespace/TagName'. " +
    "If no good match exists, return the closest fallback with confidence='fallback'. " +
    "alternatives should list up to 3 other plausible URIs from the provided list.";

  const userPrompt = `Label: "${label}"\n\nAvailable XBRL concepts:\n${conceptList || "(none provided — use common us-gaap concepts)"}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(MERCURY_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_schema", json_schema: jsonSchema },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;

    return JSON.parse(raw) as MercuryConceptResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
