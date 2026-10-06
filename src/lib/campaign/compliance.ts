import type { TranscriptSegment, TranscriptWord } from "@/lib/detection/transcript";
import type { Campaign, CampaignRequirement } from "./types";

/**
 * Deterministic Campaign Compliance + Campaign Fit.
 * - PASS: every active required/prohibited rule is verified.
 * - REVIEW: something can't be verified by code (or only AI evidence exists).
 * - FAIL: a mandatory rule is clearly violated.
 * Campaign Fit is separate from Engagement Potential and never replaces it.
 */

export type CheckResult = "pass" | "fail" | "review" | "unmet";
export type ComplianceStatus = "PASS" | "REVIEW" | "FAIL";

export interface RequirementOutcome {
  requirement: CampaignRequirement;
  result: CheckResult;
  evidence: string;
  /** Suggested non-destructive fix the user can preview and accept. */
  fix?: { label: string; hashtags?: string[]; descriptionAppend?: string } | undefined;
}

export interface ClipCampaignContext {
  startSec: number;
  endSec: number;
  transcriptText: string;
  segments?: TranscriptSegment[] | undefined;
  title?: string | undefined;
  description?: string | undefined;
  hashtags?: string | undefined;
  /** "9:16" | "1:1" | "16:9" */
  aspect?: string | undefined;
  captionsEnabled?: boolean | undefined;
  sourceFileName?: string | undefined;
  /** Transcript language name, when known (e.g. "english"). */
  language?: string | undefined;
  /** Optional validated Ollama assessment for this clip + campaign. */
  ai?: AiClipAssessment | undefined;
}

export interface AiClipAssessment {
  fit: number;
  met: string[];
  violated: string[];
  notes: string[];
}

export interface CampaignEvaluation {
  status: ComplianceStatus;
  /** 0–100, or null when the campaign has no active requirements. */
  fit: number | null;
  outcomes: RequirementOutcome[];
  strengths: string[];
  issues: string[];
}

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard", "damn", "dick", "cunt", "motherfucker"];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function clipWords(ctx: ClipCampaignContext): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const s of ctx.segments ?? []) {
    for (const w of s.words ?? []) {
      if (
        w &&
        typeof w.text === "string" &&
        Number.isFinite(w.startSec) &&
        Number.isFinite(w.endSec) &&
        w.endSec > w.startSec &&
        w.startSec >= ctx.startSec - 0.05 &&
        w.startSec < ctx.endSec
      )
        out.push(w);
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

const KEY_STOP = new Set(
  "the a an and or of to in on for with every all any must should only clips clip video videos content moments moment use be is are that this from your our they it we you".split(
    " ",
  ),
);
export function keywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !KEY_STOP.has(w)),
    ),
  ];
}

function evaluate(req: CampaignRequirement, ctx: ClipCampaignContext, campaign: Campaign): RequirementOutcome {
  const transcript = norm(ctx.transcriptText);
  const post = norm(`${ctx.title ?? ""} ${ctx.description ?? ""} ${ctx.hashtags ?? ""}`);
  const mandatory = req.type === "required" || req.type === "prohibited";
  const miss = (evidence: string, fix?: RequirementOutcome["fix"]): RequirementOutcome => ({
    requirement: req,
    result: req.type === "recommended" ? "unmet" : req.type === "review" ? "review" : "fail",
    evidence,
    fix,
  });
  const ok = (evidence: string): RequirementOutcome => ({
    requirement: req,
    result: req.type === "review" ? "review" : "pass",
    evidence,
  });
  const review = (evidence: string): RequirementOutcome => ({ requirement: req, result: "review", evidence });
  const c = req.check;
  const dur = Math.max(0, ctx.endSec - ctx.startSec);

  if (c) {
    switch (c.kind) {
      case "hashtag": {
        const tags = (c.values ?? []).map((v) => v.toLowerCase());
        const missing = tags.filter((t) => !post.includes(t));
        if (req.type === "prohibited")
          return missing.length < tags.length ? miss("A prohibited hashtag is present.") : ok("No prohibited hashtag.");
        return missing.length
          ? miss(`Missing ${missing.join(" ")}`, { label: `Add ${missing.join(" ")}`, hashtags: missing })
          : ok(`Contains ${tags.join(" ")}`);
      }
      case "account": {
        const tags = (c.values ?? []).map((v) => v.toLowerCase());
        const missing = tags.filter((t) => !post.includes(t));
        return missing.length
          ? miss(`Missing ${missing.join(" ")}`, { label: `Add ${missing.join(" ")}`, hashtags: missing })
          : ok(`Mentions ${tags.join(" ")}`);
      }
      case "phrase": {
        const vals = (c.values ?? []).filter(Boolean);
        if (!vals.length) return review("No phrase to look for.");
        const found = vals.filter((v) => transcript.includes(norm(v)) || post.includes(norm(v)));
        if (req.type === "prohibited")
          return found.length ? miss(`Contains "${found[0]}"`) : ok("Phrase not present.");
        return found.length === vals.length
          ? ok(`Found "${vals.join('", "')}"`)
          : miss(`"${vals.filter((v) => !found.includes(v)).join('", "')}" not found in transcript or post text`, {
              label: `Add "${vals[0]}" to the description`,
              descriptionAppend: vals.filter((v) => !found.includes(v)).join(" "),
            });
      }
      case "hook-time": {
        const limit = c.seconds ?? 3;
        const words = clipWords(ctx);
        if (!words.length) return review("No word timing for this clip — can't verify hook timing.");
        if (c.values?.length) {
          const early = norm(words.filter((w) => w.startSec - ctx.startSec <= limit).map((w) => w.text).join(" "));
          const hit = c.values.some((v) => early.includes(norm(v)));
          return hit
            ? ok(`"${c.values[0]}" is said within ${limit}s`)
            : miss(`"${c.values[0]}" isn't said in the first ${limit}s`);
        }
        const first = words[0]!.startSec - ctx.startSec;
        return first <= limit
          ? ok(`Speech starts at ${first.toFixed(1)}s (limit ${limit}s)`)
          : miss(`Speech starts at ${first.toFixed(1)}s, after the ${limit}s hook window`);
      }
      case "max-duration":
        return dur <= (c.seconds ?? Infinity)
          ? ok(`${Math.round(dur)}s ≤ ${c.seconds}s`)
          : miss(`${Math.round(dur)}s is longer than ${c.seconds}s`);
      case "min-duration":
        return dur >= (c.seconds ?? 0)
          ? ok(`${Math.round(dur)}s ≥ ${c.seconds}s`)
          : miss(`${Math.round(dur)}s is shorter than ${c.seconds}s`);
      case "aspect": {
        const want = c.values?.[0];
        if (!ctx.aspect || !want) return review("Output format unknown.");
        return ctx.aspect === want ? ok(`Format is ${want}`) : miss(`Format is ${ctx.aspect}, campaign wants ${want}`);
      }
      case "language": {
        const want = c.values?.[0];
        if (!ctx.language) return review(`Transcript language unknown — confirm it's ${want}.`);
        return norm(ctx.language).startsWith(norm(want ?? ""))
          ? ok(`Transcript language: ${ctx.language}`)
          : miss(`Transcript language is ${ctx.language}, campaign wants ${want}`);
      }
      case "captions":
        return ctx.captionsEnabled ? ok("Captions are on") : miss("Captions are off");
      case "forbidden-words": {
        const hit = PROFANITY.find((p) => new RegExp(`\\b${p}`, "i").test(transcript));
        return hit ? miss(`Transcript contains a profanity ("${hit[0]}…")`) : ok("No listed profanity in transcript");
      }
      case "source": {
        const list = campaign.approvedSources.map((s) => s.toLowerCase());
        if (!list.length) return review("No approved source list — source can't be verified.");
        if (!ctx.sourceFileName) return review("Source file unknown.");
        return list.includes(ctx.sourceFileName.toLowerCase())
          ? ok(`APPROVED: ${ctx.sourceFileName} is on the approved list`)
          : review(`UNKNOWN: ${ctx.sourceFileName} isn't on the approved list`);
      }
    }
  }

  // Semantic requirements: optional AI evidence, otherwise keyword evidence → review.
  if (ctx.ai) {
    if (ctx.ai.violated.includes(req.id))
      return review(`AI flagged a possible ${req.type === "prohibited" ? "violation" : "miss"} — please confirm.`);
    if (ctx.ai.met.includes(req.id))
      return mandatory
        ? { requirement: req, result: "review", evidence: "AI thinks this is satisfied — please confirm." }
        : ok("AI thinks this is satisfied.");
  }
  const kw = keywords(req.text);
  const hits = kw.filter((k) => transcript.includes(k));
  if (req.type === "prohibited")
    return review(hits.length ? `Transcript mentions "${hits[0]}" — check the footage.` : "Needs a visual/manual check.");
  if (hits.length) return review(`Transcript mentions ${hits.slice(0, 3).join(", ")} — confirm it matches.`);
  return req.type === "recommended"
    ? { requirement: req, result: "unmet", evidence: "No evidence found in the transcript." }
    : review("Can't verify from the transcript — needs your review.");
}

const SCORE: Record<CheckResult, number> = { pass: 1, review: 0.5, fail: 0, unmet: 0 };

export function evaluateClipForCampaign(
  campaign: Campaign | null | undefined,
  ctx: ClipCampaignContext,
): CampaignEvaluation | null {
  if (!campaign) return null;
  const active = campaign.requirements.filter((r) => r.active);
  const outcomes = active.map((r) => evaluate(r, ctx, campaign));
  let num = 0;
  let den = 0;
  for (const o of outcomes) {
    const w = o.requirement.type === "recommended" ? 1 : o.requirement.type === "review" ? 0.5 : 2;
    num += w * SCORE[o.result];
    den += w;
  }
  let fit = den ? Math.round((num / den) * 100) : null;
  if (fit !== null && ctx.ai) fit = Math.round(fit * 0.7 + Math.min(100, Math.max(0, ctx.ai.fit)) * 0.3);
  const mandatoryFail = outcomes.some(
    (o) => o.result === "fail" && (o.requirement.type === "required" || o.requirement.type === "prohibited"),
  );
  const anyReview = outcomes.some((o) => o.result === "review");
  return {
    status: mandatoryFail ? "FAIL" : anyReview ? "REVIEW" : "PASS",
    fit,
    outcomes,
    strengths: outcomes.filter((o) => o.result === "pass").map((o) => `${o.requirement.text} — ${o.evidence}`),
    issues: outcomes
      .filter((o) => o.result !== "pass")
      .map((o) => `${o.requirement.text} — ${o.evidence}`),
  };
}

/** Validate an Ollama clip assessment against the campaign's requirement ids. */
export function parseAiAssessment(raw: string, campaign: Campaign): AiClipAssessment | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(raw.slice(a, b + 1)) as Record<string, unknown>;
    const ids = new Set(campaign.requirements.map((r) => r.id));
    const fit = Number(o["fit"]);
    if (!Number.isFinite(fit)) return null;
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => ids.has(x)) : []);
    return {
      fit: Math.round(Math.min(100, Math.max(0, fit))),
      met: list(o["met"]),
      violated: list(o["violated"]),
      notes: Array.isArray(o["notes"]) ? o["notes"].map((n) => String(n).slice(0, 120)).slice(0, 4) : [],
    };
  } catch {
    return null;
  }
}

export function assessmentPrompt(campaign: Campaign, transcript: string): string {
  const reqs = campaign.requirements
    .filter((r) => r.active && !r.check)
    .map((r) => `${r.id} [${r.type}] ${r.text}`)
    .join("\n");
  return `You review a short video clip transcript against campaign requirements. Judge only from the transcript; if unsure, leave the id out.
Return ONLY JSON: {"fit":0-100,"met":["id"],"violated":["id"],"notes":["short evidence"]}

Requirements:
${reqs}

Transcript:
${transcript.slice(0, 2500)}`;
}
