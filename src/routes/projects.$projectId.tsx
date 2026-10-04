import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileVideo, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ClipCard } from "@/components/clips/ClipCard";
import { BestMomentsPanel } from "@/components/clips/BestMomentsPanel";
import { AudioEnhancePanel } from "@/components/clips/AudioEnhancePanel";
import {
  loadAudioEnhanceSettings,
  saveAudioEnhanceSettings,
  type AudioEnhanceSettings,
} from "@/lib/video/audio-enhance";
import { OllamaSettingsPanel } from "@/components/detection/OllamaSettingsPanel";
import { selectBestMoments } from "@/lib/detection/best-moments";
import { buildHighlightReel } from "@/lib/detection/highlight-reel";
import { BatchExportPanel, type BatchQueueItem } from "@/components/clips/BatchExportPanel";
import { ClipEditDialog } from "@/components/clips/ClipEditDialog";
import { clipToSrt, downloadText, segmentsInRange } from "@/lib/clip-export";
import type { ClipCandidate } from "@/lib/detection/types";
import { clipFileName } from "@/lib/video/clip-range";
// thumbnail generation is dynamic-imported to keep initial bundle light
import { useCaptionSettings } from "@/lib/video/caption-settings";
import { CaptionSettingsPanel } from "@/components/clips/CaptionSettingsPanel";
import { useCleanupSettings } from "@/lib/video/cleanup-settings";
import { CleanupSettingsPanel } from "@/components/clips/CleanupSettingsPanel";
import { AiSettingsPanel } from "@/components/detection/AiSettingsPanel";
import { DetectionModeSelector } from "@/components/detection/DetectionModeSelector";
import { RuleSettingsPanel } from "@/components/detection/RuleSettingsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MODE_META, PIPELINE_STAGES } from "@/lib/detection/defaults";
import { formatDuration, formatTimecode } from "@/lib/format";
import { deleteProject, updateProject, useProject } from "@/lib/projects";
import { runDetection } from "@/lib/detection/detection-pipeline";
import {
  TranscriptionPanel,
  type TranscriptState,
} from "@/components/transcription/TranscriptionPanel";
import { TranscriptViewer } from "@/components/transcription/TranscriptViewer";
import {
  getProjectFile,
  setProjectFile,
  subscribeProjectFiles,
} from "@/lib/transcription/session-files";
import {
  getTranscriptionProvider,
  transcribeVideo,
  TranscriptionError,
  type TranscriptionProgress,
} from "@/lib/transcription/transcription-provider";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project workspace — ClipPilot" },
      {
        name: "description",
        content: "Preview your video, choose a detection mode, and tune how clips are found.",
      },
      { property: "og:title", content: "Project workspace — ClipPilot" },
      {
        property: "og:description",
        content: "Tune AI and rule-based clip detection for a ClipPilot project.",
      },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { projectId } = Route.useParams();
  const { project, ready } = useProject(projectId);
  const provider = getTranscriptionProvider();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | undefined>(undefined);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [bestMomentsMax, setBestMomentsMax] = useState(5);

  useEffect(() => {
    const sync = () => setFile(getProjectFile(projectId));
    sync();
    const a = provider.availability();
    setUnavailable(a.status === "unavailable" ? a.reason : undefined);
    return subscribeProjectFiles(sync);
  }, [projectId, provider]);

  useEffect(() => {
    if (!file) return setVideoUrl(null);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Stop any running transcription when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stopAtRef = useRef<(() => void) | null>(null);
  const previewClipRef = useRef<((c: ClipCandidate) => void) | null>(null);
  const [editing, setEditing] = useState<ClipCandidate | null>(null);
  const [renderingClipId, setRenderingClipId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchAbortRef = useRef<AbortController | null>(null);
  const batchCancelRemainingRef = useRef(false);
  const [renderState, setRenderState] = useState<{ label: string; progress: number | null }>({
    label: "Preparing clip...",
    progress: null,
  });
  const renderAbortRef = useRef<AbortController | null>(null);
  const [captionSettings, updateCaptionSettings] = useCaptionSettings();
  const [audioEnhance, setAudioEnhance] = useState<AudioEnhanceSettings>(() =>
    loadAudioEnhanceSettings(),
  );
  const updateAudioEnhance = (patch: Partial<AudioEnhanceSettings>) =>
    setAudioEnhance(saveAudioEnhanceSettings(patch));
  const [cleanupSettings, updateCleanupSettings] = useCleanupSettings();
  useEffect(() => () => renderAbortRef.current?.abort(), []);

  const seek = useCallback((sec: number) => {
    const el = videoRef.current;
    if (!el) return;
    stopAtRef.current?.();
    el.currentTime = sec;
    void el.play().catch(() => undefined);
  }, []);

  /** Plays just the clip's range, then pauses at its end. */
  const previewClip = useCallback(
    (clip: ClipCandidate) => {
      const el = videoRef.current;
      if (!el) {
        if (getProjectFile(projectId)) {
          // File exists but the player hasn't mounted yet — retry shortly.
          setTimeout(() => {
            if (videoRef.current) previewClipRef.current?.(clip);
            else toast.error("The video is still loading. Try again in a moment.");
          }, 300);
        } else {
          toast.error("Select the video file above to preview clips.");
        }
        return;
      }
      stopAtRef.current?.();
      const onTime = () => {
        if (el.currentTime >= clip.endSec) {
          el.pause();
          cleanup();
        }
      };
      const cleanup = () => {
        el.removeEventListener("timeupdate", onTime);
        el.removeEventListener("seeking", onSeekAway);
        stopAtRef.current = null;
      };
      const onSeekAway = () => {
        if (el.currentTime < clip.startSec - 0.5 || el.currentTime > clip.endSec) cleanup();
      };
      el.currentTime = clip.startSec;
      el.addEventListener("timeupdate", onTime);
      el.addEventListener("seeking", onSeekAway);
      stopAtRef.current = cleanup;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      void el.play().catch(() => undefined);
    },
    [projectId],
  );
  previewClipRef.current = previewClip;

  if (!ready) {
    return (
      <AppShell>
        <div className="panel h-64 animate-pulse" />
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="panel px-6 py-16 text-center">
          <h1 className="text-lg font-semibold">Project not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed from this device.
          </p>
          <Button asChild className="mt-5">
            <Link to="/projects">Back to projects</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const duration = project.video?.durationSec ?? 0;
  const hasTranscript = (project.transcript?.segments.length ?? 0) > 0;
  const transcriptState: TranscriptState = transcribing
    ? "TRANSCRIBING"
    : error
      ? "TRANSCRIPTION_ERROR"
      : hasTranscript
        ? "TRANSCRIBED"
        : "NO_TRANSCRIPT";
  const canAnalyze =
    !!project.video && hasTranscript && !transcribing && !analyzing;
  const analyzeHint = !project.video
    ? "Add a video to this project first."
    : transcribing
      ? "Wait for transcription to finish."
      : analyzing
        ? "Analyzing transcript..."
        : !hasTranscript
          ? "Transcribe video to analyze clips."
          : project.mode === "ai"
            ? "Rank clips with local Engagement Potential (not virality). Hard filters still apply."
            : project.mode === "hybrid"
              ? "Hard rule filters first, then Engagement Potential ranking."
              : "Find clips in the transcript using your rules.";

  const pickFile = (f: File) => {
    if (
      project.video &&
      (f.name !== project.video.fileName || f.size !== project.video.sizeBytes)
    ) {
      toast.warning("This file doesn't match the project's original video.");
    }
    setProjectFile(project.id, f);
  };

  const transcribe = async () => {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setTranscribing(true);
    setError(null);
    setProgress(null);
    try {
      const { result, warnings } = await transcribeVideo(file, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      updateProject(project.id, {
        transcript: result,
        hasTranscript: true,
        clips: [],
        lastAnalysis: undefined,
      });
      toast.success("Transcription complete");
      if (warnings.length) console.warn("[transcript]", warnings);
    } catch (err) {
      if (err instanceof TranscriptionError && err.code === "cancelled") {
        toast("Transcription cancelled");
      } else {
        console.error(err);
        setError(
          err instanceof TranscriptionError
            ? err.message
            : "Transcription failed. Please try again.",
        );
      }
    } finally {
      abortRef.current = null;
      setTranscribing(false);
      setProgress(null);
    }
  };

  const analyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await runAnalysis();
    } finally {
      setAnalyzing(false);
    }
  };

  const segments = project.transcript?.segments ?? [];
  const bestMoments = selectBestMoments(
    project.clips.filter((c) => c.status !== "rejected"),
    { maxRecommendations: bestMomentsMax },
  );


  const exportHighlightReel = async () => {
    if (!file) {
      toast.error("Select the original video file before exporting.");
      return;
    }
    if (!project.clips.length) {
      toast.error("Analyze the video first so there are moments to include.");
      return;
    }
    if (renderingClipId) {
      toast.error("Wait for the current export to finish.");
      return;
    }
    const reel = buildHighlightReel(project.clips, {
      maxMoments: 5,
      targetDurationSec: 45,
      maxDurationSec: 90,
    });
    if (!reel || !reel.plan.segments.length) {
      toast.error("Not enough distinct moments to build a highlight reel.");
      return;
    }
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setRenderingClipId("highlight-reel");
    setRenderState({ label: "Building highlight reel...", progress: null });
    toast.message("Highlight reel started", {
      description: reel.message + " — keep this tab open. Usually 2–5 min for ~45s of highlights.",
    });
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      let tick = 0;
      heartbeat = setInterval(() => {
        tick += 1;
        // Fake slow crawl 0→8% so you know the tab is alive while FFmpeg loads/encodes
        setRenderState((s) => {
          if (s.progress != null && s.progress >= 0.08) return s;
          return {
            label: s.label.includes("Encoding") || s.label.includes("Rendering")
              ? `Still encoding… (${tick * 5}s elapsed, keep tab open)`
              : s.label,
            progress: Math.min(0.08, (tick / 40) * 0.08),
          };
        });
      }, 5000);
      const { renderClip, downloadBlob } = await import("@/lib/video/local-video-renderer");
      const { buildCaptionCues, buildDynamicAss } = await import("@/lib/video/dynamic-captions");
      const { rebaseWords } = await import("@/lib/video/edit-timeline");
      const { wordsInClip } = await import("@/lib/video/filler-detect");
      const segs = project.transcript?.segments ?? [];
      const first = reel.plan.segments[0]!;
      const last = reel.plan.segments[reel.plan.segments.length - 1]!;

      // Captions: collect words from each moment, rebase onto the stitched timeline.
      const allWords = reel.moments.flatMap((m) =>
        wordsInClip(segs, m.startSec, m.endSec),
      );
      const rebased = rebaseWords(reel.plan, allWords);
      let captionAss: string | undefined;
      if (captionSettings.enabled && rebased.length) {
        const fakeSegs = [
          {
            id: "highlight-reel",
            startSec: 0,
            endSec: reel.plan.outputDurationSec,
            text: rebased.map((w) => w.text).join(" "),
            words: rebased,
          },
        ];
        const cues = buildCaptionCues(fakeSegs, 0, reel.plan.outputDurationSec, captionSettings);
        captionAss = cues.length ? buildDynamicAss(cues, captionSettings) : undefined;
      }

      setRenderState({ label: "Rendering highlight reel (encoding)…", progress: 0 });
      toast.message("Encoding highlight reel", { description: "Stitching moments — please wait." });
      const name = `${(project.name || "ClipPilot").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 30)}_Highlight_Reel.mp4`;
      const result = await renderClip({
        file,
        startSec: first.sourceStartSec,
        endSec: last.sourceEndSec,
        sourceDurationSec: project.video?.durationSec,
        outputName: name,
        signal: controller.signal,
        vertical: true,
        // Center crop only — smart reframe + multi-cut is too heavy in-browser.
        reframe: { source: "center", points: [{ timeSec: 0, x: 0.5, confidence: 0 }] },
        editPlan: reel.plan,
        captionAss,
        // Audio enhance off for reel reliability
        onProgress: (p) =>
          setRenderState(
            p.stage === "loading"
              ? { label: "Loading video engine...", progress: null }
              : p.stage === "finalizing"
                ? { label: "Finalizing highlight reel...", progress: 1 }
                : {
                    label: `Highlight reel... ${Math.round((p.progress ?? 0) * 100)}%`,
                    progress: p.progress ?? 0,
                  },
          ),
      });
      downloadBlob(result.file, name);
      toast.success("Highlight reel exported", {
        description: `${reel.message} · ${name}`,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) toast.message("Highlight reel cancelled");
      else {
        const e = err as { message?: string; code?: string };
        toast.error(e?.message ?? "Highlight reel export failed.");
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      setRenderingClipId(null);
      setRenderState({ label: "", progress: null });
      renderAbortRef.current = null;
    }
  };

  const rejectClip = (clip: ClipCandidate) => {
    const before = project.clips;
    updateProject(project.id, { clips: before.filter((c) => c.id !== clip.id) });
    toast("Clip removed", {
      action: { label: "Undo", onClick: () => updateProject(project.id, { clips: before }) },
    });
  };

  const saveClip = (changes: { title: string; startSec: number; endSec: number }) => {
    if (!editing) return;
    const inside = segmentsInRange(segments, changes.startSec, changes.endSec);
    updateProject(project.id, {
      clips: project.clips.map((c) =>
        c.id === editing.id
          ? {
              ...c,
              ...changes,
              durationSec: Math.round((changes.endSec - changes.startSec) * 10) / 10,
              transcriptText: inside.map((x) => x.text.trim()).join(" "),
              segmentIds: inside.map((x) => x.id),
            }
          : c,
      ),
    });
    setEditing(null);
    toast.success("Clip updated");
    const f = getProjectFile(project.id);
    const clipId = editing.id;
    if (f) {
      void (async () => {
        try {
          const { generateClipThumbnail } = await import("@/lib/video/thumbnail");
          const { trackSubject } = await import("@/lib/video/subject-tracker");
          const { getProject } = await import("@/lib/projects");
          const reframe = await trackSubject(f, {
            startSec: changes.startSec,
            endSec: changes.endSec,
            sampleIntervalSec: 0.8,
          });
          const url = await generateClipThumbnail(f, {
            startSec: changes.startSec,
            endSec: changes.endSec,
            reframe,
          });
          if (!url) return;
          const latest = getProject(project.id);
          if (!latest) return;
          updateProject(project.id, {
            clips: latest.clips.map((c) =>
              c.id === clipId ? { ...c, thumbnailUrl: url } : c,
            ),
          });
        } catch (err) {
          console.warn("thumbnail refresh failed", err);
        }
      })();
    }
  };

  const exportClip = (clip: ClipCandidate) => {
    const srt = clipToSrt(clip, segments);
    if (!srt) {
      toast.error("This clip has no transcript lines to export.");
      return;
    }
    const safe = (project.name || "clip").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    downloadText(`${safe}-clip-${clip.index}.srt`, srt, "application/x-subrip");
    toast.success("Captions downloaded", {
      description: "A subtitle file with the clip's timed lines.",
    });
  };

  const exportVideo = async (clip: ClipCandidate) => {
    if (renderingClipId) return;
    const file = getProjectFile(project.id);
    if (!file) {
      toast.error("Select the original video file again before exporting this clip.");
      return;
    }
    if (
      project.video &&
      (file.name !== project.video.fileName || file.size !== project.video.sizeBytes)
    )
      toast.warning("This file doesn't match the project's original video.");
    const current = project.clips.find((c) => c.id === clip.id) ?? clip;
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setRenderingClipId(current.id);
    setRenderState({ label: "Preparing clip...", progress: null });
    try {
      const { renderClip, downloadBlob } = await import("@/lib/video/local-video-renderer");
      const { buildCaptionCues, buildDynamicAss } = await import("@/lib/video/dynamic-captions");
      const { trackSubject } = await import("@/lib/video/subject-tracker");
      const { buildCleanupPlan } = await import("@/lib/video/cleanup-plan");
      const { rebaseWords } = await import("@/lib/video/edit-timeline");
      const { wordsInClip } = await import("@/lib/video/filler-detect");
      const name = clipFileName(project.name, current.index, current.startSec, current.endSec);

      setRenderState({ label: "Analyzing pauses...", progress: null });
      const { plan, fillerCount, warnings: cleanupWarnings } = await buildCleanupPlan({
        file,
        segments,
        clipStart: current.startSec,
        clipEnd: current.endSec,
        settings: cleanupSettings,
        signal: controller.signal,
      });

      setRenderState({ label: "Tracking subject (local)...", progress: null });
      const reframe = await trackSubject(file, {
        startSec: current.startSec,
        endSec: current.endSec,
        signal: controller.signal,
        onProgress: (p) =>
          setRenderState(
            p.stage === "loading"
              ? { label: "Loading face detector...", progress: null }
              : {
                  label: `Tracking subject... ${Math.round((p.progress ?? 0) * 100)}%`,
                  progress: p.progress ?? 0,
                },
          ),
      });

      let captionAss: string | undefined;
      if (captionSettings.enabled) {
        if (!plan.isIdentity) {
          const srcWords = wordsInClip(segments, current.startSec, current.endSec);
          const rebased = rebaseWords(plan, srcWords);
          const fakeSegs = rebased.length
            ? [
                {
                  id: "cleanup",
                  startSec: 0,
                  endSec: plan.outputDurationSec,
                  text: rebased.map((w) => w.text).join(" "),
                  words: rebased,
                },
              ]
            : [];
          const cues = buildCaptionCues(fakeSegs, 0, plan.outputDurationSec, captionSettings);
          captionAss = cues.length ? buildDynamicAss(cues, captionSettings) : undefined;
        } else {
          const cues = buildCaptionCues(
            segments,
            current.startSec,
            current.endSec,
            captionSettings,
          );
          captionAss = cues.length ? buildDynamicAss(cues, captionSettings) : undefined;
        }
      }

      const result = await renderClip({
        file,
        startSec: current.startSec,
        endSec: current.endSec,
        sourceDurationSec: project.video?.durationSec,
        outputName: name,
        signal: controller.signal,
        vertical: true,
        reframe,
        editPlan: plan.isIdentity ? undefined : plan,
        captionAss,
        audioEnhance,
        onProgress: (p) =>
          setRenderState(
            p.stage === "loading"
              ? { label: "Loading video engine (first time only)...", progress: null }
              : p.stage === "finalizing"
                ? { label: "Finalizing MP4...", progress: 1 }
                : {
                    label: `Rendering 9:16 short... ${Math.round((p.progress ?? 0) * 100)}%`,
                    progress: p.progress ?? 0,
                  },
          ),
      });
      downloadBlob(result.file, name);
      const bits: string[] = [];
      bits.push(result.smartReframe ? "Smart Reframe" : "Center Crop");
      if (result.cleanupApplied) {
        const saved = Math.max(0, current.endSec - current.startSec - result.durationSec);
        bits.push(`cleanup −${saved.toFixed(1)}s`);
        if (fillerCount) bits.push(`${fillerCount} fillers`);
      }
      if (result.captionsBurned) bits.push("captions");
      toast.success(`Clip ${current.index} exported successfully`, {
        description: `${name} · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB · ${bits.join(" · ")}`,
      });
      if (result.captionWarning) toast.warning(result.captionWarning);
      if (result.cleanupWarning) toast.warning(result.cleanupWarning);
      for (const w of cleanupWarnings) {
        if (w && !result.cleanupWarning) toast.message(w);
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "cancelled") toast("Export cancelled");
      else toast.error(err.code ? (err.message ?? "Export failed.") : "Export failed.");
    } finally {
      renderAbortRef.current = null;
      setRenderingClipId(null);
    }
  };


  const toggleSelectClip = (clip: ClipCandidate) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      return next;
    });
  };

  const selectAllClips = () => {
    setSelectedClipIds(new Set(project.clips.map((c) => c.id)));
  };

  const clearClipSelection = () => setSelectedClipIds(new Set());

  const runBatchExport = async () => {
    if (batchRunning || renderingClipId) {
      toast.error("Wait for the current export to finish.");
      return;
    }
    const selected = project.clips.filter((c) => selectedClipIds.has(c.id));
    if (!selected.length) {
      toast.error("Select at least one clip.");
      return;
    }
    if (selected.length > 12) {
      toast.error("Browser limit: export at most 12 clips at a time.");
      return;
    }
    const file = getProjectFile(project.id);
    if (!file) {
      toast.error("Select the original video file again before exporting.");
      return;
    }
    batchCancelRemainingRef.current = false;
    setBatchRunning(true);
    const queue: BatchQueueItem[] = selected.map((clip) => ({
      clip,
      status: "waiting",
      progress: null,
    }));
    setBatchQueue(queue);

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i++) {
      if (batchCancelRemainingRef.current) {
        setBatchQueue((q) =>
          q.map((item, idx) =>
            idx >= i && item.status === "waiting"
              ? { ...item, status: "cancelled" }
              : item,
          ),
        );
        break;
      }
      const clip = queue[i]!.clip;
      const controller = new AbortController();
      batchAbortRef.current = controller;
      renderAbortRef.current = controller;
      setRenderingClipId(clip.id);
      setBatchQueue((q) =>
        q.map((item, idx) =>
          idx === i ? { ...item, status: "rendering", label: "Preparing…", progress: 0 } : item,
        ),
      );
      try {
        // Reuse single-clip export by calling exportVideo logic inline via dynamic import path
        await exportVideoForBatch(clip, file, controller, (label, progress) => {
          setRenderState({ label, progress });
          setBatchQueue((q) =>
            q.map((item, idx) =>
              idx === i ? { ...item, status: "rendering", label, progress } : item,
            ),
          );
        });
        completed += 1;
        setBatchQueue((q) =>
          q.map((item, idx) =>
            idx === i ? { ...item, status: "done", progress: 1, label: "Done" } : item,
          ),
        );
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code === "cancelled" || controller.signal.aborted) {
          setBatchQueue((q) =>
            q.map((item, idx) =>
              idx === i ? { ...item, status: "cancelled", label: "Cancelled" } : item,
            ),
          );
          if (batchCancelRemainingRef.current) {
            setBatchQueue((q) =>
              q.map((item, idx) =>
                idx > i && item.status === "waiting"
                  ? { ...item, status: "cancelled" }
                  : item,
              ),
            );
            break;
          }
        } else {
          failed += 1;
          setBatchQueue((q) =>
            q.map((item, idx) =>
              idx === i
                ? {
                    ...item,
                    status: "failed",
                    error: err.message ?? "Export failed",
                    label: "Failed",
                  }
                : item,
            ),
          );
        }
      } finally {
        batchAbortRef.current = null;
        renderAbortRef.current = null;
        setRenderingClipId(null);
        setRenderState({ label: "", progress: null });
      }
    }

    setBatchRunning(false);
    toast.message(`Batch finished · ${completed} done · ${failed} failed`);
  };

  /** Single-clip render used by batch (same pipeline as Export Short). */
  const exportVideoForBatch = async (
    clip: ClipCandidate,
    file: File,
    controller: AbortController,
    onProg: (label: string, progress: number | null) => void,
  ) => {
    const current = project.clips.find((c) => c.id === clip.id) ?? clip;
    const { renderClip, downloadBlob } = await import("@/lib/video/local-video-renderer");
    const { buildCaptionCues, buildDynamicAss } = await import("@/lib/video/dynamic-captions");
    const { trackSubject } = await import("@/lib/video/subject-tracker");
    const { buildCleanupPlan } = await import("@/lib/video/cleanup-plan");
    const { rebaseWords } = await import("@/lib/video/edit-timeline");
    const { wordsInClip } = await import("@/lib/video/filler-detect");
    const name = `ClipPilot_clip_${String(current.index).padStart(2, "0")}.mp4`;

    onProg("Analyzing pauses…", null);
    const { plan } = await buildCleanupPlan({
      file,
      segments,
      clipStart: current.startSec,
      clipEnd: current.endSec,
      settings: cleanupSettings,
      signal: controller.signal,
    });

    onProg("Tracking subject…", null);
    const reframe = await trackSubject(file, {
      startSec: current.startSec,
      endSec: current.endSec,
      signal: controller.signal,
    });

    let captionAss: string | undefined;
    if (captionSettings.enabled) {
      if (!plan.isIdentity) {
        const srcWords = wordsInClip(segments, current.startSec, current.endSec);
        const rebased = rebaseWords(plan, srcWords);
        const fakeSegs = rebased.length
          ? [
              {
                id: "cleanup",
                startSec: 0,
                endSec: plan.outputDurationSec,
                text: rebased.map((w) => w.text).join(" "),
                words: rebased,
              },
            ]
          : [];
        const cues = buildCaptionCues(fakeSegs, 0, plan.outputDurationSec, captionSettings);
        captionAss = cues.length ? buildDynamicAss(cues, captionSettings) : undefined;
      } else {
        const cues = buildCaptionCues(
          segments,
          current.startSec,
          current.endSec,
          captionSettings,
        );
        captionAss = cues.length ? buildDynamicAss(cues, captionSettings) : undefined;
      }
    }

    const result = await renderClip({
      file,
      startSec: current.startSec,
      endSec: current.endSec,
      sourceDurationSec: project.video?.durationSec,
      outputName: name,
      signal: controller.signal,
      vertical: true,
      reframe,
      editPlan: plan.isIdentity ? undefined : plan,
      captionAss,
      audioEnhance,
      onProgress: (p) =>
        onProg(
          p.stage === "loading"
            ? "Loading video engine…"
            : p.stage === "finalizing"
              ? "Finalizing…"
              : `Rendering… ${Math.round((p.progress ?? 0) * 100)}%`,
          p.progress ?? null,
        ),
    });
    downloadBlob(result.file, name);
  };

  const cancelBatchCurrent = () => {
    batchAbortRef.current?.abort();
    renderAbortRef.current?.abort();
  };
  const cancelBatchRemaining = () => {
    batchCancelRemainingRef.current = true;
    batchAbortRef.current?.abort();
  };
  const cancelBatchAll = () => {
    batchCancelRemainingRef.current = true;
    batchAbortRef.current?.abort();
    renderAbortRef.current?.abort();
  };


  const runAnalysis = async () => {
    try {
      const { setRankingProvider } = await import("@/lib/detection/ranking-provider");
      const { resolveRankingProvider } = await import("@/lib/detection/ollama-ranking-provider");
      setRankingProvider(resolveRankingProvider());
    } catch (e) {
      console.warn("ranking provider setup", e);
    }
    const run = await runDetection(project.transcript, project.rules, {
      mode: project.mode,
      projectId: project.id,
      ai: project.ai,
    });
    updateProject(project.id, {
      clips: run.candidates,
      status: run.status === "ok" ? "ready" : project.status,
      lastAnalysis: {
        ranAt: new Date().toISOString(),
        mode: run.mode,
        status: run.status,
        message: run.message,
        candidatesEvaluated: run.stats.candidatesEvaluated,
        passedRules: run.stats.passedRules,
        rejected: run.stats.rejected,
        candidatesFound: run.stats.candidatesFound,
        duplicates: run.stats.duplicates,
        returned: run.stats.returned,
        topFailures: run.topFailures,
        warnings: run.warnings,
      },
    });
    if (run.status === "ok") {
      toast.success(`Analysis complete — ${run.message}`);
      // Phase 7: async thumbnails (non-blocking)
      const f = getProjectFile(project.id);
      if (f && run.candidates.length) {
        void (async () => {
          try {
            const { generateClipThumbnail } = await import("@/lib/video/thumbnail");
            const { trackSubject } = await import("@/lib/video/subject-tracker");
            let clips = run.candidates;
            for (const c of run.candidates) {
              try {
                const reframe = await trackSubject(f, {
                  startSec: c.startSec,
                  endSec: c.endSec,
                  sampleIntervalSec: 0.8,
                });
                const url = await generateClipThumbnail(f, {
                  startSec: c.startSec,
                  endSec: c.endSec,
                  reframe,
                });
                if (url) {
                  const { getProject } = await import("@/lib/projects");
                  const latest = getProject(project.id);
                  if (!latest) continue;
                  updateProject(project.id, {
                    clips: latest.clips.map((x) =>
                      x.id === c.id ? { ...x, thumbnailUrl: url } : x,
                    ),
                  });
                }
              } catch (e) {
                console.warn("thumbnail failed", c.id, e);
              }
            }
          } catch (e) {
            console.warn("thumbnail batch failed", e);
          }
        })();
      }
    } else toast.error(run.message);
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects">
            <ArrowLeft className="size-4" /> Projects
          </Link>
        </Button>
        <Input
          value={project.name}
          onChange={(e) => updateProject(project.id, { name: e.target.value })}
          className="h-10 max-w-sm border-transparent bg-transparent px-2 font-display text-xl font-semibold hover:border-input focus-visible:border-input"
        />
        <Badge variant="outline" className="ml-auto">
          {MODE_META[project.mode].icon} {MODE_META[project.mode].label} mode
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            deleteProject(project.id);
            toast.success("Project deleted");
          }}
          asChild
        >
          <Link to="/projects">
            <Trash2 className="size-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="panel overflow-hidden">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="aspect-video w-full bg-muted/50"
              />
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-muted/50 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-background/70">
                  <Play className="size-5 text-muted-foreground" />
                </span>
                <p className="text-sm text-muted-foreground">
                  {project.video ? project.video.fileName : "No video added to this project"}
                </p>
                {project.video ? (
                  <>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      Videos stay on your device and aren't saved between visits. Select the file
                      again to play and transcribe it.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => pickRef.current?.click()}>
                      <FileVideo className="size-4" /> Select video file
                    </Button>
                    <input
                      ref={pickRef}
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) pickFile(f);
                      }}
                    />
                  </>
                ) : null}
              </div>
            )}

            <div className="space-y-2 border-t border-border p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Timeline</span>
                <span className="font-mono">
                  {formatTimecode(0)} / {formatDuration(duration)}
                </span>
              </div>
              <div className="film-strip h-12 rounded-lg border border-border" />
              <p className="text-xs text-muted-foreground">
                Clip markers on the timeline come later.
              </p>
            </div>
          </section>

          {project.video ? (
            <TranscriptionPanel
              state={transcriptState}
              progress={progress}
              error={error}
              segmentCount={project.transcript?.segments.length ?? 0}
              hasFile={!!file}
              unavailableReason={unavailable}
              modelName={provider.modelName}
              onTranscribe={() => void transcribe()}
              onCancel={() => abortRef.current?.abort()}
            />
          ) : null}

          {hasTranscript && project.transcript ? (
            <TranscriptViewer
              segments={project.transcript.segments}
              onSeek={videoUrl ? seek : undefined}
            />
          ) : null}

          <section className="panel p-6">
            <h2 className="font-display text-lg font-semibold">Detection mode</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              Decide who chooses your clips: AI, your rules, or both.
            </p>
            <DetectionModeSelector
              value={project.mode}
              onChange={(mode) => updateProject(project.id, { mode })}
            />
          </section>

          <section className="panel p-6">
            <h2 className="font-display text-lg font-semibold">Detection settings</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              Saved with the project and reused every time it is analysed.
            </p>
            <Tabs defaultValue={project.mode === "rules" ? "rules" : "ai"}>
              <TabsList>
                <TabsTrigger value="ai">🤖 AI settings</TabsTrigger>
                <TabsTrigger value="rules">⚙️ Rule settings</TabsTrigger>
              </TabsList>
              <TabsContent value="ai" className="pt-6">
                <OllamaSettingsPanel />
                <AiSettingsPanel
                  settings={project.ai}
                  onChange={(ai) => updateProject(project.id, { ai })}
                />
              </TabsContent>
              <TabsContent value="rules" className="pt-6">
                <RuleSettingsPanel
                  rules={project.rules}
                  onChange={(rules) => updateProject(project.id, { rules })}
                />
              </TabsContent>
            </Tabs>
          </section>

          <section className="panel space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-4">
              <Button size="lg" disabled={!canAnalyze} onClick={() => void analyze()}>
                {analyzing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {analyzing ? "Analyzing transcript..." : "Analyze video"}
              </Button>
              <p className="text-sm text-muted-foreground">{analyzeHint}</p>
            </div>
            {project.lastAnalysis ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p>{project.lastAnalysis.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Candidates checked: {project.lastAnalysis.candidatesEvaluated} · Passed hard
                  filters: {project.lastAnalysis.passedRules}
                  {project.lastAnalysis.duplicates !== undefined
                    ? ` · Removed as duplicates: ${project.lastAnalysis.duplicates}`
                    : ""}
                  {project.lastAnalysis.returned !== undefined
                    ? ` · Final clips: ${project.lastAnalysis.returned}`
                    : ""}
                </p>
                {project.lastAnalysis.topFailures.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    <li className="text-foreground/80">Most common hard-filter failures:</li>
                    {project.lastAnalysis.topFailures.map((f) => (
                      <li key={f.ruleId}>
                        {f.count} candidates failed “{f.label}”
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="mb-4 font-display text-lg font-semibold">Potential clips</h2>
            {project.clips.length > 0 ? (
              <>
                <div className="panel p-4 mb-3">
                <AudioEnhancePanel settings={audioEnhance} onChange={updateAudioEnhance} />
              </div>
              <CaptionSettingsPanel settings={captionSettings} onChange={updateCaptionSettings} />
                <CleanupSettingsPanel
                  settings={cleanupSettings}
                  onChange={updateCleanupSettings}
                />
                <BatchExportPanel
                  selectedCount={selectedClipIds.size}
                  queue={batchQueue}
                  running={batchRunning}
                  completed={batchQueue.filter((q) => q.status === "done").length}
                  failed={batchQueue.filter((q) => q.status === "failed").length}
                  totalClips={project.clips.length}
                  onStart={() => void runBatchExport()}
                  onCancelCurrent={cancelBatchCurrent}
                  onCancelRemaining={cancelBatchRemaining}
                  onCancelAll={cancelBatchAll}
                  onClearSelection={clearClipSelection}
                  onSelectAll={selectAllClips}
                />
              </>
            ) : null}
            {project.clips.length === 0 ? (
              <div className="panel px-6 py-14 text-center">
                <h3 className="font-semibold">No clips yet</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Clips will appear here after a real analysis run. Nothing is estimated or invented
                  in the meantime.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">

                
                
                {renderingClipId ? (
                  <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {renderingClipId === "highlight-reel"
                            ? "Exporting highlight reel"
                            : renderingClipId === "batch"
                              ? "Batch export"
                              : "Exporting clip"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {renderState.label || "Working…"}
                          {renderState.progress != null
                            ? ` · ${Math.round(renderState.progress * 100)}%`
                            : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          First run may sit at 0% while the video engine loads. Multi-moment reels
                          often take 2–10 minutes — the page should stay responsive.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          renderAbortRef.current?.abort();
                          toast.message("Cancelling export…");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{
                          width:
                            renderState.progress != null
                              ? `${Math.max(2, Math.round(renderState.progress * 100))}%`
                              : "15%",
                        }}
                      />
                    </div>
                  </div>
                ) : null}

<div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!file || !project.clips.length || !!renderingClipId}
                    onClick={() => void exportHighlightReel()}
                  >
                    {renderingClipId === "highlight-reel"
                      ? (renderState.label || "Exporting highlight reel…")
                      : "Export full-video highlight reel"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Stitches top moments into one clip
                  </span>
                </div>
                <BestMomentsPanel
                  recommendations={bestMoments}
                  maxShow={bestMomentsMax}
                  onMaxChange={setBestMomentsMax}
                  onPreview={(c) => setEditing(c)}
                  onEdit={(c) => setEditing(c)}
                  onCreateClip={(c) => {
                    /* already a clip from analysis — keep it */
                    toast.message(`Clip ${c.index} kept in list`);
                  }}
                  onReject={rejectClip}
                />

                {project.clips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    onPreview={setEditing}
                    onEdit={setEditing}
                    onReject={rejectClip}
                    onExport={exportClip}
                    onExportVideo={(c) => void exportVideo(c)}
                    onCancelRender={() => renderAbortRef.current?.abort()}
                    render={renderingClipId === clip.id ? renderState : undefined}
                    renderDisabled={renderingClipId !== null && renderingClipId !== clip.id}
                    captionsEnabled={captionSettings.enabled}
        captionSettings={captionSettings}
                    thumbnailPending={!clip.thumbnailUrl && !!file}
                    selected={selectedClipIds.has(clip.id)}
                    onToggleSelect={toggleSelectClip}
                  />
                ))}
              </div>
            )}
            <ClipEditDialog
              clip={editing}
              maxSec={project.video?.durationSec}
              videoUrl={videoUrl}
              hasVideoFile={!!file}
              segments={segments}
              captionsEnabled={captionSettings.enabled}
              cleanupSettings={cleanupSettings}
              onClose={() => setEditing(null)}
              onSave={saveClip}
              onExport={(c) => void exportVideo(c)}
              onRequestVideo={() => pickRef.current?.click()}
            />
          </section>
        </div>

        <aside className="space-y-6">
          <section className="panel p-6">
            <h2 className="font-display text-base font-semibold">Video</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="File" value={project.video?.fileName ?? "—"} />
              <Row label="Duration" value={formatDuration(project.video?.durationSec)} />
              <Row label="Transcript" value={hasTranscript ? "Ready" : "Not created yet"} />
              <Row label="Clips" value={String(project.clips.length)} />
            </dl>
          </section>

          <section className="panel p-6">
            <h2 className="font-display text-base font-semibold">Processing steps</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {PIPELINE_STAGES.map((stage, i) => (
                <li key={stage.key} className="flex items-center gap-3 text-muted-foreground">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs">
                    {i + 1}
                  </span>
                  {stage.label}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Every step runs on a backend worker once it is built.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
