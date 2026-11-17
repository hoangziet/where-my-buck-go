// Public, keyless API (https://uselessfacts.jsph.pl). It sends no account data; JSON is its default format,
// so no Accept header is set and the request stays a simple CORS GET.
const RANDOM_FACT_URL = "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en";

export interface UselessFact {
  id: string;
  text: string;
  source: string;
  sourceUrl: string;
}

export async function fetchRandomFact(signal?: AbortSignal): Promise<UselessFact> {
  const res = await fetch(RANDOM_FACT_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Fact request failed (${res.status})`);
  const data: unknown = await res.json();
  if (!data || typeof data !== "object" || typeof (data as { text?: unknown }).text !== "string") {
    throw new Error("Unexpected fact response");
  }
  const { id, text, source, source_url: sourceUrl } = data as Record<string, unknown>;
  return {
    id: String(id ?? ""),
    text: (text as string).trim(),
    source: typeof source === "string" ? source : "",
    sourceUrl: typeof sourceUrl === "string" && sourceUrl.startsWith("http") ? sourceUrl : "",
  };
}
