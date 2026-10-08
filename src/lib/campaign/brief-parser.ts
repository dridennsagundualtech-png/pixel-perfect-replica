import { newId } from "./campaign-store";
import type {
  CampaignRequirement,
  RequirementCategory,
  RequirementCheck,
  RequirementType,
} from "./types";
import { CATEGORY_LABELS, TYPE_LABELS } from "./types";

/**
 * Brief → structured requirements. Local deterministic extraction always runs;
 * Ollama (when enabled) may re-group the brief, but its output is validated
 * and can never upgrade a soft preference into a mandatory requirement.
 * Nothing is active until the user reviews and activates the campaign.
 */

const PROHIBIT =
  /\b(do not|don't|dont|never|avoid|no\s+\w+|not allowed|prohibited|forbidden|must not|mustn't|without)\b/i;
const REQUIRE =
  /\b(must|required|requires?|need(s)? to|every|always|only|mandatory|has to|have to)\b/i;
const SOFT =
  /\b(prefer(red|ably)?|should|ideally|recommend(ed)?|try to|encourage(d)?|bonus|nice to have|if possible)\b/i;

const LANGUAGES = [
  "english",
  "german",
  "filipino",
  "tagalog",
  "japanese",
  "spanish",
  "french",
  "portuguese",
  "italian",
  "korean",
  "chinese",
  "hindi",
  "arabic",
  "czech",
  "polish",
  "dutch",
  "indonesian",
];

export function classifyType(text: string): RequirementType {
  const t = text.toLowerCase();
  if (/\b(must not|mustn't|do not|don't|dont|never|not allowed|prohibited|forbidden)\b/.test(t))
    return "prohibited";
  if (/^\s*(no|avoid)\b/.test(t)) return "prohibited";
  if (SOFT.test(t) && !/\bmust\b|\brequired\b|\bmandatory\b/.test(t)) return "recommended";
  if (REQUIRE.test(t)) return "required";
  // Imperative instructions ("Tag @x", "Include #y") read as requirements.
  if (/^\s*(tag|include|add|use|mention|post|keep|put|show|start|end|credit|link|submit)\b/.test(t))
    return "required";
  if (PROHIBIT.test(t) && /\b(no|avoid)\b/.test(t)) return "prohibited";
  return "review";
}

export function classifyCategory(text: string, type: RequirementType): RequirementCategory {
  const t = text.toLowerCase();
  if (/#\w/.test(t) || /hashtag|caption text|description|tag @|@\w/.test(t)) return "post";
  if (/\bhook\b|first \d+ ?(s|sec|seconds)/.test(t)) return "hook";
  if (/footage|source|approved|official|recording|provided (url|link|file)/.test(t))
    return "source";
  if (LANGUAGES.some((l) => t.includes(l)) || /\blanguage\b/.test(t)) return "language";
  if (type === "prohibited") return "prohibited";
  if (/tiktok|reels|instagram|youtube shorts|deadline|post(ing)? (time|by)|submit/.test(t))
    return "posting";
  if (
    /\d+ ?(s|sec|seconds|minutes?)\b|duration|aspect|9:16|1:1|16:9|subtitle|caption|pacing|intro|outro/.test(
      t,
    )
  )
    return "editing";
  if (/brand|logo|mention|name|phrase|account/.test(t)) return "branding";
  if (/priorit|focus on|highlight|best|strong|funny|emotional|clutch|reaction/.test(t))
    return "priority";
  if (/clip|moment|content|video/.test(t)) return "content";
  return "other";
}

/** Deterministic check that can be run with plain code, when the text implies one. */
export function extractCheck(
  text: string,
  approvedSources: string[] = [],
): RequirementCheck | undefined {
  const t = text.toLowerCase();
  const tags = text.match(/#[\p{L}\p{N}_]{2,}/gu);
  if (tags?.length)
    return { kind: "hashtag", values: [...new Set(tags.map((x) => x.toLowerCase()))] };
  const handles = text.match(/(?:^|\s)@[\w.]{2,}/g);
  if (handles?.length)
    return { kind: "account", values: [...new Set(handles.map((h) => h.trim().toLowerCase()))] };
  const aspect = text.match(/\b(9:16|1:1|16:9)\b/);
  if (aspect) return { kind: "aspect", values: [aspect[1]!] };
  const quoted = [...text.matchAll(/["“']([^"”']{2,60})["”']/g)].map((m) => m[1]!.trim());
  const within = t.match(/(?:within|in) (?:the )?first (\d+(?:\.\d+)?) ?(?:s|sec|secs|seconds)\b/);
  if (within && /hook|mention|say|open|start/.test(t)) {
    const mention = text.match(/mention(?:s|ing)? ([A-Z0-9][\w'&-]*(?: [A-Z0-9][\w'&-]*)*)/);
    const values = quoted.length ? quoted : mention ? [mention[1]!] : undefined;
    return { kind: "hook-time", seconds: Number(within[1]), values };
  }
  const max = t.match(
    /(?:under|max(?:imum)?|no longer than|at most|up to|shorter than|less than) (\d+) ?(s|sec|secs|seconds|min|minutes?)\b/,
  );
  if (max)
    return { kind: "max-duration", seconds: Number(max[1]) * (max[2]!.startsWith("min") ? 60 : 1) };
  const min = t.match(
    /(?:at least|min(?:imum)?|longer than|more than|over) (\d+) ?(s|sec|secs|seconds|min|minutes?)\b/,
  );
  if (min)
    return { kind: "min-duration", seconds: Number(min[1]) * (min[2]!.startsWith("min") ? 60 : 1) };
  const lang = LANGUAGES.find((l) => t.includes(l));
  if (lang && /language|caption|subtitle|speak|audio|english|spoken|in /.test(t))
    return { kind: "language", values: [lang] };
  if (/subtitle|captions? (are )?required|burned.?in captions|must (have|include) captions/.test(t))
    return { kind: "captions" };
  if (/swear|profan|curse|cursing|bad language|explicit language/.test(t))
    return { kind: "forbidden-words" };
  if (/approved|official|provided/.test(t) && /footage|source|file|recording/.test(t))
    return { kind: "source", values: approvedSources };
  if (quoted.length || /\bmention\b|\binclude the (word|phrase|name)\b/.test(t)) {
    const mention = text.match(
      /mention(?:s|ing)? (?:the )?([A-Z0-9][\w'&-]*(?: [A-Z0-9][\w'&-]*)*)/,
    );
    const values = quoted.length ? quoted : mention ? [mention[1]!] : [];
    if (values.length) return { kind: "phrase", values };
  }
  return undefined;
}

export function splitBrief(brief: string): string[] {
  return brief
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“#@])/)
    .map((s) => s.replace(/^\s*(?:[-*•✓✔✕✗>]|\d+[.)])\s*/, "").trim())
    .filter((s) => s.length >= 4 && /[a-z]/i.test(s));
}

function build(
  text: string,
  approved: string[],
  origin: "local" | "ai",
  type?: RequirementType,
  category?: RequirementCategory,
): CampaignRequirement {
  const ty = type ?? classifyType(text);
  const check = extractCheck(text, approved);
  const cat = category ?? classifyCategory(text, ty);
  return {
    id: newId("req"),
    category: cat,
    text: text.slice(0, 300),
    type: ty,
    method: check
      ? "automatic"
      : cat === "content" || cat === "priority" || ty === "prohibited"
        ? "ai"
        : "manual",
    active: true,
    check,
    origin,
  };
}

export function parseBriefLocal(
  brief: string,
  approvedSources: string[] = [],
): CampaignRequirement[] {
  const seen = new Set<string>();
  const out: CampaignRequirement[] = [];
  for (const line of splitBrief(brief)) {
    const k = line.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(build(line, approvedSources, "local"));
  }
  return out;
}

/** Campaign explicitly forbids AI / automated clipping — always surfaced, never hidden. */
export function detectAiConflict(brief: string): boolean {
  return /\b(no|not|without|never|prohibit\w*|ban\w*|don't|do not)\b[^.\n]{0,50}\b(ai|a\.i\.|artificial intelligence|automated|automation|auto[- ]?clip\w*|clipping (tools?|software|apps?))\b/i.test(
    brief,
  );
}

const RANK: Record<RequirementType, number> = {
  review: 0,
  recommended: 1,
  required: 2,
  prohibited: 2,
};

/** Validate an AI item; the stricter of AI vs. local wording never wins silently. */
export function reconcileType(aiType: RequirementType, text: string): RequirementType {
  const local = classifyType(text);
  if ((aiType === "required" || aiType === "prohibited") && RANK[local] < RANK[aiType]) {
    return local === "review" ? "review" : local;
  }
  return aiType;
}

export function parseAiRequirements(
  raw: string,
  approvedSources: string[] = [],
): CampaignRequirement[] | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const obj = JSON.parse(raw.slice(a, b + 1)) as { requirements?: unknown };
    if (!Array.isArray(obj.requirements)) return null;
    const out: CampaignRequirement[] = [];
    for (const r of obj.requirements as Array<Record<string, unknown>>) {
      const text = typeof r?.["text"] === "string" ? (r["text"] as string).trim() : "";
      if (text.length < 3) continue;
      const t = String(r["type"] ?? "");
      const c = String(r["category"] ?? "");
      const type =
        t in TYPE_LABELS ? reconcileType(t as RequirementType, text) : classifyType(text);
      const cat = c in CATEGORY_LABELS ? (c as RequirementCategory) : undefined;
      out.push(build(text, approvedSources, "ai", type, cat));
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export interface ParseResult {
  requirements: CampaignRequirement[];
  source: "ollama" | "local";
  warning?: string | undefined;
  aiConflict: boolean;
}

export async function parseBrief(
  brief: string,
  approvedSources: string[] = [],
  deps: {
    ollama?: { enabled: boolean; model: string; baseUrl: string } | undefined;
    generate?: ((baseUrl: string, model: string, prompt: string) => Promise<string>) | undefined;
  } = {},
): Promise<ParseResult> {
  const aiConflict = detectAiConflict(brief);
  const local = parseBriefLocal(brief, approvedSources);
  if (!brief.trim())
    return { requirements: [], source: "local", aiConflict, warning: "The brief is empty." };
  if (deps.ollama?.enabled && deps.generate) {
    const prompt = `Split this campaign brief into individual requirements. Use only what the brief says; do not invent requirements.
Categories: ${Object.keys(CATEGORY_LABELS).join(", ")}.
Types: required (explicit must), recommended (preference/should), prohibited (must not), review (unclear).
Return ONLY JSON: {"requirements":[{"category":"...","type":"...","text":"..."}]}

Brief:
${brief.slice(0, 6000)}`;
    try {
      const raw = await deps.generate(deps.ollama.baseUrl, deps.ollama.model, prompt);
      const ai = parseAiRequirements(raw, approvedSources);
      if (ai) return { requirements: ai, source: "ollama", aiConflict };
      return {
        requirements: local,
        source: "local",
        aiConflict,
        warning:
          "The AI reply couldn't be used, so requirements were extracted locally. Please review them.",
      };
    } catch {
      return {
        requirements: local,
        source: "local",
        aiConflict,
        warning:
          "Ollama is unavailable, so requirements were extracted locally. Please review them.",
      };
    }
  }
  return { requirements: local, source: "local", aiConflict };
}
