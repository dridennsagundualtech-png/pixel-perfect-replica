import { useCallback, useEffect, useState } from "react";
import {
  CAPTION_PRESETS,
  DEFAULT_CAPTION_SETTINGS,
  POSITION_LAYOUT,
  SIZE_SCALE,
  resolveCaptionStyle,
  type CaptionSettings,
  type CaptionStyleId,
} from "./dynamic-captions";

const KEY = "clippilot.captionSettings.v1";
const PRESETS_KEY = "clippilot.customCaptionPresets.v1";

export function loadCaptionSettings(): CaptionSettings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULT_CAPTION_SETTINGS };
    const v = { ...DEFAULT_CAPTION_SETTINGS, ...(JSON.parse(raw) as Partial<CaptionSettings>) };
    v.style = resolveCaptionStyle(v.style);
    if (!(v.position in POSITION_LAYOUT)) v.position = DEFAULT_CAPTION_SETTINGS.position;
    if (!(v.size in SIZE_SCALE)) v.size = DEFAULT_CAPTION_SETTINGS.size;
    v.maxWords = Math.min(5, Math.max(2, Number(v.maxWords) || 4));
    v.maxLines = Math.min(3, Math.max(1, Number(v.maxLines) || 2));
    if (v.endPadSec != null) v.endPadSec = Math.min(0.35, Math.max(0, Number(v.endPadSec)));
    if (v.groupPauseSec != null)
      v.groupPauseSec = Math.min(2, Math.max(0.25, Number(v.groupPauseSec)));
    v.enabled = v.enabled !== false;
    v.highlightWord = v.highlightWord !== false;
    if (typeof v.fontFamily === "string") v.fontFamily = v.fontFamily.trim() || undefined;
    if (v.outline != null) v.outline = Math.min(10, Math.max(0, Number(v.outline)));
    if (v.shadow != null) v.shadow = Math.min(8, Math.max(0, Number(v.shadow)));
    return v;
  } catch {
    return { ...DEFAULT_CAPTION_SETTINGS };
  }
}

/** Caption settings shared by Short exports, saved in this browser. */
export function useCaptionSettings() {
  const [settings, setSettings] = useState<CaptionSettings>(DEFAULT_CAPTION_SETTINGS);
  useEffect(() => setSettings(loadCaptionSettings()), []);
  const update = useCallback((patch: Partial<CaptionSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.style) next.style = resolveCaptionStyle(patch.style);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage full/blocked */
      }
      return next;
    });
  }, []);
  return [settings, update] as const;
}

export interface CustomCaptionPreset {
  id: string;
  name: string;
  settings: CaptionSettings;
  savedAt: string;
}

export function loadCustomCaptionPresets(): CustomCaptionPreset[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(PRESETS_KEY) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw) as CustomCaptionPreset[];
    return Array.isArray(arr) ? arr.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function saveCustomCaptionPreset(
  name: string,
  settings: CaptionSettings,
): CustomCaptionPreset[] {
  const list = loadCustomCaptionPresets().filter((p) => p.name !== name);
  const entry: CustomCaptionPreset = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40) || "My preset",
    settings: { ...settings, customName: name.trim().slice(0, 40) },
    savedAt: new Date().toISOString(),
  };
  const next = [entry, ...list].slice(0, 20);
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function deleteCustomCaptionPreset(id: string): CustomCaptionPreset[] {
  const next = loadCustomCaptionPresets().filter((p) => p.id !== id);
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function builtInPresetIds(): CaptionStyleId[] {
  return Object.keys(CAPTION_PRESETS) as CaptionStyleId[];
}
