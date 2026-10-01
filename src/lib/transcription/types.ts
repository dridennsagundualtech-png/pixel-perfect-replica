import type { TranscriptionResult } from "@/lib/detection/transcript";

/**
 * Transcription provider contract. Providers only produce the existing
 * `TranscriptionResult`; detection never knows which provider ran.
 */

export type ProviderAvailability = "unavailable" | "ready";

export type TranscriptionStage =
  "idle" | "decoding" | "downloading" | "loading" | "transcribing" | "complete" | "error";

export interface TranscriptionProgress {
  stage: TranscriptionStage;
  /** Only set when the real value is measurable (e.g. model download bytes). */
  loadedBytes?: number | undefined;
  totalBytes?: number | undefined;
  percent?: number | undefined;
}

export interface TranscriptionOptions {
  /** ISO language code; omit to let the model detect it. */
  language?: string | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: TranscriptionProgress) => void) | undefined;
}

export interface TranscriptionProvider {
  id: string;
  name: string;
  modelName: string;
  availability(): { status: ProviderAvailability; reason?: string | undefined };
  transcribe(video: File, options?: TranscriptionOptions): Promise<TranscriptionResult>;
}

/** Error with a message that is safe to show to a normal user. */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unsupported"
      | "too-large"
      | "no-audio"
      | "silent"
      | "model-download"
      | "model-load"
      | "worker"
      | "failed"
      | "no-speech"
      | "cancelled",
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}
