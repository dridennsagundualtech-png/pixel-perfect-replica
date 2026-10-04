import {
  DEFAULT_CAPTION_SETTINGS,
  resolveCaptionStyle,
  type CaptionSettings,
} from "@/lib/video/dynamic-captions";
import { DEFAULT_AUDIO_ENHANCE, type AudioEnhanceSettings } from "@/lib/video/audio-enhance";
import {
  DEFAULT_OUTPUT_SETTINGS,
  normalizeOutputSettings,
  type OutputSettings,
} from "@/lib/video/output-format";

/**
 * Creator presets: one bundle of format, caption look, audio and reframe
 * choices. Stored locally (per browser). Applying a preset only sets the
 * existing settings — it never changes caption timing or the renderer.
 */

export interface CreatorPresetValues {
  output: OutputSettings;
  /** Visual caption fields only (timing fields are never stored). */
  caption: Pick<
    CaptionSettings,
    | "enabled"
    | "style"
    | "size"
    | "position"
    | "highlightWord"
    | "maxWords"
    | "textColor"
    | "highlightColor"
    | "fontFamily"
    | "uppercase"
    | "background"
  >;
  audioEnhance: AudioEnhanceSettings;
  /** Music file can't be stored; only the volume preference. */
  musicVolume: number;
}

export interface CreatorPreset {
  id: string;
  name: string;
  builtIn: boolean;
  values: CreatorPresetValues;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "clippilot.creatorPresets.v1";
const ACTIVE_KEY = "clippilot.activeCreatorPreset.v1";
const MAX_CUSTOM = 30;

const cap = (c: Partial<CaptionSettings>): CreatorPresetValues["caption"] => ({
  enabled: c.enabled ?? true,
  style: resolveCaptionStyle(c.style ?? DEFAULT_CAPTION_SETTINGS.style),
  size: c.size ?? DEFAULT_CAPTION_SETTINGS.size,
  position: c.position ?? DEFAULT_CAPTION_SETTINGS.position,
  highlightWord: c.highlightWord ?? true,
  maxWords: c.maxWords ?? DEFAULT_CAPTION_SETTINGS.maxWords,
  textColor: c.textColor,
  highlightColor: c.highlightColor,
  fontFamily: c.fontFamily,
  uppercase: c.uppercase,
  background: c.background,
});

const values = (
  output: Partial<OutputSettings>,
  caption: Partial<CaptionSettings>,
  audio: Partial<AudioEnhanceSettings> = {},
): CreatorPresetValues => ({
  output: normalizeOutputSettings({ ...DEFAULT_OUTPUT_SETTINGS, ...output }),
  caption: cap(caption),
  audioEnhance: { ...DEFAULT_AUDIO_ENHANCE, ...audio },
  musicVolume: 0.2,
});

export const BUILT_IN_PRESETS: CreatorPreset[] = [
  {
    id: "builtin-default",
    name: "My Default",
    builtIn: true,
    values: values({}, {}),
  },
  {
    id: "builtin-tiktok",
    name: "TikTok Style",
    builtIn: true,
    values: values({ resolution: "hd" }, { style: "highlight", position: "lower", size: "large" }),
  },
  {
    id: "builtin-shorts",
    name: "YouTube Shorts",
    builtIn: true,
    values: values({ resolution: "hd" }, { style: "bold", position: "lower" }),
  },
  {
    id: "builtin-clean",
    name: "Clean Captions",
    builtIn: true,
    values: values({}, { style: "minimal", highlightWord: false, position: "bottom" }),
  },
  {
    id: "builtin-podcast",
    name: "Podcast",
    builtIn: true,
    values: values(
      { format: "landscape", resolution: "hd" },
      { style: "podcast", position: "bottom", background: true },
      { enabled: true },
    ),
  },
];

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Validate/repair one stored preset; returns null when unusable. */
export function validatePreset(raw: unknown): CreatorPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CreatorPreset>;
  if (typeof r.id !== "string" || !r.id || typeof r.name !== "string" || !r.name.trim())
    return null;
  if (!r.values || typeof r.values !== "object") return null;
  const v = r.values as Partial<CreatorPresetValues>;
  const vol = Number(v.musicVolume);
  return {
    id: r.id,
    name: r.name.trim().slice(0, 40),
    builtIn: false,
    values: {
      output: normalizeOutputSettings(v.output),
      caption: cap((v.caption ?? {}) as Partial<CaptionSettings>),
      audioEnhance: {
        ...DEFAULT_AUDIO_ENHANCE,
        ...(v.audioEnhance && typeof v.audioEnhance === "object" ? v.audioEnhance : {}),
      },
      musicVolume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.2,
    },
  };
}

export function loadCustomPresets(storage = defaultStorage()): CreatorPreset[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(validatePreset).filter((p): p is CreatorPreset => p !== null);
  } catch {
    return [];
  }
}

export function listPresets(storage = defaultStorage()): CreatorPreset[] {
  return [...BUILT_IN_PRESETS, ...loadCustomPresets(storage)];
}

function write(list: CreatorPreset[], storage: KeyValueStorage | null) {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CUSTOM)));
  } catch {
    /* storage full/blocked */
  }
}

let counter = 0;
function newId(): string {
  try {
    return `preset-${crypto.randomUUID()}`;
  } catch {
    counter += 1;
    return `preset-${Date.now()}-${counter}`;
  }
}

export function createPreset(
  name: string,
  v: CreatorPresetValues,
  storage = defaultStorage(),
): CreatorPreset {
  const preset = validatePreset({ id: newId(), name: name.trim() || "My preset", values: v })!;
  write([preset, ...loadCustomPresets(storage)], storage);
  return preset;
}

/** Update a custom preset. Built-ins can't be changed (returns null). */
export function updatePreset(
  id: string,
  patch: { name?: string; values?: CreatorPresetValues },
  storage = defaultStorage(),
): CreatorPreset | null {
  const list = loadCustomPresets(storage);
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const next = validatePreset({ ...list[i]!, ...patch });
  if (!next) return null;
  list[i] = next;
  write(list, storage);
  return next;
}

export function deletePreset(id: string, storage = defaultStorage()): boolean {
  const list = loadCustomPresets(storage);
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  write(next, storage);
  return true;
}

export function getPreset(id: string, storage = defaultStorage()): CreatorPreset | null {
  return listPresets(storage).find((p) => p.id === id) ?? null;
}

export function getActivePresetId(storage = defaultStorage()): string | null {
  try {
    return storage?.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActivePresetId(id: string | null, storage = defaultStorage()): void {
  try {
    storage?.setItem(ACTIVE_KEY, id ?? "");
  } catch {
    /* ignore */
  }
}

/** Snapshot current settings into preset values (timing fields excluded). */
export function captureValues(
  output: OutputSettings,
  caption: CaptionSettings,
  audioEnhance: AudioEnhanceSettings,
  musicVolume: number,
): CreatorPresetValues {
  return {
    output: normalizeOutputSettings(output),
    caption: cap(caption),
    audioEnhance: { ...audioEnhance },
    musicVolume,
  };
}
