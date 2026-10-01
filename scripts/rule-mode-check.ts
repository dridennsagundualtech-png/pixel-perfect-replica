// Deterministic validation of hard filters vs quality signals.
// Usage: bun scripts/rule-mode-check.ts  (exits 1 on failure)
import { createDefaultRules } from "../src/lib/detection/defaults";
import { runDetection } from "../src/lib/detection/detection-pipeline";
import type { TranscriptSegment } from "../src/lib/detection/transcript";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const seg = (id: string, start: number, end: number, text: string): TranscriptSegment => ({
  id,
  startSec: start,
  endSec: end,
  text,
});

// Plain: 5 contiguous neutral sentences, 30s, no question/strong statement/payoff.
const plain = [
  "We walked along the river in the morning.",
  "The water was calm and the air felt cool.",
  "A few boats moved slowly past the old bridge.",
  "Later we stopped at a small cafe near the park.",
  "Then we took the train back into the city.",
].map((t, i) => seg(`p${i}`, i * 6, i * 6 + 6, t));

// Signals: same shape but opens with a question + strong statement, and ends on a payoff.
const rich = [
  "Why do most people never finish their projects?",
  "The truth is you need a much smaller first step.",
  "I remember starting with ten minutes a day.",
  "It felt tiny but I kept showing up every morning.",
  "That's why the lesson is to start small and stay consistent.",
].map((t, i) => seg(`r${i}`, i * 6, i * 6 + 6, t));

const rules = createDefaultRules();
const only = (segments: TranscriptSegment[]) =>
  runDetection({ segments }, rules, { mode: "rules", now: () => "1970-01-01T00:00:00.000Z" });

const a = only(plain);
const plainBest = a.candidates[0];
check("plain clip without quality signals is NOT rejected", !!plainBest, a.message);

const b = only(rich);
const richBest = b.candidates[0];
check("clip with quality signals passes", !!richBest, b.message);
check(
  "clip with quality signals scores higher",
  (richBest?.score ?? 0) > (plainBest?.score ?? 100),
  `rich ${richBest?.score} vs plain ${plainBest?.score}`,
);

// Excessive silence: 5s gap in the middle.
const silent = plain.map((s, i) =>
  i >= 3 ? { ...s, startSec: s.startSec + 5, endSec: s.endSec + 5 } : s,
);
const c = only(silent);
check(
  "clip with 5s silence is rejected",
  !c.candidates.some((x) => x.startSec <= 12 && x.endSec >= 23),
  c.topFailures.map((f) => `${f.count}× ${f.label}`).join(", "),
);

// Too short: only 12s of speech.
const d = only(plain.slice(0, 2));
check("12s clip is rejected (min 20s)", d.candidates.length === 0, d.message);

const again = JSON.stringify(only(rich).candidates);
check("deterministic", again === JSON.stringify(b.candidates));

process.exit(failures ? 1 : 0);
