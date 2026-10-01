import type { TranscriptSegment } from "@/lib/detection/transcript";
import { formatTimecode } from "@/lib/format";

export function TranscriptViewer({
  segments,
  onSeek,
}: {
  segments: TranscriptSegment[];
  onSeek?: ((sec: number) => void) | undefined;
}) {
  return (
    <section className="panel p-6">
      <h2 className="font-display text-lg font-semibold">Transcript</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">
        Click a line to jump the video there.
      </p>
      <ol className="max-h-96 space-y-1 overflow-y-auto pr-2">
        {segments.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSeek?.(s.startSec)}
              className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="shrink-0 font-mono text-xs text-primary">
                {formatTimecode(s.startSec)}
              </span>
              <span>
                {s.speaker ? <span className="mr-1 font-medium">{s.speaker}:</span> : null}
                {s.text}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
