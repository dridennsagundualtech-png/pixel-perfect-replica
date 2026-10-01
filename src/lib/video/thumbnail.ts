/**
 * Local 9:16 clip thumbnails (Phase 7).
 * Reuses Phase 3 subject tracking when available — no second detector stack.
 * Async, non-blocking; stores data URLs suitable for localStorage.
 */

import { SHORT_HEIGHT, SHORT_WIDTH } from "./short-captions";
import type { ReframeTrack } from "./reframe-track";
import { sampleTrackX } from "./reframe-track";

export interface ThumbnailOptions {
  startSec: number;
  endSec: number;
  /** Prefer these absolute times (e.g. start+0.3, mid). */
  candidateOffsetsSec?: number[];
  signal?: AbortSignal;
  /** Optional precomputed reframe track (clip-relative times). */
  reframe?: ReframeTrack;
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    const target = Math.min(
      Math.max(0, timeSec),
      Number.isFinite(video.duration) ? video.duration : timeSec,
    );
    if (Math.abs(video.currentTime - target) < 0.04) {
      video.removeEventListener("seeked", done);
      resolve();
      return;
    }
    video.currentTime = target;
    setTimeout(() => {
      video.removeEventListener("seeked", done);
      resolve();
    }, 1200);
  });
}

/** Draw a 9:16 center-or-smart crop of the current video frame. */
function draw916(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  subjectX: number,
): void {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const outW = SHORT_WIDTH;
  const outH = SHORT_HEIGHT;
  // Scale to cover 9:16
  const scale = Math.max(outW / vw, outH / vh);
  const sw = outW / scale;
  const sh = outH / scale;
  const cx = Math.min(Math.max(subjectX * vw, sw / 2), vw - sw / 2);
  const sx = cx - sw / 2;
  const sy = (vh - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
}

/** Score a frame: prefer non-black, moderate brightness. */
function frameScore(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let dark = 0;
  const step = 16 * 4;
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    const y = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    sum += y;
    if (y < 18) dark += 1;
    n += 1;
  }
  const mean = n ? sum / n : 0;
  const darkRatio = n ? dark / n : 1;
  // Prefer mid brightness, penalize mostly-black frames
  return mean * (1 - darkRatio) - Math.abs(mean - 120) * 0.15;
}

/**
 * Generate a JPEG data-URL thumbnail for a clip range.
 * Returns null on failure (caller keeps any existing thumbnail).
 */
export async function generateClipThumbnail(
  file: File,
  opts: ThumbnailOptions,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const start = Math.max(0, opts.startSec);
  const end = Math.max(start + 0.2, opts.endSec);
  const mid = (start + end) / 2;
  const offsets = opts.candidateOffsetsSec?.length
    ? opts.candidateOffsetsSec
    : [0.25, 0.5, 1.0, Math.max(0.2, (end - start) * 0.35)];
  const candidates = [
    ...offsets.map((o) => Math.min(end - 0.05, start + o)),
    mid,
    start + 0.1,
  ].filter((t, i, a) => t >= start && t <= end && a.indexOf(t) === i);

  // Prefer face track mid-point time if available.
  if (opts.reframe && opts.reframe.source === "face" && opts.reframe.points.length) {
    const best = [...opts.reframe.points].sort((a, b) => b.confidence - a.confidence)[0];
    if (best) candidates.unshift(start + best.timeSec);
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
      video.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = SHORT_WIDTH;
    canvas.height = SHORT_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    let bestUrl: string | null = null;
    let bestScore = -Infinity;

    for (const t of candidates.slice(0, 6)) {
      if (opts.signal?.aborted) break;
      await seekVideo(video, t);
      const clipRel = t - start;
      const sx = opts.reframe ? sampleTrackX(opts.reframe, clipRel) : 0.5;
      draw916(video, ctx, sx);
      const score = frameScore(ctx, canvas.width, canvas.height);
      if (score > bestScore) {
        bestScore = score;
        bestUrl = canvas.toDataURL("image/jpeg", 0.72);
      }
    }
    return bestUrl;
  } catch (e) {
    console.warn("[thumbnail]", e);
    return null;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}
