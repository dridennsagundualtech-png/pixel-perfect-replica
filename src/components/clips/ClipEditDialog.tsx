import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { TranscriptSegment } from "@/lib/detection/transcript";
import {
  buildCaptionCues,
  captionTextAtTime,
  DEFAULT_CAPTION_SETTINGS,
  type CaptionSettings,
} from "@/lib/video/dynamic-captions";
import type { ClipCandidate } from "@/lib/detection/types";
import { formatTimecode } from "@/lib/format";
import { MODE_META } from "@/lib/detection/defaults";
import { ClipTimeline, type TimelineCaptionBand, type TimelineRemovalBand } from "@/components/clips/ClipTimeline";
import type { CleanupSettings } from "@/lib/video/cleanup-settings";

/**
 * Lightweight clip inspector + trimmer (Phase 5).
 * Not a full NLE — preview, trim, reset, save. Export uses the existing pipeline.
 */

export function ClipEditDialog({
  clip,
  maxSec,
  videoUrl,
  hasVideoFile,
  segments,
  captionsEnabled,
  captionSettings,
  cleanupSettings,
  onClose,
  onSave,
  onExport,
  onRequestVideo,
}: {
  clip: ClipCandidate | null;
  maxSec?: number | undefined;
  /** Object URL for the local project video, if selected this session. */
  videoUrl?: string | null | undefined;
  hasVideoFile?: boolean | undefined;
  segments?: TranscriptSegment[] | undefined;
  captionsEnabled?: boolean | undefined;
  captionSettings?: CaptionSettings | undefined;
  cleanupSettings?: CleanupSettings | undefined;
  onClose: () => void;
  onSave: (changes: { title: string; startSec: number; endSec: number }) => void;
  onExport?: (clip: ClipCandidate) => void;
  onRequestVideo?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"start" | "end" | "playhead" | null>(null);

  const [title, setTitle] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  /** Original detected bounds for "Reset to detected clip". */
  const detectedRef = useRef<{ title: string; startSec: number; endSec: number } | null>(
    null,
  );

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [reframeX, setReframeX] = useState(0.5);
  const [reframeLabel, setReframeLabel] = useState<"Smart Reframe" | "Center Crop">(
    "Center Crop",
  );
  const [reframeLoading, setReframeLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<
    { title: string; startSec: number; endSec: number }[]
  >([]);
  const [redoStack, setRedoStack] = useState<
    { title: string; startSec: number; endSec: number }[]
  >([]);
  const [removals, setRemovals] = useState<TimelineRemovalBand[]>([]);
  const [captionBands, setCaptionBands] = useState<TimelineCaptionBand[]>([]);

  // Seed form + detected snapshot when a new clip opens.
  useEffect(() => {
    if (!clip) {
      detectedRef.current = null;
      setPlaying(false);
      return;
    }
    setTitle(clip.title);
    const s = Math.round(clip.startSec * 10) / 10;
    const e = Math.round(clip.endSec * 10) / 10;
    setStart(s);
    setEnd(e);
    detectedRef.current = { title: clip.title, startSec: s, endSec: e };
    setCurrent(s);
    setReframeX(0.5);
    setReframeLabel("Center Crop");
    setUndoStack([]);
    setRedoStack([]);
  }, [clip?.id]);

  // Keep playback inside [start, end].
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !clip) return;
    const onTime = () => {
      const t = el.currentTime;
      setCurrent(t);
      if (t >= end - 0.05) {
        el.pause();
        el.currentTime = end;
        setPlaying(false);
      }
      if (t < start - 0.05) el.currentTime = start;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [clip, start, end]);

  // Seek to start when range or video URL changes.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoUrl) return;
    el.currentTime = start;
    setCurrent(start);
  }, [videoUrl, start, clip?.id]);

  // Lightweight smart-reframe sample for preview object-position (non-blocking).
  useEffect(() => {
    if (!clip || !videoUrl || typeof window === "undefined") return;
    let cancelled = false;
    setReframeLoading(true);
    (async () => {
      try {
        const res = await fetch(videoUrl);
        const blob = await res.blob();
        const file = new File([blob], "preview.mp4", { type: blob.type || "video/mp4" });
        const { trackSubject } = await import("@/lib/video/subject-tracker");
        const track = await trackSubject(file, {
          startSec: start,
          endSec: end,
          sampleIntervalSec: Math.max(0.6, (end - start) / 8),
        });
        if (cancelled) return;
        if (track.source === "face" && track.points.length) {
          const mid = track.points[Math.floor(track.points.length / 2)]!;
          setReframeX(mid.x);
          setReframeLabel("Smart Reframe");
        } else {
          setReframeX(0.5);
          setReframeLabel("Center Crop");
        }
      } catch {
        if (!cancelled) {
          setReframeX(0.5);
          setReframeLabel("Center Crop");
        }
      } finally {
        if (!cancelled) setReframeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clip?.id, videoUrl, start, end]);

  const limit = maxSec ?? Number.POSITIVE_INFINITY;
  const duration = Math.max(0, end - start);
  const error =
    start < 0
      ? "Start can't be negative."
      : end <= start
        ? "End must be after start."
        : end > limit
          ? `End can't be past the end of the video (${Math.floor(limit)}s).`
          : null;

  const captionLine = liveCaption(
    segments ?? [],
    current,
    start,
    end,
    captionSettings,
  );

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < start || el.currentTime >= end) el.currentTime = start;
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  const restart = () => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = start;
    setCurrent(start);
    void el.play().catch(() => undefined);
  };

  const resetDetected = () => {
    const d = detectedRef.current;
    if (!d) return;
    setTitle(d.title);
    setStart(d.startSec);
    setEnd(d.endSec);
    const el = videoRef.current;
    if (el) {
      el.currentTime = d.startSec;
      setCurrent(d.startSec);
    }
  };

  const clampStart = (v: number) => {
    const next = Math.max(0, Math.min(v, end - 0.1));
    setStart(Math.round(next * 10) / 10);
  };
  const clampEnd = (v: number) => {
    const next = Math.min(limit, Math.max(v, start + 0.1));
    setEnd(Math.round(next * 10) / 10);
  };

  const pushHistory = () => {
    setUndoStack((u) => [...u.slice(-29), { title, startSec: start, endSec: end }]);
    setRedoStack([]);
  };

  const undo = () => {
    setUndoStack((u) => {
      if (!u.length) return u;
      const prev = u[u.length - 1]!;
      setRedoStack((r) => [...r, { title, startSec: start, endSec: end }]);
      setTitle(prev.title);
      setStart(prev.startSec);
      setEnd(prev.endSec);
      return u.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1]!;
      setUndoStack((u) => [...u, { title, startSec: start, endSec: end }]);
      setTitle(next.title);
      setStart(next.startSec);
      setEnd(next.endSec);
      return r.slice(0, -1);
    });
  };

  const onBarPointer = useCallback(
    (clientX: number, mode: "start" | "end" | "playhead") => {
      const bar = barRef.current;
      if (!bar || !Number.isFinite(limit) || limit <= 0) return;
      const rect = bar.getBoundingClientRect();
      const u = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = u * limit;
      if (mode === "start") clampStart(t);
      else if (mode === "end") clampEnd(t);
      else {
        const clamped = Math.min(end, Math.max(start, t));
        const el = videoRef.current;
        if (el) el.currentTime = clamped;
        setCurrent(clamped);
      }
    },
    [limit, start, end],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      onBarPointer(e.clientX, dragRef.current);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onBarPointer]);

  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, ((current - start) / duration) * 100)) : 0;
  const startPct = limit > 0 ? (start / limit) * 100 : 0;
  const endPct = limit > 0 ? (end / limit) * 100 : 100;

  // object-position: map subject X so the face stays in frame under object-cover
  const objectPosition = `${Math.round(reframeX * 100)}% 50%`;


  // Caption bands + non-destructive removal preview for timeline
  useEffect(() => {
    if (!clip) {
      setCaptionBands([]);
      setRemovals([]);
      return;
    }
    const segs = segments ?? [];
    const bands: TimelineCaptionBand[] = [];
    for (const seg of segs) {
      if (!(seg.endSec > start && seg.startSec < end)) continue;
      const words = Array.isArray(seg.words) ? seg.words : [];
      if (words.length) {
        for (const w of words) {
          if (w.endSec > start && w.startSec < end)
            bands.push({ startSec: w.startSec, endSec: w.endSec, label: w.text });
        }
      } else if (seg.text.trim()) {
        bands.push({
          startSec: Math.max(start, seg.startSec),
          endSec: Math.min(end, seg.endSec),
          label: seg.text.trim().slice(0, 40),
        });
      }
    }
    setCaptionBands(bands);

    let cancelled = false;
    (async () => {
      if (!cleanupSettings?.removeDeadAir && !cleanupSettings?.removeFillers) {
        if (!cancelled) setRemovals([]);
        return;
      }
      try {
        const { buildCleanupPlan } = await import("@/lib/video/cleanup-plan");
        const { plan } = await buildCleanupPlan({
          segments: segs,
          clipStart: start,
          clipEnd: end,
          settings: cleanupSettings,
        });
        if (cancelled || plan.isIdentity) {
          if (!cancelled) setRemovals([]);
          return;
        }
        // Invert keep segments → removal bands for display
        const removes: TimelineRemovalBand[] = [];
        let cursor = start;
        for (const s of plan.segments) {
          if (s.sourceStartSec > cursor + 0.05) {
            removes.push({
              startSec: cursor,
              endSec: s.sourceStartSec,
              reason: "silence",
            });
          }
          cursor = s.sourceEndSec;
        }
        if (end > cursor + 0.05) {
          removes.push({ startSec: cursor, endSec: end, reason: "silence" });
        }
        if (!cancelled) setRemovals(removes);
      } catch {
        if (!cancelled) setRemovals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clip?.id, start, end, segments, cleanupSettings]);

  return (
    <Dialog open={clip !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clip editor</DialogTitle>
          <DialogDescription>
            Preview the 9:16 short, trim start/end, then save or export. Not a full timeline editor.
          </DialogDescription>
        </DialogHeader>

        {!clip ? null : (
          <div className="space-y-4">
            {/* 9:16 preview */}
            <div className="mx-auto w-full max-w-[280px]">
              <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-black">
                {videoUrl ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    muted={muted}
                    playsInline
                    className="size-full object-cover"
                    style={{ objectPosition }}
                    onClick={togglePlay}
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                    <p>
                      {hasVideoFile
                        ? "Video is still loading…"
                        : "Select the original video file to preview this clip."}
                    </p>
                    {!hasVideoFile && onRequestVideo ? (
                      <Button size="sm" variant="secondary" onClick={onRequestVideo}>
                        Select video
                      </Button>
                    ) : null}
                  </div>
                )}

                {/* Simple caption overlay */}
                {videoUrl && captionsEnabled && captionLine ? (
                  <div className="pointer-events-none absolute inset-x-2 bottom-[18%] text-center">
                    <span className="inline-block rounded bg-black/55 px-2 py-1 text-sm font-semibold uppercase leading-tight text-white shadow">
                      {captionLine}
                    </span>
                  </div>
                ) : null}

                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    9:16
                  </Badge>
                  <Badge variant="outline" className="border-white/30 bg-black/40 text-[10px] text-white">
                    {reframeLoading ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> Reframe…
                      </span>
                    ) : (
                      reframeLabel
                    )}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Transport */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={togglePlay} disabled={!videoUrl}>
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {playing ? "Pause" : "Play"}
                </Button>
                <Button size="sm" variant="ghost" onClick={restart} disabled={!videoUrl}>
                  <RotateCcw className="size-4" /> Restart
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMuted((m) => !m)}
                  disabled={!videoUrl}
                >
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTimecode(Math.max(0, current - start))} / {formatTimecode(duration)}
                </span>
              </div>
              <Progress value={progressPct} className="h-1.5" />
            </div>

            <ClipTimeline
              durationSec={Number.isFinite(limit) ? limit : Math.max(end, 1)}
              startSec={start}
              endSec={end}
              playheadSec={current}
              captions={captionBands}
              removals={removals}
              onSeek={(t) => {
                const el = videoRef.current;
                if (el) el.currentTime = t;
                setCurrent(t);
              }}
              onChangeRange={(s, e) => {
                pushHistory();
                setStart(Math.round(s * 10) / 10);
                setEnd(Math.round(e * 10) / 10);
              }}
            />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" disabled={!undoStack.length} onClick={undo}>
                Undo
              </Button>
              <Button size="sm" variant="ghost" disabled={!redoStack.length} onClick={redo}>
                Redo
              </Button>
            </div>

            {/* Title + numeric trim */}

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="clip-title">Title</Label>
                <Input id="clip-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="clip-start">Start (seconds)</Label>
                  <Input
                    id="clip-start"
                    type="number"
                    step="0.1"
                    min={0}
                    value={start}
                    onChange={(e) => clampStart(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clip-end">End (seconds)</Label>
                  <Input
                    id="clip-end"
                    type="number"
                    step="0.1"
                    min={0}
                    value={end}
                    onChange={(e) => clampEnd(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <p className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
                {error ?? `Length: ${Math.round(duration * 10) / 10}s`}
              </p>
            </div>

            {/* Key information */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="mb-2 text-sm font-medium">Clip info</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
                <Info label="Duration" value={`${Math.round(duration * 10) / 10}s`} />
                <Info
                  label="Original range"
                  value={`${formatTimecode(start)} – ${formatTimecode(end)}`}
                />
                <Info
                  label="Mode"
                  value={`${MODE_META[clip.mode].icon} ${MODE_META[clip.mode].label}`}
                />
                {typeof clip.score === "number" ? (
                  <Info label="Rule Score" value={String(clip.score)} />
                ) : null}
                {typeof clip.engagementPotential === "number" ? (
                  <Info label="Engagement Potential" value={String(clip.engagementPotential)} />
                ) : null}
                {(clip.qualityMatched != null || clip.rulesMatched != null) && (
                  <Info
                    label="Quality signals"
                    value={`${clip.qualityMatched ?? clip.rulesMatched}/${clip.qualityTotal ?? clip.rulesTotal}`}
                  />
                )}
                <Info
                  label="Captions"
                  value={captionsEnabled ? "On for export" : "Off for export"}
                />
                <Info label="Reframe" value={reframeLabel} />
              </dl>
              {clip.highlights?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {clip.highlights.map((h) => (
                    <Badge key={h} variant="secondary" className="font-normal">
                      {h}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {clip.reason ? (
                <p className="mt-2 text-muted-foreground">{clip.reason}</p>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={resetDetected} disabled={!clip}>
            <Maximize2 className="size-4" /> Reset to detected clip
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {onExport && clip ? (
              <Button
                variant="secondary"
                disabled={error !== null}
                onClick={() => {
                  if (error) return;
                  onSave({ title: title.trim() || clip.title, startSec: start, endSec: end });
                  onExport({ ...clip, title: title.trim() || clip.title, startSec: start, endSec: end });
                }}
              >
                Save & Export Short
              </Button>
            ) : null}
            <Button
              disabled={error !== null || !title.trim()}
              onClick={() => onSave({ title: title.trim(), startSec: start, endSec: end })}
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Caption overlay using the same buildCaptionCues timeline as Export Short.
 * tAbs is source timeline seconds; converted to clip-relative for cue lookup.
 */
function liveCaption(
  segments: TranscriptSegment[],
  tAbs: number,
  clipStart: number,
  clipEnd: number,
  captionSettings?: CaptionSettings,
): string {
  const settings = captionSettings ?? DEFAULT_CAPTION_SETTINGS;
  if (!settings.enabled) return "";
  const cues = buildCaptionCues(segments, clipStart, clipEnd, settings);
  const tRel = tAbs - clipStart;
  return captionTextAtTime(cues, tRel);
}
