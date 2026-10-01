import type { RuleEvaluation, RuleMetrics } from "./rule-engine";

/**
 * Transparent, deterministic "Rule Score" (0-100). It is a ranking signal
 * built from measurable/heuristic features — not a prediction of performance.
 *
 * - Quality signals only count when their rule is turned on. A present signal
 *   earns its weight; a missing one earns nothing (it never rejects).
 * - Base factors (speech density, filler, silence, clean ending) always count.
 * - The total is divided by the best possible total for the current settings,
 *   so turning signals off does not shrink every score.
 */

export interface ScoreWeights {
  hookQuestion: number;
  hookStrongStatement: number;
  hookDirectAddress: number;
  hookSurprising: number;
  hookSentenceStart: number;
  completeThought: number;
  payoff: number;
  informationDense: number;
  storytelling: number;
  emotional: number;
  educational: number;
  funny: number;
  speechDensity: number;
  lowFiller: number;
  lowSilence: number;
  endCompleteSentence: number;
  endConclusion: number;
  endPayoff: number;
  endEmotional: number;
  penaltyExcessiveSilence: number;
  penaltyHighFiller: number;
  penaltyIncomplete: number;
  penaltyOutOfRange: number;
  penaltyDuplicate: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  hookQuestion: 8,
  hookStrongStatement: 8,
  hookDirectAddress: 5,
  hookSurprising: 6,
  hookSentenceStart: 5,
  completeThought: 10,
  payoff: 8,
  informationDense: 6,
  storytelling: 5,
  emotional: 4,
  educational: 5,
  funny: 3,
  speechDensity: 8,
  lowFiller: 5,
  lowSilence: 4,
  endCompleteSentence: 5,
  endConclusion: 3,
  endPayoff: 2,
  endEmotional: 2,
  penaltyExcessiveSilence: 10,
  penaltyHighFiller: 8,
  penaltyIncomplete: 10,
  penaltyOutOfRange: 15,
  penaltyDuplicate: 20,
};

/** Which quality-signal rule type drives which weight. */
export const SIGNAL_WEIGHTS: { type: string; key: keyof ScoreWeights; label: string }[] = [
  { type: "hook.containsQuestion", key: "hookQuestion", label: "Opening question" },
  { type: "hook.strongStatement", key: "hookStrongStatement", label: "Strong opening statement" },
  { type: "hook.directAddress", key: "hookDirectAddress", label: "Direct address" },
  { type: "hook.surprising", key: "hookSurprising", label: "Surprising opening" },
  { type: "hook.sentenceStart", key: "hookSentenceStart", label: "Starts at a sentence" },
  { type: "content.completeThought", key: "completeThought", label: "Complete thought" },
  { type: "content.payoff", key: "payoff", label: "Payoff" },
  { type: "content.informationDense", key: "informationDense", label: "Information dense" },
  { type: "content.storytelling", key: "storytelling", label: "Storytelling" },
  { type: "content.emotional", key: "emotional", label: "Emotional language" },
  { type: "content.educational", key: "educational", label: "Useful information" },
  { type: "content.funny", key: "funny", label: "Humor cues" },
  { type: "ending.conclusion", key: "endConclusion", label: "Ends on a conclusion" },
  { type: "ending.payoff", key: "endPayoff", label: "Ends on the payoff" },
  { type: "ending.emotional", key: "endEmotional", label: "Ends on an emotional line" },
];

export interface ScoreContext {
  minDurationSec: number;
  maxDurationSec: number;
  maxSilenceSec: number;
  maxFillerDensityPct: number;
  duplicate?: boolean | undefined;
}

export interface ScoreItem {
  key: keyof ScoreWeights;
  label: string;
  points: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreItem[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function scoreCandidate(
  metrics: RuleMetrics,
  evaluations: RuleEvaluation[],
  ctx: ScoreContext,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreResult {
  const items: ScoreItem[] = [];
  let maxPossible = 0;
  const add = (key: keyof ScoreWeights, label: string, factor: number | boolean) => {
    maxPossible += Math.max(0, weights[key]);
    const f = typeof factor === "boolean" ? (factor ? 1 : 0) : clamp01(factor);
    const points = Math.round(weights[key] * f * 10) / 10;
    if (points !== 0) items.push({ key, label, points });
  };
  const penalize = (key: keyof ScoreWeights, label: string, when: boolean) => {
    if (when) items.push({ key, label, points: -weights[key] });
  };

  // Quality signals: only the ones turned on in Rule settings.
  for (const s of SIGNAL_WEIGHTS) {
    const e = evaluations.find(
      (x) => x.ruleType === s.type && x.kind === "quality-signal" && x.enabled && x.supported,
    );
    if (e) add(s.key, s.label, e.passed === true);
  }

  // Base factors from measurements.
  // Full credit at 95% speech, none at 50%.
  add("speechDensity", "Speech density", (metrics.speechDensityPct - 50) / 45);
  add(
    "lowFiller",
    "Low filler words",
    1 - metrics.fillerDensityPct / Math.max(1, ctx.maxFillerDensityPct),
  );
  add("lowSilence", "Low silence", 1 - metrics.maxSilenceSec / Math.max(0.1, ctx.maxSilenceSec));
  add("endCompleteSentence", "Ends on a complete sentence", metrics.endsWithCompleteSentence);

  // Penalties only bite when the matching hard filter is turned off.
  penalize(
    "penaltyExcessiveSilence",
    "Excessive silence",
    metrics.maxSilenceSec > ctx.maxSilenceSec,
  );
  penalize(
    "penaltyHighFiller",
    "High filler density",
    metrics.fillerDensityPct > ctx.maxFillerDensityPct,
  );
  penalize("penaltyIncomplete", "Ends mid-sentence", !metrics.endsWithCompleteSentence);
  penalize(
    "penaltyOutOfRange",
    "Duration outside range",
    metrics.durationSec < ctx.minDurationSec || metrics.durationSec > ctx.maxDurationSec,
  );
  penalize("penaltyDuplicate", "Duplicate of a stronger clip", ctx.duplicate === true);

  const total = items.reduce((sum, i) => sum + i.points, 0);
  const normalized = maxPossible > 0 ? (total / maxPossible) * 100 : 0;
  return { score: Math.round(Math.min(100, Math.max(0, normalized))), breakdown: items };
}
