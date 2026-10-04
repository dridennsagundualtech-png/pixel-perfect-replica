/**
 * Export-only audio enhancement settings + ffmpeg filter builder.
 * Pure (no ffmpeg import); saved in this browser.
 */
export type AudioEnhanceStrength = "low" | "medium" | "high";

export interface AudioEnhanceSettings {
  enabled: boolean;
  noiseReduction: boolean;
  voiceClarity: boolean;
  loudnessNormalize: boolean;
  strength: AudioEnhanceStrength;
}

export const DEFAULT_AUDIO_ENHANCE: AudioEnhanceSettings = {
  enabled: false,
  noiseReduction: true,
  voiceClarity: true,
  loudnessNormalize: true,
  strength: "medium",
};

const KEY = "clippilot.audioEnhance.v1";

export function loadAudioEnhanceSettings(): AudioEnhanceSettings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const v = { ...DEFAULT_AUDIO_ENHANCE, ...(raw ? JSON.parse(raw) : {}) } as AudioEnhanceSettings;
    if (!["low", "medium", "high"].includes(v.strength)) v.strength = "medium";
    return v;
  } catch {
    return { ...DEFAULT_AUDIO_ENHANCE };
  }
}

export function saveAudioEnhanceSettings(patch: Partial<AudioEnhanceSettings>): AudioEnhanceSettings {
  const next = { ...loadAudioEnhanceSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** Comma-joined ffmpeg audio filters for the voice track, or "" when nothing applies. */
export function buildAudioEnhanceFilter(s: AudioEnhanceSettings | undefined): string {
  if (!s?.enabled) return "";
  const k = { low: 0, medium: 1, high: 2 }[s.strength];
  const f: string[] = [];
  if (s.noiseReduction) f.push(`afftdn=nr=${[6, 12, 20][k]}:nf=-40`);
  if (s.voiceClarity)
    f.push("highpass=f=80", `equalizer=f=3000:t=q:w=1:g=${[2, 3, 5][k]}`);
  if (s.loudnessNormalize) f.push("loudnorm=I=-14:TP=-1.5:LRA=11");
  return f.join(",");
}
