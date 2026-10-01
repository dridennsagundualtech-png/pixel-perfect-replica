import {
  DEFAULT_MAX_CANDIDATES,
  generateCandidates,
  getDurationBounds,
  type CandidateWindow,
} from "./candidate-generator";
import { createDefaultAiSettings } from "./defaults";
import {
  evaluateMetrics,
  getNumericRuleValue,
  isRuleActive,
  measureWindow,
  summarize,
  type RuleEngineResult,
  type RuleEvaluation,
} from "./rule-engine";
import {
  getRankingProvider,
  hybridScore,
  rankCandidatesSync,
  type RankingCandidateInput,
} from "./ranking-provider";
import {
  DEFAULT_SCORE_WEIGHTS,
  scoreCandidate,
  type ScoreResult,
  type ScoreWeights,
} from "./scoring";
import { prepareSegments } from "./text-signals";
import { validateTranscript, type TranscriptionResult } from "./transcript";
import type {
  AiSettings,
  ClipCandidate,
  ClipRuleResult,
  DetectionMode,
  DetectionRule,
} from "./types";

/**
 * transcript → candidate windows → rule engine → Rule Score → filter → rank → ClipCandidate[]
 *
 * Rule Mode: deterministic Rule Score only (unchanged).
 * AI Mode: same hard filters for safety, then Engagement Potential ranking.
 * Hybrid: hard filters + Rule Score first, then AI ranks survivors → Hybrid Score.
 * AI never resurrects hard-filter failures. On ranking failure, order by Rule Score.
 */

export type DetectionRunStatus =
  | "ok"
  | "no-transcript"
  | "empty-transcript"
  | "invalid-rules"
  | "no-candidates"
  | "all-rejected";

export interface DetectionOptions {
  mode?: DetectionMode | undefined;
  projectId?: string | undefined;
  maxCandidates?: number | undefined;
  maxResults?: number | undefined;
  /** Overlap ratio (of the shorter clip) above which clips count as duplicates. */
  duplicateOverlap?: number | undefined;
  weights?: ScoreWeights | undefined;
  /** Injectable clock so tests stay deterministic. */
  now?: (() => string) | undefined;
  /** AI factor weights / detect flags (AI + Hybrid). */
  ai?: AiSettings | undefined;
}

export interface AnalyzedCandidate {
  window: CandidateWindow;
  result: RuleEngineResult;
  score: ScoreResult;
  duplicateOf?: string | undefined;
  accepted: boolean;
}

export interface DetectionStats {
  segmentsUsed: number;
  segmentsSkipped: number;
  candidatesFound: number;
  candidatesEvaluated: number;
  passedRules: number;
  rejected: number;
  duplicates: number;
  beyondLimit: number;
  returned: number;
}

export interface DetectionRunResult {
  status: DetectionRunStatus;
  message: string;
  mode: DetectionMode;
  candidates: ClipCandidate[];
  analyzed: AnalyzedCandidate[];
  stats: DetectionStats;
  topFailures: { ruleId: string; label: string; count: number }[];
  warnings: string[];
}

function validateRules(rules: DetectionRule[]): string | null {
  if (!Array.isArray(rules)) return "Rule settings are missing.";
  const min = getNumericRuleValue(rules, "length.min");
  const max = getNumericRuleValue(rules, "length.max");
  if (min !== undefined && min < 0) return "Minimum duration cannot be negative.";
  if (max !== undefined && max <= 0) return "Maximum duration must be greater than 0.";
  if (min !== undefined && max !== undefined && min > max)
    return "Minimum duration is longer than maximum duration.";
  return null;
}

function overlapRatio(a: CandidateWindow, b: CandidateWindow): number {
  const inter = Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec);
  if (inter <= 0) return 0;
  return inter / Math.max(0.001, Math.min(a.durationSec, b.durationSec));
}

function firstSentence(text: string, max: number): string {
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

function toRuleResult(e: RuleEvaluation): ClipRuleResult {
  return { ruleId: e.ruleId, label: e.label, passed: e.passed === true, reason: e.reason };
}

function highlights(a: AnalyzedCandidate): string[] {
  const m = a.result.metrics;
  const out: string[] = [];
  if (m.containsQuestion) out.push("Opening question");
  if (m.containsStrongStatement) out.push("Strong opening statement");
  if (m.containsSurprisingStatement) out.push("Surprising opening");
  if (m.completeThought) out.push("Complete thought");
  if (m.hasPayoff) out.push("Clear payoff");
  out.push(`Speech density: ${Math.round(m.speechDensityPct)}%`);
  out.push(`Filler density: ${Math.round(m.fillerDensityPct)}%`);
  out.push(`${Math.round(m.durationSec)} second duration`);
  return out;
}

function toClip(
  a: AnalyzedCandidate,
  index: number,
  mode: DetectionMode,
  projectId: string | undefined,
  createdAt: string,
  ai?: {
    engagementPotential: number;
    factorScores: ClipCandidate["factorScores"];
    explanations: string[];
  },
): ClipCandidate {
  const { window: w, result } = a;
  const evals = result.evaluations.filter((e) => e.enabled && e.supported);
  const hl = highlights(a);
  const reasonParts = ai?.explanations?.length ? ai.explanations.slice(0, 4) : hl.slice(0, 4);
  return {
    id: w.id,
    index,
    projectId,
    startSec: w.startSec,
    endSec: w.endSec,
    durationSec: Math.round(w.durationSec * 10) / 10,
    mode,
    title: firstSentence(w.text, 70),
    hook: firstSentence(w.segments[0]?.text ?? w.text, 120),
    reason: reasonParts.join(" · "),
    transcriptText: w.text,
    segmentIds: w.segmentIds,
    score: a.score.score,
    engagementPotential: ai?.engagementPotential,
    factorScores: ai?.factorScores,
    rulesMatched: result.qualitySignalMatchedCount,
    rulesTotal: result.qualitySignalCount,
    qualityMatched: result.qualitySignalMatchedCount,
    qualityTotal: result.qualitySignalCount,
    hardFiltersChecked: result.hardFilterCount,
    passedRules: evals.filter((e) => e.passed === true).map(toRuleResult),
    failedRules: evals.filter((e) => e.passed === false).map(toRuleResult),
    highlights: ai?.explanations?.length
      ? [...ai.explanations, ...hl.filter((h) => !ai.explanations!.includes(h))].slice(0, 8)
      : hl,
    metrics: {
      durationSec: Math.round(result.metrics.durationSec * 10) / 10,
      wordCount: result.metrics.wordCount,
      speechDensityPct: Math.round(result.metrics.speechDensityPct),
      fillerDensityPct: Math.round(result.metrics.fillerDensityPct * 10) / 10,
      maxSilenceSec: Math.round(result.metrics.maxSilenceSec * 10) / 10,
      wordsPerSecond: Math.round(result.metrics.wordsPerSecond * 10) / 10,
    },
    status: "candidate",
    createdAt,
  };
}

const emptyStats = (skipped = 0, used = 0): DetectionStats => ({
  segmentsUsed: used,
  segmentsSkipped: skipped,
  candidatesFound: 0,
  candidatesEvaluated: 0,
  passedRules: 0,
  rejected: 0,
  duplicates: 0,
  beyondLimit: 0,
  returned: 0,
});

export async function runDetection(
  transcript: TranscriptionResult | undefined | null,
  rules: DetectionRule[],
  options: DetectionOptions = {},
): DetectionRunResult {
  const mode = options.mode ?? "rules";
  const base = { mode, candidates: [] as ClipCandidate[], analyzed: [] as AnalyzedCandidate[], topFailures: [] as DetectionRunResult["topFailures"] };

  if (!transcript) {
    return {
      ...base,
      status: "no-transcript",
      message: "This video has no transcript yet. Transcription is the next required step.",
      stats: emptyStats(),
      warnings: [],
    };
  }

  const { segments: clean, skipped, warnings } = validateTranscript(transcript.segments);
  if (clean.length === 0) {
    return {
      ...base,
      status: "empty-transcript",
      message: "The transcript has no usable segments.",
      stats: emptyStats(skipped),
      warnings,
    };
  }

  const ruleError = validateRules(rules);
  if (ruleError) {
    return {
      ...base,
      status: "invalid-rules",
      message: ruleError,
      stats: emptyStats(skipped, clean.length),
      warnings,
    };
  }

  const prepared = prepareSegments(clean);
  // Duration bounds: Rule settings for rules/hybrid; AI length settings can tighten AI mode.
  let bounds = getDurationBounds(rules);
  if (mode === "ai" && options.ai) {
    const aiB = {
      minDurationSec: Math.max(1, options.ai.minDurationSec || bounds.minDurationSec),
      maxDurationSec: Math.max(
        2,
        options.ai.maxDurationSec || bounds.maxDurationSec,
      ),
    };
    if (aiB.minDurationSec > aiB.maxDurationSec) {
      aiB.maxDurationSec = aiB.minDurationSec + 15;
    }
    bounds = aiB;
  }

  const generation = generateCandidates(prepared, {
    ...bounds,
    maxCandidates: options.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
  });
  if (generation.truncated) {
    warnings.push(
      `Found ${generation.totalFound} possible windows; evaluated a spread of ${generation.candidates.length}.`,
    );
  }
  if (generation.oversizedSegments > 0) {
    warnings.push(
      `${generation.oversizedSegments} transcript segments are longer than the maximum clip duration.`,
    );
  }

  const stats = emptyStats(skipped, clean.length);
  stats.candidatesFound = generation.totalFound;
  stats.candidatesEvaluated = generation.candidates.length;

  if (generation.candidates.length === 0) {
    return {
      ...base,
      status: "no-candidates",
      message: `No window of whole sentences fits between ${bounds.minDurationSec}s and ${bounds.maxDurationSec}s.`,
      stats,
      warnings,
    };
  }

  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
  const scoreCtx = {
    ...bounds,
    maxSilenceSec: getNumericRuleValue(rules, "audio.maxSilence") ?? 2,
    maxFillerDensityPct: getNumericRuleValue(rules, "audio.maxFillerDensity") ?? 8,
  };

  const analyzed: AnalyzedCandidate[] = generation.candidates.map((window) => {
    const metrics = measureWindow(window.segments, window.startSec, window.endSec);
    const result = evaluateMetrics(rules, metrics);
    return {
      window,
      result,
      score: scoreCandidate(metrics, result.evaluations, scoreCtx, weights),
      accepted: false,
    };
  });

  // Hard filters always apply — AI cannot resurrect rejects.
  const passedHard = analyzed.filter((a) => a.result.passed);
  stats.passedRules = passedHard.length;

  const rankedByRule = [...passedHard].sort(
    (a, b) =>
      b.score.score - a.score.score ||
      a.window.startSec - b.window.startSec ||
      a.window.endSec - b.window.endSec,
  );

  const dupRule = rules.find((r) => r.type === "exclude.duplicates");
  const excludeDuplicates = dupRule ? isRuleActive(dupRule) : true;
  const threshold = options.duplicateOverlap ?? 0.5;
  const maxResults = Math.max(1, options.maxResults ?? 20);
  const accepted: AnalyzedCandidate[] = [];

  for (const a of rankedByRule) {
    if (accepted.length >= maxResults) break;
    const dupOf = accepted.find((k) => overlapRatio(k.window, a.window) >= threshold);
    if (dupOf) {
      a.duplicateOf = dupOf.window.id;
      stats.duplicates += 1;
      if (excludeDuplicates) {
        const idx = a.result.evaluations.findIndex((e) => e.ruleType === "exclude.duplicates");
        const evaluation: RuleEvaluation = {
          ruleId: dupRule?.id ?? "exclude.duplicates",
          ruleType: "exclude.duplicates",
          label: dupRule?.label ?? "Exclude duplicate / similar clips",
          kind: "hard-filter",
          enabled: true,
          supported: true,
          passed: false,
          actual: false,
          expected: true,
          method: "measured",
          reason: `Overlaps a higher-ranked clip (${dupOf.window.id})`,
        };
        const evals = [...a.result.evaluations];
        if (idx >= 0) evals[idx] = evaluation;
        else evals.push(evaluation);
        a.result = summarize(evals, a.result.metrics);
        a.score = scoreCandidate(
          a.result.metrics,
          evals,
          { ...scoreCtx, duplicate: true },
          weights,
        );
        continue;
      }
    }
    a.accepted = true;
    accepted.push(a);
  }

  stats.rejected = analyzed.length - passedHard.length;
  stats.returned = accepted.length;
  stats.beyondLimit = Math.max(
    0,
    passedHard.length - accepted.length - (excludeDuplicates ? stats.duplicates : 0),
  );

  const failureCounts = new Map<string, { ruleId: string; label: string; count: number }>();
  for (const a of analyzed) {
    if (a.result.passed) continue;
    for (const e of a.result.evaluations) {
      if (e.passed !== false || e.kind !== "hard-filter" || e.ruleType === "exclude.duplicates")
        continue;
      const entry = failureCounts.get(e.ruleId) ?? { ruleId: e.ruleId, label: e.label, count: 0 };
      entry.count += 1;
      failureCounts.set(e.ruleId, entry);
    }
  }
  const topFailures = [...failureCounts.values()]
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId))
    .slice(0, 5);

  const unsupported =
    analyzed[0]?.result.evaluations.filter(
      (e) => e.enabled && !e.supported && e.ruleType !== "exclude.duplicates",
    ) ?? [];
  if (unsupported.length > 0) {
    warnings.push(`Not checked (no evaluator yet): ${unsupported.map((e) => e.label).join(", ")}.`);
  }

  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  const aiSettings: AiSettings = options.ai ?? createDefaultAiSettings();

  // Optional AI ranking on hard-filter survivors only.
  const aiMap = new Map<
    string,
    {
      engagementPotential: number;
      factorScores: ClipCandidate["factorScores"];
      explanations: string[];
    }
  >();
  let ordered = accepted;

  if ((mode === "ai" || mode === "hybrid") && accepted.length > 0) {
    try {
      const inputs: RankingCandidateInput[] = accepted.map((a) => ({
        id: a.window.id,
        window: a.window,
        ruleScore: a.score.score,
        metrics: a.result.metrics,
        signalLabels: highlights(a),
      }));
      const provider = getRankingProvider();
      const ranked =
        provider.id === "local-heuristic"
          ? rankCandidatesSync(inputs, aiSettings)
          : await provider.rankCandidates(inputs, aiSettings);
      if (provider.id !== "local-heuristic") {
        warnings.push(`Ranked with ${provider.label}.`);
      }
      for (const r of ranked) {
        aiMap.set(r.id, {
          engagementPotential: r.engagementPotential,
          factorScores: r.factorScores,
          explanations: r.explanations,
        });
      }
      ordered = [...accepted].sort((a, b) => {
        const ea = aiMap.get(a.window.id)?.engagementPotential ?? 0;
        const eb = aiMap.get(b.window.id)?.engagementPotential ?? 0;
        if (mode === "hybrid") {
          const ha = hybridScore(a.score.score, ea);
          const hb = hybridScore(b.score.score, eb);
          return hb - ha || eb - ea || b.score.score - a.score.score;
        }
        return eb - ea || b.score.score - a.score.score;
      });
      if (mode === "hybrid") {
        warnings.push(
          "Hybrid Score = 40% Rule Score + 60% Engagement Potential. Hard filters always apply first.",
        );
      } else {
        warnings.push(
          "Engagement Potential is a local ranking signal, not a prediction of reach or virality.",
        );
      }
    } catch (e) {
      console.warn("[detection] AI ranking failed", e);
      warnings.push("AI ranking failed; clips ordered by Rule Score.");
      ordered = accepted;
      aiMap.clear();
    }
  }

  const candidates = ordered.map((a, i) => {
    const ai = aiMap.get(a.window.id);
    let ep = ai?.engagementPotential;
    if (mode === "hybrid" && ai) {
      ep = hybridScore(a.score.score, ai.engagementPotential);
    }
    return toClip(
      a,
      i + 1,
      mode,
      options.projectId,
      createdAt,
      ai
        ? {
            engagementPotential: ep ?? ai.engagementPotential,
            factorScores: ai.factorScores,
            explanations: ai.explanations,
          }
        : undefined,
    );
  });

  const modeLabel =
    mode === "ai" ? "AI" : mode === "hybrid" ? "Hybrid" : "Rules";

  return {
    mode,
    status: accepted.length > 0 ? "ok" : "all-rejected",
    message:
      accepted.length > 0
        ? `${accepted.length} clip${accepted.length === 1 ? "" : "s"} found (${modeLabel}) — ${passedHard.length} of ${analyzed.length} candidates passed your hard filters.`
        : `All ${analyzed.length} candidates failed at least one hard filter.`,
    candidates,
    analyzed,
    stats,
    topFailures,
    warnings,
  };
}
