// Usage: bun scripts/video-render-check.ts
import { clipFileName, validateClipRange } from "../src/lib/video/clip-range";
let fail = 0;
const t = (n: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${n}`);
  if (!ok) fail++;
};
t("5→35 accepted", validateClipRange(5, 35).ok);
t("35→5 rejected", !validateClipRange(35, 5).ok);
t("10→10 rejected", !validateClipRange(10, 10).ok);
const c = validateClipRange(12, 28, 100);
t("edited 12→28 kept", c.ok && c.startSec === 12 && c.endSec === 28);
const cl = validateClipRange(30, 50, 40);
t("end clamped to source", cl.ok && cl.endSec === 40);
t("start past end of video rejected", !validateClipRange(45, 50, 40).ok);
t(
  "filename sanitized",
  clipFileName('My "Pod/cast" ep#1', 1, 5, 42) === "My_Pod_cast_ep_1_Clip_01_00-05_to_00-42.mp4",
);
process.exit(fail ? 1 : 0);
