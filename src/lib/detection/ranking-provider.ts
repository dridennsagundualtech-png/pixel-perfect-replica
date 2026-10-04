/**
 * Clip ranking providers (Phase 8).
 *
 * Rule Mode stays fully deterministic and does not use these providers.
 * AI / Hybrid modes call a ClipRankingProvider. The built-in local provider is
 * free, offline, and deterministic — it is NOT a neural model and does NOT
 * claim virality prediction. Engagement Potential is a ranking signal only.
 *
 * Swap in a remote provider later without changing the pipeline contract.
 */

import type { RuleMetrics } from "./rule-engine";
import type { AiFactorKey, AiSettings, DetectionRule } from "./types";
import type { CandidateWindow } from "./candidate-generator";
import type { ScoreResult } from "./scoring";

export interface RankingCandidateInput {
  id: string;
  window: CandidateWindow;
  /** Deterministic Rule Score (0–100), if available. */
  ruleScore: number;
  metrics: RuleMetrics;
  /** Quality-signal highlights already measured. */
  signalLabels: string[];
}

export interface RankedCandidate {
  id: string;
  /** Engagement Potential 0–100 — ranking signal, not virality probability. */
  engagementPotential: number;
  factorScores: Partial<Record<AiFactorKey, number>>;
  /** Concise explanations backed only by measured signals. */
  explanations: string[];
}

export interface ClipRankingProvider {
  readonly id: string;
  readonly label: string;
  rankCandidates(
    candidates: RankingCandidateInput[],
    settings: AiSettings,
  ): Promise<RankedCandidate[]>;
}

const FACTOR_KEYS: AiFactorKey[] = [
  "hook",
  "curiosity",
  "emotion",
  "story",
  "information",
  "quotability",
  "humor",
  "surprise",
  "pacing",
];

function clamp100(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)));
}

/**
 * Free local ranker: maps measured transcript metrics + quality signals onto
 * AiSettings factor weights. Deterministic for the same transcript + settings.
 */
export const localHeuristicRankingProvider: ClipRankingProvider = {
  id: "local-heuristic",
  label: "Local ranking (free)",

  async rankCandidates(candidates, settings) {
    return rankCandidatesSync(candidates, settings);
  },
};

/** Sync entry for the detection pipeline (local provider has no I/O). */
export function rankCandidatesSync(
  candidates: RankingCandidateInput[],
  settings: AiSettings,
): RankedCandidate[] {
  return candidates.map((c) => rankOne(c, settings));
}

function rankOne(c: RankingCandidateInput, settings: AiSettings): RankedCandidate {
  const m = c.metrics;
  const labels = new Set(c.signalLabels.map((s) => s.toLowerCase()));
  const has = (...parts: string[]) =>
    [...labels].some((l) => parts.every((p) => l.includes(p.toLowerCase())));

  const factors: Record<AiFactorKey, number> = {
    hook: scoreHook(m, has),
    curiosity: scoreCuriosity(m, has, c.window.text),
    emotion: scoreBool(m.emotional || has("emotional"), 75, 25),
    story: scoreBool(m.storytelling || has("story"), 70, 20),
    information: scoreInformation(m, has),
    quotability: scoreQuotability(c.window.text, m),
    humor: scoreBool(m.funny || has("humor") || has("funny"), 65, 15),
    surprise: scoreBool(m.containsSurprisingStatement || has("surprising"), 70, 18),
    pacing: scorePacing(m),
  };

  // Apply user factor weights + detect flags.
  let weighted = 0;
  let weightSum = 0;
  const explanations: string[] = [];

  for (const key of FACTOR_KEYS) {
    const w = settings.factors[key] ?? 50;
    if (w <= 0) continue;
    const v = factors[key];
    weighted += (v * w) / 100;
    weightSum += w;

    // Explanations only when the factor scored meaningfully and the signal is real.
    if (v >= 55) {
      const exp = explanationFor(key, m, has, c.window.text);
      if (exp) explanations.push(exp);
    }
  }

  // Detect flags: boost when enabled and signal present (never invent).
  if (settings.detect.strongHooks && (m.containsQuestion || m.containsStrongStatement)) {
    explanations.push(m.containsQuestion ? "Strong opening question" : "Strong opening statement");
  }
  if (settings.detect.questions && m.containsQuestion) {
    /* already covered */
  }
  if (settings.detect.surprising && m.containsSurprisingStatement) {
    explanations.push("Surprising opening");
  }
  if (settings.detect.emotional && m.emotional) {
    explanations.push("Emotional moment");
  }
  if (settings.detect.usefulInfo && (m.informationDense || m.educational)) {
    explanations.push("High information density");
  }
  if (settings.detect.storytelling && m.storytelling) {
    explanations.push("Complete story arc cues");
  }
  if (settings.detect.quotable && factors.quotability >= 60) {
    explanations.push("Quotable line");
  }
  if (settings.detect.humor && m.funny) {
    explanations.push("Humor cues");
  }

  if (m.hasPayoff || m.endsWithPayoff) explanations.push("Clear payoff");
  if (m.completeThought) explanations.push("Complete thought");

  const unique = [...new Set(explanations)].slice(0, 5);
  const base = weightSum > 0 ? (weighted / weightSum) * 100 : 50;
  // Slight blend with Rule Score so ranking stays grounded when available.
  const blended = base * 0.85 + c.ruleScore * 0.15;

  const factorScores: Partial<Record<AiFactorKey, number>> = {};
  for (const key of FACTOR_KEYS) factorScores[key] = clamp100(factors[key]);

  return {
    id: c.id,
    engagementPotential: clamp100(blended),
    factorScores,
    explanations: unique,
  };
}

function scoreBool(on: boolean, high: number, low: number): number {
  return on ? high : low;
}

function scoreHook(m: RuleMetrics, has: (...p: string[]) => boolean): number {
  let s = 20;
  if (m.containsQuestion || has("question")) s += 35;
  if (m.containsStrongStatement || has("strong opening")) s += 30;
  if (m.containsDirectAddress || has("direct address")) s += 15;
  if (m.startsNearSentenceStart) s += 10;
  return Math.min(100, s);
}

function scoreCuriosity(m: RuleMetrics, has: (...p: string[]) => boolean, text: string): number {
  let s = 20;
  if (m.containsQuestion) s += 25;
  if (m.containsSurprisingStatement) s += 25;
  if (/\b(secret|nobody|most people|here's why|the truth)\b/i.test(text)) s += 20;
  if (has("surprising")) s += 10;
  return Math.min(100, s);
}

function scoreInformation(m: RuleMetrics, has: (...p: string[]) => boolean): number {
  let s = m.informationDense || m.educational || has("information") || has("useful") ? 70 : 25;
  if (m.wordsPerSecond >= 2.2 && m.wordsPerSecond <= 3.8) s += 15;
  return Math.min(100, s);
}

function scoreQuotability(text: string, m: RuleMetrics): number {
  const first = text.split(/[.!?]/)[0] ?? text;
  let s = 25;
  if (first.length >= 20 && first.length <= 110) s += 25;
  if (m.containsStrongStatement || m.containsQuestion) s += 20;
  if (m.hasPayoff) s += 15;
  return Math.min(100, s);
}

function scorePacing(m: RuleMetrics): number {
  // Prefer speechy clips with limited dead air and moderate rate.
  let s = 40;
  s += Math.min(30, Math.max(0, (m.speechDensityPct - 55) * 0.8));
  s -= Math.min(25, m.maxSilenceSec * 8);
  s -= Math.min(15, m.fillerDensityPct * 1.5);
  if (m.wordsPerSecond >= 2 && m.wordsPerSecond <= 4) s += 15;
  return Math.min(100, Math.max(0, s));
}

function explanationFor(
  key: AiFactorKey,
  m: RuleMetrics,
  has: (...p: string[]) => boolean,
  _text: string,
): string | null {
  switch (key) {
    case "hook":
      if (m.containsQuestion) return "Strong opening question";
      if (m.containsStrongStatement) return "Strong opening statement";
      if (m.containsDirectAddress) return "Direct address to the viewer";
      return null;
    case "curiosity":
      if (m.containsQuestion || m.containsSurprisingStatement) return "Curiosity hook";
      return null;
    case "emotion":
      return m.emotional || has("emotional") ? "Emotional moment" : null;
    case "story":
      return m.storytelling || has("story") ? "Story structure cues" : null;
    case "information":
      return m.informationDense || m.educational ? "High information density" : null;
    case "quotability":
      return m.containsStrongStatement || m.containsQuestion ? "Quotable opening" : null;
    case "humor":
      return m.funny ? "Humor cues" : null;
    case "surprise":
      return m.containsSurprisingStatement ? "Surprising claim" : null;
    case "pacing":
      return m.speechDensityPct >= 70 && m.maxSilenceSec < 1.5 ? "Tight pacing" : null;
    default:
      return null;
  }
}

/** Default provider registry — extend when adding paid/remote rankers. */
let activeProvider: ClipRankingProvider = localHeuristicRankingProvider;

export function getRankingProvider(): ClipRankingProvider {
  return activeProvider;
}

export function setRankingProvider(provider: ClipRankingProvider): void {
  activeProvider = provider;
}

/** Hybrid Score: Rule Score + Engagement Potential (transparent blend). */
export function hybridScore(ruleScore: number, engagementPotential: number): number {
  return clamp100(ruleScore * 0.4 + engagementPotential * 0.6);
}

/** Re-export for pipeline duration bounds from AI settings when in AI mode. */
export function aiDurationBounds(settings: AiSettings): {
  minDurationSec: number;
  maxDurationSec: number;
} {
  const min = Math.max(1, settings.minDurationSec || 15);
  const max = Math.max(min + 1, settings.maxDurationSec || 60);
  return { minDurationSec: min, maxDurationSec: max };
}

export type { DetectionRule };
