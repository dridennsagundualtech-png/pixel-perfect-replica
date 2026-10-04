/**
 * Dynamic word captions for vertical Short exports. Pure (no ffmpeg/DOM), so
 * it is checked by `bun scripts/caption-check.ts`.
 *
 * Only genuine Whisper word timings (`TranscriptSegment.words`) are used.
 * Segments without valid words fall back to one static segment-level cue.
 * Timings are never estimated or distributed.
 */
import type { TranscriptSegment, TranscriptWord } from "@/lib/detection/transcript";
import { CAPTION_FONT_NAME, SHORT_HEIGHT, SHORT_WIDTH } from "./short-captions";

export type CaptionStyleId =
  | "classic"
  | "highlight"
  | "clean"
  | "impact"
  | "karaoke"
  | "minimal"
  | "bold"
  | "podcast";
export type CaptionPosition = "top" | "center" | "lower" | "bottom";
export type CaptionSize = "small" | "medium" | "large";

export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyleId;
  size: CaptionSize;
  position: CaptionPosition;
  highlightWord: boolean;
  maxWords: number;
  /** Optional override max lines (1–3). */
  maxLines: number;
  /** Optional primary text colour ASS (&HAABBGGRR). Empty = preset default. */
  textColor?: string | undefined;
  /** Optional active-word colour. Empty = preset default. */
  highlightColor?: string | undefined;
  /** Outline thickness override; null = preset. */
  outline?: number | undefined;
  /** Shadow depth override; null = preset. */
  shadow?: number | undefined;
  /** Custom preset name when saved by the user. */
  customName?: string | undefined;
  /** Seconds to keep caption after last spoken word (default ~0.15). */
  endPadSec?: number | undefined;
  /** Gap between words (s) that forces a new caption group. */
  groupPauseSec?: number | undefined;
  /** ASS FontName — built-in Anton or your custom font family name. */
  fontFamily?: string | undefined;
  /** Capitalization override; undefined = style default. */
  uppercase?: boolean | undefined;
  /** Dark box behind the text instead of an outline. */
  background?: boolean | undefined;
}

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  enabled: true,
  style: "highlight",
  size: "medium",
  position: "lower",
  highlightWord: true,
  maxWords: 4,
  maxLines: 2,
  endPadSec: 0.15,
  groupPauseSec: 0.55,
};

export interface CaptionPreset {
  label: string;
  description: string;
  fontSize: number;
  outline: number;
  shadow: number;
  /** ASS colours (&HAABBGGRR). */
  primary: string;
  inactive: string;
  active: string;
  activeScale: number;
  uppercase: boolean;
  maxWordsCap: number;
}

export const CAPTION_PRESETS: Record<CaptionStyleId, CaptionPreset> = {
  classic: {
    label: "Classic",
    description: "White bold text, black outline",
    fontSize: 58,
    outline: 4,
    shadow: 2,
    primary: "&H00FFFFFF",
    inactive: "&H00FFFFFF",
    active: "&H00FFFFFF",
    activeScale: 112,
    uppercase: false,
    maxWordsCap: 5,
  },
  highlight: {
    label: "Highlight",
    description: "Current word in yellow, strong outline",
    fontSize: 60,
    outline: 5,
    shadow: 2,
    primary: "&H00FFFFFF",
    inactive: "&H00FFFFFF",
    active: "&H0000D4FF",
    activeScale: 108,
    uppercase: true,
    maxWordsCap: 5,
  },
  clean: {
    label: "Clean",
    description: "Minimal, soft outline",
    fontSize: 52,
    outline: 2,
    shadow: 1,
    primary: "&H00FFFFFF",
    inactive: "&H00C8C8C8",
    active: "&H00FFFFFF",
    activeScale: 100,
    uppercase: false,
    maxWordsCap: 5,
  },
  impact: {
    label: "Impact",
    description: "Large, punchy, short groups",
    fontSize: 76,
    outline: 6,
    shadow: 3,
    primary: "&H00FFFFFF",
    inactive: "&H00FFFFFF",
    active: "&H0000D4FF",
    activeScale: 115,
    uppercase: true,
    maxWordsCap: 3,
  },
  karaoke: {
    label: "Karaoke",
    description: "Strong current-word emphasis",
    fontSize: 64,
    outline: 5,
    shadow: 3,
    primary: "&H00FFFFFF",
    inactive: "&H00B0B0B0",
    active: "&H0000FFFF",
    activeScale: 128,
    uppercase: true,
    maxWordsCap: 4,
  },
  minimal: {
    label: "Minimal",
    description: "Smaller, soft outline",
    fontSize: 44,
    outline: 1,
    shadow: 0,
    primary: "&H00FFFFFF",
    inactive: "&H00E0E0E0",
    active: "&H00FFFFFF",
    activeScale: 100,
    uppercase: false,
    maxWordsCap: 5,
  },
  bold: {
    label: "Bold",
    description: "Heavy white text, thick outline",
    fontSize: 68,
    outline: 7,
    shadow: 3,
    primary: "&H00FFFFFF",
    inactive: "&H00FFFFFF",
    active: "&H0000D4FF",
    activeScale: 110,
    uppercase: true,
    maxWordsCap: 4,
  },
  podcast: {
    label: "Podcast",
    description: "Readable sentence case, longer lines",
    fontSize: 48,
    outline: 3,
    shadow: 1,
    primary: "&H00FFFFFF",
    inactive: "&H00E6E6E6",
    active: "&H0066E0FF",
    activeScale: 100,
    uppercase: false,
    maxWordsCap: 5,
  },
};

/** Safe-area margins for 720×1280 shorts (UI guide + ASS margins). */
export const CAPTION_SAFE_AREA = {
  topPct: 0.12,
  bottomPct: 0.18,
  sidePct: 0.08,
} as const;

/** Resolve style with optional Classic fallback. */
export function resolveCaptionFontName(settings: CaptionSettings): string {
  const n = settings.fontFamily?.trim();
  return n || CAPTION_FONT_NAME;
}

export function resolveCaptionStyle(id: string): CaptionStyleId {
  if (id in CAPTION_PRESETS) return id as CaptionStyleId;
  return "classic";
}

export const SIZE_SCALE: Record<CaptionSize, number> = { small: 0.85, medium: 1, large: 1.18 };

/** Alignment (numpad) + vertical margin, all inside the 720×1280 safe area. */
export const POSITION_LAYOUT: Record<CaptionPosition, { alignment: number; marginV: number }> = {
  top: { alignment: 8, marginV: 200 },
  center: { alignment: 5, marginV: 0 },
  lower: { alignment: 2, marginV: 340 },
  bottom: { alignment: 2, marginV: 230 },
};

const SIDE_MARGIN = 60;
/** Pause (s) between words that ends a caption group (default). */
export const GROUP_PAUSE_SEC = 0.55;
/** Default pad after last spoken word before caption disappears. */
export const DEFAULT_END_PAD_SEC = 0.15;
/** Hard ceiling on post-word pad so captions never linger ~2–3s. */
export const MAX_END_PAD_SEC = 0.35;
/** Rough glyph width relative to font size (Anton is condensed). */
const CHAR_WIDTH_RATIO = 0.5;

export interface DynamicCaptionCue {
  /** Clip-relative seconds. */
  startSec: number;
  endSec: number;
  /** Clip-relative words with real Whisper timing; empty for segment fallback cues. */
  words: TranscriptWord[];
  text: string;
  /** Word emphasized during this cue, or null (static / no highlight). */
  activeWordIndex: number | null;
  /** Index of the caption group this cue belongs to. */
  group: number;
}

/** A word is usable only with non-empty text and finite, increasing timestamps. */
export function isValidWord(w: unknown): w is TranscriptWord {
  if (!w || typeof w !== "object") return false;
  const x = w as Partial<TranscriptWord>;
  return (
    typeof x.text === "string" &&
    x.text.trim() !== "" &&
    typeof x.startSec === "number" &&
    typeof x.endSec === "number" &&
    Number.isFinite(x.startSec) &&
    Number.isFinite(x.endSec) &&
    x.endSec > x.startSec
  );
}

export function validWords(seg: TranscriptSegment): TranscriptWord[] {
  if (!Array.isArray(seg.words)) return [];
  return seg.words
    .filter(isValidWord)
    .map((w) => ({ text: w.text.trim(), startSec: w.startSec, endSec: w.endSec }))
    .sort((a, b) => a.startSec - b.startSec);
}

export function maxCharsPerLine(settings: CaptionSettings): number {
  const p = CAPTION_PRESETS[resolveCaptionStyle(settings.style)];
  const size = p.fontSize * SIZE_SCALE[settings.size];
  return Math.max(6, Math.floor((SHORT_WIDTH - SIDE_MARGIN * 2) / (size * CHAR_WIDTH_RATIO)));
}

function effectiveMaxWords(settings: CaptionSettings): number {
  const cap = CAPTION_PRESETS[settings.style].maxWordsCap;
  return Math.max(1, Math.min(cap, Math.round(settings.maxWords) || 4));
}

/** Groups words into readable 2–5 word chunks at punctuation, pauses and width limits. */
export function groupWords(
  words: TranscriptWord[],
  opts: { maxWords: number; maxChars: number; pauseSec?: number },
): TranscriptWord[][] {
  const groups: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  const len = (g: TranscriptWord[]) => g.reduce((n, w) => n + w.text.length, 0) + g.length - 1;
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev) {
      const pauseLimit = opts.pauseSec ?? GROUP_PAUSE_SEC;
      const pause = w.startSec - prev.endSec >= pauseLimit;
      const tooWide = len([...cur, w]) > opts.maxChars * 2;
      if (pause || tooWide || cur.length >= opts.maxWords) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
    const next = words[i + 1];
    const endsSentence = /[.!?]["')\]]*$/.test(w.text);
    const endsClause = /[,;:]["')\]]*$/.test(w.text);
    if (next && (endsSentence || (endsClause && cur.length >= 2))) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

/** Index of the word being spoken at `t`, holding the previous word through gaps. */
export function activeWordAt(words: TranscriptWord[], t: number): number | null {
  let idx: number | null = null;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i]!.startSec <= t) idx = i;
    else break;
  }
  return idx;
}

/** Greedy wrap into lines no wider than maxChars (a single long word stays alone). */
export function wrapWords(words: string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let width = 0;
  for (const w of words) {
    const add = line.length ? w.length + 1 : w.length;
    if (line.length && width + add > maxChars) {
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(w);
    width += line.length > 1 ? w.length + 1 : w.length;
  }
  if (line.length) lines.push(line);
  // Balance two lines ("YOU NEED TO / UNDERSTAND THIS" rather than 4 + 1).
  if (lines.length === 2) {
    const all = [...lines[0]!, ...lines[1]!];
    let best = lines;
    let bestDiff = Infinity;
    for (let k = 1; k < all.length; k += 1) {
      const a = all.slice(0, k).join(" ").length;
      const b = all.slice(k).join(" ").length;
      if (a <= maxChars && b <= maxChars && Math.abs(a - b) < bestDiff) {
        bestDiff = Math.abs(a - b);
        best = [all.slice(0, k), all.slice(k)];
      }
    }
    return best;
  }
  return lines;
}

/**
 * Builds clip-relative caption cues. Segments with valid words become grouped
 * dynamic cues (one cue per active word when highlighting); others fall back to
 * a single static cue spanning the segment.
 */
export function resolveEndPadSec(settings: CaptionSettings): number {
  const v = settings.endPadSec;
  if (v == null || !Number.isFinite(v)) return DEFAULT_END_PAD_SEC;
  return Math.min(MAX_END_PAD_SEC, Math.max(0, v));
}

export function resolveGroupPauseSec(settings: CaptionSettings): number {
  const v = settings.groupPauseSec;
  if (v == null || !Number.isFinite(v)) return GROUP_PAUSE_SEC;
  return Math.min(2, Math.max(0.25, v));
}

/**
 * Clamp word end times so a word never extends into the next word's start
 * (Whisper sometimes reports long endSec into silence).
 */
export function clampWordTimings(words: TranscriptWord[]): TranscriptWord[] {
  if (!words.length) return [];
  const out: TranscriptWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    let end = w.endSec;
    if (next && end > next.startSec) end = next.startSec;
    if (end <= w.startSec)
      end = Math.min(w.startSec + 0.05, next ? next.startSec : w.startSec + 0.05);
    out.push({ text: w.text, startSec: w.startSec, endSec: end });
  }
  return out;
}

/**
 * Builds clip-relative caption cues from real word timestamps.
 * Group start = first word start; group end = last word end + small pad.
 * Never uses segment end times when words exist. Never invents timing.
 */
export function buildCaptionCues(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  settings: CaptionSettings,
): DynamicCaptionCue[] {
  const dur = clipEnd - clipStart;
  if (!(dur > 0)) return [];
  const pad = resolveEndPadSec(settings);
  const pauseSec = resolveGroupPauseSec(settings);
  const opts = {
    maxWords: effectiveMaxWords(settings),
    maxChars: maxCharsPerLine(settings),
    pauseSec,
  };
  type Block = { start: number; end: number; words: TranscriptWord[]; text: string };
  const blocks: Block[] = [];

  for (const seg of segments) {
    if (!(seg.endSec > clipStart && seg.startSec < clipEnd)) continue;
    const raw = validWords(seg)
      .filter((w) => w.endSec > clipStart && w.startSec < clipEnd)
      .map((w) => ({
        text: w.text,
        startSec: Math.max(0, w.startSec - clipStart),
        endSec: Math.min(dur, Math.max(w.startSec, w.endSec) - clipStart),
      }))
      .filter((w) => w.endSec > w.startSec || w.startSec < dur);
    const words = clampWordTimings(
      raw
        .map((w) => ({
          ...w,
          endSec: Math.min(dur, Math.max(w.startSec + 0.04, w.endSec)),
        }))
        .filter((w) => w.startSec < dur),
    );
    if (words.length) {
      for (const g of groupWords(words, opts)) {
        const first = g[0]!;
        const last = g[g.length - 1]!;
        blocks.push({
          start: first.startSec,
          end: last.endSec,
          words: g,
          text: g.map((w) => w.text).join(" "),
        });
      }
    } else if (seg.text.trim()) {
      // Segment-level fallback only when word timestamps are unavailable.
      const start = Math.max(0, seg.startSec - clipStart);
      const end = Math.min(dur, seg.endSec - clipStart);
      if (end > start) blocks.push({ start, end, words: [], text: seg.text.trim() });
    }
  }

  blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  const cues: DynamicCaptionCue[] = [];
  blocks.forEach((b, gi) => {
    const next = blocks[gi + 1];
    // End at last spoken word + small pad; never span silence into the next group.
    let end = b.words.length ? Math.min(dur, b.end + pad) : b.end;
    if (next) end = Math.min(end, next.start);
    if (!(end > b.start)) end = Math.min(dur, b.start + 0.05);

    if (!b.words.length || !settings.highlightWord) {
      if (end > b.start) {
        cues.push({
          startSec: b.start,
          endSec: end,
          words: b.words,
          text: b.text,
          activeWordIndex: null,
          group: gi,
        });
      }
      return;
    }

    b.words.forEach((w, wi) => {
      // Cue starts when this word starts (group first word uses block start = first word).
      const s = w.startSec;
      let e: number;
      if (wi < b.words.length - 1) {
        // Active until next word starts (tight word highlighting).
        e = b.words[wi + 1]!.startSec;
      } else {
        // Last word: until word end + pad (or next group).
        e = end;
      }
      if (e > s) {
        cues.push({
          startSec: s,
          endSec: e,
          words: b.words,
          text: b.text,
          activeWordIndex: wi,
          group: gi,
        });
      }
    });
  });
  return cues;
}

/** Active caption text at clip-relative time t (shared by preview + export timeline). */
export function cueAtTime(cues: DynamicCaptionCue[], t: number): DynamicCaptionCue | null {
  for (const c of cues) {
    if (t >= c.startSec && t < c.endSec) return c;
  }
  return null;
}

export function captionTextAtTime(cues: DynamicCaptionCue[], t: number): string {
  return cueAtTime(cues, t)?.text?.trim() ?? "";
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`;
}

const clean = (t: string) => t.replace(/\\/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();

/** ASS text for one cue: manual wrapping, active-word emphasis, overflow shrink. */
export function cueToAssText(cue: DynamicCaptionCue, settings: CaptionSettings): string {
  const p = { ...CAPTION_PRESETS[resolveCaptionStyle(settings.style)] };
  if (settings.textColor?.trim()) {
    p.primary = settings.textColor.trim();
    p.inactive = settings.textColor.trim();
  }
  if (settings.highlightColor?.trim()) p.active = settings.highlightColor.trim();
  const maxChars = maxCharsPerLine(settings);
  const tokens = (cue.words.length ? cue.words.map((w) => w.text) : cue.text.split(" "))
    .map((t) => clean((settings.uppercase ?? p.uppercase) ? t.toUpperCase() : t))
    .filter(Boolean);
  const lines = wrapWords(tokens, maxChars);
  let idx = 0;
  return lines
    .map((line) => {
      const width = line.join(" ").length;
      const lineScale = width > maxChars ? Math.max(40, Math.floor((maxChars / width) * 100)) : 100;
      const base = `\\c${p.inactive}&\\fscx${lineScale}\\fscy${lineScale}`;
      const parts = line.map((w) => {
        const i = idx++;
        if (cue.activeWordIndex === i) {
          const sc = Math.round((lineScale * p.activeScale) / 100);
          return `{\\c${p.active}&\\fscx${sc}\\fscy${sc}}${w}{${base}}`;
        }
        return w;
      });
      return `{${base}}${parts.join(" ")}`;
    })
    .join("\\N");
}

/** Full ASS script for dynamic captions with the chosen style and position. */
/**
 * Layout for a non-9:16 output frame. Only sizes/margins scale; cue timing is
 * untouched. Default (720×1280) returns factor 1 so vertical output is unchanged.
 */
export function captionLayoutScale(width: number, height: number) {
  if (width === SHORT_WIDTH && height === SHORT_HEIGHT) return { font: 1, x: 1, y: 1 };
  return {
    font: Math.min(width / SHORT_WIDTH, (height / SHORT_HEIGHT) * 1.35),
    x: width / SHORT_WIDTH,
    y: height / SHORT_HEIGHT,
  };
}

export function buildDynamicAss(
  cues: DynamicCaptionCue[],
  settings: CaptionSettings,
  frame: { width: number; height: number } = { width: SHORT_WIDTH, height: SHORT_HEIGHT },
): string {
  const k = captionLayoutScale(frame.width, frame.height);
  const styleId = resolveCaptionStyle(settings.style);
  const p = CAPTION_PRESETS[styleId];
  const pos = POSITION_LAYOUT[settings.position] ?? POSITION_LAYOUT.lower;
  const size = Math.round(p.fontSize * SIZE_SCALE[settings.size] * k.font);
  const outline = Math.round((settings.outline != null ? settings.outline : p.outline) * k.font);
  const shadow = Math.round((settings.shadow != null ? settings.shadow : p.shadow) * k.font);
  const primary = settings.textColor?.trim() || p.primary;
  const border = settings.background ? 3 : 1;
  const side = Math.round(SIDE_MARGIN * k.x);
  const marginV = Math.round(pos.marginV * k.y);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${resolveCaptionFontName(settings)},${size},${primary},${primary},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,${border},${outline},${shadow},${pos.alignment},${side},${side},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = cues.map(
    (c) =>
      `Dialogue: 0,${assTime(c.startSec)},${assTime(c.endSec)},Default,,0,0,0,,${cueToAssText(c, settings)}`,
  );
  return [...header, ...events, ""].join("\n");
}
