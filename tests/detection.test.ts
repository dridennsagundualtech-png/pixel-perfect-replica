import { describe, expect, it } from "vitest";
import { createDefaultAiSettings, createDefaultRules } from "../src/lib/detection/defaults";
import { generateCandidates, getDurationBounds } from "../src/lib/detection/candidate-generator";
import { prepareSegments } from "../src/lib/detection/text-signals";
import { runDetection } from "../src/lib/detection/detection-pipeline";
import { getRuleKind, isRuleActive, measureWindow } from "../src/lib/detection/rule-engine";
import { validateTranscript } from "../src/lib/detection/transcript";
import type { DetectionRule } from "../src/lib/detection/types";
import { NOW, PLAIN, RICH, seg, sentences } from "./helpers";

const rules = createDefaultRules();
const run = async (segments: ReturnType<typeof sentences>, r: DetectionRule[] = rules, mode: "rules" | "ai" | "hybrid" = "rules") =>
  runDetection({ segments }, r, { mode, now: NOW, ai: createDefaultAiSettings() });
const setRule = (type: string, patch: Partial<DetectionRule>) =>
  rules.map((r) => (r.type === type ? { ...r, ...patch } : r));

describe("candidate generation", () => {
  it("builds windows inside duration bounds", async () => {
    const prepared = prepareSegments(sentences([...PLAIN, ...RICH]));
    const res = generateCandidates(prepared, { minDurationSec: 20, maxDurationSec: 40 });
    expect(res.candidates.length).toBeGreaterThan(1);
    for (const c of res.candidates) {
      expect(c.durationSec).toBeGreaterThanOrEqual(20);
      expect(c.durationSec).toBeLessThanOrEqual(40);
      expect(c.endSec).toBeGreaterThan(c.startSec);
    }
  });
  it("returns nothing for a transcript shorter than the minimum", async () => {
    const prepared = prepareSegments(sentences(PLAIN.slice(0, 2)));
    expect(generateCandidates(prepared, { minDurationSec: 20, maxDurationSec: 60 }).candidates).toHaveLength(0);
  });
  it("caps very long transcripts", async () => {
    const long = sentences(Array.from({ length: 300 }, (_, i) => `Sentence number ${i} is here.`), 3);
    const res = generateCandidates(prepareSegments(long), { minDurationSec: 10, maxDurationSec: 60, maxCandidates: 50 });
    expect(res.candidates.length).toBeLessThanOrEqual(50);
    expect(res.truncated).toBe(true);
  });
  it("prefers sentence-boundary windows", async () => {
    const segs = [seg("a", 0, 10, "This starts a sentence."), seg("b", 10, 20, "and keeps going without end"), seg("c", 20, 30, "Then it ends.")];
    const res = generateCandidates(prepareSegments(segs), { minDurationSec: 15, maxDurationSec: 40 });
    expect(res.candidates.every((c) => c.endsAtSentence)).toBe(true);
  });
  it("reads bounds from the length rules", async () => {
    expect(getDurationBounds(rules)).toMatchObject({ minDurationSec: 20, maxDurationSec: 60 });
  });
});

describe("rule engine", () => {
  it("classifies hard filters vs quality signals", async () => {
    expect(getRuleKind({ type: "length.min" })).toBe("hard-filter");
    expect(getRuleKind({ type: "hook.containsQuestion" })).toBe("quality-signal");
  });
  it("treats boolean rules as active only when enabled and not false", async () => {
    const r = rules.find((x) => x.type === "hook.containsQuestion")!;
    expect(isRuleActive({ ...r, enabled: true, value: true })).toBe(true);
    expect(isRuleActive({ ...r, enabled: true, value: false })).toBe(false);
    expect(isRuleActive({ ...r, enabled: false })).toBe(false);
  });
  it("measures silence, speech density and fillers", async () => {
    const segs = prepareSegments([seg("a", 0, 5, "Um so basically this is it."), seg("b", 9, 14, "And here we go.")]);
    const m = measureWindow(segs, 0, 14);
    expect(m.maxSilenceSec).toBeCloseTo(4, 5);
    expect(m.speechDensityPct).toBeLessThan(100);
    expect(m.fillerWordCount).toBeGreaterThanOrEqual(2);
  });
  it("keeps plain clips (quality signals never reject)", async () => {
    expect((await run(sentences(PLAIN))).candidates.length).toBeGreaterThan(0);
  });
  it("scores clips with signals higher", async () => {
    const plain = (await run(sentences(PLAIN))).candidates[0]!;
    const rich = (await run(sentences(RICH))).candidates[0]!;
    expect(rich.score!).toBeGreaterThan(plain.score!);
    expect(rich.score!).toBeLessThanOrEqual(100);
  });
  it("rejects clips over the silence limit", async () => {
    const s = sentences(PLAIN).map((x, i) => (i >= 3 ? { ...x, startSec: x.startSec + 5, endSec: x.endSec + 5 } : x));
    const res = await run(s);
    expect(res.candidates.some((c) => c.startSec <= 12 && c.endSec >= 23)).toBe(false);
  });
  it("rejects clips under min / over max duration", async () => {
    expect((await run(sentences(PLAIN.slice(0, 2)))).candidates).toHaveLength(0);
    const tight = setRule("length.max", { value: 25 });
    for (const c of (await run(sentences([...PLAIN, ...RICH]), tight)).candidates) expect(c.endSec - c.startSec).toBeLessThanOrEqual(25);
  });
  it("rejects high filler density", async () => {
    const fill = sentences(Array.from({ length: 5 }, () => "Um uh basically you know literally um it is."));
    expect((await run(fill)).candidates).toHaveLength(0);
  });
  it("removes overlapping duplicates", async () => {
    const cands = (await run(sentences([...PLAIN, ...RICH, ...PLAIN]))).candidates;
    for (let i = 0; i < cands.length; i++)
      for (let j = i + 1; j < cands.length; j++) {
        const a = cands[i]!, b = cands[j]!;
        const ov = Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
        expect(ov / Math.min(a.endSec - a.startSec, b.endSec - b.startSec)).toBeLessThan(0.5);
      }
  });
  it("is deterministic", async () => {
    const a = await run(sentences(RICH));
    const b = await run(sentences(RICH));
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
  });
  it("handles empty / malformed transcripts", async () => {
    expect((await runDetection(undefined, rules, { now: NOW })).status).toBe("no-transcript");
    expect((await runDetection({ segments: [] }, rules, { now: NOW })).status).toBe("empty-transcript");
    const v = validateTranscript([{ id: "x", startSec: 5, endSec: 2, text: "bad" }, seg("ok", 0, 1, "fine")]);
    expect(v.segments.map((s) => s.id)).toEqual(["ok"]);
  });
  it("reports invalid rules", async () => {
    expect((await run(sentences(PLAIN), setRule("length.min", { value: 90 }))).status).toBe("invalid-rules");
  });
});

describe("engagement signals", () => {
  const sig = (t: string) => prepareSegments([seg("a", 0, 5, t)])[0]!;
  it("detects questions, strong statements, surprise, emotion, education, story", async () => {
    expect(sig("Why do people quit?").question).toBe(true);
    expect(sig("The truth is you need focus.").strongStatement).toBe(true);
    expect(sig("Believe it or not, it turns out to be easy.").surprising).toBe(true);
    expect(sig("I remember when I was a kid.").storytelling).toBe(true);
  });
  it("AI/hybrid modes add Engagement Potential within 0–100", async () => {
    for (const mode of ["ai", "hybrid"] as const) {
      const c = (await run(sentences([...RICH, ...PLAIN]), rules, mode)).candidates;
      expect(c.length).toBeGreaterThan(0);
      for (const x of c) {
        expect(x.engagementPotential).toBeGreaterThanOrEqual(0);
        expect(x.engagementPotential).toBeLessThanOrEqual(100);
      }
    }
  });
});
