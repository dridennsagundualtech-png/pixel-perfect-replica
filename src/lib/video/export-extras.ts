import { useCallback, useEffect, useState } from "react";

/**
 * Per-browser export extras: mirror (flip) and background music.
 * Flip is saved in localStorage; the music File lives only in memory (like the
 * source video) and must be re-picked after a reload.
 */
export interface BackgroundMusic {
  file: File;
  /** 0–1 music volume under the voice. */
  volume: number;
}

export interface ExportExtras {
  flip: boolean;
  music: BackgroundMusic | null;
}

const KEY = "clippilot.exportExtras.v1";
type Store = { music: BackgroundMusic | null; listeners: Set<() => void> };
const g = globalThis as typeof globalThis & { __clippilotMusic?: Store };
const store: Store = (g.__clippilotMusic ??= { music: null, listeners: new Set() });

function loadFlip(): boolean {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}").flip === true;
  } catch {
    return false;
  }
}

export function useExportExtras() {
  const [flip, setFlipState] = useState(false);
  const [music, setMusicState] = useState<BackgroundMusic | null>(store.music);
  useEffect(() => {
    setFlipState(loadFlip());
    const l = () => setMusicState(store.music);
    store.listeners.add(l);
    return () => {
      store.listeners.delete(l);
    };
  }, []);
  const setFlip = useCallback((v: boolean) => {
    setFlipState(v);
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ flip: v }));
    } catch {
      /* ignore */
    }
  }, []);
  const setMusic = useCallback((m: BackgroundMusic | null) => {
    store.music = m;
    store.listeners.forEach((l) => l());
  }, []);
  return { flip, setFlip, music, setMusic };
}
