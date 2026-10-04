/**
 * Dead-air detection for a clip range.
 *
 * Primary (safe): gaps between transcript word timestamps — never cuts mid-word.
 * Optional: Web Audio RMS calibration when the browser can decode the file.
 */

import type { TranscriptSegment } from "@/lib/detection/transcript";
import type { CleanupSettings } from "./cleanup-settings";
import type { RemovalRange } from "./edit-timeline";
import { wordsInClip } from "./filler-detect";

export interface SilenceDetectResult {
  removals: RemovalRange[];
  method: "transcript-gaps" | "audio+transcript" | "none";
  effectiveMinSilenceSec: number;
  warnings: string[];
}

export async function detectSilenceRemovals(
  file: File | undefined,
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  settings: CleanupSettings,
  signal?: AbortSignal,
): Promise<SilenceDetectResult> {
  const warnings: string[] = [];
  if (!settings.removeDeadAir) {
    return {
      removals: [],
      method: "none",
      effectiveMinSilenceSec: settings.minSilenceSec,
      warnings,
    };
  }

  const minSilence = settings.minSilenceSec;
  const keep = Math.min(settings.keepSilenceSec, minSilence * 0.5);
  const words = wordsInClip(segments, clipStart, clipEnd);

  const gapRemovals: RemovalRange[] = [];
  if (words.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < words.length; i++) {
      const g = words[i]!.startSec - words[i - 1]!.endSec;
      if (g > 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0.15;
    const sensitivity = settings.silenceThreshold;
    const calibrated = Math.max(
      minSilence,
      median * (1.8 - sensitivity) + minSilence * (1 - sensitivity * 0.3),
    );

    for (let i = 1; i < words.length; i++) {
      if (signal?.aborted) break;
      const prev = words[i - 1]!;
      const next = words[i]!;
      const gap = next.startSec - prev.endSec;
      if (gap < calibrated) continue;
      const removeStart = prev.endSec + keep;
      const removeEnd = next.startSec - keep;
      if (removeEnd - removeStart < 0.08) continue;
      gapRemovals.push({
        startSec: Math.max(clipStart, removeStart),
        endSec: Math.min(clipEnd, removeEnd),
        reason: "silence",
      });
    }

    const first = words[0]!;
    const last = words[words.length - 1]!;
    if (first.startSec - clipStart >= calibrated) {
      const removeEnd = first.startSec - keep;
      if (removeEnd - clipStart > 0.08) {
        gapRemovals.push({ startSec: clipStart, endSec: removeEnd, reason: "silence" });
      }
    }
    if (clipEnd - last.endSec >= calibrated) {
      const removeStart = last.endSec + keep;
      if (clipEnd - removeStart > 0.08) {
        gapRemovals.push({ startSec: removeStart, endSec: clipEnd, reason: "silence" });
      }
    }

    if (file && gapRemovals.length) {
      try {
        const noisy = await findNoisyGaps(file, gapRemovals, settings, signal);
        if (noisy) {
          const filtered = gapRemovals.filter((r) => !noisy.has(keyOf(r)));
          return {
            removals: filtered,
            method: "audio+transcript",
            effectiveMinSilenceSec: calibrated,
            warnings,
          };
        }
      } catch (e) {
        warnings.push("Audio level check skipped; using transcript gaps only.");
        console.warn("[silence]", e);
      }
    }

    return {
      removals: gapRemovals,
      method: "transcript-gaps",
      effectiveMinSilenceSec: calibrated,
      warnings,
    };
  }

  const segs = segments
    .filter((s) => s.endSec > clipStart && s.startSec < clipEnd)
    .sort((a, b) => a.startSec - b.startSec);

  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1]!;
    const next = segs[i]!;
    const gap = next.startSec - prev.endSec;
    if (gap < minSilence) continue;
    const removeStart = prev.endSec + keep;
    const removeEnd = next.startSec - keep;
    if (removeEnd - removeStart < 0.08) continue;
    gapRemovals.push({
      startSec: Math.max(clipStart, removeStart),
      endSec: Math.min(clipEnd, removeEnd),
      reason: "silence",
    });
  }

  if (!gapRemovals.length) {
    warnings.push("No word timings available for precise silence cuts.");
  }

  return {
    removals: gapRemovals,
    method: gapRemovals.length ? "transcript-gaps" : "none",
    effectiveMinSilenceSec: minSilence,
    warnings,
  };
}

function keyOf(r: RemovalRange): string {
  return `${r.startSec.toFixed(3)}-${r.endSec.toFixed(3)}`;
}

async function findNoisyGaps(
  file: File,
  removals: RemovalRange[],
  settings: CleanupSettings,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") {
    return null;
  }

  // Safety guard: avoid loading very large source videos into browser memory.
  const MAX_AUDIO_CHECK_BYTES = 150 * 1024 * 1024;
  if (file.size > MAX_AUDIO_CHECK_BYTES) {
    console.info("[silence] Skipping full-file audio confirmation for large source:", file.size);
    return null;
  }

  const Ctx = window.AudioContext || webkitAudioContext;
  const ctx = new Ctx();
  try {
    if (signal?.aborted) return null;
    const buf = await file.arrayBuffer();
    if (signal?.aborted) return null;
    let audio: AudioBuffer;
    try {
      audio = await ctx.decodeAudioData(buf.slice(0));
    } catch {
      return null;
    }
    const ch = audio.getChannelData(0);
    const sr = audio.sampleRate;

    let sum = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(ch.length / 4000));
    for (let i = 0; i < ch.length; i += step) {
      sum += Math.abs(ch[i]!);
      n++;
    }

    const mean = n ? sum / n : 0.02;
    const limit = mean * (0.35 + (1 - settings.silenceThreshold) * 0.5);
    const noisy = new Set<string>();

    for (const r of removals) {
      const a = Math.max(0, Math.floor(r.startSec * sr));
      const b = Math.min(ch.length, Math.floor(r.endSec * sr));
      if (b <= a) continue;

      let s = 0;
      let c = 0;
      const st = Math.max(1, Math.floor((b - a) / 200));
      for (let i = a; i < b; i += st) {
        s += Math.abs(ch[i]!);
        c++;
      }

      const avg = c ? s / c : 0;
      if (avg > limit) noisy.add(keyOf(r));
    }

    return noisy;
  } finally {
    void ctx.close();
  }
}

declare const webkitAudioContext: typeof AudioContext | undefined;
