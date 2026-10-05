import { useCallback, useEffect, useState } from "react";
import { SHORT_HEIGHT, SHORT_WIDTH } from "./short-captions";
import type { ReframeTrack } from "./reframe-track";

/**
 * Output format (aspect ratio + resolution) and manual reframe override.
 * Pure helpers + one small hook. These only configure the existing renderer;
 * there is no separate render pipeline per format.
 */

export type AspectFormat = "vertical" | "square" | "landscape";
/** standard = the original 720-based export (fast); hd = 1080-based. */
export type ExportResolution = "standard" | "hd";
export type ReframeChoice = "auto" | "center" | "left" | "right" | "custom";

export interface OutputSettings {
  format: AspectFormat;
  resolution: ExportResolution;
  reframe: ReframeChoice;
  /** 0 (left edge) … 1 (right edge); used when reframe = "custom". */
  manualX: number;
}

/** Defaults reproduce the previous export exactly: 9:16 at 720×1280, auto reframe. */
export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = {
  format: "vertical",
  resolution: "standard",
  reframe: "auto",
  manualX: 0.5,
};

export const FORMAT_META: Record<AspectFormat, { label: string; ratio: string; css: string }> = {
  vertical: { label: "Vertical", ratio: "9:16", css: "9 / 16" },
  square: { label: "Square", ratio: "1:1", css: "1 / 1" },
  landscape: { label: "Landscape", ratio: "16:9", css: "16 / 9" },
};

const SIZES: Record<ExportResolution, Record<AspectFormat, { width: number; height: number }>> = {
  standard: {
    vertical: { width: SHORT_WIDTH, height: SHORT_HEIGHT },
    square: { width: 720, height: 720 },
    landscape: { width: 1280, height: 720 },
  },
  hd: {
    vertical: { width: 1080, height: 1920 },
    square: { width: 1080, height: 1080 },
    landscape: { width: 1920, height: 1080 },
  },
};

export function getOutputSize(
  format: AspectFormat,
  resolution: ExportResolution = "standard",
): { width: number; height: number } {
  return { ...(SIZES[resolution]?.[format] ?? SIZES.standard.vertical) };
}

export interface ExportPreset {
  id: string;
  label: string;
  format: AspectFormat;
  resolution: ExportResolution;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "shorts", label: "TikTok / Reels / Shorts", format: "vertical", resolution: "hd" },
  { id: "youtube", label: "YouTube", format: "landscape", resolution: "hd" },
  { id: "square", label: "Square Social", format: "square", resolution: "hd" },
  { id: "fast", label: "Fast vertical (720p)", format: "vertical", resolution: "standard" },
];

export function exportPresetSize(id: string): { width: number; height: number } | null {
  const p = EXPORT_PRESETS.find((x) => x.id === id);
  return p ? getOutputSize(p.format, p.resolution) : null;
}

export const REFRAME_LABELS: Record<ReframeChoice, string> = {
  auto: "Auto (face)",
  center: "Center",
  left: "Left",
  right: "Right",
  custom: "Custom",
};

/** Manual horizontal position, or null when the automatic track should be used. */
export function manualReframeX(s: Pick<OutputSettings, "reframe" | "manualX">): number | null {
  switch (s.reframe) {
    case "center":
      return 0.5;
    case "left":
      return 0.25;
    case "right":
      return 0.75;
    case "custom":
      return clamp01(s.manualX);
    default:
      return null;
  }
}

/** Constant-position track for a manual override (never presented as face data). */
export function manualTrack(x: number): ReframeTrack {
  if (Math.abs(x - 0.5) < 1e-6)
    return { source: "center", points: [{ timeSec: 0, x: 0.5, confidence: 0 }] };
  return { source: "person", points: [{ timeSec: 0, x: clamp01(x), confidence: 1 }] };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

export function normalizeOutputSettings(raw: unknown): OutputSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<OutputSettings>;
  return {
    format: v.format && v.format in FORMAT_META ? v.format : DEFAULT_OUTPUT_SETTINGS.format,
    resolution: v.resolution === "hd" ? "hd" : "standard",
    reframe: v.reframe && v.reframe in REFRAME_LABELS ? v.reframe : DEFAULT_OUTPUT_SETTINGS.reframe,
    manualX: clamp01(Number(v.manualX ?? 0.5)),
  };
}

const KEY = "clippilot.outputSettings.v1";

export function loadOutputSettings(): OutputSettings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return normalizeOutputSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_OUTPUT_SETTINGS };
  }
}

export function useOutputSettings() {
  const [settings, setSettings] = useState<OutputSettings>(DEFAULT_OUTPUT_SETTINGS);
  useEffect(() => setSettings(loadOutputSettings()), []);
  const update = useCallback((patch: Partial<OutputSettings>) => {
    setSettings((prev) => {
      const next = normalizeOutputSettings({ ...prev, ...patch });
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, []);
  return [settings, update] as const;
}
