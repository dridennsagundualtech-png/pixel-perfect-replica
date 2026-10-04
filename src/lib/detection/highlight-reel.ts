import type { ClipCandidate } from "./types";
import type { EditPlan } from "@/lib/video/edit-timeline";

export interface HighlightReelOptions {
  maxMoments: number;
  targetDurationSec: number;
  maxDurationSec: number;
}

export interface HighlightReel {
  moments: ClipCandidate[];
  plan: EditPlan;
}

/** Picks top non-overlapping detected clips (by existing rank order) and stitches them in source order. */
export function buildHighlightReel(
  clips: ClipCandidate[],
  opts: HighlightReelOptions,
): HighlightReel | null {
  const picked: ClipCandidate[] = [];
  let total = 0;
  for (const c of clips) {
    if (picked.length >= opts.maxMoments || total >= opts.targetDurationSec) break;
    const len = c.endSec - c.startSec;
    if (!(len > 0) || total + len > opts.maxDurationSec) continue;
    if (picked.some((p) => c.startSec < p.endSec && c.endSec > p.startSec)) continue;
    picked.push(c);
    total += len;
  }
  if (!picked.length) return null;
  picked.sort((a, b) => a.startSec - b.startSec);
  let out = 0;
  const segments = picked.map((c) => {
    const s = { sourceStartSec: c.startSec, sourceEndSec: c.endSec, outputStartSec: out };
    out += c.endSec - c.startSec;
    return s;
  });
  return {
    moments: picked,
    plan: {
      segments,
      outputDurationSec: out,
      isIdentity: segments.length === 1,
      removedSilenceSec: 0,
      removedFillerSec: 0,
      cutCount: segments.length - 1,
      warnings: [],
    },
  };
}
