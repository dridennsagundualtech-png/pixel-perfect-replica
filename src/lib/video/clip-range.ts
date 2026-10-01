/** Pure timestamp validation for clip rendering (no browser APIs). */

export type ClipRangeResult =
  | { ok: true; startSec: number; endSec: number; durationSec: number }
  | { ok: false; error: string };

/** Clips shorter than this can't produce a meaningful video. */
export const MIN_RENDER_SEC = 0.5;
/** Longer clips are too heavy for reliable in-browser encoding. */
export const MAX_RENDER_SEC = 10 * 60;

export function validateClipRange(
  startSec: number,
  endSec: number,
  sourceDurationSec?: number | undefined,
): ClipRangeResult {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec))
    return { ok: false, error: "The clip has invalid start or end times." };
  if (endSec <= startSec) return { ok: false, error: "The clip's end must be after its start." };
  let start = Math.max(0, startSec);
  let end = endSec;
  if (
    sourceDurationSec !== undefined &&
    Number.isFinite(sourceDurationSec) &&
    sourceDurationSec > 0
  ) {
    if (start >= sourceDurationSec)
      return { ok: false, error: "The clip starts after the end of the video." };
    end = Math.min(end, sourceDurationSec);
  }
  start = Math.round(start * 1000) / 1000;
  end = Math.round(end * 1000) / 1000;
  const durationSec = end - start;
  if (durationSec < MIN_RENDER_SEC) return { ok: false, error: "The clip is too short to export." };
  if (durationSec > MAX_RENDER_SEC)
    return {
      ok: false,
      error: "Clips longer than 10 minutes are too long to render in the browser.",
    };
  return { ok: true, startSec: start, endSec: end, durationSec };
}

export function clipFileName(projectName: string, index: number, startSec: number, endSec: number) {
  const safe =
    projectName
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "ClipPilot";
  const t = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}-${String(sec).padStart(2, "0")}`;
  };
  return `${safe}_Clip_${String(index).padStart(2, "0")}_${t(startSec)}_to_${t(endSec)}.mp4`;
}
