/**
 * Suggested title / description / hashtags for a clip.
 * Order: Ollama (when enabled in settings) → local deterministic fallback.
 * There is no other AI provider configured in ClipPilot today.
 * Suggestions are never presented as guaranteed reach or virality.
 */

export type MetadataKind = "title" | "description" | "hashtags";

export interface MetadataResult {
  value: string;
  source: "ollama" | "local";
  /** Set when AI was tried but unavailable / invalid and the local fallback was used. */
  warning?: string | undefined;
}

export interface MetadataDeps {
  ollama?: { enabled: boolean; model: string; baseUrl: string } | undefined;
  generate?: ((baseUrl: string, model: string, prompt: string) => Promise<string>) | undefined;
}

const STOP = new Set(
  (
    "a an the and or but if so of to in on at for from with by as is are was were be been being " +
    "it its this that these those i you he she we they me him her us them my your our their " +
    "do does did have has had not no yes just like really very can could would should will " +
    "what when where who why how which there here then than about into out up down over " +
    "um uh yeah okay ok gonna wanna kind sort thing things lot get got going know think " +
    "say said make made want right well also because one two all some any more most much"
  ).split(" "),
);

const tidy = (t: string) => t.replace(/\s+/g, " ").trim();

function sentences(text: string): string[] {
  return tidy(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w, i) =>
      i > 0 && w.length <= 3 && STOP.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

function clipWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 20 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—]+$/, "")}…`;
}

export function localTitle(text: string): string {
  const ss = sentences(text);
  if (!ss.length) return "";
  const pick =
    ss.find((s) => s.endsWith("?") && s.length <= 90) ??
    ss.find((s) => s.length >= 20 && s.length <= 80) ??
    ss[0]!;
  return titleCase(clipWords(pick.replace(/[.!]+$/, ""), 70));
}

export function localDescription(text: string): string {
  const ss = sentences(text);
  if (!ss.length) return "";
  let out = "";
  for (const s of ss) {
    if ((out + " " + s).trim().length > 200) break;
    out = (out + " " + s).trim();
    if (out.length > 120) break;
  }
  return clipWords(out || ss[0]!, 220);
}

export function localHashtags(text: string, max = 5): string[] {
  const counts = new Map<string, number>();
  for (const raw of tidy(text).toLowerCase().split(/[^a-z0-9']+/)) {
    const w = raw.replace(/'/g, "");
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => `#${w}`);
}

function local(kind: MetadataKind, text: string): string {
  if (kind === "title") return localTitle(text);
  if (kind === "description") return localDescription(text);
  return localHashtags(text).join(" ");
}

function prompt(kind: MetadataKind, text: string): string {
  const body = tidy(text).slice(0, 1500);
  const ask =
    kind === "title"
      ? 'a short engagement-focused title (max 70 characters). Return JSON {"title":"..."}'
      : kind === "description"
        ? 'a concise description (1-2 sentences, max 200 characters). Return JSON {"description":"..."}'
        : 'up to 5 relevant hashtags. Return JSON {"hashtags":["#tag", ...]}';
  return `Write ${ask} for this short video clip, based only on its transcript. No emojis, no claims about going viral.\n\nTranscript:\n${body}`;
}

/** Parse a model response; returns null when it doesn't contain a usable value. */
export function parseMetadata(kind: MetadataKind, raw: string): string | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const obj = JSON.parse(raw.slice(a, b + 1)) as Record<string, unknown>;
    if (kind === "hashtags") {
      const arr = obj.hashtags;
      if (!Array.isArray(arr)) return null;
      const tags = arr
        .map((t) => String(t).trim().replace(/\s+/g, ""))
        .filter((t) => /^#?[\p{L}\p{N}_]{2,40}$/u.test(t))
        .map((t) => (t.startsWith("#") ? t : `#${t}`).toLowerCase())
        .slice(0, 5);
      return tags.length ? tags.join(" ") : null;
    }
    const v = obj[kind];
    if (typeof v !== "string" || !v.trim()) return null;
    return clipWords(tidy(v).replace(/^["']|["']$/g, ""), kind === "title" ? 90 : 240);
  } catch {
    return null;
  }
}

export async function generateClipMetadata(
  kind: MetadataKind,
  transcript: string,
  deps: MetadataDeps = {},
): Promise<MetadataResult> {
  const text = tidy(transcript);
  if (!text) throw new Error("This clip has no transcript text to work from.");
  const fallback = local(kind, text);
  if (deps.ollama?.enabled && deps.generate) {
    try {
      const raw = await deps.generate(deps.ollama.baseUrl, deps.ollama.model, prompt(kind, text));
      const parsed = parseMetadata(kind, raw);
      if (parsed) return { value: parsed, source: "ollama" };
      return {
        value: fallback,
        source: "local",
        warning: "The AI reply couldn't be used, so a local suggestion was made instead.",
      };
    } catch {
      return {
        value: fallback,
        source: "local",
        warning: "AI suggestions are unavailable right now, so a local suggestion was made.",
      };
    }
  }
  return { value: fallback, source: "local" };
}
