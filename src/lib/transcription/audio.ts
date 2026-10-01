import { TranscriptionError } from "./types";

export const WHISPER_SAMPLE_RATE = 16000;
/** The whole file is read once to decode audio; beyond this browsers tend to run out of memory. */
export const MAX_DECODE_BYTES = 1.5 * 1024 * 1024 * 1024;

/**
 * Video File → 16 kHz mono Float32 samples using the browser's own decoder.
 * No FFmpeg needed for MP4/WEBM (and MOV where the browser supports its codecs).
 */
export async function decodeVideoAudio(file: File, signal?: AbortSignal): Promise<Float32Array> {
  if (file.size > MAX_DECODE_BYTES) {
    throw new TranscriptionError(
      "This video is too large to transcribe in the browser (limit about 1.5 GB). Try a shorter or compressed file.",
      "too-large",
    );
  }
  const Ctx =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctx) {
    throw new TranscriptionError("This browser can't decode audio.", "unsupported");
  }

  let buffer: ArrayBuffer | null;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new TranscriptionError(
      "The browser ran out of memory reading this video. Try a smaller file.",
      "too-large",
    );
  }
  if (signal?.aborted) throw cancelled();

  const ctx = new Ctx({ sampleRate: WHISPER_SAMPLE_RATE });
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buffer);
  } catch {
    throw new TranscriptionError(
      "Couldn't read an audio track from this video. It may have no audio, be corrupted, or use a format this browser can't decode.",
      "no-audio",
    );
  } finally {
    buffer = null;
    void ctx.close();
  }
  if (signal?.aborted) throw cancelled();

  if (decoded.length === 0) {
    throw new TranscriptionError("This video's audio track is empty.", "no-audio");
  }

  let mono: Float32Array;
  if (decoded.numberOfChannels === 1) {
    mono = decoded.getChannelData(0).slice();
  } else {
    mono = new Float32Array(decoded.length);
    const channels = decoded.numberOfChannels;
    for (let c = 0; c < channels; c += 1) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels;
    }
  }

  let peak = 0;
  for (let i = 0; i < mono.length; i += 64) peak = Math.max(peak, Math.abs(mono[i] ?? 0));
  if (peak < 1e-4) {
    throw new TranscriptionError(
      "This video's audio is silent, so there is nothing to transcribe.",
      "silent",
    );
  }
  return mono;
}

export function cancelled() {
  return new TranscriptionError("Transcription cancelled.", "cancelled");
}
