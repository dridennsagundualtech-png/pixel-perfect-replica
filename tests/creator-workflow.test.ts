import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_SETTINGS,
  EXPORT_PRESETS,
  exportPresetSize,
  getOutputSize,
  manualReframeX,
  manualTrack,
  normalizeOutputSettings,
} from "../src/lib/video/output-format";
import {
  BUILT_IN_PRESETS,
  captureValues,
  createPreset,
  deletePreset,
  getPreset,
  listPresets,
  loadCustomPresets,
  updatePreset,
  type KeyValueStorage,
} from "../src/lib/creator-presets";
import {
  buildDynamicAss,
  captionLayoutScale,
  DEFAULT_CAPTION_SETTINGS,
  type DynamicCaptionCue,
} from "../src/lib/video/dynamic-captions";
import { DEFAULT_AUDIO_ENHANCE } from "../src/lib/video/audio-enhance";
import {
  generateClipMetadata,
  localHashtags,
  localTitle,
  parseMetadata,
} from "../src/lib/clip-metadata";
import { wrapThumbnailText } from "../src/lib/video/thumbnail-frame";

function memStorage(init: Record<string, string> = {}): KeyValueStorage {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("aspect ratios", () => {
  it("9:16 dimensions", () => {
    expect(getOutputSize("vertical", "hd")).toEqual({ width: 1080, height: 1920 });
  });
  it("1:1 dimensions", () => {
    expect(getOutputSize("square", "hd")).toEqual({ width: 1080, height: 1080 });
  });
  it("16:9 dimensions", () => {
    expect(getOutputSize("landscape", "hd")).toEqual({ width: 1920, height: 1080 });
  });
  it("default export stays 720×1280 vertical with auto reframe", () => {
    const d = DEFAULT_OUTPUT_SETTINGS;
    expect(getOutputSize(d.format, d.resolution)).toEqual({ width: 720, height: 1280 });
    expect(manualReframeX(d)).toBeNull();
  });
  it("invalid stored settings recover to defaults", () => {
    expect(normalizeOutputSettings({ format: "bogus", manualX: "x" })).toEqual(
      DEFAULT_OUTPUT_SETTINGS,
    );
  });
  it("manual reframe overrides only position", () => {
    expect(manualReframeX({ reframe: "left", manualX: 0 })).toBe(0.25);
    expect(manualReframeX({ reframe: "custom", manualX: 2 })).toBe(1);
    expect(manualTrack(0.5).source).toBe("center");
    expect(manualTrack(0.8).points[0]!.x).toBe(0.8);
  });
});

describe("export presets", () => {
  it("map to correct dimensions", () => {
    expect(exportPresetSize("shorts")).toEqual({ width: 1080, height: 1920 });
    expect(exportPresetSize("youtube")).toEqual({ width: 1920, height: 1080 });
    expect(exportPresetSize("square")).toEqual({ width: 1080, height: 1080 });
    expect(exportPresetSize("nope")).toBeNull();
    expect(EXPORT_PRESETS.length).toBeGreaterThanOrEqual(3);
  });
});

describe("caption layout for formats", () => {
  const cues: DynamicCaptionCue[] = [
    { startSec: 0, endSec: 1, words: [], text: "Hello there", activeWordIndex: null, group: 0 },
  ];
  it("vertical 720×1280 ASS is unchanged by the format parameter", () => {
    expect(buildDynamicAss(cues, DEFAULT_CAPTION_SETTINGS)).toBe(
      buildDynamicAss(cues, DEFAULT_CAPTION_SETTINGS, { width: 720, height: 1280 }),
    );
    expect(captionLayoutScale(720, 1280)).toEqual({ font: 1, x: 1, y: 1 });
  });
  it("landscape uses its own play resolution, same event times", () => {
    const a = buildDynamicAss(cues, DEFAULT_CAPTION_SETTINGS, { width: 1920, height: 1080 });
    expect(a).toContain("PlayResX: 1920");
    expect(a).toContain("PlayResY: 1080");
    expect(a).toContain("Dialogue: 0,0:00:00.00,0:00:01.00");
  });
  it("background box switches border style", () => {
    const a = buildDynamicAss(cues, { ...DEFAULT_CAPTION_SETTINGS, background: true });
    expect(a).toMatch(/,3,\d+,\d+,2,/);
  });
});

describe("creator presets", () => {
  const vals = captureValues(
    DEFAULT_OUTPUT_SETTINGS,
    DEFAULT_CAPTION_SETTINGS,
    DEFAULT_AUDIO_ENHANCE,
    0.3,
  );
  it("create + load", () => {
    const st = memStorage();
    const p = createPreset("Mine", vals, st);
    expect(loadCustomPresets(st)).toHaveLength(1);
    expect(getPreset(p.id, st)?.name).toBe("Mine");
    expect(listPresets(st)).toHaveLength(BUILT_IN_PRESETS.length + 1);
  });
  it("update", () => {
    const st = memStorage();
    const p = createPreset("Mine", vals, st);
    const u = updatePreset(
      p.id,
      { values: { ...vals, output: { ...vals.output, format: "square" } } },
      st,
    );
    expect(u?.values.output.format).toBe("square");
    expect(updatePreset(BUILT_IN_PRESETS[0]!.id, { name: "x" }, st)).toBeNull();
  });
  it("delete", () => {
    const st = memStorage();
    const p = createPreset("Mine", vals, st);
    expect(deletePreset(p.id, st)).toBe(true);
    expect(loadCustomPresets(st)).toHaveLength(0);
    expect(deletePreset(BUILT_IN_PRESETS[0]!.id, st)).toBe(false);
  });
  it("invalid preset recovery", () => {
    const st = memStorage({
      "clippilot.creatorPresets.v1": JSON.stringify([
        { id: "ok", name: "Good", values: { output: { format: "landscape" } } },
        { id: "", name: "bad" },
        null,
        "junk",
      ]),
    });
    const list = loadCustomPresets(st);
    expect(list).toHaveLength(1);
    expect(list[0]!.values.output.format).toBe("landscape");
    expect(list[0]!.values.caption.style).toBe(DEFAULT_CAPTION_SETTINGS.style);
    expect(loadCustomPresets(memStorage({ "clippilot.creatorPresets.v1": "{not json" }))).toEqual(
      [],
    );
  });
  it("presets never store caption timing fields", () => {
    expect(vals.caption).not.toHaveProperty("endPadSec");
    expect(vals.caption).not.toHaveProperty("groupPauseSec");
  });
});

describe("AI metadata fallback", () => {
  const text =
    "Why do most new traders lose money? Because they skip risk management. Risk management keeps traders alive.";
  it("local fallback without AI", async () => {
    const r = await generateClipMetadata("title", text);
    expect(r.source).toBe("local");
    expect(r.value).toBe(localTitle(text));
    expect(r.value.length).toBeLessThanOrEqual(72);
  });
  it("Ollama unavailable falls back locally", async () => {
    const r = await generateClipMetadata("description", text, {
      ollama: { enabled: true, model: "m", baseUrl: "http://x" },
      generate: () => Promise.reject(new Error("offline")),
    });
    expect(r.source).toBe("local");
    expect(r.warning).toMatch(/unavailable/);
    expect(r.value.length).toBeGreaterThan(0);
  });
  it("invalid AI response falls back locally", async () => {
    const r = await generateClipMetadata("hashtags", text, {
      ollama: { enabled: true, model: "m", baseUrl: "http://x" },
      generate: () => Promise.resolve("sure! here you go"),
    });
    expect(r.source).toBe("local");
    expect(r.value).toBe(localHashtags(text).join(" "));
  });
  it("valid AI response is used", async () => {
    const r = await generateClipMetadata("title", text, {
      ollama: { enabled: true, model: "m", baseUrl: "http://x" },
      generate: () => Promise.resolve('{"title":"The Mistake New Traders Make"}'),
    });
    expect(r).toEqual({ value: "The Mistake New Traders Make", source: "ollama" });
  });
  it("parses hashtags and rejects junk", () => {
    expect(parseMetadata("hashtags", '{"hashtags":["Trading","#risk tips","#ok"]}')).toBe(
      "#trading #risktips #ok",
    );
    expect(parseMetadata("title", '{"title":""}')).toBeNull();
  });
  it("empty transcript errors gracefully", async () => {
    await expect(generateClipMetadata("title", "  ")).rejects.toThrow(/transcript/);
  });
  it("local hashtags are deterministic", () => {
    expect(localHashtags(text)).toEqual(localHashtags(text));
    expect(localHashtags(text)[0]).toBe("#management");
  });
});

describe("thumbnail text", () => {
  it("wraps and caps lines", () => {
    expect(wrapThumbnailText("the biggest mistake new traders make every day", 16, 2)).toEqual([
      "the biggest",
      "mistake new",
    ]);
  });
});
