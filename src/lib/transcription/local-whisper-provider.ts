import type { TranscriptionResult, TranscriptSegment } from "@/lib/detection/transcript";
import { cancelled, decodeVideoAudio, WHISPER_SAMPLE_RATE } from "./audio";
import { TranscriptionError, type TranscriptionOptions, type TranscriptionProvider } from "./types";

/**
 * Same Whisper "base" weights, exported with cross-attention outputs so
 * Transformers.js can compute real word timestamps. The plain
 * onnx-community/whisper-base export lacks them and throws on "word" mode.
 */
const MODEL = "onnx-community/whisper-base_timestamped";

type WhisperChunk = { timestamp: [number, number | null]; text: string };

/**
 * Assigns each Whisper word to the segment containing its midpoint. Timings
 * are copied as-is from Whisper; words without a real end time are dropped.
 */
function attachWords(segments: TranscriptSegment[], words: WhisperChunk[]) {
  let si = 0;
  for (const w of words) {
    const [start, end] = w.timestamp;
    if (typeof start !== "number" || typeof end !== "number") continue;
    const mid = (start + end) / 2;
    while (si < segments.length - 1 && mid >= (segments[si]?.endSec ?? 0)) si += 1;
    const seg = segments[si];
    if (!seg || mid < seg.startSec || mid > seg.endSec) continue;
    (seg.words ??= []).push({ text: w.text.trim(), startSec: start, endSec: end });
  }
}

function logWordTiming(segments: TranscriptSegment[]) {
  const all = segments.flatMap((s) => s.words ?? []);
  if (!all.length) {
    console.info("[whisper] Word timing available: 0 words");
    return;
  }
  const first = all
    .slice(0, 8)
    .map((w) => `"${w.text}" ${w.startSec.toFixed(2)}–${w.endSec.toFixed(2)}`)
    .join("\n");
  console.info(`[whisper] Word timing available: ${all.length} words\nFirst words:\n${first}`);
}

/** One worker is reused so the model stays in memory between runs. */
let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

function disposeWorker() {
  worker?.terminate();
  worker = null;
}

interface ModelProgressEvent {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export const localWhisperProvider: TranscriptionProvider = {
  id: "local-whisper",
  name: "Local Whisper (in your browser)",
  modelName: MODEL,

  availability() {
    if (typeof window === "undefined")
      return { status: "unavailable", reason: "Not in a browser." };
    if (typeof Worker === "undefined")
      return { status: "unavailable", reason: "This browser doesn't support background workers." };
    if (typeof WebAssembly === "undefined")
      return { status: "unavailable", reason: "This browser doesn't support WebAssembly." };
    if (!("AudioContext" in window) && !("webkitAudioContext" in window))
      return { status: "unavailable", reason: "This browser can't decode audio." };
    return { status: "ready" };
  },

  async transcribe(video: File, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    const { signal, onProgress, language } = options;
    if (signal?.aborted) throw cancelled();

    onProgress?.({ stage: "decoding" });
    const audio = await decodeVideoAudio(video, signal);
    const durationSec = audio.length / WHISPER_SAMPLE_RATE;

    const w = getWorker();
    const files = new Map<string, { loaded: number; total: number }>();

    return new Promise<TranscriptionResult>((resolve, reject) => {
      const cleanup = () => {
        w.removeEventListener("message", onMessage);
        w.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        disposeWorker(); // true cancellation: stops the computation
        reject(cancelled());
      };
      const onError = () => {
        cleanup();
        disposeWorker();
        reject(
          new TranscriptionError(
            "The transcription worker crashed. Try again, or use a shorter video.",
            "worker",
          ),
        );
      };
      const onMessage = (event: MessageEvent) => {
        const msg = event.data as
          | { type: "model-progress"; data: ModelProgressEvent }
          | { type: "transcribing" }
          | {
              type: "result";
              chunks: WhisperChunk[];
              words?: WhisperChunk[] | null;
              wordError?: string | null;
            }
          | { type: "error"; phase: "model" | "transcribe"; message: string };

        if (msg.type === "model-progress") {
          const p = msg.data;
          if (p.status === "progress" && p.file && p.total) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
            let loaded = 0;
            let total = 0;
            files.forEach((f) => {
              loaded += f.loaded;
              total += f.total;
            });
            onProgress?.({
              stage: "downloading",
              loadedBytes: loaded,
              totalBytes: total,
              percent: total ? Math.min(100, (loaded / total) * 100) : undefined,
            });
          } else if (p.status === "done" || p.status === "ready") {
            onProgress?.({ stage: "loading" });
          }
          return;
        }
        if (msg.type === "transcribing") {
          onProgress?.({ stage: "transcribing" });
          return;
        }
        cleanup();
        if (msg.type === "error") {
          console.error("[whisper]", msg.message);
          const offline = /fetch|network/i.test(msg.message);
          reject(
            msg.phase === "model"
              ? new TranscriptionError(
                  offline
                    ? "Couldn't download the transcription model. Check your internet connection and try again."
                    : "The transcription model couldn't be loaded in this browser.",
                  offline ? "model-download" : "model-load",
                )
              : /memory|allocat/i.test(msg.message)
                ? new TranscriptionError(
                    "The browser ran out of memory while transcribing. Try a shorter video.",
                    "too-large",
                  )
                : new TranscriptionError("Transcription failed. Please try again.", "failed"),
          );
          return;
        }

        const segments: TranscriptSegment[] = msg.chunks.map((c, i) => {
          const start = c.timestamp[0] ?? 0;
          const end = c.timestamp[1] ?? Math.max(start + 0.5, durationSec);
          return { id: `seg-${i + 1}`, startSec: start, endSec: end, text: c.text };
        });
        if (msg.wordError) console.warn("[whisper] word timestamps unavailable:", msg.wordError);
        attachWords(segments, msg.words ?? []);
        if (import.meta.env.DEV) logWordTiming(segments);
        resolve({
          segments,
          language,
          durationSec,
          source: `provider:local-whisper:${MODEL}`,
        });
      };

      w.addEventListener("message", onMessage);
      w.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      // Transfer the buffer so we don't keep a second copy on the main thread.
      w.postMessage({ audio, model: MODEL, language }, [audio.buffer]);
    });
  },
};
