/**
 * Local subject tracking for smart 9:16 reframing.
 *
 * Strategy:
 * 1. Prefer MediaPipe Face Detector (@mediapipe/tasks-vision) — fully local WASM.
 * 2. Fall back to the browser FaceDetector API when available.
 * 3. Always fall back to center crop if detection is unavailable or fails.
 *
 * No paid APIs, no cloud inference, no API keys.
 */

import {
  CENTER_X,
  type ReframeTrack,
  type SubjectPoint,
  smoothSubjectPoints,
} from "./reframe-track";

export interface TrackSubjectOptions {
  /** Absolute start of the clip in the source video. */
  startSec: number;
  /** Absolute end of the clip in the source video. */
  endSec: number;
  /** Max analysis width (keeps inference cheap). Default 640. */
  analysisWidth?: number;
  /** Seconds between sampled frames. Default 0.5. */
  sampleIntervalSec?: number;
  /** Abort mid-scan. */
  signal?: AbortSignal;
  onProgress?: (p: { stage: "loading" | "scanning"; progress: number | null }) => void;
}

type FaceBox = {
  /** Normalized center X in [0, 1]. */
  x: number;
  /** Relative size (area proxy) for multi-face preference. */
  area: number;
  confidence: number;
};

let mediapipePromise: Promise<MediapipeFace | null> | null = null;

interface MediapipeFace {
  detect(image: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement): FaceBox[];
  close(): void;
}

/**
 * Lazily load MediaPipe Face Detector from CDN (same pattern as ffmpeg core).
 * Returns null if the library or model cannot be loaded — caller must fall back.
 */
async function getMediapipeFace(): Promise<MediapipeFace | null> {
  if (typeof window === "undefined") return null;
  if (!mediapipePromise) {
    mediapipePromise = (async () => {
      try {
        // Prefer npm package when installed; otherwise CDN (local WASM, no API key).
        type VisionMod = {
          FaceDetector: {
            createFromOptions: (
              vision: unknown,
              opts: Record<string, unknown>,
            ) => Promise<{
              detect: (img: HTMLCanvasElement) => {
                detections: Array<{
                  boundingBox?: {
                    originX: number;
                    originY: number;
                    width: number;
                    height: number;
                  };
                  categories?: Array<{ score?: number }>;
                }>;
              };
              close: () => void;
            }>;
          };
          FilesetResolver: {
            forVisionTasks: (path: string) => Promise<unknown>;
          };
        };

        let mod: VisionMod;
        try {
          mod = (await import("@mediapipe/tasks-vision")) as VisionMod;
        } catch {
          const cdnUrl: string =
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm";
          mod = (await import(/* @vite-ignore */ cdnUrl)) as VisionMod;
        }
        const { FaceDetector, FilesetResolver } = mod;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm",
        );
        const detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.4,
        });

        return {
          detect(image: HTMLCanvasElement) {
            const result = detector.detect(image);
            const w = image.width || 1;
            const h = image.height || 1;
            return (result.detections ?? [])
              .map((d) => {
                const box = d.boundingBox;
                if (!box || box.width <= 0 || box.height <= 0) return null;
                const cx = (box.originX + box.width / 2) / w;
                const area = (box.width * box.height) / (w * h);
                const confidence = d.categories?.[0]?.score ?? 0.5;
                return { x: cx, area, confidence } satisfies FaceBox;
              })
              .filter((b): b is FaceBox => !!b);
          },
          close() {
            try {
              detector.close();
            } catch {
              /* already closed */
            }
          },
        };
      } catch (e) {
        console.warn("[reframe] MediaPipe face detector unavailable", e);
        return null;
      }
    })();
    mediapipePromise.catch(() => {
      mediapipePromise = null;
    });
  }
  return mediapipePromise;
}

/** Chromium FaceDetector API (no extra deps). */
async function detectNative(
  bitmap: ImageBitmap | HTMLCanvasElement,
): Promise<FaceBox[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FD = (window as any).FaceDetector;
  if (typeof FD !== "function") return [];
  try {
    const detector = new FD({ fastMode: true, maxDetectedFaces: 5 });
    const faces = await detector.detect(bitmap);
    const w =
      "width" in bitmap ? (bitmap as ImageBitmap).width : (bitmap as HTMLCanvasElement).width;
    const h =
      "height" in bitmap ? (bitmap as ImageBitmap).height : (bitmap as HTMLCanvasElement).height;
    return (faces as Array<{ boundingBox: DOMRectReadOnly }>).map((f) => {
      const b = f.boundingBox;
      return {
        x: (b.x + b.width / 2) / Math.max(1, w),
        area: (b.width * b.height) / Math.max(1, w * h),
        confidence: 0.7,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Pick one face from a multi-face set: prefer the one closest to the current
 * crop position (stable speaker), then the largest.
 */
function pickFace(faces: FaceBox[], preferredX: number): FaceBox | null {
  if (!faces.length) return null;
  if (faces.length === 1) return faces[0]!;
  let best = faces[0]!;
  let bestScore = -Infinity;
  for (const f of faces) {
    const dist = Math.abs(f.x - preferredX);
    // Prefer proximity, then size.
    const score = f.area * 2 - dist;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

function centerTrack(durationSec: number): ReframeTrack {
  return {
    source: "center",
    points: [
      { timeSec: 0, x: CENTER_X, confidence: 0 },
      { timeSec: Math.max(0, durationSec), x: CENTER_X, confidence: 0 },
    ],
  };
}

/**
 * Build a reframe track for [startSec, endSec] by sampling the local video File.
 * Never throws for detection failure — returns a center track instead.
 */
export async function trackSubject(
  file: File,
  opts: TrackSubjectOptions,
): Promise<ReframeTrack> {
  const startSec = Math.max(0, opts.startSec);
  const endSec = Math.max(startSec + 0.1, opts.endSec);
  const durationSec = endSec - startSec;
  const interval = Math.max(0.25, opts.sampleIntervalSec ?? 0.5);
  const analysisWidth = opts.analysisWidth ?? 640;

  opts.onProgress?.({ stage: "loading", progress: null });

  if (opts.signal?.aborted) return centerTrack(durationSec);

  // Try MediaPipe first; native FaceDetector as secondary.
  let mp: MediapipeFace | null = null;
  try {
    mp = await getMediapipeFace();
  } catch {
    mp = null;
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
      video.src = url;
    });

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const scale = Math.min(1, analysisWidth / srcW);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return centerTrack(durationSec);

    const times: number[] = [];
    for (let t = startSec; t <= endSec + 1e-6; t += interval) {
      times.push(Math.min(endSec, t));
    }
    if (times[times.length - 1]! < endSec - 0.05) times.push(endSec);

    const raw: SubjectPoint[] = [];
    let preferredX = CENTER_X;
    let anyFace = false;

    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) break;
      const absT = times[i]!;
      await seekVideo(video, absT);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let faces: FaceBox[] = [];
      if (mp) {
        try {
          faces = mp.detect(canvas);
        } catch {
          faces = [];
        }
      }
      if (!faces.length) {
        faces = await detectNative(canvas);
      }

      const chosen = pickFace(faces, preferredX);
      if (chosen) {
        anyFace = true;
        preferredX = chosen.x;
        raw.push({
          timeSec: absT - startSec,
          x: chosen.x,
          confidence: chosen.confidence,
        });
      } else {
        raw.push({
          timeSec: absT - startSec,
          x: preferredX,
          confidence: 0,
        });
      }

      opts.onProgress?.({
        stage: "scanning",
        progress: (i + 1) / times.length,
      });
    }

    if (!anyFace || !raw.length) return centerTrack(durationSec);

    const smoothed = smoothSubjectPoints(raw, durationSec);
    return {
      source: "face",
      points: smoothed,
    };
  } catch (e) {
    console.warn("[reframe] subject tracking failed, using center crop", e);
    return centerTrack(durationSec);
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
    // Keep MediaPipe warm for subsequent clips; do not close the shared detector.
  }
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    const target = Math.min(
      Math.max(0, timeSec),
      Number.isFinite(video.duration) ? video.duration : timeSec,
    );
    if (Math.abs(video.currentTime - target) < 0.01) {
      video.removeEventListener("seeked", onSeeked);
      resolve();
      return;
    }
    video.currentTime = target;
    // Safety timeout if seek never fires (some browsers on short seeks).
    setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }, 1500);
  });
}
