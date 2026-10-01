import { HARD_FILTER_TYPES } from "./rule-engine";
import type {
  AiDetectionFlag,
  AiFactorKey,
  AiSettings,
  DetectionProfile,
  DetectionRule,
  RuleGroup,
} from "./types";

export const AI_FACTORS: { key: AiFactorKey; label: string; hint: string }[] = [
  { key: "hook", label: "Hook strength", hint: "How strongly the opening grabs attention" },
  { key: "curiosity", label: "Curiosity", hint: "Open loops that make people keep watching" },
  { key: "emotion", label: "Emotional intensity", hint: "Strength of feeling in the moment" },
  { key: "story", label: "Story completeness", hint: "Beginning, middle and payoff" },
  { key: "information", label: "Information density", hint: "Useful content per second" },
  { key: "quotability", label: "Quotability", hint: "Lines people repeat or screenshot" },
  { key: "humor", label: "Humor", hint: "Comedic timing and punchlines" },
  { key: "surprise", label: "Surprise", hint: "Unexpected turns or claims" },
  { key: "pacing", label: "Pacing", hint: "Momentum and lack of dead air" },
];

export const AI_DETECTION_FLAGS: { key: AiDetectionFlag; label: string }[] = [
  { key: "strongHooks", label: "Detect strong hooks" },
  { key: "questions", label: "Detect questions" },
  { key: "surprising", label: "Detect surprising statements" },
  { key: "emotional", label: "Detect emotional moments" },
  { key: "usefulInfo", label: "Detect useful information" },
  { key: "storytelling", label: "Detect storytelling" },
  { key: "quotable", label: "Detect quotable statements" },
  { key: "humor", label: "Detect humorous moments" },
];

export const RULE_GROUP_META: Record<RuleGroup, { label: string; description: string }> = {
  length: { label: "Clip length", description: "How long a clip is allowed to be" },
  hook: { label: "Opening", description: "What makes the first seconds grab attention" },
  content: { label: "Content", description: "What makes the middle of a clip worth watching" },
  audio: { label: "Audio", description: "Silence, filler words and speech density" },
  ending: { label: "Ending", description: "Where a clip stops" },
  exclusion: { label: "Exclusion rules", description: "What should be thrown away" },
};

export const RULE_GROUP_ORDER: RuleGroup[] = [
  "length",
  "hook",
  "content",
  "audio",
  "ending",
  "exclusion",
];

export function createDefaultAiSettings(): AiSettings {
  return {
    minDurationSec: 15,
    maxDurationSec: 60,
    factors: {
      hook: 85,
      curiosity: 70,
      emotion: 60,
      story: 65,
      information: 60,
      quotability: 55,
      humor: 40,
      surprise: 55,
      pacing: 70,
    },
    detect: {
      strongHooks: true,
      questions: true,
      surprising: true,
      emotional: true,
      usefulInfo: true,
      storytelling: true,
      quotable: false,
      humor: false,
    },
  };
}

function rule(
  type: string,
  group: RuleGroup,
  label: string,
  operator: DetectionRule["operator"],
  value: boolean | number,
  extra: Partial<DetectionRule> = {},
): DetectionRule {
  const kind = HARD_FILTER_TYPES.has(type) ? "hard-filter" : "quality-signal";
  return { id: type, type, group, label, operator, value, enabled: true, kind, ...extra };
}

/**
 * Current display labels by rule type. Older saved projects still carry the
 * old "Must contain…" labels, so the settings panel prefers these.
 */
export const RULE_LABELS: Record<string, string> = {
  "hook.containsQuestion": "Prefer questions",
  "hook.strongStatement": "Prefer strong statements",
  "hook.surprising": "Prefer surprising openings",
  "hook.directAddress": "Prefer direct address",
  "hook.sentenceStart": "Prefer starting at a sentence",
  "content.completeThought": "Prefer complete thoughts",
  "content.payoff": "Prefer payoffs",
  "content.educational": "Prefer educational content",
  "content.funny": "Prefer funny moments",
  "content.emotional": "Prefer emotional moments",
  "content.storytelling": "Prefer storytelling",
  "content.informationDense": "Prefer information-dense moments",
  "ending.conclusion": "Prefer ending on a conclusion",
  "ending.payoff": "Prefer ending on the payoff",
  "ending.emotional": "Prefer an emotional ending",
  "ending.completeSentence": "End on a complete sentence",
};

export const ruleLabel = (r: DetectionRule): string =>
  r.custom ? r.label : (RULE_LABELS[r.type] ?? r.label);

/**
 * Defaults are tuned for podcasts, interviews, tutorials and talking-head
 * videos: a few sensible hard filters, and quality signals that only rank.
 */
export function createDefaultRules(): DetectionRule[] {
  const q = (type: string, group: RuleGroup, on: boolean) =>
    rule(type, group, RULE_LABELS[type] ?? type, "isTrue", on);
  return [
    rule("length.min", "length", "Minimum duration", "min", 20, { unit: "s" }),
    rule("length.max", "length", "Maximum duration", "max", 60, { unit: "s" }),

    q("hook.containsQuestion", "hook", true),
    q("hook.strongStatement", "hook", true),
    q("hook.surprising", "hook", true),
    q("hook.directAddress", "hook", true),
    q("hook.sentenceStart", "hook", true),

    q("content.completeThought", "content", true),
    q("content.payoff", "content", true),
    q("content.educational", "content", true),
    q("content.funny", "content", false),
    q("content.emotional", "content", true),
    q("content.storytelling", "content", true),
    q("content.informationDense", "content", true),

    rule("audio.maxSilence", "audio", "Maximum silence", "max", 2, { unit: "s" }),
    rule("audio.maxFillerDensity", "audio", "Maximum filler density", "max", 8, { unit: "%" }),
    rule("audio.minSpeechDensity", "audio", "Minimum speech density", "min", 70, { unit: "%" }),

    rule("ending.completeSentence", "ending", "End on a complete sentence", "isTrue", true),
    q("ending.conclusion", "ending", true),
    q("ending.payoff", "ending", false),
    q("ending.emotional", "ending", false),

    rule("exclude.excessiveSilence", "exclusion", "Exclude excessive silence", "isTrue", true),
    rule(
      "exclude.incompleteSentences",
      "exclusion",
      "Exclude incomplete sentences",
      "isTrue",
      true,
    ),
    rule("exclude.duplicates", "exclusion", "Exclude duplicate / similar clips", "isTrue", true),
    rule("exclude.tooShort", "exclusion", "Exclude clips shorter than minimum", "isTrue", true),
    rule("exclude.tooLong", "exclusion", "Exclude clips longer than maximum", "isTrue", true),
  ];
}

export function createDefaultProfile(overrides: Partial<DetectionProfile> = {}): DetectionProfile {
  return {
    id: "balanced",
    name: "Balanced",
    description: "Sensible starting point for talking-head videos.",
    mode: "ai",
    ai: createDefaultAiSettings(),
    rules: { rules: createDefaultRules() },
    ...overrides,
  };
}

/** Built-in starting points shown on the Templates page. */
export const BUILT_IN_PROFILES: DetectionProfile[] = [
  createDefaultProfile({ builtIn: true }),
  createDefaultProfile({
    id: "podcast-highlights",
    name: "Podcast highlights",
    description: "Longer clips that keep a full thought and its payoff intact.",
    mode: "hybrid",
    builtIn: true,
  }),
  createDefaultProfile({
    id: "tight-hooks",
    name: "Tight hooks",
    description: "Short, fast clips that must open with a question or bold claim.",
    mode: "ai",
    builtIn: true,
  }),
  createDefaultProfile({
    id: "rules-only",
    name: "Rules only",
    description: "Deterministic detection with no AI involved at any step.",
    mode: "rules",
    builtIn: true,
  }),
];

export const MODE_META: Record<
  "ai" | "rules" | "hybrid",
  { label: string; icon: string; description: string; experimental?: boolean }
> = {
  ai: {
    label: "AI",
    icon: "🤖",
    description: "Let AI identify and rank potentially engaging moments.",
  },
  rules: {
    label: "Rules",
    icon: "⚙️",
    description: "Find clips using rules that you define.",
  },
  hybrid: {
    label: "Hybrid",
    icon: "🧠",
    description: "Use rules to filter candidates, then let AI rank the remaining clips.",
    experimental: true,
  },
};

/** Documented future pipeline — used for status/placeholder UI only. */
export const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "storage", label: "Storage" },
  { key: "audio", label: "Extract audio" },
  { key: "transcription", label: "Transcription" },
  { key: "detection", label: "Detection" },
  { key: "clipping", label: "Clip generation" },
  { key: "captions", label: "Captions" },
  { key: "reframing", label: "9:16 reframing" },
  { key: "render", label: "Rendering" },
  { key: "export", label: "Export" },
];

/**
 * Plain-language help per built-in rule type: what it checks and what happens
 * when a clip fails it. Looked up by type so older saved projects get it too.
 */
export const RULE_HELP: Record<string, { checks: string; onFail: string }> = {
  "length.min": { checks: "Shortest clip allowed.", onFail: "Shorter windows are not suggested." },
  "length.max": { checks: "Longest clip allowed.", onFail: "Longer windows are not suggested." },
  "hook.containsQuestion": {
    checks: "A question in the first 5 seconds (based on wording and '?').",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "hook.strongStatement": {
    checks: 'A bold opener like "the truth is" or "you need to" in the first 5 seconds.',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "hook.surprising": {
    checks: 'Surprise wording like "turns out" or "nobody talks about" in the first 5 seconds.',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "hook.directAddress": {
    checks: 'The speaker says "you" in the first 5 seconds.',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "hook.sentenceStart": {
    checks: "The clip starts where a sentence starts.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.completeThought": {
    checks: "Starts at a sentence and ends on a finished sentence.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.payoff": {
    checks: 'Payoff wording like "that\'s why" or "the lesson is".',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.educational": {
    checks: 'Teaching cues like "how to", "for example" or numbers.',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.funny": {
    checks: "Laughter or joke cues in the transcript.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.emotional": {
    checks: "Emotional words or exclamations.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.storytelling": {
    checks: 'Story cues like "I remember" or "one day".',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "content.informationDense": {
    checks: "Fast, varied speech with few filler words.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "audio.maxSilence": {
    checks: "Longest pause between spoken lines.",
    onFail: "Clips with longer pauses are rejected.",
  },
  "audio.maxFillerDensity": {
    checks: 'Share of words like "um", "uh", "you know".',
    onFail: "Clips above the limit are rejected.",
  },
  "audio.minSpeechDensity": {
    checks: "Share of the clip where someone is talking.",
    onFail: "Clips below the minimum are rejected.",
  },
  "ending.completeSentence": {
    checks: "The last line ends with . ! or ?",
    onFail: "Clips that stop mid-sentence are removed.",
  },
  "ending.conclusion": {
    checks: 'The last line wraps up ("so", "in the end", "that\'s why").',
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "ending.payoff": {
    checks: "The last line contains the payoff.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "ending.emotional": {
    checks: "The last line is emotional.",
    onFail: "Raises the Rule Score when found; never removes a clip.",
  },
  "exclude.excessiveSilence": {
    checks: "Uses your maximum silence setting.",
    onFail: "The clip is thrown away.",
  },
  "exclude.incompleteSentences": {
    checks: "Starts or ends mid-sentence.",
    onFail: "The clip is thrown away.",
  },
  "exclude.duplicates": {
    checks: "Overlaps more than half of a higher-ranked clip.",
    onFail: "Only the stronger clip is kept.",
  },
  "exclude.tooShort": { checks: "Uses your minimum duration.", onFail: "The clip is thrown away." },
  "exclude.tooLong": { checks: "Uses your maximum duration.", onFail: "The clip is thrown away." },
};
