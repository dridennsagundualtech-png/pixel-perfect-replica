// Developer utility: runs the deterministic Rule Mode pipeline on the
// development sample transcript. Usage: bun scripts/detection-debug.ts
import { createDefaultRules } from "../src/lib/detection/defaults";
import { formatDetectionReport, runSampleDetection } from "../src/lib/detection/debug";

const strict = await runSampleDetection();
console.log(formatDetectionReport(strict, "Sample transcript — default rules"));

// Relaxed: only measurable rules, to inspect ranking on a wider set.
const relaxed = createDefaultRules().map((r) =>
  r.group === "hook" || r.group === "content" || r.type === "ending.conclusion"
    ? { ...r, enabled: r.type === "hook.sentenceStart" || r.type === "content.completeThought" }
    : r,
);
console.log(
  "\n" +
    formatDetectionReport(await runSampleDetection(relaxed), "Sample transcript — measurable rules only"),
);

const a = JSON.stringify((await runSampleDetection()).candidates);
const b = JSON.stringify((await runSampleDetection()).candidates);
console.log(`\ndeterministic: ${a === b}`);
