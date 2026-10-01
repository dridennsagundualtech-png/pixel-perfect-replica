import { getNumericRuleValue } from "./rule-engine";
import type { PreparedSegment } from "./text-signals";
import type { DetectionRule } from "./types";

/**
 * Builds candidate windows from whole transcript segments. Windows never cut
 * a segment in half, prefer sentence boundaries, and are deterministic.
 * Cost is O(segments × segments-per-max-duration).
 */

export const DEFAULT_MAX_CANDIDATES = 250;
/** Used only when the matching length rule is disabled. */
export const FALLBACK_MIN_DURATION_SEC = 10;
export const FALLBACK_MAX_DURATION_SEC = 90;

export interface CandidateWindow {
  id: string;
  startIndex: number;
  endIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  segmentIds: string[];
  segments: PreparedSegment[];
  text: string;
  startsAtSentence: boolean;
  endsAtSentence: boolean;
}

export interface CandidateGeneratorOptions {
  minDurationSec: number;
  maxDurationSec: number;
  maxCandidates?: number | undefined;
  /** How many end points to keep per start segment. */
  endsPerStart?: number | undefined;
}

export interface CandidateGenerationResult {
  candidates: CandidateWindow[];
  /** Windows found before the maxCandidates cap. */
  totalFound: number;
  truncated: boolean;
  oversizedSegments: number;
}

/** Duration bounds come from the existing Rule Mode settings (single source of truth). */
export function getDurationBounds(rules: DetectionRule[]): {
  minDurationSec: number;
  maxDurationSec: number;
} {
  return {
    minDurationSec: getNumericRuleValue(rules, "length.min") ?? FALLBACK_MIN_DURATION_SEC,
    maxDurationSec: getNumericRuleValue(rules, "length.max") ?? FALLBACK_MAX_DURATION_SEC,
  };
}

function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  if (count <= 0) return [];
  if (count === 1) return items.slice(-1);
  const out: T[] = [];
  const step = (items.length - 1) / (count - 1);
  for (let k = 0; k < count; k += 1) {
    const item = items[Math.round(k * step)];
    if (item !== undefined && out[out.length - 1] !== item) out.push(item);
  }
  return out;
}

export function generateCandidates(
  segments: PreparedSegment[],
  options: CandidateGeneratorOptions,
): CandidateGenerationResult {
  const { minDurationSec, maxDurationSec } = options;
  const maxCandidates = Math.max(1, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const endsPerStart = Math.max(1, options.endsPerStart ?? 3);

  const anySentenceStarts = segments.some((s, i) => i > 0 && s.startsSentence);
  const all: CandidateWindow[] = [];
  let oversizedSegments = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const start = segments[i];
    if (!start) continue;
    if (start.endSec - start.startSec > maxDurationSec) oversizedSegments += 1;
    if (anySentenceStarts && !start.startsSentence) continue;

    const sentenceEnds: number[] = [];
    const anyEnds: number[] = [];
    for (let j = i; j < segments.length; j += 1) {
      const end = segments[j];
      if (!end) break;
      const duration = end.endSec - start.startSec;
      if (duration > maxDurationSec) break;
      if (duration < minDurationSec) continue;
      anyEnds.push(j);
      if (end.endsSentence) sentenceEnds.push(j);
    }

    const chosen = pickEvenly(sentenceEnds.length > 0 ? sentenceEnds : anyEnds, endsPerStart);
    for (const j of chosen) {
      const windowSegments = segments.slice(i, j + 1);
      const last = windowSegments[windowSegments.length - 1];
      if (!last) continue;
      all.push({
        id: `cand-${start.id}-${last.id}`,
        startIndex: i,
        endIndex: j,
        startSec: start.startSec,
        endSec: last.endSec,
        durationSec: last.endSec - start.startSec,
        segmentIds: windowSegments.map((s) => s.id),
        segments: windowSegments,
        text: windowSegments.map((s) => s.text).join(" "),
        startsAtSentence: start.startsSentence,
        endsAtSentence: last.endsSentence,
      });
    }
  }

  let candidates = all;
  if (all.length > maxCandidates) {
    const tier = (c: CandidateWindow) => (c.startsAtSentence ? 0 : 1) + (c.endsAtSentence ? 0 : 1);
    const tiers: CandidateWindow[][] = [[], [], []];
    for (const c of all) tiers[tier(c)]?.push(c);
    candidates = [];
    for (const t of tiers) {
      const room = maxCandidates - candidates.length;
      if (room <= 0) break;
      // Even sampling keeps coverage across the whole video timeline.
      candidates.push(...pickEvenly(t, room));
    }
    candidates.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  }

  return {
    candidates,
    totalFound: all.length,
    truncated: all.length > candidates.length,
    oversizedSegments,
  };
}
