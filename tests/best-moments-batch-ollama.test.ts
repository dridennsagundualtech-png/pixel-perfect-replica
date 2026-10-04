import { afterEach, describe, expect, it, vi } from "vitest";
import { selectBestMoments } from "../src/lib/detection/best-moments";
import type { ClipCandidate } from "../src/lib/detection/types";
import { MAX_BATCH_CLIPS, runBatch, validateBatch, type BatchItemPatch } from "../src/lib/batch-export";
import {
  createOllamaRankingProvider,
  parseResponse,
} from "../src/lib/detection/ollama-ranking-provider";
import { createDefaultAiSettings } from "../src/lib/detection/defaults";
import { buildHighlightReel } from "../src/lib/detection/highlight-reel";

const clip = (id: string, s: number, e: number, ep?: number, score = 50) =>
  ({ id, title: id, startSec: s, endSec: e, mode: "rules", engagementPotential: ep, score, transcriptText: `Text ${id}. More.` }) as unknown as ClipCandidate;

describe("best moments", () => {
  const clips = [clip("a", 0, 30, 40), clip("b", 40, 70, 90), clip("c", 80, 110, 70), clip("d", 120, 150, undefined, 60)];
  it("returns strongest first and keeps timestamps", () => {
    const r = selectBestMoments(clips, { maxRecommendations: 3 });
    expect(r.map((x) => x.clip.id)).toEqual(["b", "c", "d"]);
    expect(r[0]).toMatchObject({ startSec: 40, endSec: 70, rank: 1 });
  });
  it("handles fewer and zero candidates", () => {
    expect(selectBestMoments(clips, { maxRecommendations: 10 })).toHaveLength(4);
    expect(selectBestMoments([])).toEqual([]);
  });
});

describe("highlight reel", () => {
  it("skips overlaps, keeps source order and respects max", () => {
    const r = buildHighlightReel([clip("x", 50, 70), clip("y", 55, 75), clip("z", 0, 20)], { maxMoments: 5, targetDurationSec: 45, maxDurationSec: 90 })!;
    expect(r.moments.map((m) => m.id)).toEqual(["z", "x"]);
    expect(r.plan.outputDurationSec).toBe(40);
    expect(r.plan.segments[1]!.outputStartSec).toBe(20);
    expect(buildHighlightReel([], { maxMoments: 5, targetDurationSec: 45, maxDurationSec: 90 })).toBeNull();
  });
});

describe("batch export", () => {
  const exec = async (items: string[], render: (x: string, c: AbortController) => Promise<void>, cancelRemaining = () => false) => {
    const log: [number, BatchItemPatch][] = [];
    const res = await runBatch({ items, render: (x, _i, c) => render(x, c), onUpdate: (i, p) => log.push([i, p]), shouldCancelRemaining: cancelRemaining });
    const final = items.map((_, i) => [...log].reverse().find(([k]) => k === i)?.[1].status);
    return { res, final };
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  it("validates selection", () => {
    expect(validateBatch(0, true)).toMatch(/at least one/);
    expect(validateBatch(MAX_BATCH_CLIPS + 1, true)).toMatch(/at most/);
    expect(validateBatch(2, false)).toMatch(/original video/);
    expect(validateBatch(2, true)).toBeNull();
  });
  it("one and many successes", async () => {
    expect((await exec(["a"], async () => undefined)).res).toEqual({ completed: 1, failed: 0, cancelled: 0 });
    expect((await exec(["a", "b", "c"], async () => undefined)).res.completed).toBe(3);
  });
  it("one failure does not stop the batch", async () => {
    const { res, final } = await exec(["a", "b", "c"], async (x) => {
      if (x === "b") throw new Error("boom");
    });
    expect(res).toEqual({ completed: 2, failed: 1, cancelled: 0 });
    expect(final).toEqual(["done", "failed", "done"]);
  });
  it("all fail", async () => {
    expect((await exec(["a", "b"], async () => Promise.reject(new Error("x")))).res.failed).toBe(2);
  });
  it("cancel current continues with the rest", async () => {
    const { final } = await exec(["a", "b", "c"], async (x, c) => {
      if (x === "a") {
        c.abort();
        throw { code: "cancelled" };
      }
    });
    expect(final).toEqual(["cancelled", "done", "done"]);
  });
  it("cancel remaining stops the queue and a new batch still works", async () => {
    let stop = false;
    const { res, final } = await exec(["a", "b", "c"], async (x, c) => {
      if (x === "a") {
        stop = true;
        c.abort();
        throw { code: "cancelled" };
      }
    }, () => stop);
    expect(res).toEqual({ completed: 0, failed: 0, cancelled: 3 });
    expect(final).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect((await exec(["d"], async () => undefined)).res.completed).toBe(1);
  });
});

describe("ollama fallback", () => {
  const base = [{ id: "a", engagementPotential: 40, factorScores: {}, explanations: ["x"] }];
  afterEach(() => vi.unstubAllGlobals());
  it("parses valid JSON, keeps 0 scores, ignores unknown ids", () => {
    const r = parseResponse('[{"id":"a","engagementPotential":0},{"id":"zz","engagementPotential":99}]', base);
    expect(r).toEqual([{ ...base[0], engagementPotential: 0 }]);
  });
  it("invalid JSON falls back", () => {
    expect(parseResponse("not json [oops", base)).toBe(base);
    expect(parseResponse("[{bad]", base)).toBe(base);
  });
  it("network failure falls back to local heuristic ranking", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = createOllamaRankingProvider({ baseUrl: "http://127.0.0.1:1", model: "m", timeoutMs: 50 });
    const out = await p.rankCandidates([], createDefaultAiSettings());
    expect(out).toEqual([]);
  });
});
