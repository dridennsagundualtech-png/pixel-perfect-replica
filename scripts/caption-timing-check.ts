/**
 * Pure caption-timing checks (no browser).
 * Run: npx --yes tsx scripts/caption-timing-check.ts
 */
import {
  buildCaptionCues,
  DEFAULT_CAPTION_SETTINGS,
  type CaptionSettings,
} from "../src/lib/video/dynamic-captions";
import type { TranscriptSegment } from "../src/lib/detection/transcript";

const settings: CaptionSettings = {
  ...DEFAULT_CAPTION_SETTINGS,
  endPadSec: 0.15,
  groupPauseSec: 0.55,
  highlightWord: true,
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  // speech → silence → speech
  const segs1: TranscriptSegment[] = [
    {
      id: "1",
      startSec: 0,
      endSec: 10,
      text: "Hello world later words",
      words: [
        { text: "Hello", startSec: 1.0, endSec: 1.3 },
        { text: "world", startSec: 1.35, endSec: 1.7 },
        // silence ~2s
        { text: "later", startSec: 4.0, endSec: 4.3 },
        { text: "words", startSec: 4.35, endSec: 4.7 },
      ],
    },
  ];
  const cues1 = buildCaptionCues(segs1, 0, 10, settings);
  assert(cues1.length >= 2, "expected multiple groups across silence");
  const firstGroupEnd = Math.max(...cues1.filter((c) => c.group === 0).map((c) => c.endSec));
  assert(firstGroupEnd < 2.5, `first group must end before long silence, got ${firstGroupEnd}`);
  assert(firstGroupEnd <= 1.7 + 0.36, `first group linger too long: ${firstGroupEnd}`);

  // speech ending before action-only section (no words after)
  const segs2: TranscriptSegment[] = [
    {
      id: "2",
      startSec: 0,
      endSec: 20,
      text: "Done speaking",
      words: [
        { text: "Done", startSec: 2.0, endSec: 2.3 },
        { text: "speaking", startSec: 2.4, endSec: 2.9 },
      ],
    },
  ];
  const cues2 = buildCaptionCues(segs2, 0, 20, settings);
  const last2 = cues2[cues2.length - 1]!;
  assert(last2.endSec <= 2.9 + 0.36, `must not linger into action section: ${last2.endSec}`);
  assert(last2.endSec >= 2.9, "must cover last word");

  // short final sentence
  const segs3: TranscriptSegment[] = [
    {
      id: "3",
      startSec: 0,
      endSec: 5,
      text: "Yes",
      words: [{ text: "Yes", startSec: 1.0, endSec: 1.2 }],
    },
  ];
  const cues3 = buildCaptionCues(segs3, 0, 5, settings);
  assert(cues3.length >= 1, "short sentence needs a cue");
  assert(cues3[0]!.startSec === 1.0, "start at first word");
  assert(cues3[0]!.endSec <= 1.2 + 0.36, "short pad only");

  // long sentence → multiple groups by maxWords
  const longWords = Array.from({ length: 12 }, (_, i) => ({
    text: `w${i}`,
    startSec: 1 + i * 0.25,
    endSec: 1 + i * 0.25 + 0.2,
  }));
  const segs4: TranscriptSegment[] = [
    { id: "4", startSec: 0, endSec: 20, text: longWords.map((w) => w.text).join(" "), words: longWords },
  ];
  const cues4 = buildCaptionCues(segs4, 0, 20, { ...settings, maxWords: 4 });
  const groups4 = new Set(cues4.map((c) => c.group));
  assert(groups4.size >= 2, "long sentence should split groups");

  // silence between two caption groups
  for (const c of cues1) {
    if (c.group === 0) assert(c.endSec < 3.5, "no caption during silence");
  }

  // clip starts mid-segment
  const cuesMid = buildCaptionCues(segs1, 1.2, 5, settings);
  assert(cuesMid.every((c) => c.startSec >= 0), "clip-relative starts >= 0");
  assert(
    cuesMid.every((c) => c.endSec <= 5 - 1.2 + 0.001),
    "clip-relative ends within duration",
  );

  // no captions when no words in range
  const cuesEmpty = buildCaptionCues(segs1, 8, 9, settings);
  assert(cuesEmpty.length === 0, "no words in range → no captions");

  console.log("caption-timing-check: all passed");
}

run();
