/**
 * Detection domain types.
 *
 * These describe the contract between the UI and a future processing backend
 * (audio extraction -> transcript -> rule engine / AI ranking -> clips).
 * Nothing here performs analysis; it only describes configuration and results.
 */

export type DetectionMode = "ai" | "rules" | "hybrid";

/** Adjustable importance weights used by the future AI ranker. */
export type AiFactorKey =
  | "hook"
  | "curiosity"
  | "emotion"
  | "story"
  | "information"
  | "quotability"
  | "humor"
  | "surprise"
  | "pacing";

export type AiDetectionFlag =
  | "strongHooks"
  | "questions"
  | "surprising"
  | "emotional"
  | "usefulInfo"
  | "storytelling"
  | "quotable"
  | "humor";

export interface AiSettings {
  minDurationSec: number;
  maxDurationSec: number;
  /** 0-100 importance per factor. */
  factors: Record<AiFactorKey, number>;
  detect: Record<AiDetectionFlag, boolean>;
}

/**
 * A single deterministic rule, stored as a configuration object so the rule
 * engine can evaluate rules generically instead of reading UI state.
 */
export type RuleGroup = "length" | "hook" | "content" | "audio" | "ending" | "exclusion";

export type RuleOperator = "isTrue" | "isFalse" | "min" | "max" | "equals";

/**
 * "hard-filter" rules may reject a clip; "quality-signal" rules only add to
 * the Rule Score. Older saved rules have no kind — use `getRuleKind()`.
 */
export type RuleKind = "hard-filter" | "quality-signal";

export interface DetectionRule {
  id: string;
  /** Stable machine key, e.g. "hook.containsQuestion". */
  type: string;
  group: RuleGroup;
  label: string;
  description?: string | undefined;
  operator: RuleOperator;
  value: boolean | number;
  unit?: string | undefined;
  enabled: boolean;
  kind?: RuleKind | undefined;
  /** Rules added by the user rather than shipped defaults. */
  custom?: boolean | undefined;
}

export interface RuleSettings {
  rules: DetectionRule[];
}

export interface DetectionProfile {
  id: string;
  name: string;
  description: string;
  mode: DetectionMode;
  ai: AiSettings;
  rules: RuleSettings;
  builtIn?: boolean | undefined;
}

/** Compact rule outcome stored on a clip for a future "Why this clip?" panel. */
export interface ClipRuleResult {
  ruleId: string;
  label: string;
  passed: boolean;
  reason: string;
}

export interface ClipMetricsSummary {
  durationSec: number;
  wordCount: number;
  speechDensityPct: number;
  fillerDensityPct: number;
  maxSilenceSec: number;
  wordsPerSecond: number;
}

/** Shape the engine returns. No values are invented in the UI. */
export interface ClipCandidate {
  id: string;
  index: number;
  projectId?: string | undefined;
  startSec: number;
  endSec: number;
  durationSec?: number | undefined;
  mode: DetectionMode;
  title: string;
  hook: string;
  reason: string;
  transcriptText?: string | undefined;
  segmentIds?: string[] | undefined;
  /** AI / hybrid only. Never call this "viral probability". */
  engagementPotential?: number | undefined;
  factorScores?: Partial<Record<AiFactorKey, number>> | undefined;
  /** Deterministic Rule Score (0-100) — a ranking signal, not a prediction. */
  score?: number | undefined;
  /** Rule mode only. Kept for older saved clips; equals the quality-signal counts. */
  rulesMatched?: number | undefined;
  rulesTotal?: number | undefined;
  qualityMatched?: number | undefined;
  qualityTotal?: number | undefined;
  hardFiltersChecked?: number | undefined;
  passedRules?: ClipRuleResult[] | undefined;
  failedRules?: ClipRuleResult[] | undefined;
  highlights?: string[] | undefined;
  metrics?: ClipMetricsSummary | undefined;
  status: "candidate" | "kept" | "rejected";
  thumbnailUrl?: string | undefined;
  createdAt?: string | undefined;
}

export type ProcessingStage =
  | "upload"
  | "storage"
  | "audio"
  | "transcription"
  | "detection"
  | "clipping"
  | "captions"
  | "reframing"
  | "render"
  | "export";

export type ProjectStatus = "draft" | "uploaded" | "queued" | "processing" | "ready" | "failed";
