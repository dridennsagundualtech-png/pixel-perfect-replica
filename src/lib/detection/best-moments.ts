/**
 * Automatic Best Moments — ranks already-detected clips without replacing
 * Rule / AI / Hybrid pipelines.
 */
import type { ClipCandidate } from "./types";

export interface BestMomentsOptions {
  /** Max recommendations to return (default 5). */
  maxRecommendations?: number;
}

export interface BestMomentRecommendation {
  clip: ClipCandidate;
  rank: number;
  engagementPotential: number;
  ruleScore: number;
  durationSec: number;
  transcript: string;
  hook: string;
  reasons: string[];
  signals: string[];
  startSec: number;
  endSec: number;
}

function engagementOf(c: ClipCandidate): number {
  if (typeof c.engagementPotential === "number" && Number.isFinite(c.engagementPotential)) {
    return c.engagementPotential;
  }
  return c.score ?? 0;
}

function hookFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const sentence = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  return sentence.length > 120 ? `${sentence.slice(0, 117)}…` : sentence;
}

function reasonsFrom(c: ClipCandidate): string[] {
  const out: string[] = [];
  if (c.reason?.trim()) out.push(c.reason.trim());
  if (c.highlights?.length) out.push(...c.highlights.map(String));
  if (c.passedRules?.length) {
    out.push(
      ...c.passedRules
        .slice(0, 4)
        .map((r) => (typeof r === "string" ? r : (r as { label?: string }).label || ""))
        .filter(Boolean),
    );
  }
  const uniq = [...new Set(out.map((s) => String(s).trim()).filter(Boolean))];
  return uniq.slice(0, 6);
}

/**
 * Sort accepted clips by Engagement Potential (then Rule Score), return top N.
 * Does not re-run detection — uses the existing analysis result.
 */
export function selectBestMoments(
  clips: ClipCandidate[],
  options: BestMomentsOptions = {},
): BestMomentRecommendation[] {
  const max = Math.min(20, Math.max(1, options.maxRecommendations ?? 5));
  const sorted = [...clips].sort((a, b) => {
    const ea = engagementOf(a);
    const eb = engagementOf(b);
    if (eb !== ea) return eb - ea;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  return sorted.slice(0, max).map((clip, i) => {
    const transcript = (clip.transcriptText || "").replace(/\s+/g, " ").trim();
    const hook = (clip.hook || "").trim() || hookFrom(transcript);
    return {
      clip,
      rank: i + 1,
      engagementPotential: Math.round(engagementOf(clip)),
      ruleScore: Math.round(clip.score ?? 0),
      durationSec: Math.max(
        0,
        clip.durationSec ?? (clip.endSec ?? 0) - (clip.startSec ?? 0),
      ),
      transcript,
      hook,
      reasons: reasonsFrom(clip),
      signals: (clip.highlights ?? []).map(String).slice(0, 8),
      startSec: clip.startSec,
      endSec: clip.endSec,
    };
  });
}
