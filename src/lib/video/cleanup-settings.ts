import { useCallback, useEffect, useState } from "react";

export interface CleanupSettings {
  /** Remove long pauses / dead air. Default off until user enables. */
  removeDeadAir: boolean;
  /**
   * Relative silence sensitivity 0–1.
   * Higher = more aggressive (treat quieter regions as silence).
   * Calibrated against the clip's own median speech level when audio is available.
   */
  silenceThreshold: number;
  /** Minimum gap length (seconds) before a pause is considered dead air. */
  minSilenceSec: number;
  /** Seconds of silence to keep at each cut (natural breath). */
  keepSilenceSec: number;
  /** Remove filler words from the transcript. Default off. */
  removeFillers: boolean;
  /** Lowercase tokens treated as fillers when context allows. */
  fillerWords: string[];
}

export const DEFAULT_FILLER_WORDS = ["um", "uh", "er", "ah", "uhm", "hmm", "like", "you know"];

export const DEFAULT_CLEANUP_SETTINGS: CleanupSettings = {
  removeDeadAir: false,
  silenceThreshold: 0.55,
  minSilenceSec: 0.45,
  keepSilenceSec: 0.12,
  removeFillers: false,
  fillerWords: [...DEFAULT_FILLER_WORDS],
};

const KEY = "clippilot.cleanupSettings.v1";

export function loadCleanupSettings(): CleanupSettings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULT_CLEANUP_SETTINGS, fillerWords: [...DEFAULT_FILLER_WORDS] };
    const v = {
      ...DEFAULT_CLEANUP_SETTINGS,
      ...(JSON.parse(raw) as Partial<CleanupSettings>),
    };
    v.removeDeadAir = !!v.removeDeadAir;
    v.removeFillers = !!v.removeFillers;
    v.silenceThreshold = Math.min(1, Math.max(0.05, Number(v.silenceThreshold) || 0.55));
    v.minSilenceSec = Math.min(3, Math.max(0.15, Number(v.minSilenceSec) || 0.45));
    v.keepSilenceSec = Math.min(0.5, Math.max(0, Number(v.keepSilenceSec) || 0.12));
    if (!Array.isArray(v.fillerWords) || !v.fillerWords.length) {
      v.fillerWords = [...DEFAULT_FILLER_WORDS];
    } else {
      v.fillerWords = v.fillerWords
        .map((w) => String(w).toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 40);
    }
    return v;
  } catch {
    return { ...DEFAULT_CLEANUP_SETTINGS, fillerWords: [...DEFAULT_FILLER_WORDS] };
  }
}

/** Cleanup settings shared by Export Short, saved in this browser. */
export function useCleanupSettings() {
  const [settings, setSettings] = useState<CleanupSettings>(DEFAULT_CLEANUP_SETTINGS);
  useEffect(() => setSettings(loadCleanupSettings()), []);
  const update = useCallback((patch: Partial<CleanupSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
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
