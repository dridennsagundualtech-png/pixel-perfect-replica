/**
 * Smart 9:16 reframe track: subject horizontal position over time.
 * Pure math — no browser APIs — so it can be unit-tested offline.
 */

export interface SubjectPoint {
  timeSec: number;
  x: number;
  confidence: number;
}

export interface ReframeTrack {
  points: SubjectPoint[];
  source: "face" | "person" | "center";
}

export const CENTER_X = 0.5;

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return CENTER_X;
  return Math.min(1, Math.max(0, v));
}

export function sampleTrackX(track: ReframeTrack, t: number): number {
  const pts = track.points;
  if (!pts.length) return CENTER_X;
  if (pts.length === 1) return clamp01(pts[0]!.x);
  if (t <= pts[0]!.timeSec) return clamp01(pts[0]!.x);
  const last = pts[pts.length - 1]!;
  if (t >= last.timeSec) return clamp01(last.x);

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (t >= a.timeSec && t <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      if (span <= 1e-6) return clamp01(b.x);
      const u = (t - a.timeSec) / span;
      return clamp01(a.x + (b.x - a.x) * u);
    }
  }
  return clamp01(last.x);
}

export function smoothSubjectPoints(
  raw: SubjectPoint[],
  durationSec: number,
  opts?: {
    follow?: number;
    holdSec?: number;
    centerDriftSec?: number;
    minConfidence?: number;
  },
): SubjectPoint[] {
  const follow = opts?.follow ?? 0.35;
  const holdSec = opts?.holdSec ?? 0.6;
  const centerDriftSec = opts?.centerDriftSec ?? 1.2;
  const minConfidence = opts?.minConfidence ?? 0.35;

  if (!raw.length || durationSec <= 0) {
    return [{ timeSec: 0, x: CENTER_X, confidence: 0 }];
  }

  const sorted = [...raw].sort((a, b) => a.timeSec - b.timeSec);
  const out: SubjectPoint[] = [];
  let x = clamp01(sorted[0]!.x);
  let lastGoodT = sorted[0]!.timeSec;
  let lastGoodX = x;

  for (const p of sorted) {
    const conf = Number.isFinite(p.confidence) ? p.confidence : 0;
    if (conf >= minConfidence) {
      x = clamp01(x + (p.x - x) * follow);
      lastGoodT = p.timeSec;
      lastGoodX = x;
      out.push({ timeSec: p.timeSec, x, confidence: conf });
      continue;
    }

    const lostFor = p.timeSec - lastGoodT;
    if (lostFor <= holdSec) {
      x = lastGoodX;
      out.push({ timeSec: p.timeSec, x, confidence: conf });
    } else {
      const driftT = lostFor - holdSec;
      const u = Math.min(1, driftT / Math.max(1e-6, centerDriftSec));
      x = clamp01(lastGoodX + (CENTER_X - lastGoodX) * u);
      out.push({ timeSec: p.timeSec, x, confidence: conf });
    }
  }

  if (out[0]!.timeSec > 0.001) {
    out.unshift({ timeSec: 0, x: out[0]!.x, confidence: out[0]!.confidence });
  }
  const end = out[out.length - 1]!;
  if (end.timeSec < durationSec - 0.001) {
    out.push({ timeSec: durationSec, x: end.x, confidence: end.confidence });
  }

  return out;
}

export function buildCropXExpression(track: ReframeTrack): string {
  const pts = track.points;
  if (!pts.length || track.source === "center") {
    return "(iw-ow)/2";
  }

  const subjectExpr = buildPiecewiseX(pts);
  return `min(max(0\\,(${subjectExpr})*iw-ow/2)\\,iw-ow)`;
}

function buildPiecewiseX(pts: SubjectPoint[]): string {
  if (pts.length === 1) return formatNum(clamp01(pts[0]!.x));

  let expr = formatNum(clamp01(pts[pts.length - 1]!.x));
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const t0 = formatNum(a.timeSec);
    const t1 = formatNum(b.timeSec);
    const x0 = formatNum(clamp01(a.x));
    const x1 = formatNum(clamp01(b.x));
    const span = b.timeSec - a.timeSec;
    const lerp = span <= 1e-6 ? x1 : `${x0}+(${x1}-${x0})*(t-${t0})/${formatNum(span)}`;
    expr = `if(lt(t\\,${t1})\\,${i === 0 ? `if(lt(t\\,${t0})\\,${x0}\\,${lerp})` : lerp}\\,${expr})`;
  }
  return expr;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0.5";
  return (Math.round(n * 1e6) / 1e6).toString();
}

export function isSmartReframe(track: ReframeTrack | undefined | null): boolean {
  return !!track && track.source !== "center" && track.points.length > 0;
}

export const CUT_TRANSITION_SEC = 0.4;
const CUT_JUMP_EPS = 0.04;

export function rebaseReframeTrack(
  track: ReframeTrack | undefined | null,
  plan: { segments: { sourceStartSec: number; sourceEndSec: number; outputStartSec: number }[] },
  clipStartSec: number,
): ReframeTrack | undefined {
  if (!track) return undefined;
  if (!isSmartReframe(track) || !plan.segments.length) return track;
  const valid = track.points.filter((p) => Number.isFinite(p.timeSec) && Number.isFinite(p.x));
  if (!valid.length)
    return { source: "center", points: [{ timeSec: 0, x: CENTER_X, confidence: 0 }] };

  const src: ReframeTrack = {
    source: track.source,
    points: [...valid].sort((a, b) => a.timeSec - b.timeSec),
  };

  const out: SubjectPoint[] = [];
  const push = (p: SubjectPoint) => {
    const last = out[out.length - 1];
    if (last && p.timeSec <= last.timeSec + 1e-6) {
      if (Math.abs(p.timeSec - last.timeSec) <= 1e-6) out[out.length - 1] = p;
      return;
    }
    out.push(p);
  };

  plan.segments.forEach((seg, i) => {
    const relA = seg.sourceStartSec - clipStartSec;
    const relB = seg.sourceEndSec - clipStartSec;
    const len = relB - relA;
    if (!(len > 0)) return;
    const o0 = seg.outputStartSec;
    const toOut = (rel: number) => formatRound(o0 + (rel - relA));
    const startX = sampleTrackX(src, relA);
    const prev = out[out.length - 1];

    if (i > 0 && prev && Math.abs(prev.x - startX) > CUT_JUMP_EPS) {
      // Hold the previous framing at the cut, then move toward the new
      // segment's first retained tracking position on the OUTPUT timeline.
      // Do not interpolate through the removed source interval.
      const ease = Math.min(CUT_TRANSITION_SEC, len / 2);
      const easeEnd = toOut(relA + ease);

      push({
        timeSec: toOut(relA),
        x: prev.x,
        confidence: prev.confidence,
      });
      push({
        timeSec: easeEnd,
        x: startX,
        confidence: 0,
      });
    } else {
      push({ timeSec: toOut(relA), x: startX, confidence: 0 });
    }

    for (const p of src.points) {
      if (p.timeSec > relA && p.timeSec < relB) {
        push({ ...p, timeSec: toOut(p.timeSec) });
      }
    }
    push({ timeSec: toOut(relB), x: sampleTrackX(src, relB), confidence: 0 });
  });

  if (!out.length)
    return { source: "center", points: [{ timeSec: 0, x: CENTER_X, confidence: 0 }] };
  if (out[0]!.timeSec > 0.001) out.unshift({ ...out[0]!, timeSec: 0 });
  return { source: track.source, points: out };
}

function formatRound(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
