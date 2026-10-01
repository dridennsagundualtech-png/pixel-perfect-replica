import type { DetectionRule, RuleKind } from "./types";
import { prepareSegments, type PreparedSegment } from "./text-signals";
import type { TranscriptSegment } from "./transcript";

export type { TranscriptSegment, TranscriptionResult } from "./transcript";

/**
 * Deterministic rule engine for ClipPilot.
 *
 * No AI, no raw video. It measures a window of timestamped transcript and
 * checks each DetectionRule config object against those measurements.
 * Every evaluation carries a human-readable reason for a "Why this clip?" view.
 *
 * Rules are either hard filters (can reject a clip) or quality signals (only
 * affect the Rule Score). A rule is on when `enabled && value !== false` —
 * this matches the checkbox semantics of RuleSettingsPanel.
 */

/** Seconds at the start of a clip that count as "the hook". */
export const HOOK_WINDOW_SEC = 5;

export interface RuleEngineInput {
  startSec: number;
  endSec: number;
  segments: TranscriptSegment[];
  /** Optional semantic signals from a future analyzer; override heuristics. */
  signals?: Partial<RuleSignals> | undefined;
}

export interface RuleSignals {
  containsQuestion: boolean;
  containsStrongStatement: boolean;
  containsSurprisingStatement: boolean;
  containsDirectAddress: boolean;
  startsNearSentenceStart: boolean;
  completeThought: boolean;
  hasPayoff: boolean;
  educational: boolean;
  funny: boolean;
  emotional: boolean;
  storytelling: boolean;
  informationDense: boolean;
  endsWithCompleteSentence: boolean;
  endsWithConclusion: boolean;
  endsWithPayoff: boolean;
  endsWithEmotionalStatement: boolean;
  duplicate: boolean;
}

export interface RuleMetrics extends Omit<RuleSignals, "duplicate"> {
  durationSec: number;
  wordCount: number;
  speechDurationSec: number;
  speechDensityPct: number;
  maxSilenceSec: number;
  fillerWordCount: number;
  fillerDensityPct: number;
  wordsPerSecond: number;
  uniqueWordRatio: number;
  semantic: Partial<RuleSignals>;
}

/** "measured" = from timestamps/counts; "heuristic" = keyword/punctuation guess; "signal" = supplied by an analyzer. */
export type EvaluationMethod = "measured" | "heuristic" | "signal";

export interface RuleEvaluation {
  ruleId: string;
  ruleType: string;
  label: string;
  kind: RuleKind;
  /** Rule is turned on (enforced for hard filters, scored for quality signals). */
  enabled: boolean;
  supported: boolean;
  passed: boolean | null;
  actual?: number | boolean | null | undefined;
  expected?: number | boolean | null | undefined;
  method?: EvaluationMethod | undefined;
  reason: string;
}

export interface RuleEngineResult {
  /** True when no enabled hard filter failed. Quality signals never reject. */
  passed: boolean;
  supportedRuleCount: number;
  unsupportedRuleCount: number;
  enabledRuleCount: number;
  passedRuleCount: number;
  failedRuleCount: number;
  hardFilterCount: number;
  hardFilterFailedCount: number;
  qualitySignalCount: number;
  qualitySignalMatchedCount: number;
  metrics: RuleMetrics;
  evaluations: RuleEvaluation[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rule types that may reject a clip. Everything else is a quality signal. */
export const HARD_FILTER_TYPES: ReadonlySet<string> = new Set([
  "length.min",
  "length.max",
  "audio.maxSilence",
  "audio.maxFillerDensity",
  "audio.minSpeechDensity",
  "ending.completeSentence",
  "ending.completeThought",
  "exclude.excessiveSilence",
  "exclude.incompleteSentences",
  "exclude.tooShort",
  "exclude.tooLong",
  "exclude.duplicates",
]);

/**
 * Centralized classification. Explicit `kind` wins; older saved rules without
 * it are inferred from their type. Custom rules default to quality signals so
 * an unchecked custom rule can never wipe out every clip.
 */
export function getRuleKind(rule: Pick<DetectionRule, "type" | "kind">): RuleKind {
  if (rule.kind === "hard-filter" || rule.kind === "quality-signal") return rule.kind;
  return HARD_FILTER_TYPES.has(rule.type) ? "hard-filter" : "quality-signal";
}

export function isRuleActive(rule: DetectionRule): boolean {
  if (!rule.enabled) return false;
  if ((rule.operator === "isTrue" || rule.operator === "isFalse") && rule.value === false)
    return false;
  return true;
}

export function getNumericRuleValue(rules: DetectionRule[], type: string): number | undefined {
  const r = rules.find((c) => c.type === type && c.enabled && typeof c.value === "number");
  return r && Number.isFinite(Number(r.value)) ? Number(r.value) : undefined;
}

/** Measures a window made of whole prepared segments (already sorted). */
export function measureWindow(
  segments: PreparedSegment[],
  startSec: number,
  endSec: number,
  signals: Partial<RuleSignals> = {},
): RuleMetrics {
  const clipStart = Math.min(startSec, endSec);
  const clipEnd = Math.max(startSec, endSec);
  const durationSec = Math.max(0, clipEnd - clipStart);

  let wordCount = 0;
  let fillerWordCount = 0;
  let speechDurationSec = 0;
  let maxSilenceSec = 0;
  const unique = new Set<string>();
  const any = {
    question: false,
    payoff: false,
    educational: false,
    funny: false,
    emotional: false,
    storytelling: false,
  };
  const hook = { question: false, strong: false, direct: false, surprising: false };
  let prevEnd = clipStart;

  for (const seg of segments) {
    const s = Math.max(clipStart, seg.startSec);
    const e = Math.min(clipEnd, seg.endSec);
    if (e <= s) continue;
    speechDurationSec += e - s;
    maxSilenceSec = Math.max(maxSilenceSec, s - prevEnd);
    prevEnd = Math.max(prevEnd, e);
    wordCount += seg.wordCount;
    fillerWordCount += seg.fillerCount;
    for (const t of seg.tokens) unique.add(t);
    any.payoff ||= seg.payoff;
    any.educational ||= seg.educational;
    any.funny ||= seg.funny;
    any.emotional ||= seg.emotional;
    any.storytelling ||= seg.storytelling;
    if (seg.startSec < clipStart + HOOK_WINDOW_SEC) {
      hook.question ||= seg.question;
      hook.strong ||= seg.strongStatement;
      hook.direct ||= seg.directAddress;
      hook.surprising ||= seg.surprising;
    }
  }
  maxSilenceSec = Math.max(maxSilenceSec, clipEnd - prevEnd);

  const first = segments[0];
  const last = segments[segments.length - 1];
  const speechDensityPct =
    durationSec > 0 ? Math.min(100, (speechDurationSec / durationSec) * 100) : 0;
  const fillerDensityPct = wordCount > 0 ? (fillerWordCount / wordCount) * 100 : 0;
  const wordsPerSecond = durationSec > 0 ? wordCount / durationSec : 0;
  const uniqueWordRatio = wordCount > 0 ? unique.size / wordCount : 0;

  const startsNear = first
    ? first.startsSentence && Math.abs(first.startSec - clipStart) <= 1.5
    : false;
  const endsComplete = last ? last.endsSentence : false;

  const h = {
    containsQuestion: hook.question,
    containsStrongStatement: hook.strong,
    containsDirectAddress: hook.direct,
    containsSurprisingStatement: hook.surprising,
    startsNearSentenceStart: startsNear,
    completeThought: startsNear && endsComplete,
    hasPayoff: any.payoff,
    educational: any.educational,
    funny: any.funny,
    emotional: any.emotional,
    storytelling: any.storytelling,
    informationDense: wordsPerSecond >= 2.2 && uniqueWordRatio >= 0.45 && fillerDensityPct < 5,
    endsWithCompleteSentence: endsComplete,
    endsWithConclusion: last ? last.conclusion || last.payoff : false,
    endsWithPayoff: last ? last.payoff : false,
    endsWithEmotionalStatement: last ? last.emotional : false,
  };

  const { duplicate: _dup, ...overrides } = signals;
  return {
    ...h,
    ...overrides,
    durationSec,
    wordCount,
    speechDurationSec,
    speechDensityPct,
    maxSilenceSec,
    fillerWordCount,
    fillerDensityPct,
    wordsPerSecond,
    uniqueWordRatio,
    semantic: signals,
  };
}

type Check =
  | {
      supported: true;
      actual: number | boolean;
      reason: string;
      method: EvaluationMethod;
      passedOverride?: boolean;
    }
  | { supported: false; reason: string };

function fmt(n: number, unit?: string): string {
  if (unit === "%") return `${Math.round(n)}%`;
  if (unit === "s") return `${round1(n)}s`;
  return `${round1(n)}`;
}

function numeric(
  name: string,
  actual: number,
  rule: DetectionRule,
): { passed: boolean; reason: string } {
  const expected = Number(rule.value);
  const a = fmt(actual, rule.unit);
  const e = fmt(expected, rule.unit);
  switch (rule.operator) {
    case "min":
      return actual >= expected
        ? { passed: true, reason: `${name} is ${a}, meeting the required ${e}` }
        : { passed: false, reason: `${name} is ${a}, below the required ${e}` };
    case "max":
      return actual <= expected
        ? { passed: true, reason: `${name} is ${a}, within the ${e} limit` }
        : { passed: false, reason: `${name} is ${a}, above the ${e} limit` };
    case "equals":
      return actual === expected
        ? { passed: true, reason: `${name} is ${a}, as required` }
        : { passed: false, reason: `${name} is ${a}, expected ${e}` };
    default:
      return {
        passed: false,
        reason: `${name}: operator "${rule.operator}" is not valid for a number`,
      };
  }
}

const flag = (
  actual: boolean,
  yes: string,
  no: string,
  method: EvaluationMethod = "heuristic",
): Check => ({
  supported: true,
  actual,
  reason: actual ? yes : no,
  method,
});

const NUMERIC_METRIC: Record<string, { name: string; pick: (m: RuleMetrics) => number }> = {
  "length.min": { name: "Duration", pick: (m) => m.durationSec },
  "length.max": { name: "Duration", pick: (m) => m.durationSec },
  "audio.maxSilence": { name: "Longest silence", pick: (m) => m.maxSilenceSec },
  "audio.maxFillerDensity": { name: "Filler-word density", pick: (m) => m.fillerDensityPct },
  "audio.minSpeechDensity": { name: "Speech density", pick: (m) => m.speechDensityPct },
};

function check(type: string, m: RuleMetrics, rules: DetectionRule[]): Check {
  const sig = (k: keyof RuleSignals): EvaluationMethod | undefined =>
    m.semantic[k] !== undefined ? "signal" : undefined;
  switch (type) {
    case "hook.containsQuestion":
      return flag(
        m.containsQuestion,
        "Opens with a question",
        "No question in the opening seconds",
        sig("containsQuestion"),
      );
    case "hook.strongStatement":
      return flag(
        m.containsStrongStatement,
        "Opens with a strong statement",
        "No strong statement in the opening seconds",
        sig("containsStrongStatement"),
      );
    case "hook.surprising":
      return flag(
        m.containsSurprisingStatement,
        "Opens with a surprising claim",
        "No surprising claim in the opening seconds",
        sig("containsSurprisingStatement"),
      );
    case "hook.directAddress":
      return flag(
        m.containsDirectAddress,
        "Speaks directly to the viewer",
        "Does not address the viewer directly",
        sig("containsDirectAddress"),
      );
    case "hook.sentenceStart":
      return flag(
        m.startsNearSentenceStart,
        "Starts at the beginning of a sentence",
        "Starts mid-sentence",
        sig("startsNearSentenceStart") ?? "measured",
      );
    case "content.completeThought":
      return flag(
        m.completeThought,
        "Complete thought",
        "Thought is cut off at the start or end",
        sig("completeThought") ?? "measured",
      );
    case "content.payoff":
      return flag(m.hasPayoff, "Contains a payoff", "No clear payoff detected", sig("hasPayoff"));
    case "content.educational":
      return flag(
        m.educational,
        "Contains useful / educational language",
        "No educational cues detected",
        sig("educational"),
      );
    case "content.funny":
      return flag(m.funny, "Contains humor cues", "No humor cues detected", sig("funny"));
    case "content.emotional":
      return flag(
        m.emotional,
        "Contains emotional language",
        "No emotional language detected",
        sig("emotional"),
      );
    case "content.storytelling":
      return flag(
        m.storytelling,
        "Contains storytelling cues",
        "No storytelling cues detected",
        sig("storytelling"),
      );
    case "content.informationDense":
      return flag(
        m.informationDense,
        `Information dense (${round1(m.wordsPerSecond)} words/s)`,
        `Not information dense (${round1(m.wordsPerSecond)} words/s, ${Math.round(m.uniqueWordRatio * 100)}% unique words)`,
        sig("informationDense"),
      );
    case "ending.completeSentence":
      return flag(
        m.endsWithCompleteSentence,
        "Ends on a complete sentence",
        "Ends mid-sentence",
        sig("endsWithCompleteSentence") ?? "measured",
      );
    case "ending.conclusion":
      return flag(
        m.endsWithConclusion,
        "Ends on a conclusion",
        "No concluding line at the end",
        sig("endsWithConclusion"),
      );
    case "ending.payoff":
      return flag(
        m.endsWithPayoff,
        "Ends on the payoff",
        "Does not end on a payoff",
        sig("endsWithPayoff"),
      );
    case "ending.emotional":
      return flag(
        m.endsWithEmotionalStatement,
        "Ends on an emotional line",
        "Ending is not emotional",
        sig("endsWithEmotionalStatement"),
      );
    case "exclude.excessiveSilence": {
      const limit = getNumericRuleValue(rules, "audio.maxSilence") ?? 2;
      return flag(
        m.maxSilenceSec <= limit,
        `No silence longer than ${fmt(limit, "s")}`,
        `Contains ${fmt(m.maxSilenceSec, "s")} of silence (limit ${fmt(limit, "s")})`,
        "measured",
      );
    }
    case "exclude.incompleteSentences":
      return flag(
        m.completeThought,
        "No cut-off sentences",
        "Starts or ends mid-sentence",
        "measured",
      );
    case "exclude.tooShort": {
      const min = getNumericRuleValue(rules, "length.min") ?? 20;
      return flag(
        m.durationSec >= min,
        `At least ${min}s long`,
        `${fmt(m.durationSec, "s")} is shorter than ${min}s`,
        "measured",
      );
    }
    case "exclude.tooLong": {
      const max = getNumericRuleValue(rules, "length.max") ?? 60;
      return flag(
        m.durationSec <= max,
        `No longer than ${max}s`,
        `${fmt(m.durationSec, "s")} is longer than ${max}s`,
        "measured",
      );
    }
    case "exclude.duplicates": {
      const dup = m.semantic.duplicate;
      if (dup === undefined)
        return { supported: false, reason: "Checked by the detection pipeline after ranking." };
      return {
        supported: true,
        actual: !dup,
        reason: dup ? "Overlaps a stronger clip" : "Not a duplicate",
        method: "measured",
      };
    }
    default:
      return { supported: false, reason: "No evaluator exists for this rule type yet." };
  }
}

export function evaluateRule(
  rule: DetectionRule,
  metrics: RuleMetrics,
  rules: DetectionRule[],
): RuleEvaluation {
  const base = { ruleId: rule.id, ruleType: rule.type, label: rule.label, kind: getRuleKind(rule) };
  if (!isRuleActive(rule)) {
    return {
      ...base,
      enabled: false,
      supported: true,
      passed: true,
      reason: "Rule is turned off.",
    };
  }

  const numericMetric = NUMERIC_METRIC[rule.type];
  if (numericMetric) {
    if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) {
      return {
        ...base,
        enabled: true,
        supported: false,
        passed: null,
        reason: "Rule has no valid numeric threshold.",
      };
    }
    const actual = numericMetric.pick(metrics);
    const { passed, reason } = numeric(numericMetric.name, actual, rule);
    return {
      ...base,
      enabled: true,
      supported: true,
      passed,
      actual: round1(actual),
      expected: rule.value,
      method: "measured",
      reason,
    };
  }

  const c = check(rule.type, metrics, rules);
  if (!c.supported) {
    return {
      ...base,
      enabled: true,
      supported: false,
      passed: null,
      expected: rule.value,
      reason: c.reason,
    };
  }
  if (
    typeof c.actual !== "boolean" ||
    (rule.operator !== "isTrue" && rule.operator !== "isFalse")
  ) {
    return {
      ...base,
      enabled: true,
      supported: false,
      passed: null,
      reason: "Rule operator does not match its measured value.",
    };
  }
  const expected = rule.operator === "isTrue";
  return {
    ...base,
    enabled: true,
    supported: true,
    passed: c.actual === expected,
    actual: c.actual,
    expected,
    method: c.method,
    reason: c.reason,
  };
}

export function evaluateMetrics(rules: DetectionRule[], metrics: RuleMetrics): RuleEngineResult {
  const evaluations = rules.map((r) => evaluateRule(r, metrics, rules));
  return summarize(evaluations, metrics);
}

/**
 * Only hard-filter failures reject a candidate. Quality-signal "failures"
 * just mean the signal is absent; they lower the Rule Score instead.
 */
export function summarize(evaluations: RuleEvaluation[], metrics: RuleMetrics): RuleEngineResult {
  const enabled = evaluations.filter((e) => e.enabled);
  const supported = enabled.filter((e) => e.supported);
  const passed = supported.filter((e) => e.passed === true);
  const failed = supported.filter((e) => e.passed === false);
  const hard = supported.filter((e) => e.kind === "hard-filter");
  const hardFailed = hard.filter((e) => e.passed === false);
  const quality = supported.filter((e) => e.kind === "quality-signal");
  return {
    passed: hardFailed.length === 0,
    supportedRuleCount: supported.length,
    unsupportedRuleCount: enabled.length - supported.length,
    enabledRuleCount: enabled.length,
    passedRuleCount: passed.length,
    failedRuleCount: failed.length,
    hardFilterCount: hard.length,
    hardFilterFailedCount: hardFailed.length,
    qualitySignalCount: quality.length,
    qualitySignalMatchedCount: quality.filter((e) => e.passed === true).length,
    metrics,
    evaluations,
  };
}

/** Convenience entry point for a single arbitrary window. */
export function evaluateRules(rules: DetectionRule[], input: RuleEngineInput): RuleEngineResult {
  const start = Math.min(input.startSec, input.endSec);
  const end = Math.max(input.startSec, input.endSec);
  const overlapping = [...input.segments]
    .filter((s) => s.endSec > start && s.startSec < end)
    .sort((a, b) => a.startSec - b.startSec);
  const metrics = measureWindow(prepareSegments(overlapping), start, end, input.signals ?? {});
  return evaluateMetrics(rules, metrics);
}
