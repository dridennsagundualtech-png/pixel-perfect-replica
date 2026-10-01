import type { TranscriptSegment } from "@/lib/detection/transcript";
import type { ClipCandidate } from "@/lib/detection/types";

/** Transcript segments that fall inside a clip's time range. */
export function segmentsInRange(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
): TranscriptSegment[] {
  return segments.filter((s) => s.endSec > startSec && s.startSec < endSec);
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** SRT captions for one clip, timed from the clip start (0:00). */
export function clipToSrt(clip: ClipCandidate, segments: TranscriptSegment[]): string {
  return segmentsInRange(segments, clip.startSec, clip.endSec)
    .map((s, i) => {
      const start = Math.max(0, s.startSec - clip.startSec);
      const end = Math.min(clip.endSec, s.endSec) - clip.startSec;
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${s.text.trim()}\n`;
    })
    .join("\n");
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
