import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlipHorizontal2,
  Loader2,
  Maximize2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { BackgroundMusic } from "@/lib/video/export-extras";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TranscriptSegment } from "@/lib/detection/transcript";
import {
  buildCaptionCues,
  CAPTION_PRESETS,
  cueAtTime,
  DEFAULT_CAPTION_SETTINGS,
  type CaptionPosition,
  type CaptionSettings,
  type CaptionSize,
  type CaptionStyleId,
} from "@/lib/video/dynamic-captions";
import type { ClipCandidate } from "@/lib/detection/types";
import { formatTimecode } from "@/lib/format";
import {
  ClipTimeline,
  type TimelineCaptionBand,
  type TimelineRemovalBand,
} from "@/components/clips/ClipTimeline";
import type { CleanupSettings } from "@/lib/video/cleanup-settings";
import {
  DEFAULT_OUTPUT_SETTINGS,
  EXPORT_PRESETS,
  FORMAT_META,
  REFRAME_LABELS,
  manualReframeX,
  type AspectFormat,
  type OutputSettings,
  type ReframeChoice,
} from "@/lib/video/output-format";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { MetadataKind } from "@/lib/clip-metadata";

/**
 * Clip inspector + trimmer: 9:16 preview with live captions, trim, caption /
 * reframe / cleanup controls that share the export settings. Not a full NLE.
 */

type Snapshot = { title: string; startSec: number; endSec: number };
const PREVIEW_WIDTH: Record<AspectFormat, string> = {
  vertical: "max-w-[260px]",
  square: "max-w-[340px]",
  landscape: "max-w-[520px]",
};

const POSITION_CLASS: Record<CaptionPosition, string> = {
  top: "top-[14%]",
  center: "top-1/2 -translate-y-1/2",
  lower: "bottom-[24%]",
  bottom: "bottom-[14%]",
};
const SIZE_CLASS: Record<CaptionSize, string> = {
  small: "text-sm",
  medium: "text-base",
  large: "text-xl",
};

export function ClipEditDialog({
  clip,
  maxSec,
  videoUrl,
  videoFile,
  hasVideoFile,
  segments,
  captionSettings,
  onCaptionSettingsChange,
  cleanupSettings,
  onCleanupSettingsChange,
  onClose,
  onSave,
  onExport,
  onRequestVideo,
  flip = false,
  onFlipChange,
  music = null,
  onMusicChange,
  outputSettings,
  onOutputSettingsChange,
  onThumbnail,
  onRegenerateThumbnail,
}: {
  outputSettings?: OutputSettings | undefined;
  onOutputSettingsChange?: ((patch: Partial<OutputSettings>) => void) | undefined;
  onThumbnail?: ((dataUrl: string) => void) | undefined;
  onRegenerateThumbnail?: ((startSec: number, endSec: number) => void) | undefined;
  flip?: boolean | undefined;
  onFlipChange?: ((v: boolean) => void) | undefined;
  music?: BackgroundMusic | null | undefined;
  onMusicChange?: ((m: BackgroundMusic | null) => void) | undefined;
  clip: ClipCandidate | null;
  maxSec?: number | undefined;
  videoUrl?: string | null | undefined;
  videoFile?: File | null | undefined;
  hasVideoFile?: boolean | undefined;
  segments?: TranscriptSegment[] | undefined;
  /** @deprecated use captionSettings.enabled */
  captionsEnabled?: boolean | undefined;
  captionSettings?: CaptionSettings | undefined;
  onCaptionSettingsChange?: ((patch: Partial<CaptionSettings>) => void) | undefined;
  cleanupSettings?: CleanupSettings | undefined;
  onCleanupSettingsChange?: ((patch: Partial<CleanupSettings>) => void) | undefined;
  onClose: () => void;
  onSave: (changes: Snapshot & { description?: string; hashtags?: string }) => void;
  onExport?: (clip: ClipCandidate) => void;
  onRequestVideo?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const musicPickRef = useRef<HTMLInputElement>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!music) return setMusicUrl(null);
    const u = URL.createObjectURL(music.file);
    setMusicUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [music?.file]);
  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = music?.volume ?? 0.2;
  }, [music?.volume, musicUrl]);
  const caps = captionSettings ?? DEFAULT_CAPTION_SETTINGS;

  const [title, setTitle] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const detectedRef = useRef<Snapshot | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const out = outputSettings ?? DEFAULT_OUTPUT_SETTINGS;
  const manualX = manualReframeX(out);
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [genBusy, setGenBusy] = useState<MetadataKind | null>(null);
  const [thumbText, setThumbText] = useState("");
  const [faceX, setFaceX] = useState<number | null>(null);
  const [reframeLoading, setReframeLoading] = useState(false);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [removals, setRemovals] = useState<TimelineRemovalBand[]>([]);

  // Latest bounds for the animation loop (avoids re-subscribing on every trim).
  const boundsRef = useRef({ start: 0, end: 0 });
  boundsRef.current = { start, end };

  useEffect(() => {
    if (!clip) {
      detectedRef.current = null;
      setPlaying(false);
      return;
    }
    const s = Math.round(clip.startSec * 10) / 10;
    const e = Math.round(clip.endSec * 10) / 10;
    setTitle(clip.title);
    setDescription(clip.description ?? "");
    setHashtags(clip.hashtags ?? "");
    setThumbText("");
    setStart(s);
    setEnd(e);
    setCurrent(s);
    detectedRef.current = { title: clip.title, startSec: s, endSec: e };
    setUndoStack([]);
    setRedoStack([]);
    setFaceX(null);
  }, [clip?.id]);

  // Smooth playhead: requestAnimationFrame while playing (timeupdate fires only ~4x/s).
  const tick = () => {
    const el = videoRef.current;
    if (!el) return;
    const { start: s, end: e } = boundsRef.current;
    const t = el.currentTime;
    if (t >= e - 0.03) {
      el.pause();
      el.currentTime = e;
      setCurrent(e);
      return;
    }
    if (t < s - 0.05) el.currentTime = s;
    setCurrent(t);
    rafRef.current = requestAnimationFrame(tick);
  };
  const stopLoop = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };
  useEffect(() => stopLoop, []);
  useEffect(() => {
    if (!clip) stopLoop();
  }, [clip]);

  const onVideoPlay = () => {
    setPlaying(true);
    const m = musicRef.current;
    const el = videoRef.current;
    if (m && el) {
      const len = m.duration || 0;
      m.currentTime = len ? (el.currentTime - boundsRef.current.start) % len : 0;
      void m.play().catch(() => undefined);
    }
    stopLoop();
    rafRef.current = requestAnimationFrame(tick);
  };
  const onVideoPause = () => {
    setPlaying(false);
    musicRef.current?.pause();
    stopLoop();
    const el = videoRef.current;
    if (el) setCurrent(el.currentTime);
  };
  const onLoaded = () => {
    const el = videoRef.current;
    if (el) el.currentTime = boundsRef.current.start;
  };

  // Face sample once per opened clip (uses the in-memory File; never re-reads on trim).
  useEffect(() => {
    if (!clip || !videoFile) return;
    let cancelled = false;
    setReframeLoading(true);
    const s0 = clip.startSec;
    const e0 = clip.endSec;
    (async () => {
      try {
        const { trackSubject } = await import("@/lib/video/subject-tracker");
        const track = await trackSubject(videoFile, {
          startSec: s0,
          endSec: e0,
          sampleIntervalSec: Math.max(0.8, (e0 - s0) / 8),
        });
        if (cancelled) return;
        if (track.source === "face" && track.points.length) {
          setFaceX(track.points[Math.floor(track.points.length / 2)]!.x);
        } else setFaceX(null);
      } catch {
        if (!cancelled) setFaceX(null);
      } finally {
        if (!cancelled) setReframeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clip?.id, videoFile]);

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

  // Caption cues: same builder as Export Short.
  const cues = useMemo(
    () => (caps.enabled ? buildCaptionCues(segments ?? [], start, end, caps) : []),
    [segments, start, end, caps],
  );
  const cue = cueAtTime(cues, current - start);
  const preset = CAPTION_PRESETS[caps.style] ?? CAPTION_PRESETS.highlight;

  const captionBands = useMemo<TimelineCaptionBand[]>(
    () =>
      cues
        .filter((c, i, arr) => i === 0 || arr[i - 1]!.group !== c.group)
        .map((c) => {
          const last = [...cues].reverse().find((x) => x.group === c.group) ?? c;
          return { startSec: start + c.startSec, endSec: start + last.endSec, label: c.text };
        }),
    [cues, start],
  );

  // Removal preview (debounced so dragging stays fluid).
  useEffect(() => {
    if (!clip) return;
    if (!cleanupSettings?.removeDeadAir && !cleanupSettings?.removeFillers) {
      setRemovals([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const { buildCleanupPlan } = await import("@/lib/video/cleanup-plan");
        const { plan } = await buildCleanupPlan({
          segments: segments ?? [],
          clipStart: start,
          clipEnd: end,
          settings: cleanupSettings,
        });
        if (cancelled) return;
        if (plan.isIdentity) return setRemovals([]);
        const out: TimelineRemovalBand[] = [];
        let cursor = start;
        for (const s of plan.segments) {
          if (s.sourceStartSec > cursor + 0.05)
            out.push({ startSec: cursor, endSec: s.sourceStartSec, reason: "silence" });
          cursor = s.sourceEndSec;
        }
        if (end > cursor + 0.05) out.push({ startSec: cursor, endSec: end, reason: "silence" });
        setRemovals(out);
      } catch {
        if (!cancelled) setRemovals([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [clip?.id, start, end, segments, cleanupSettings]);

  const seek = (t: number) => {
    const clamped = Math.min(end, Math.max(start, t));
    const el = videoRef.current;
    if (el) el.currentTime = clamped;
    setCurrent(clamped);
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < start || el.currentTime >= end - 0.05) el.currentTime = start;
      void el.play().catch(() => undefined);
    } else el.pause();
  };

  const restart = () => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = start;
    setCurrent(start);
    void el.play().catch(() => undefined);
  };

  const pushHistory = () => {
    setUndoStack((u) => [...u.slice(-29), { title, startSec: start, endSec: end }]);
    setRedoStack([]);
  };
  const apply = (s: Snapshot) => {
    setTitle(s.title);
    setStart(s.startSec);
    setEnd(s.endSec);
  };
  const undo = () => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setRedoStack((r) => [...r, { title, startSec: start, endSec: end }]);
    setUndoStack((u) => u.slice(0, -1));
    apply(prev);
  };
  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setUndoStack((u) => [...u, { title, startSec: start, endSec: end }]);
    setRedoStack((r) => r.slice(0, -1));
    apply(next);
  };
  const resetDetected = () => {
    const d = detectedRef.current;
    if (!d) return;
    pushHistory();
    apply(d);
    seek(d.startSec);
  };

  const setStartClamped = (v: number) =>
    setStart(Math.round(Math.max(0, Math.min(v, end - 0.1)) * 10) / 10);
  const setEndClamped = (v: number) =>
    setEnd(Math.round(Math.min(limit, Math.max(v, start + 0.1)) * 10) / 10);

  // Zoomed timeline window around the clip so movement is visible.
  const total = Number.isFinite(limit) ? limit : Math.max(end + 30, 1);
  const pad = Math.max(10, duration * 0.5);
  const viewStart = Math.max(0, start - pad);
  const viewEnd = Math.min(total, end + pad);

  const usingSmart = out.reframe === "auto" && faceX !== null;
  const objectPosition = `${Math.round((manualX ?? (usingSmart ? faceX! : 0.5)) * 100)}% 50%`;

  const clipText = () =>
    (segments ?? [])
      .filter((sg) => sg.endSec > start && sg.startSec < end)
      .map((sg) => sg.text.trim())
      .join(" ");

  const generate = async (kind: MetadataKind) => {
    setGenBusy(kind);
    try {
      const [{ generateClipMetadata }, ollama] = await Promise.all([
        import("@/lib/clip-metadata"),
        import("@/lib/detection/ollama-ranking-provider"),
      ]);
      const r = await generateClipMetadata(kind, clipText() || clip?.transcriptText || "", {
        ollama: ollama.loadOllamaSettings(),
        generate: (b, m, p) => ollama.ollamaGenerate(b, m, p, 60_000),
      });
      if (!r.value) throw new Error("empty");
      if (kind === "title") setTitle(r.value);
      else if (kind === "description") setDescription(r.value);
      else setHashtags(r.value);
      if (r.warning) toast.message(r.warning);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message.includes("transcript")
          ? e.message
          : "AI suggestions are unavailable right now. You can enter it manually.",
      );
    } finally {
      setGenBusy(null);
    }
  };

  /** Capture the current preview frame (with framing + optional text) as the thumbnail. */
  const captureThumbnail = async () => {
    const el = videoRef.current;
    if (!el || !el.videoWidth) {
      toast.error("Thumbnail generation failed. Load the video and choose a frame first.");
      return;
    }
    try {
      const { drawThumbnailFrame } = await import("@/lib/video/thumbnail-frame");
      const url = drawThumbnailFrame(el, {
        format: out.format,
        x: manualX ?? (usingSmart ? faceX! : 0.5),
        flip,
        text: thumbText,
      });
      if (!url) throw new Error("no canvas");
      onThumbnail?.(url);
      toast.success("Thumbnail set from this frame");
    } catch {
      toast.error("Thumbnail generation failed. You can choose a frame manually.");
    }
  };
  const highlightOn = caps.highlightWord && cue?.activeWordIndex != null && cue.words.length > 0;

  return (
    <Dialog open={clip !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clip editor</DialogTitle>
          <DialogDescription>
            Trim, customize captions, format and framing, add a title, then export.
          </DialogDescription>
        </DialogHeader>

        {!clip ? null : (
          <div className="space-y-4">
            <div className={`mx-auto w-full ${PREVIEW_WIDTH[out.format]}`}>
              <div
                style={{ aspectRatio: FORMAT_META[out.format].css }}
                className="relative overflow-hidden rounded-xl border border-border bg-background">
                {videoUrl ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    muted={muted}
                    playsInline
                    preload="auto"
                    className="size-full object-cover"
                    style={{ objectPosition, transform: flip ? "scaleX(-1)" : undefined }}
                    onClick={togglePlay}
                    onPlay={onVideoPlay}
                    onPause={onVideoPause}
                    onEnded={onVideoPause}
                    onLoadedMetadata={onLoaded}
                    onSeeked={(e) => !playing && setCurrent(e.currentTarget.currentTime)}
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

                {videoUrl && cue ? (
                  <div
                    className={`pointer-events-none absolute inset-x-3 text-center ${POSITION_CLASS[caps.position]}`}
                  >
                    <span
                      className={`inline-block font-display font-extrabold leading-tight text-foreground [text-shadow:0_0_3px_hsl(0_0%_0%),0_2px_4px_hsl(0_0%_0%)] ${SIZE_CLASS[caps.size]} ${preset.uppercase ? "uppercase" : ""}`}
                    >
                      {cue.words.length
                        ? cue.words.map((w, i) => (
                            <span
                              key={i}
                              className={
                                highlightOn && i === cue.activeWordIndex ? "text-accent" : undefined
                              }
                            >
                              {w.text.trim()}{" "}
                            </span>
                          ))
                        : cue.text}
                    </span>
                  </div>
                ) : null}

                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {FORMAT_META[out.format].ratio}
                  </Badge>
                  <Badge variant="outline" className="bg-background/60 text-[10px]">
                    {reframeLoading ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> Finding face…
                      </span>
                    ) : manualX !== null ? (
                      `Manual · ${REFRAME_LABELS[out.reframe]}`
                    ) : usingSmart ? (
                      "Smart Reframe"
                    ) : (
                      "Center Crop"
                    )}
                  </Badge>
                </div>
              </div>
            </div>

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
            <input
              type="range"
              aria-label="Seek within clip"
              min={start}
              max={end}
              step={0.05}
              value={Math.min(end, Math.max(start, current))}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full accent-primary"
              disabled={!videoUrl}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="clip-title">Title</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={genBusy !== null}
                  onClick={() => void generate("title")}
                >
                  {genBusy === "title" ? <Loader2 className="size-3 animate-spin" /> : null}
                  Generate Title
                </Button>
              </div>
              <Input id="clip-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                Suggested title — edit it freely. Uses Ollama if turned on, otherwise a local
                suggestion from the transcript.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="clip-start">Start (sec)</Label>
                <Input
                  id="clip-start"
                  type="number"
                  step="0.1"
                  min={0}
                  value={start}
                  onFocus={pushHistory}
                  onChange={(e) => setStartClamped(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clip-end">End (sec)</Label>
                <Input
                  id="clip-end"
                  type="number"
                  step="0.1"
                  min={0}
                  value={end}
                  onFocus={pushHistory}
                  onChange={(e) => setEndClamped(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Duration</Label>
                <Input readOnly value={`${Math.round(duration * 10) / 10}s`} />
              </div>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Captions (preview + export)</p>
                <Switch
                  checked={caps.enabled}
                  onCheckedChange={(v) => onCaptionSettingsChange?.({ enabled: v })}
                  disabled={!onCaptionSettingsChange}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Style">
                  <Select
                    value={caps.style}
                    onValueChange={(v) => onCaptionSettingsChange?.({ style: v as CaptionStyleId })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CAPTION_PRESETS) as CaptionStyleId[]).map((id) => (
                        <SelectItem key={id} value={id}>
                          {CAPTION_PRESETS[id].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Position">
                  <Select
                    value={caps.position}
                    onValueChange={(v) =>
                      onCaptionSettingsChange?.({ position: v as CaptionPosition })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Top</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="lower">Lower</SelectItem>
                      <SelectItem value="bottom">Bottom</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Size">
                  <Select
                    value={caps.size}
                    onValueChange={(v) => onCaptionSettingsChange?.({ size: v as CaptionSize })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="large">Large</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {caps.enabled && !cues.length ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No transcript lines fall inside this clip, so there are no captions to show.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm font-medium">Format & reframe</p>
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  {(Object.keys(FORMAT_META) as AspectFormat[]).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={out.format === f ? "default" : "outline"}
                      disabled={!onOutputSettingsChange}
                      onClick={() => onOutputSettingsChange?.({ format: f })}
                    >
                      {FORMAT_META[f].ratio}
                    </Button>
                  ))}
                </div>
                <Select
                  value={
                    EXPORT_PRESETS.find(
                      (p) => p.format === out.format && p.resolution === out.resolution,
                    )?.id
                  }
                  onValueChange={(id) => {
                    const p = EXPORT_PRESETS.find((x) => x.id === id);
                    if (p) onOutputSettingsChange?.({ format: p.format, resolution: p.resolution });
                  }}
                >
                  <SelectTrigger className="mb-2">
                    <SelectValue placeholder="Export preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPORT_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={out.reframe}
                  onValueChange={(v) => onOutputSettingsChange?.({ reframe: v as ReframeChoice })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REFRAME_LABELS) as ReframeChoice[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {REFRAME_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {out.reframe === "custom" ? (
                  <input
                    type="range"
                    aria-label="Horizontal position"
                    min={0}
                    max={1}
                    step={0.01}
                    value={out.manualX}
                    onChange={(e) => onOutputSettingsChange?.({ manualX: Number(e.target.value) })}
                    className="mt-2 w-full accent-primary"
                  />
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Auto follows the face (center if none is found). Manual choices only change the
                  final framing; preview and export match.
                </p>
              </div>
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Dead-air cleanup</p>
                  <Switch
                    checked={!!cleanupSettings?.removeDeadAir}
                    onCheckedChange={(v) => onCleanupSettingsChange?.({ removeDeadAir: v })}
                    disabled={!onCleanupSettingsChange}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Filler words</p>
                  <Switch
                    checked={!!cleanupSettings?.removeFillers}
                    onCheckedChange={(v) => onCleanupSettingsChange?.({ removeFillers: v })}
                    disabled={!onCleanupSettingsChange}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <FlipHorizontal2 className="size-4" /> Flip video
                  </p>
                  <Switch
                    checked={flip}
                    onCheckedChange={(v) => onFlipChange?.(v)}
                    disabled={!onFlipChange}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Mirrors the picture left-to-right so your Short isn't identical to other uploads.
                  Captions stay readable.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Music className="size-4" /> Background music
                </p>
                <input
                  ref={musicPickRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onMusicChange?.({ file: f, volume: music?.volume ?? 0.2 });
                    e.target.value = "";
                  }}
                />
                {music ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs">{music.file.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove music"
                        onClick={() => onMusicChange?.(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Volume
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={music.volume}
                        onChange={(e) =>
                          onMusicChange?.({ ...music, volume: Number(e.target.value) })
                        }
                        className="flex-1 accent-primary"
                      />
                      {Math.round(music.volume * 100)}%
                    </label>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => musicPickRef.current?.click()}
                    disabled={!onMusicChange}
                  >
                    Add music
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Loops under the voice and fades out at the end. Use music you have rights to.
                </p>
                {musicUrl ? <audio ref={musicRef} src={musicUrl} loop preload="auto" /> : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="clip-desc" className="text-sm">
                    Description
                  </Label>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={genBusy !== null}
                    onClick={() => void generate("description")}
                  >
                    {genBusy === "description" ? <Loader2 className="size-3 animate-spin" /> : null}
                    Generate Description
                  </Button>
                </div>
                <Textarea
                  id="clip-desc"
                  rows={3}
                  maxLength={400}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="clip-tags" className="text-sm">
                    Suggested hashtags
                  </Label>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={genBusy !== null}
                      onClick={() => void generate("hashtags")}
                    >
                      {genBusy === "hashtags" ? <Loader2 className="size-3 animate-spin" /> : null}
                      Suggest
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!hashtags.trim()}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(hashtags.trim())
                          .then(() => toast.success("Hashtags copied"))
                          .catch(() => toast.error("Couldn't copy — select and copy them manually."))
                      }
                    >
                      Copy hashtags
                    </Button>
                  </div>
                </div>
                <Input
                  id="clip-tags"
                  value={hashtags}
                  placeholder="#topic #another"
                  onChange={(e) => setHashtags(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Suggestions only — hashtags don't guarantee reach.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">Thumbnail</p>
                {clip.thumbnailUrl ? (
                  <img
                    src={clip.thumbnailUrl}
                    alt="Clip thumbnail"
                    className="mx-auto max-h-40 rounded border border-border object-contain"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">No thumbnail yet.</p>
                )}
                <Input
                  placeholder="Thumbnail text (optional)"
                  maxLength={60}
                  value={thumbText}
                  onChange={(e) => setThumbText(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!videoUrl || !onThumbnail}
                    onClick={() => void captureThumbnail()}
                  >
                    Use current frame
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!hasVideoFile || !onRegenerateThumbnail}
                    onClick={() => onRegenerateThumbnail?.(start, end)}
                  >
                    Regenerate automatically
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Pause the preview on the frame you want, add text if you like, then click Use
                  current frame.
                </p>
              </div>
            </div>

            <ClipTimeline
              durationSec={total}
              viewStartSec={viewStart}
              viewEndSec={viewEnd}
              startSec={start}
              endSec={end}
              playheadSec={current}
              captions={captionBands}
              removals={removals}
              onSeek={seek}
              onChangeRange={(s, e) => {
                setStart(Math.round(s * 10) / 10);
                setEnd(Math.round(e * 10) / 10);
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={!undoStack.length} onClick={undo}>
                Undo
              </Button>
              <Button size="sm" variant="ghost" disabled={!redoStack.length} onClick={redo}>
                Redo
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
                <Info
                  label="Original range"
                  value={`${formatTimecode(start)} – ${formatTimecode(end)}`}
                />
                {typeof clip.score === "number" ? (
                  <Info label="Rule Score" value={String(clip.score)} />
                ) : null}
                {typeof clip.engagementPotential === "number" ? (
                  <Info label="Engagement" value={String(clip.engagementPotential)} />
                ) : null}
                <Info label="Captions" value={caps.enabled ? "On" : "Off"} />
                <Info label="Format" value={FORMAT_META[out.format].ratio} />
                <Info
                  label="Reframe"
                  value={manualX !== null ? "Manual" : usingSmart ? "Auto (face)" : "Center"}
                />
                <Info label="Flip" value={flip ? "On" : "Off"} />
                <Info label="Music" value={music ? "On" : "Off"} />
                <Info
                  label="Cleanup"
                  value={
                    cleanupSettings?.removeDeadAir || cleanupSettings?.removeFillers ? "On" : "Off"
                  }
                />
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
              {clip.reason ? <p className="mt-2 text-muted-foreground">{clip.reason}</p> : null}
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
                  const t = title.trim() || clip.title;
                  onSave({ title: t, startSec: start, endSec: end, description, hashtags });
                  onExport({ ...clip, title: t, startSec: start, endSec: end });
                }}
              >
                Save & Export Short
              </Button>
            ) : null}
            <Button
              disabled={error !== null || !title.trim()}
              onClick={() =>
                onSave({ title: title.trim(), startSec: start, endSec: end, description, hashtags })
              }
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
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
