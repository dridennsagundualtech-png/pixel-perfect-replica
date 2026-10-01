/**
 * Burned-in caption helpers for vertical short exports. Pure (no ffmpeg) so
 * timing can be checked with `bun scripts/video-render-check.ts`.
 * Captions are whole transcript segments — no invented word timing.
 */

export const SHORT_WIDTH = 720;
export const SHORT_HEIGHT = 1280;
export const CAPTION_FONT_NAME = "Anton";
export const CAPTION_FONT_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/anton/Anton-Regular.ttf";

export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

/** Segments overlapping [start,end], rebased to clip-relative time. */
export function clipCaptionCues(
  segments: CaptionCue[],
  startSec: number,
  endSec: number,
): CaptionCue[] {
  const dur = endSec - startSec;
  return segments
    .filter((s) => s.endSec > startSec && s.startSec < endSec && s.text.trim())
    .map((s) => ({
      startSec: Math.max(0, s.startSec - startSec),
      endSec: Math.min(dur, s.endSec - startSec),
      text: s.text.trim(),
    }))
    .filter((c) => c.endSec > c.startSec);
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`;
}

function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, "")
    .replace(/\s*\n\s*/g, " ");
}

/** ASS subtitle file: large bold white text, black outline, lower-middle, auto-wrapped. */
export function buildAss(cues: CaptionCue[]): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${SHORT_WIDTH}`,
    `PlayResY: ${SHORT_HEIGHT}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${CAPTION_FONT_NAME},58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,60,60,320,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = cues.map(
    (c) =>
      `Dialogue: 0,${assTime(c.startSec)},${assTime(c.endSec)},Default,,0,0,0,,${escapeAss(c.text)}`,
  );
  return [...header, ...events, ""].join("\n");
}
