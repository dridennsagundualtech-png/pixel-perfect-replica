/**
 * Edit timeline for dead-air / filler removal.
 * Pure math — no browser APIs.
 */

export interface EditSegment {
  /** Absolute time in the source video. */
  sourceStartSec: number;
  sourceEndSec: number;
  /** Time in the output (concatenated) timeline. */
  outputStartSec: number;
}

export interface EditPlan {
  segments: EditSegment[];
  /** Total output duration after cuts. */
  outputDurationSec: number;
  /** True when the plan is a single continuous keep of the original range. */
  isIdentity: boolean;
  removedSilenceSec: number;
  removedFillerSec: number;
  cutCount: number;
  warnings: string[];
}

export interface RemovalRange {
  startSec: number;
  endSec: number;
  reason: "silence" | "filler";
}

/** Map a source-absolute time into output time (or null if inside a removed gap). */
export function sourceToOutput(plan: EditPlan, sourceSec: number): number | null {
  for (const s of plan.segments) {
    if (sourceSec >= s.sourceStartSec && sourceSec <= s.sourceEndSec) {
      return s.outputStartSec + (sourceSec - s.sourceStartSec);
    }
  }
  // Snap to nearest kept edge if just outside (word edges after soft cuts).
  let best: { d: number; t: number } | null = null;
  for (const s of plan.segments) {
    const d0 = Math.abs(sourceSec - s.sourceStartSec);
    const d1 = Math.abs(sourceSec - s.sourceEndSec);
    if (!best || d0 < best.d) best = { d: d0, t: s.outputStartSec };
    if (!best || d1 < best.d)
      best = { d: d1, t: s.outputStartSec + (s.sourceEndSec - s.sourceStartSec) };
  }
  return best && best.d < 0.15 ? best.t : null;
}

/** Map a closed interval; clamps to retained parts (may shrink). */
export function mapInterval(
  plan: EditPlan,
  startSec: number,
  endSec: number,
): { startSec: number; endSec: number } | null {
  if (!(endSec > startSec)) return null;
  let outStart: number | null = null;
  let outEnd: number | null = null;
  for (const s of plan.segments) {
    const a = Math.max(startSec, s.sourceStartSec);
    const b = Math.min(endSec, s.sourceEndSec);
    if (b > a) {
      const os = s.outputStartSec + (a - s.sourceStartSec);
      const oe = s.outputStartSec + (b - s.sourceStartSec);
      if (outStart === null) outStart = os;
      outEnd = oe;
    }
  }
  if (outStart === null || outEnd === null || !(outEnd > outStart)) return null;
  return { startSec: outStart, endSec: outEnd };
}

/**
 * Invert removal ranges inside [clipStart, clipEnd] into keep segments,
 * then assign contiguous outputStartSec values.
 */
export function buildEditPlan(
  clipStart: number,
  clipEnd: number,
  removals: RemovalRange[],
  opts?: { minKeepSec?: number; minOutputSec?: number },
): EditPlan {
  const minKeep = opts?.minKeepSec ?? 0.12;
  const minOutput = opts?.minOutputSec ?? 0.5;
  const warnings: string[] = [];
  const duration = clipEnd - clipStart;
  if (!(duration > 0)) {
    return {
      segments: [],
      outputDurationSec: 0,
      isIdentity: true,
      removedSilenceSec: 0,
      removedFillerSec: 0,
      cutCount: 0,
      warnings: ["Invalid clip range."],
    };
  }

  // Merge overlapping removals, clamp to clip.
  const merged = mergeRanges(
    removals
      .map((r) => ({
        startSec: Math.max(clipStart, r.startSec),
        endSec: Math.min(clipEnd, r.endSec),
        reason: r.reason,
      }))
      .filter((r) => r.endSec - r.startSec > 0.02),
  );

  let removedSilenceSec = 0;
  let removedFillerSec = 0;
  for (const r of merged) {
    const d = r.endSec - r.startSec;
    if (r.reason === "silence") removedSilenceSec += d;
    else removedFillerSec += d;
  }

  // Keep = gaps between removals.
  const keeps: { start: number; end: number }[] = [];
  let cursor = clipStart;
  for (const r of merged) {
    if (r.startSec > cursor + 0.01) keeps.push({ start: cursor, end: r.startSec });
    cursor = Math.max(cursor, r.endSec);
  }
  if (clipEnd > cursor + 0.01) keeps.push({ start: cursor, end: clipEnd });

  const filtered = keeps.filter((k) => k.end - k.start >= minKeep);
  if (!filtered.length) {
    warnings.push("Cleanup would remove the whole clip; keeping original.");
    return identityPlan(clipStart, clipEnd, warnings);
  }

  let output = 0;
  const segments: EditSegment[] = filtered.map((k) => {
    const seg: EditSegment = {
      sourceStartSec: round3(k.start),
      sourceEndSec: round3(k.end),
      outputStartSec: round3(output),
    };
    output += k.end - k.start;
    return seg;
  });
  output = round3(output);

  if (output < minOutput) {
    warnings.push("Cleanup left a clip that was too short; keeping original.");
    return identityPlan(clipStart, clipEnd, warnings);
  }

  const isIdentity =
    segments.length === 1 &&
    Math.abs(segments[0]!.sourceStartSec - clipStart) < 0.02 &&
    Math.abs(segments[0]!.sourceEndSec - clipEnd) < 0.02;

  return {
    segments,
    outputDurationSec: output,
    isIdentity,
    removedSilenceSec: round3(removedSilenceSec),
    removedFillerSec: round3(removedFillerSec),
    cutCount: Math.max(0, segments.length - 1),
    warnings,
  };
}

function identityPlan(clipStart: number, clipEnd: number, warnings: string[]): EditPlan {
  const dur = round3(clipEnd - clipStart);
  return {
    segments: [
      {
        sourceStartSec: round3(clipStart),
        sourceEndSec: round3(clipEnd),
        outputStartSec: 0,
      },
    ],
    outputDurationSec: dur,
    isIdentity: true,
    removedSilenceSec: 0,
    removedFillerSec: 0,
    cutCount: 0,
    warnings,
  };
}

function mergeRanges(ranges: RemovalRange[]): RemovalRange[] {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const out: RemovalRange[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.startSec <= cur.endSec + 0.02) {
      cur.endSec = Math.max(cur.endSec, n.endSec);
      if (cur.reason !== n.reason) cur.reason = cur.reason === "silence" ? "silence" : n.reason;
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Rebase word timestamps from source-absolute into output-relative (clip starts at 0). */
export function rebaseWords(
  plan: EditPlan,
  words: { text: string; startSec: number; endSec: number }[],
): { text: string; startSec: number; endSec: number }[] {
  const out: { text: string; startSec: number; endSec: number }[] = [];
  for (const w of words) {
    const mapped = mapInterval(plan, w.startSec, w.endSec);
    if (!mapped) continue;
    out.push({
      text: w.text,
      startSec: mapped.startSec,
      endSec: mapped.endSec,
    });
  }
  return out;
}
