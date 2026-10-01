import { buildEditPlan, rebaseWords } from "../src/lib/video/edit-timeline";
import {
  rebaseReframeTrack,
  sampleTrackX,
  isSmartReframe,
  type ReframeTrack,
} from "../src/lib/video/reframe-track";
let fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) fail++;
};
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e;
const face: ReframeTrack = {
  source: "face",
  points: Array.from({ length: 41 }, (_, i) => ({
    timeSec: i,
    x: i < 10 ? 0.3 : i < 25 ? 0.5 : 0.7,
    confidence: 0.9,
  })),
};
const clipStart = 100;

// 1 no cleanup
const id = buildEditPlan(clipStart, clipStart + 40, []);
const r1 = rebaseReframeTrack(face, id, clipStart)!;
ok(
  [0, 5, 12.5, 30, 39].every((t) => near(sampleTrackX(r1, t), sampleTrackX(face, t))),
  "identity plan keeps original track",
);

// 2 one removal
const p2 = buildEditPlan(clipStart, clipStart + 20, [
  { startSec: 110, endSec: 112, reason: "silence" },
]);
const tr2: ReframeTrack = {
  source: "face",
  points: Array.from({ length: 21 }, (_, i) => ({ timeSec: i, x: i / 20, confidence: 0.9 })),
};
const r2 = rebaseReframeTrack(tr2, p2, clipStart)!;
ok(near(p2.outputDurationSec, 18), "output 18s");
ok(
  !r2.points.some((p) => p.x > 0.5 + 1e-6 && p.x < 0.6 - 1e-6 && p.confidence > 0),
  "removed-range points dropped",
);
ok(near(sampleTrackX(r2, 15), sampleTrackX(tr2, 17)), "source 17s -> output 15s");
ok(near(sampleTrackX(r2, 10), 0.5), "holds previous framing at cut");

// 3 multiple removals
const p3 = buildEditPlan(clipStart, clipStart + 40, [
  { startSec: 110, endSec: 112, reason: "silence" },
  { startSec: 125, endSec: 127, reason: "filler" },
]);
const r3 = rebaseReframeTrack(face, p3, clipStart)!;
ok(p3.segments.map((s) => s.outputStartSec).join() === "0,10,23", "outputs 0/10/23");
ok(
  isSmartReframe(r3) &&
    near(sampleTrackX(r3, 5), 0.3) &&
    near(sampleTrackX(r3, 18), 0.5) &&
    near(sampleTrackX(r3, 30), 0.7),
  "smart reframe in all 3 segments",
);
let maxStep = 0;
for (let t = 0; t < 36; t += 0.05)
  maxStep = Math.max(maxStep, Math.abs(sampleTrackX(r3, t + 0.05) - sampleTrackX(r3, t)));
ok(maxStep < 0.05, `no hard jump at cuts (max step ${maxStep.toFixed(3)})`);

// 4 no face
const center: ReframeTrack = { source: "center", points: [{ timeSec: 0, x: 0.5, confidence: 0 }] };
ok(
  !isSmartReframe(rebaseReframeTrack(center, p3, clipStart)) &&
    rebaseReframeTrack(undefined, p3, clipStart) === undefined,
  "center fallback",
);

// 5 captions use same plan
const words = [
  { text: "a", startSec: 105, endSec: 106 },
  { text: "b", startSec: 113, endSec: 114 },
  { text: "c", startSec: 130, endSec: 131 },
];
const rw = rebaseWords(p3, words as never) as { startSec: number }[];
ok(
  rw.length === 3 &&
    near(rw[0]!.startSec, 5) &&
    near(rw[1]!.startSec, 11) &&
    near(rw[2]!.startSec, 26),
  "captions rebased with same plan",
);
ok(near(sampleTrackX(r3, 26), sampleTrackX(face, 30)), "caption & reframe share output clock");

// 6 batch: both export paths call renderClip, which does the rebasing
const src = await Bun.file("src/routes/projects.$projectId.tsx").text();
ok(
  !src.includes("plan.isIdentity ? reframe") && (src.match(/renderClip\(\{/g) ?? []).length >= 2,
  "single + batch pass track to shared renderer",
);
process.exit(fail ? 1 : 0);
