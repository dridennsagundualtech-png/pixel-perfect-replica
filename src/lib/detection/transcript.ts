/**
 * Transcript contract. A future transcription provider only has to produce a
 * `TranscriptionResult`; everything downstream (candidates, rules, scoring)
 * already consumes this shape.
 */

/** A single word with timing taken directly from Whisper (never estimated). */
export interface TranscriptWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  /** Genuine Whisper word timings; absent on old transcripts or when unavailable. */
  words?: TranscriptWord[] | undefined;
  speaker?: string | undefined;
}

/** Tolerance (s) for a word slightly overhanging its parent segment. */
const WORD_EDGE_TOLERANCE_SEC = 0.1;

/** Keeps only well-formed words that sit inside their parent segment. */
export function validateWords(
  input: unknown,
  seg: { startSec: number; endSec: number },
): TranscriptWord[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: TranscriptWord[] = [];
  for (const raw of input as unknown[]) {
    const w = raw as Partial<TranscriptWord> | null;
    if (!w || typeof w !== "object") continue;
    const { startSec, endSec } = w;
    const text = typeof w.text === "string" ? w.text.trim() : "";
    if (!text || typeof startSec !== "number" || typeof endSec !== "number") continue;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    if (startSec < 0 || endSec <= startSec) continue;
    if (startSec < seg.startSec - WORD_EDGE_TOLERANCE_SEC) continue;
    if (endSec > seg.endSec + WORD_EDGE_TOLERANCE_SEC) continue;
    out.push({ text, startSec, endSec });
  }
  out.sort((a, b) => a.startSec - b.startSec);
  return out.length ? out : undefined;
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  language?: string | undefined;
  durationSec?: number | undefined;
  /** Where the transcript came from, e.g. "provider:whisper" or "dev-sample". */
  source?: string | undefined;
}

export interface TranscriptValidation {
  segments: TranscriptSegment[];
  skipped: number;
  warnings: string[];
}

/**
 * Drops malformed segments instead of failing the whole run, and returns
 * segments sorted by start time with guaranteed ids.
 */
export function validateTranscript(input: unknown): TranscriptValidation {
  const warnings: string[] = [];
  if (!Array.isArray(input)) {
    return {
      segments: [],
      skipped: 0,
      warnings: ["Transcript is missing or not a list of segments."],
    };
  }

  const valid: TranscriptSegment[] = [];
  let skipped = 0;

  input.forEach((raw: unknown, index) => {
    const seg = raw as Partial<TranscriptSegment> | null;
    const label = `Segment ${index + 1}`;
    if (!seg || typeof seg !== "object") {
      skipped += 1;
      warnings.push(`${label} is not an object and was skipped.`);
      return;
    }
    const { startSec, endSec, text } = seg;
    if (
      typeof startSec !== "number" ||
      typeof endSec !== "number" ||
      !Number.isFinite(startSec) ||
      !Number.isFinite(endSec)
    ) {
      skipped += 1;
      warnings.push(`${label} has invalid timestamps and was skipped.`);
      return;
    }
    if (startSec < 0) {
      skipped += 1;
      warnings.push(`${label} starts before 0s and was skipped.`);
      return;
    }
    if (endSec <= startSec) {
      skipped += 1;
      warnings.push(`${label} ends before it starts and was skipped.`);
      return;
    }
    const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    if (!clean) {
      skipped += 1;
      warnings.push(`${label} has no text and was skipped.`);
      return;
    }
    const next: TranscriptSegment = {
      id: typeof seg.id === "string" && seg.id ? seg.id : `segment-${index + 1}`,
      startSec,
      endSec,
      text: clean,
      speaker: typeof seg.speaker === "string" ? seg.speaker : undefined,
    };
    if (seg.words !== undefined) next.words = seg.words;
    valid.push(next);
  });

  valid.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  // Overlapping segments are kept but trimmed so silence/speech math stays sane.
  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1];
    const cur = valid[i];
    if (prev && cur && cur.startSec < prev.endSec) {
      prev.endSec = Math.max(prev.startSec + 0.01, cur.startSec);
    }
  }

  // Word timing is optional metadata: malformed words are dropped, never fatal.
  for (const s of valid) {
    if (s.words === undefined) continue;
    const words = validateWords(s.words, s);
    if (words) s.words = words;
    else delete s.words;
  }

  if (skipped > 0 && warnings.length > 20) {
    const extra = warnings.length - 20;
    warnings.splice(20, extra, `…and ${extra} more skipped segments.`);
  }

  return { segments: valid, skipped, warnings };
}
