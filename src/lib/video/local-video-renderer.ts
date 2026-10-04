import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { validateClipRange } from "./clip-range";
import {
  buildAss,
  CAPTION_FONT_URL,
  SHORT_HEIGHT,
  SHORT_WIDTH,
  type CaptionCue,
} from "./short-captions";
import {
  buildCropXExpression,
  isSmartReframe,
  rebaseReframeTrack,
  type ReframeTrack,
} from "./reframe-track";
import type { EditPlan } from "./edit-timeline";
import { buildAudioEnhanceFilter, type AudioEnhanceSettings } from "./audio-enhance";

/**
 * Local clip renderer: original video File + start/end → a real MP4.
 *
 * Runs ffmpeg.wasm (free, open source) in its own worker. The source File is
 * mounted read-only (WORKERFS), so it is never copied whole into memory and
 * never modified or uploaded.
 *
 * Vertical (9:16):
 * - Smart reframe when continuous + track provided
 * - Center crop fallback
 * - Optional editPlan concatenates kept segments (dead-air / filler cleanup)
 */

export interface VideoRenderProgress {
  stage: "loading" | "processing" | "encoding" | "finalizing";
  progress: number | null;
}

export interface VideoRenderRequest {
  file: File;
  startSec: number;
  endSec: number;
  outputName: string;
  sourceDurationSec?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((p: VideoRenderProgress) => void) | undefined;
  vertical?: boolean | undefined;
  reframe?: ReframeTrack | undefined;
  captions?: CaptionCue[] | undefined;
  captionAss?: string | undefined;
  /** Absolute source keep-list. Identity / missing → continuous path. */
  editPlan?: EditPlan | undefined;
  /** Mirror the video horizontally (before captions, so text stays readable). */
  flip?: boolean | undefined;
  /** Export-only voice enhancement. */
  audioEnhance?: AudioEnhanceSettings | undefined;
  /** Background music mixed under the voice (looped, faded out). */
  music?: { file: File; volume: number } | null | undefined;
}

let flipActive = false;

const FONT_URLS = [
  CAPTION_FONT_URL,
  "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
];
let fontCache: Promise<Uint8Array> | null = null;
/** Invalidate when the user uploads/clears a custom font. */
export function clearCaptionFontCache(): void {
  fontCache = null;
}

async function loadCaptionFont(): Promise<Uint8Array> {
  // Prefer user-uploaded font from IndexedDB (paid/local fonts).
  try {
    const { loadCustomCaptionFont } = await import("./caption-font-store");
    const custom = await loadCustomCaptionFont();
    if (custom?.data && custom.data.byteLength > 0) {
      return new Uint8Array(custom.data.slice(0));
    }
  } catch {
    /* fall through to bundled Anton */
  }
  if (!fontCache) {
    fontCache = (async () => {
      for (const url of FONT_URLS) {
        try {
          const r = await fetch(url);
          if (r.ok) return new Uint8Array(await r.arrayBuffer());
        } catch {
          /* try next */
        }
      }
      throw new Error("caption font unavailable");
    })();
    fontCache.catch(() => {
      fontCache = null;
    });
  }
  return fontCache;
}

export interface VideoRenderResult {
  blob: Blob;
  file: File;
  durationSec: number;
  mimeType: string;
  captionsBurned: boolean;
  captionWarning?: string | undefined;
  smartReframe?: boolean | undefined;
  cleanupApplied?: boolean | undefined;
  cleanupWarning?: string | undefined;
  audioWarning?: string | undefined;
}

export class RenderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unsupported-browser"
      | "invalid-range"
      | "init-failed"
      | "unsupported-format"
      | "out-of-memory"
      | "render-failed"
      | "cancelled",
  ) {
    super(message);
    this.name = "RenderError";
  }
}

const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let instance: Promise<FFmpeg> | null = null;
let busy = false;

export function isLocalRenderingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
    typeof Blob === "function"
  );
}

async function getFFmpeg(onProgress?: VideoRenderRequest["onProgress"]): Promise<FFmpeg> {
  if (!instance) {
    instance = (async () => {
      onProgress?.({ stage: "loading", progress: null });
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ff = new FFmpeg();
      await ff.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ff;
    })();
    instance.catch(() => {
      instance = null;
    });
  }
  return instance;
}

function reset(ff: FFmpeg | undefined) {
  try {
    ff?.terminate();
  } catch {
    /* already gone */
  }
  instance = null;
}

function parseTime(line: string): number | null {
  const m = line.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function buildVerticalBaseFilter(reframe?: ReframeTrack): string {
  const cropX = buildCropXExpression(
    reframe ?? { source: "center", points: [{ timeSec: 0, x: 0.5, confidence: 0 }] },
  );
  return `scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=increase,crop=${SHORT_WIDTH}:${SHORT_HEIGHT}:${cropX}:0,setsar=1${flipActive ? ",hflip" : ""}`;
}

function usesCuts(plan?: EditPlan): boolean {
  return !!plan && !plan.isIdentity && plan.segments.length >= 1;
}

/** filter_complex for N kept segments + optional ASS on the final video. */
function buildCutFilterComplex(
  plan: EditPlan,
  vertical: boolean,
  withAss: boolean,
  outputTrack?: ReframeTrack,
): string {
  const n = plan.segments.length;
  const parts: string[] = [];

  for (let i = 0; i < n; i++) {
    const s = plan.segments[i]!;
    const a = s.sourceStartSec;
    const b = s.sourceEndSec;
    parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
  }
  const ins = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("");
  // Reframe + captions run once on the concatenated output timeline, so the
  // crop expression's `t` and caption times share the same clock.
  const post: string[] = [];
  if (vertical) post.push(buildVerticalBaseFilter(outputTrack));
  if (withAss) post.push("ass=/captions.ass:fontsdir=/fonts");
  if (post.length) {
    parts.push(`${ins}concat=n=${n}:v=1:a=1[vc][outa]`);
    parts.push(`[vc]${post.join(",")}[outv]`);
  } else {
    parts.push(`${ins}concat=n=${n}:v=1:a=1[outv][outa]`);
  }
  return parts.join(";");
}

export async function renderClip(req: VideoRenderRequest): Promise<VideoRenderResult> {
  if (!isLocalRenderingSupported())
    throw new RenderError(
      "Local video rendering isn't available in this browser. Try the latest Chrome or another supported browser.",
      "unsupported-browser",
    );
  const range = validateClipRange(req.startSec, req.endSec, req.sourceDurationSec);
  if (!range.ok) throw new RenderError(range.error, "invalid-range");
  if (busy) throw new RenderError("Another clip is already rendering.", "render-failed");
  if (req.signal?.aborted) throw new RenderError("Export cancelled.", "cancelled");

  busy = true;
  flipActive = !!req.flip;
  let ff: FFmpeg | undefined;
  const dir = `/src${Date.now()}`;
  let mounted = false;
  const logTail: string[] = [];
  const onAbort = () => reset(ff);
  const cut = usesCuts(req.editPlan);
  const cutTrack = cut ? rebaseReframeTrack(req.reframe, req.editPlan!, range.startSec) : undefined;
  const smart = cut ? isSmartReframe(cutTrack) : isSmartReframe(req.reframe);
  const outDur = cut ? req.editPlan!.outputDurationSec : range.durationSec;

  try {
    try {
      ff = await getFFmpeg(req.onProgress);
    } catch (e) {
      console.error("ffmpeg load failed", e);
      throw new RenderError(
        "The video engine couldn't be loaded. Check your internet connection and try again.",
        "init-failed",
      );
    }
    if (req.signal?.aborted) throw new RenderError("Export cancelled.", "cancelled");
    req.signal?.addEventListener("abort", onAbort, { once: true });

    const { FFFSType } = await import("@ffmpeg/ffmpeg");
    await ff.createDir(dir);
    await ff.mount(FFFSType.WORKERFS, { files: [req.file] }, dir);
    mounted = true;

    const onLog = ({ message }: { message: string }) => {
      logTail.push(message);
      if (logTail.length > 40) logTail.shift();
      const t = parseTime(message);
      if (t !== null)
        req.onProgress?.({ stage: "encoding", progress: Math.min(1, t / Math.max(0.01, outDur)) });
    };
    ff.on("log", onLog);
    req.onProgress?.({ stage: "processing", progress: 0 });

    let captionsBurned = false;
    let captionWarning: string | undefined;
    let cleanupApplied = cut;
    let cleanupWarning: string | undefined;

    const cues = req.captions ?? [];
    const ass = req.captionAss ?? (cues.length ? buildAss(cues) : null);
    let assReady = false;
    if (ass && req.vertical) {
      try {
        const font = await loadCaptionFont();
        await ff.createDir("/fonts").catch(() => undefined);
        await ff.writeFile("/fonts/caption.ttf", font.slice());
        await ff.writeFile("/captions.ass", ass);
        captionsBurned = true;
        assReady = true;
      } catch (e) {
        console.warn("caption setup failed", e);
        captionWarning =
          "Caption font couldn't be loaded, so this video was exported without captions.";
        captionsBurned = false;
      }
    }

    const inputPath = `${dir}/${req.file.name}`;

    const runContinuous = async (vf: string | null) =>
      ff!.exec([
        "-ss",
        String(range.startSec),
        "-i",
        inputPath,
        "-t",
        String(range.durationSec),
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        ...(vf ? ["-vf", vf] : []),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "out.mp4",
      ]);

    const runCuts = async (withAss: boolean, track?: ReframeTrack) => {
      const fc = buildCutFilterComplex(req.editPlan!, !!req.vertical, withAss && assReady, track);
      return ff!.exec([
        "-i",
        inputPath,
        "-filter_complex",
        fc,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "out.mp4",
      ]);
    };

    let usedSmart = smart;
    let code: number;

    if (cut) {
      code = await runCuts(true, usedSmart ? cutTrack : undefined);
      if (code !== 0 && usedSmart && req.vertical && !req.signal?.aborted) {
        console.warn("smart reframe with cuts failed, retrying center crop", logTail.join("\n"));
        await ff.deleteFile("out.mp4").catch(() => undefined);
        usedSmart = false;
        req.onProgress?.({ stage: "processing", progress: 0 });
        code = await runCuts(true);
      }
      if (code !== 0 && assReady && !req.signal?.aborted) {
        console.warn("cut+caption failed, retrying cuts without captions", logTail.join("\n"));
        await ff.deleteFile("out.mp4").catch(() => undefined);
        captionsBurned = false;
        captionWarning =
          "Captions couldn't be burned in with cleanup cuts, so this video was exported without them.";
        code = await runCuts(false, usedSmart ? cutTrack : undefined);
      }
      if (code !== 0 && !req.signal?.aborted) {
        // Safety: fall back to original continuous export.
        console.warn("cleanup cuts failed, exporting original range", logTail.join("\n"));
        await ff.deleteFile("out.mp4").catch(() => undefined);
        cleanupApplied = false;
        cleanupWarning = "Cleanup cuts couldn't be applied; exported the original clip.";
        usedSmart = isSmartReframe(req.reframe);
        let vf: string | null = null;
        if (req.vertical) {
          const base = buildVerticalBaseFilter(req.reframe);
          vf = assReady ? `${base},ass=/captions.ass:fontsdir=/fonts` : base;
          captionsBurned = assReady;
        }
        req.onProgress?.({ stage: "processing", progress: 0 });
        code = await runContinuous(vf);
      }
    } else {
      let vf: string | null = null;
      if (req.vertical) {
        const base = buildVerticalBaseFilter(req.reframe);
        vf = assReady ? `${base},ass=/captions.ass:fontsdir=/fonts` : base;
      }
      code = await runContinuous(vf);
      if (code !== 0 && usedSmart && req.vertical && !req.signal?.aborted) {
        console.warn("smart reframe failed, retrying center crop", logTail.join("\n"));
        await ff.deleteFile("out.mp4").catch(() => undefined);
        const centerBase = buildVerticalBaseFilter({
          source: "center",
          points: [{ timeSec: 0, x: 0.5, confidence: 0 }],
        });
        usedSmart = false;
        const vf2 = assReady ? `${centerBase},ass=/captions.ass:fontsdir=/fonts` : centerBase;
        req.onProgress?.({ stage: "processing", progress: 0 });
        code = await runContinuous(vf2);
      }
      if (code !== 0 && captionsBurned && !req.signal?.aborted) {
        console.warn("caption burn failed, retrying without captions", logTail.join("\n"));
        await ff.deleteFile("out.mp4").catch(() => undefined);
        captionsBurned = false;
        captionWarning =
          "Captions couldn't be burned in on this browser, so this video was exported without them.";
        const baseOnly = buildVerticalBaseFilter(
          usedSmart
            ? req.reframe
            : { source: "center", points: [{ timeSec: 0, x: 0.5, confidence: 0 }] },
        );
        req.onProgress?.({ stage: "processing", progress: 0 });
        code = await runContinuous(req.vertical ? baseOnly : null);
      }
    }

    await ff.deleteFile("/captions.ass").catch(() => undefined);
    if (req.signal?.aborted) throw new RenderError("Export cancelled.", "cancelled");

    // Flip without vertical (no base filter) — apply in the post pass.
    const finalDur = cleanupApplied ? outDur : range.durationSec;
    const flipPost = !!req.flip && !req.vertical;
    const enhance = buildAudioEnhanceFilter(req.audioEnhance);
    let audioWarning: string | undefined;
    if (code === 0 && (enhance || req.music || flipPost)) {
      req.onProgress?.({ stage: "processing", progress: 0 });
      try {
        let musicPath: string | null = null;
        if (req.music) {
          musicPath = `/music_${req.music.file.name.replace(/[^\w.]/g, "_")}`;
          await ff.writeFile(musicPath, new Uint8Array(await req.music.file.arrayBuffer()));
        }
        const vol = Math.min(1, Math.max(0, req.music?.volume ?? 0.2));
        const fadeSt = Math.max(0, finalDur - 1.5);
        const voice = `[0:a]${enhance || "anull"}[voice]`;
        const fc = musicPath
          ? `${voice};[1:a]volume=${vol},afade=t=out:st=${fadeSt}:d=1.5[bg];[voice][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
          : `${voice.replace("[voice]", "[aout]")}`;
        const post = await ff.exec([
          "-i",
          "out.mp4",
          ...(musicPath ? ["-stream_loop", "-1", "-i", musicPath] : []),
          "-filter_complex",
          flipPost ? `[0:v]hflip[vout];${fc}` : fc,
          "-map",
          flipPost ? "[vout]" : "0:v:0",
          "-map",
          "[aout]",
          ...(flipPost
            ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"]
            : ["-c:v", "copy"]),
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-t",
          String(finalDur),
          "-movflags",
          "+faststart",
          "final.mp4",
        ]);
        if (musicPath) await ff.deleteFile(musicPath).catch(() => undefined);
        if (req.signal?.aborted) throw new RenderError("Export cancelled.", "cancelled");
        if (post === 0) {
          await ff.deleteFile("out.mp4").catch(() => undefined);
          await ff.rename("final.mp4", "out.mp4");
        } else {
          console.warn("audio post pass failed", logTail.join("\n"));
          await ff.deleteFile("final.mp4").catch(() => undefined);
          audioWarning =
            "Music / audio enhance couldn't be applied, so the original audio was kept.";
        }
      } catch (e) {
        if (e instanceof RenderError) throw e;
        console.error("audio post pass error", e);
        await ff.deleteFile("final.mp4").catch(() => undefined);
        audioWarning = "Music / audio enhance couldn't be applied, so the original audio was kept.";
      }
    }
    ff.off("log", onLog);

    if (code !== 0) {
      const log = logTail.join("\n");
      console.error("ffmpeg failed", code, log);
      if (/Invalid data found|could not find codec|Unknown decoder|moov atom not found/i.test(log))
        throw new RenderError(
          "This video's format can't be processed in the browser. Try converting it to a standard MP4 first.",
          "unsupported-format",
        );
      throw new RenderError(
        "Rendering failed. Try a shorter clip or reload the page.",
        "render-failed",
      );
    }

    req.onProgress?.({ stage: "finalizing", progress: null });
    const data = await ff.readFile("out.mp4");
    await ff.deleteFile("out.mp4").catch(() => undefined);
    if (!(data instanceof Uint8Array) || data.byteLength === 0)
      throw new RenderError("Rendering produced an empty file.", "render-failed");

    const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
    const file = new File([blob], req.outputName, { type: "video/mp4" });
    return {
      blob,
      file,
      durationSec: cleanupApplied ? outDur : range.durationSec,
      mimeType: "video/mp4",
      captionsBurned,
      captionWarning,
      smartReframe: usedSmart,
      cleanupApplied,
      cleanupWarning,
      audioWarning,
    };
  } catch (e) {
    if (e instanceof RenderError) throw e;
    if (req.signal?.aborted) throw new RenderError("Export cancelled.", "cancelled");
    console.error("render error", e);
    const msg = String((e as Error)?.message ?? e);
    reset(ff);
    ff = undefined;
    if (/memory|OOM|allocation/i.test(msg))
      throw new RenderError(
        "This video is too large for reliable browser rendering on this device. Try a shorter/smaller source video.",
        "out-of-memory",
      );
    throw new RenderError(
      "Rendering failed. Try a shorter clip or reload the page.",
      "render-failed",
    );
  } finally {
    req.signal?.removeEventListener("abort", onAbort);
    if (ff && instance && !req.signal?.aborted) {
      if (mounted) await ff.unmount(dir).catch(() => undefined);
      await ff.deleteDir(dir).catch(() => undefined);
    }
    busy = false;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
