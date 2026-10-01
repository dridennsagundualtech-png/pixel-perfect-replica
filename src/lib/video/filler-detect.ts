/**
 * Filler-word detection from transcript words (local, pure).
 * Conservative: only removes clear standalone fillers, not ordinary "like" / "you know".
 */

import type { TranscriptSegment, TranscriptWord } from "@/lib/detection/transcript";
import type { RemovalRange } from "./edit-timeline";

const PUNCT = /^[^\p{L}\p{N}]+$/u;

function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

/** Collect words in [clipStart, clipEnd] with absolute timestamps. */
export function wordsInClip(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const seg of segments) {
    if (!(seg.endSec > clipStart && seg.startSec < clipEnd)) continue;
    const words = Array.isArray(seg.words) ? seg.words : [];
    for (const w of words) {
      if (
        typeof w.text !== "string" ||
        !Number.isFinite(w.startSec) ||
        !Number.isFinite(w.endSec) ||
        !(w.endSec > w.startSec)
      )
        continue;
      if (w.endSec <= clipStart || w.startSec >= clipEnd) continue;
      out.push({
        text: w.text,
        startSec: w.startSec,
        endSec: w.endSec,
      });
    }
  }
  out.sort((a, b) => a.startSec - b.startSec);
  return out;
}

/**
 * Decide whether a token at index i is a removable filler.
 * Multi-word fillers (e.g. "you know") are matched as sequences.
 */
export function isRemovableFiller(
  words: TranscriptWord[],
  index: number,
  fillerList: string[],
): { match: boolean; endIndex: number } {
  const fillers = fillerList.map((f) => f.toLowerCase().trim()).filter(Boolean);
  const multi = fillers.filter((f) => f.includes(" ")).sort((a, b) => b.length - a.length);
  const single = new Set(fillers.filter((f) => !f.includes(" ")));

  // Multi-word first.
  for (const phrase of multi) {
    const parts = phrase.split(/\s+/);
    if (index + parts.length > words.length) continue;
    let ok = true;
    for (let k = 0; k < parts.length; k++) {
      if (normalizeToken(words[index + k]!.text) !== parts[k]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (hasStrongContext(words, index, index + parts.length - 1)) continue;
    return { match: true, endIndex: index + parts.length - 1 };
  }

  const tok = normalizeToken(words[index]!.text);
  if (!tok || !single.has(tok)) return { match: false, endIndex: index };

  // "like" / "ah" need weak context (hesitation), not content use.
  if (tok === "like" || tok === "so") {
    if (!looksLikeHesitation(words, index)) return { match: false, endIndex: index };
  }

  if (hasStrongContext(words, index, index)) return { match: false, endIndex: index };
  return { match: true, endIndex: index };
}

/** Surrounding content words → treat as real speech, not filler. */
function hasStrongContext(words: TranscriptWord[], from: number, to: number): boolean {
  const prev = words[from - 1];
  const next = words[to + 1];
  // If previous token ends a sentence and next starts a sentence, filler in between is OK to drop.
  // If "like" is between two content words tightly, often real: "I like this"
  if (prev && next) {
    const pt = normalizeToken(prev.text);
    const nt = normalizeToken(next.text);
    const gapBefore = words[from]!.startSec - prev.endSec;
    const gapAfter = next.startSec - words[to]!.endSec;
    // Tight sandwich with content on both sides and short gaps → likely real word.
    if (gapBefore < 0.2 && gapAfter < 0.2 && pt.length > 2 && nt.length > 2) {
      const cur = normalizeToken(words[from]!.text);
      if (cur === "like") return true; // "I like this"
    }
  }
  return false;
}

function looksLikeHesitation(words: TranscriptWord[], index: number): boolean {
  const w = words[index]!;
  const prev = words[index - 1];
  const next = words[index + 1];
  const pauseBefore = prev ? w.startSec - prev.endSec : 0.5;
  const pauseAfter = next ? next.startSec - w.endSec : 0.5;
  // Isolated with pauses, or very short duration.
  const dur = w.endSec - w.startSec;
  return pauseBefore >= 0.18 || pauseAfter >= 0.18 || dur < 0.28;
}

export function detectFillerRemovals(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  fillerList: string[],
): { removals: RemovalRange[]; count: number } {
  const words = wordsInClip(segments, clipStart, clipEnd);
  const removals: RemovalRange[] = [];
  let count = 0;
  let i = 0;
  while (i < words.length) {
    const { match, endIndex } = isRemovableFiller(words, i, fillerList);
    if (match) {
      const a = words[i]!;
      const b = words[endIndex]!;
      // Pad slightly into adjacent micro-gaps, stay inside clip.
      const start = Math.max(clipStart, a.startSec - 0.02);
      const end = Math.min(clipEnd, b.endSec + 0.02);
      if (end > start) {
        removals.push({ startSec: start, endSec: end, reason: "filler" });
        count += 1;
      }
      i = endIndex + 1;
      continue;
    }
    i += 1;
  }
  return { removals, count };
}

export function countFillerPreview(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  fillerList: string[],
): number {
  return detectFillerRemovals(segments, clipStart, clipEnd, fillerList).count;
}

/** @internal exported for tests */
export function _normalizeToken(text: string): string {
  return normalizeToken(text);
}

export function _isPunct(text: string): boolean {
  return PUNCT.test(text);
}
