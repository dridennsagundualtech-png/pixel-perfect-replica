import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatTimecode } from "@/lib/format";

export interface TimelineCaptionBand {
  startSec: number;
  endSec: number;
  label?: string;
}

export interface TimelineRemovalBand {
  startSec: number;
  endSec: number;
  reason: "silence" | "filler";
}

/**
 * Lightweight single-track timeline (Phase 6).
 * No continuous video frame scrubbing — pure layout + pointer events.
 */
export function ClipTimeline({
  durationSec,
  startSec,
  endSec,
  playheadSec,
  captions,
  removals,
  onSeek,
  onChangeRange,
  className,
}: {
  /** Full source duration (or clip window max). */
  durationSec: number;
  startSec: number;
  endSec: number;
  playheadSec: number;
  captions?: TimelineCaptionBand[];
  removals?: TimelineRemovalBand[];
  onSeek: (sec: number) => void;
  onChangeRange: (start: number, end: number) => void;
  className?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<"playhead" | "start" | "end" | null>(null);
  const dur = Math.max(0.1, durationSec);

  const secFromClientX = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar) return 0;
      const rect = bar.getBoundingClientRect();
      const u = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(u * dur * 100) / 100;
    },
    [dur],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      const t = secFromClientX(e.clientX);
      if (drag.current === "playhead") onSeek(Math.min(endSec, Math.max(startSec, t)));
      else if (drag.current === "start") {
        const s = Math.max(0, Math.min(t, endSec - 0.1));
        onChangeRange(s, endSec);
      } else if (drag.current === "end") {
        const e2 = Math.min(dur, Math.max(t, startSec + 0.1));
        onChangeRange(startSec, e2);
      }
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [secFromClientX, startSec, endSec, dur, onSeek, onChangeRange]);

  const pct = (sec: number) => `${(sec / dur) * 100}%`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{formatTimecode(0)}</span>
        <span>
          Clip {formatTimecode(startSec)} – {formatTimecode(endSec)}
        </span>
        <span>{formatTimecode(dur)}</span>
      </div>

      {/* Caption track */}
      <div className="relative h-3 rounded bg-muted/60">
        {(captions ?? []).map((c, i) => (
          <div
            key={i}
            title={c.label}
            className="absolute top-0.5 h-2 rounded-sm bg-accent/70"
            style={{
              left: pct(c.startSec),
              width: pct(Math.max(0.05, c.endSec - c.startSec)),
            }}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">Caption regions (real word timing)</p>

      {/* Main track: removals + clip range + playhead */}
      <div
        ref={barRef}
        className="relative h-10 cursor-pointer rounded-md bg-muted"
        onPointerDown={(e) => {
          drag.current = "playhead";
          const t = secFromClientX(e.clientX);
          onSeek(Math.min(endSec, Math.max(startSec, t)));
        }}
      >
        {/* Removed regions (non-destructive overlay) */}
        {(removals ?? []).map((r, i) => (
          <div
            key={i}
            title={r.reason === "silence" ? "Dead air (preview)" : "Filler (preview)"}
            className={cn(
              "absolute inset-y-1 opacity-80",
              r.reason === "silence" ? "bg-amber-500/35" : "bg-rose-500/35",
            )}
            style={{
              left: pct(r.startSec),
              width: pct(Math.max(0.05, r.endSec - r.startSec)),
            }}
          />
        ))}

        {/* Active clip range */}
        <div
          className="absolute inset-y-0 bg-primary/30"
          style={{
            left: pct(startSec),
            width: pct(Math.max(0.05, endSec - startSec)),
          }}
        />

        {/* Start handle */}
        <button
          type="button"
          aria-label="Clip start"
          className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 rounded-sm bg-primary shadow"
          style={{ left: pct(startSec) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = "start";
          }}
        />
        {/* End handle */}
        <button
          type="button"
          aria-label="Clip end"
          className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 rounded-sm bg-primary shadow"
          style={{ left: pct(endSec) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = "end";
          }}
        />
        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-foreground"
          style={{ left: pct(playheadSec) }}
        >
          <div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-primary/50" /> Clip
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-amber-500/50" /> Dead air
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-rose-500/50" /> Filler
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-accent/70" /> Captions
        </span>
      </div>
    </div>
  );
}
