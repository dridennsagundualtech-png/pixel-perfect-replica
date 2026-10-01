import { validateTranscript, type TranscriptionResult } from "@/lib/detection/transcript";
import { localWhisperProvider } from "./local-whisper-provider";
import { TranscriptionError, type TranscriptionOptions, type TranscriptionProvider } from "./types";

/**
 * Provider registry. Add self-hosted Whisper / faster-whisper providers here;
 * detection code only ever sees the validated TranscriptionResult.
 */
const providers: TranscriptionProvider[] = [localWhisperProvider];

export function getTranscriptionProvider(id = "local-whisper"): TranscriptionProvider {
  return providers.find((p) => p.id === id) ?? localWhisperProvider;
}

/** Runs a provider and validates its output before anything downstream sees it. */
export async function transcribeVideo(
  video: File,
  options: TranscriptionOptions & { providerId?: string | undefined } = {},
): Promise<{ result: TranscriptionResult; warnings: string[] }> {
  const provider = getTranscriptionProvider(options.providerId);
  const raw = await provider.transcribe(video, options);
  const validation = validateTranscript(raw.segments);
  if (validation.segments.length === 0) {
    throw new TranscriptionError("No speech was found in this video.", "no-speech");
  }
  return { result: { ...raw, segments: validation.segments }, warnings: validation.warnings };
}

export * from "./types";
