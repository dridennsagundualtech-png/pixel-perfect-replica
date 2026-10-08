import { localHashtags } from "@/lib/clip-metadata";
import type { Campaign } from "./types";

/**
 * Editorial hook suggestions. Hooks are the editor's own words — never
 * presented as something a person in the video said. Any quoted text or
 * "X said" attribution is rejected unless it appears verbatim in the transcript.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function isFabricatedQuote(hook: string, transcript: string): boolean {
  const t = norm(transcript);
  const quotes = [...hook.matchAll(/["“”«»]([^"“”«»]{3,})["“”«»]/g)].map((m) => m[1]!);
  if (quotes.some((q) => !t.includes(norm(q)))) return true;
  if (
    /\b(said|says|told|admits?|claims?|confess(es|ed)?)\b\s*[:"“]/i.test(hook) &&
    quotes.length === 0
  )
    return true;
  return false;
}

export function localHooks(campaign: Campaign | null, transcript: string, count = 5): string[] {
  const topic = (localHashtags(transcript, 2)[0] ?? "").replace("#", "");
  const name = campaign?.name ?? "";
  const subject = topic || "this moment";
  const pool = [
    `Watch what happens next`,
    `Nobody expected this ${topic ? `${subject} ` : ""}moment`,
    `This might be the best ${topic ? `${subject} ` : ""}moment yet`,
    name ? `${name}: the moment you need to see` : `The moment you need to see`,
    `Wait for the ending`,
    `Here's why everyone is talking about ${topic || "this"}`,
    name ? `${name} — don't skip this one` : `Don't skip this one`,
  ];
  return [...new Set(pool)].filter((h) => !isFabricatedQuote(h, transcript)).slice(0, count);
}

export function parseAiHooks(raw: string, transcript: string): string[] | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(raw.slice(a, b + 1)) as { hooks?: unknown };
    if (!Array.isArray(o.hooks)) return null;
    const hooks = o.hooks
      .map((h) => String(h).replace(/\s+/g, " ").trim().slice(0, 100))
      .filter((h) => h.length >= 4 && !isFabricatedQuote(h, transcript));
    return hooks.length ? hooks.slice(0, 5) : null;
  } catch {
    return null;
  }
}

export async function suggestHooks(
  campaign: Campaign | null,
  transcript: string,
  deps: {
    ollama?: { enabled: boolean; model: string; baseUrl: string } | undefined;
    generate?: ((baseUrl: string, model: string, prompt: string) => Promise<string>) | undefined;
  } = {},
): Promise<{ hooks: string[]; source: "ollama" | "local"; warning?: string }> {
  const local = localHooks(campaign, transcript);
  if (!deps.ollama?.enabled || !deps.generate) return { hooks: local, source: "local" };
  const reqs = (campaign?.requirements ?? [])
    .filter((r) => r.active && (r.category === "hook" || r.category === "branding"))
    .map((r) => `- ${r.text}`)
    .join("\n");
  const prompt = `Write 5 short editorial on-screen hooks (max 60 characters each) for this clip.
They are the editor's words, NOT quotes. Never put words in anyone's mouth, never invent names, events or statistics.
Campaign: ${campaign?.name ?? "none"}
${reqs ? `Hook rules:\n${reqs}\n` : ""}Return ONLY JSON: {"hooks":["..."]}

Transcript:
${transcript.slice(0, 2000)}`;
  try {
    const ai = parseAiHooks(
      await deps.generate(deps.ollama.baseUrl, deps.ollama.model, prompt),
      transcript,
    );
    if (ai) return { hooks: ai, source: "ollama" };
    return {
      hooks: local,
      source: "local",
      warning: "The AI reply couldn't be used; showing local hooks.",
    };
  } catch {
    return {
      hooks: local,
      source: "local",
      warning: "Ollama is unavailable; showing local hooks.",
    };
  }
}
