/// <reference lib="webworker" />
/**
 * Runs Whisper (transformers.js, ONNX/WASM) off the main thread.
 * Model files are cached by the browser Cache API, so they download once.
 */
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type Asr = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

let asr: Asr | null = null;
let loadedModel: string | null = null;

const post = (msg: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (event: MessageEvent) => {
  const { audio, model, language } = event.data as {
    audio: Float32Array;
    model: string;
    language?: string;
  };

  if (!asr || loadedModel !== model) {
    try {
      asr = (await pipeline("automatic-speech-recognition", model, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: unknown) => post({ type: "model-progress", data: p }),
      })) as unknown as Asr;
      loadedModel = model;
    } catch (err) {
      post({ type: "error", phase: "model", message: String((err as Error)?.message ?? err) });
      return;
    }
  }

  post({ type: "transcribing" });
  const base = {
    chunk_length_s: 30,
    stride_length_s: 5,
    task: "transcribe",
    ...(language ? { language } : {}),
  };
  let out: Awaited<ReturnType<Asr>>;
  try {
    // Pass 1: segment timestamps (unchanged; detection depends on these).
    out = await asr(audio, { ...base, return_timestamps: true });
  } catch (err) {
    post({ type: "error", phase: "transcribe", message: String((err as Error)?.message ?? err) });
    return;
  }

  // Pass 2: genuine word timestamps (cross-attention alignment). Optional —
  // a failure here never breaks the transcript.
  let words: { timestamp: [number, number | null]; text: string }[] | null = null;
  let wordError: string | null = null;
  try {
    const w = await asr(audio, { ...base, return_timestamps: "word" });
    words = w.chunks ?? null;
  } catch (err) {
    wordError = String((err as Error)?.message ?? err);
  }

  post({ type: "result", chunks: out.chunks ?? [], text: out.text, words, wordError });
};
