// Usage: bun scripts/caption-check.ts
import { clipToSrt } from "../src/lib/clip-export";
import type { TranscriptSegment } from "../src/lib/detection/transcript";
import type { ClipCandidate } from "../src/lib/detection/types";
import {
  activeWordAt,
  buildCaptionCues,
  buildDynamicAss,
  DEFAULT_CAPTION_SETTINGS as S,
  groupWords,
  wrapWords,
} from "../src/lib/video/dynamic-captions";

let fail = 0;
const t = (n: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}`);
  if (!ok) fail++;
};

const words = "you need to understand this. it really changes everything about the way we work"
  .split(" ")
  .map((text, i) => ({ text, startSec: 10 + i * 0.4, endSec: 10 + i * 0.4 + 0.3 }));
const seg: TranscriptSegment = {
  id: "a",
  startSec: 10,
  endSec: 16,
  text: words.map((w) => w.text).join(" "),
  words,
};

const groups = groupWords(words, { maxWords: 4, maxChars: 24 });
t(
  "1. groups are 1–4 words",
  groups.every((g) => g.length >= 1 && g.length <= 4),
);
t(
  "1b. sentence end closes a group",
  groups.some((g) => g[g.length - 1]!.text === "this."),
);

const cues = buildCaptionCues([seg], 10, 20, S);
const firstYou = cues.find((c) => c.activeWordIndex === 0)!;
t(
  "2. real timestamps preserved (rebased)",
  Math.abs(cues[1]!.startSec - 0.4) < 1e-9 && firstYou.startSec === 0,
);
t(
  "3. active word at t",
  activeWordAt(groups[0]!, 10.85) === 2 && activeWordAt(groups[0]!, 9) === null,
);

const bad: TranscriptSegment = {
  ...seg,
  words: [
    { text: "ok", startSec: 10, endSec: 10.3 },
    { text: "bad", startSec: 11, endSec: 10.5 },
    { text: "nan", startSec: NaN, endSec: 12 },
    { text: "  ", startSec: 12, endSec: 12.4 },
  ],
};
const bc = buildCaptionCues([bad], 10, 20, S);
t("4/5. invalid + empty words ignored", bc.length === 1 && bc[0]!.text === "ok");

const lines = wrapWords("YOU NEED TO UNDERSTAND THIS".split(" "), 16);
t(
  "6. wraps into balanced lines",
  lines.length === 2 && lines.every((l) => l.join(" ").length <= 16),
);

let sane = true;
for (let i = 0; i < cues.length; i++) {
  const c = cues[i]!;
  if (!(c.endSec > c.startSec) || c.startSec < 0 || c.endSec > 10) sane = false;
  if (i && cues[i - 1]!.endSec > c.startSec + 1e-9) sane = false;
}
t("7. no impossible or overlapping timing", sane);

const noWords: TranscriptSegment = {
  id: "b",
  startSec: 12,
  endSec: 15,
  text: "Old transcript line",
};
const fb = buildCaptionCues([noWords], 10, 20, S);
t(
  "8. missing words → segment cue",
  fb.length === 1 &&
    fb[0]!.startSec === 2 &&
    fb[0]!.endSec === 5 &&
    fb[0]!.activeWordIndex === null,
);

const ass = buildDynamicAss(cues, S);
t(
  "ASS has dialogue per word",
  (ass.match(/^Dialogue:/gm) ?? []).length === cues.length && ass.includes("\\c&H0000D4FF&"),
);

const clip = { startSec: 10, endSec: 20 } as ClipCandidate;
t("9. SRT still works", clipToSrt(clip, [noWords]).includes("00:00:02,000 --> 00:00:05,000"));

process.exit(fail ? 1 : 0);
