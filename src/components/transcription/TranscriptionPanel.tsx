import { Loader2, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import type { TranscriptionProgress } from "@/lib/transcription/types";

export type TranscriptState =
  "NO_TRANSCRIPT" | "TRANSCRIBING" | "TRANSCRIBED" | "TRANSCRIPTION_ERROR";

const STAGE_LABEL: Record<string, string> = {
  decoding: "Reading audio from video...",
  downloading: "Downloading transcription model...",
  loading: "Loading model...",
  transcribing: "Transcribing...",
};

interface Props {
  state: TranscriptState;
  progress: TranscriptionProgress | null;
  error: string | null;
  segmentCount: number;
  hasFile: boolean;
  unavailableReason?: string | undefined;
  modelName: string;
  onTranscribe: () => void;
  onCancel: () => void;
}

export function TranscriptionPanel(p: Props) {
  const busy = p.state === "TRANSCRIBING";
  const status =
    p.state === "TRANSCRIBED"
      ? "Transcript ready"
      : p.state === "TRANSCRIPTION_ERROR"
        ? "Transcription failed"
        : busy
          ? (STAGE_LABEL[p.progress?.stage ?? ""] ?? "Transcribing video...")
          : "Not transcribed";

  return (
    <section className="panel space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Transcription</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs free on your device with Whisper. The model downloads once, then is reused.
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs">{status}</span>
      </div>

      {busy ? (
        <div className="space-y-2">
          {p.progress?.stage === "downloading" && p.progress.percent !== undefined ? (
            <>
              <Progress value={p.progress.percent} />
              <p className="text-xs text-muted-foreground">
                {formatBytes(p.progress.loadedBytes ?? 0)} of{" "}
                {formatBytes(p.progress.totalBytes ?? 0)}
              </p>
            </>
          ) : (
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            You can keep using the page. Long videos can take several minutes.
          </p>
        </div>
      ) : null}

      {p.state === "TRANSCRIPTION_ERROR" && p.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {p.error}
        </p>
      ) : null}
      {p.state === "TRANSCRIBED" ? (
        <p className="text-sm text-muted-foreground">{p.segmentCount} transcript segments.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {p.unavailableReason ? (
          <>
            <Button disabled variant="outline">
              <Mic className="size-4" /> Local transcription unavailable
            </Button>
            <p className="text-sm text-muted-foreground">{p.unavailableReason}</p>
          </>
        ) : busy ? (
          <>
            <Button disabled>
              <Loader2 className="size-4 animate-spin" /> Transcribing video...
            </Button>
            <Button variant="outline" onClick={p.onCancel}>
              <X className="size-4" /> Cancel
            </Button>
          </>
        ) : (
          <>
            <Button onClick={p.onTranscribe} disabled={!p.hasFile}>
              <Mic className="size-4" />{" "}
              {p.state === "TRANSCRIBED" ? "Transcribe again" : "Transcribe video"}
            </Button>
            {!p.hasFile ? (
              <p className="text-sm text-muted-foreground">Select the video file above first.</p>
            ) : p.state === "NO_TRANSCRIPT" ? (
              <p className="text-sm text-muted-foreground">Transcribe video to analyze clips.</p>
            ) : null}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Model: {p.modelName}</p>
    </section>
  );
}
