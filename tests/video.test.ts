import { describe, expect, it } from "vitest";
import {
  buildCaptionCues,
  DEFAULT_CAPTION_SETTINGS as S,
  cueAtTime,
} from "../src/lib/video/dynamic-captions";
import { buildEditPlan, mapInterval, rebaseWords, sourceToOutput } from "../src/lib/video/edit-timeline";
import { isSmartReframe, rebaseReframeTrack, sampleTrackX, type ReframeTrack } from "../src/lib/video/reframe-track";
import { clipFileName, validateClipRange } from "../src/lib/video/clip-range";
import { buildAudioEnhanceFilter, DEFAULT_AUDIO_ENHANCE } from "../src/lib/video/audio-enhance";
import { clipToSrt } from "../src/lib/clip-export";
import type { TranscriptSegment } from "../src/lib/detection/transcript";
import type { ClipCandidate } from "../src/lib/detection/types";

const w = (text: string, s: number, e: number) => ({ text, startSec: s, endSec: e });

describe("caption timing", () => {
  const seg: TranscriptSegment = {
    id: "1", startSec: 0, endSec: 10, text: "Hello world later words",
    words: [w("Hello", 1, 1.3), w("world", 1.35, 1.7), w("later", 4, 4.3), w("words", 4.35, 4.7)],
  };
  it("uses real word times rebased to the clip", () => {
    const c = buildCaptionCues([seg], 0.5, 10, S);
    expect(c[0]!.startSec).toBeCloseTo(0.5, 6);
  });
  it("does not show captions during silence", () => {
    const c = buildCaptionCues([seg], 0, 10, S);
    expect(cueAtTime(c, 3)).toBeNull();
    expect(cueAtTime(c, 1.1)?.activeWordIndex).toBe(0);
  });
  it("final caption disappears shortly after the last word", () => {
    const c = buildCaptionCues([seg], 0, 10, S);
    expect(c[c.length - 1]!.endSec).toBeLessThanOrEqual(4.7 + 0.36);
    expect(cueAtTime(c, 6)).toBeNull();
  });
  it("splits long sentences by maxWords", () => {
    const words = Array.from({ length: 12 }, (_, i) => w(`w${i}`, i * 0.25, i * 0.25 + 0.2));
    const c = buildCaptionCues([{ id: "l", startSec: 0, endSec: 5, text: "", words }], 0, 5, { ...S, maxWords: 4 });
    expect(new Set(c.map((x) => x.group)).size).toBeGreaterThanOrEqual(3);
  });
  it("falls back to segment cues without word timing and drops invalid words", () => {
    const c = buildCaptionCues([{ id: "o", startSec: 2, endSec: 4, text: "Old line" }], 0, 10, S);
    expect(c).toHaveLength(1);
    expect(c[0]!.activeWordIndex).toBeNull();
    const bad = buildCaptionCues([{ id: "b", startSec: 0, endSec: 5, text: "x", words: [w("ok", 1, 1.2), w("bad", 2, 1), w(" ", 3, 3.2)] }], 0, 5, S);
    expect(bad.map((x) => x.text)).toEqual(["ok"]);
  });
  it("captions turned off produce SRT unchanged", () => {
    const srt = clipToSrt({ startSec: 10, endSec: 20 } as ClipCandidate, [{ id: "b", startSec: 12, endSec: 15, text: "Line" }]);
    expect(srt).toContain("00:00:02,000 --> 00:00:05,000");
  });
});

describe("edit timeline / cleanup", () => {
  it("identity plan for no removals", () => {
    const p = buildEditPlan(10, 30, []);
    expect(p.isIdentity).toBe(true);
    expect(p.outputDurationSec).toBe(20);
  });
  it("multiple removals shift output time", () => {
    const p = buildEditPlan(100, 140, [{ startSec: 110, endSec: 112, reason: "silence" }, { startSec: 125, endSec: 127, reason: "filler" }]);
    expect(p.segments.map((s) => s.outputStartSec)).toEqual([0, 10, 23]);
    expect(p.outputDurationSec).toBe(36);
    expect(sourceToOutput(p, 111)).toBeNull();
    expect(sourceToOutput(p, 130)).toBeCloseTo(26, 6);
    expect(mapInterval(p, 105, 115)).toEqual({ startSec: 5, endSec: 13 });
    expect(rebaseWords(p, [w("a", 113, 114)] as never)).toHaveLength(1);
  });
  it("invalid ranges produce an empty plan", () => {
    expect(buildEditPlan(10, 10, []).segments).toHaveLength(0);
  });
});

describe("smart reframe rebasing", () => {
  const face: ReframeTrack = { source: "face", points: Array.from({ length: 41 }, (_, i) => ({ timeSec: i, x: i < 10 ? 0.3 : i < 25 ? 0.5 : 0.7, confidence: 0.9 })) };
  it("survives cuts without hard jumps", () => {
    const p = buildEditPlan(100, 140, [{ startSec: 110, endSec: 112, reason: "silence" }, { startSec: 125, endSec: 127, reason: "filler" }]);
    const r = rebaseReframeTrack(face, p, 100)!;
    expect(isSmartReframe(r)).toBe(true);
    expect(sampleTrackX(r, 30)).toBeCloseTo(0.7, 3);
    let step = 0;
    for (let t = 0; t < 36; t += 0.05) step = Math.max(step, Math.abs(sampleTrackX(r, t + 0.05) - sampleTrackX(r, t)));
    expect(step).toBeLessThan(0.05);
  });
  it("no face → center fallback", () => {
    const p = buildEditPlan(0, 10, [{ startSec: 3, endSec: 4, reason: "silence" }]);
    expect(rebaseReframeTrack(undefined, p, 0)).toBeUndefined();
    expect(isSmartReframe(rebaseReframeTrack({ source: "center", points: [{ timeSec: 0, x: 0.5, confidence: 0 }] }, p, 0))).toBe(false);
  });
});

describe("export guards", () => {
  it("validates clip ranges", () => {
    expect(validateClipRange(5, 35).ok).toBe(true);
    expect(validateClipRange(35, 5).ok).toBe(false);
    expect(validateClipRange(10, 10).ok).toBe(false);
    expect(validateClipRange(45, 50, 40).ok).toBe(false);
    expect(validateClipRange(0, 11 * 60).ok).toBe(false);
    expect(clipFileName('A/"b"', 1, 5, 42)).toBe("A_b_Clip_01_00-05_to_00-42.mp4");
  });
  it("audio enhance filter is empty when off and complete when on", () => {
    expect(buildAudioEnhanceFilter(DEFAULT_AUDIO_ENHANCE)).toBe("");
    const f = buildAudioEnhanceFilter({ ...DEFAULT_AUDIO_ENHANCE, enabled: true });
    expect(f).toContain("afftdn");
    expect(f).toContain("loudnorm");
    expect(buildAudioEnhanceFilter({ ...DEFAULT_AUDIO_ENHANCE, enabled: true, noiseReduction: false, voiceClarity: false, loudnessNormalize: false })).toBe("");
  });
});
