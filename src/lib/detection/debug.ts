import { createDefaultRules } from "./defaults";
import { runDetection, type DetectionRunResult } from "./detection-pipeline";
import { SAMPLE_TRANSCRIPT, SAMPLE_TRANSCRIPT_LABEL } from "./sample-transcript";
import type { TranscriptionResult } from "./transcript";
import type { DetectionRule } from "./types";

/**
 * Developer-only helpers. Not imported by any page.
 * Run: `bun scripts/detection-debug.ts`
 */

export function runSampleDetection(
  rules: DetectionRule[] = createDefaultRules(),
  transcript: TranscriptionResult = SAMPLE_TRANSCRIPT,
): Promise<DetectionRunResult> {
  return runDetection(transcript, rules, { mode: "rules", now: () => "1970-01-01T00:00:00.000Z" });
}

export function formatDetectionReport(
  run: DetectionRunResult,
  title = SAMPLE_TRANSCRIPT_LABEL,
): string {
  const lines: string[] = [];
  const s = run.stats;
  lines.push(`== ${title} ==`);
  lines.push(`status: ${run.status} — ${run.message}`);
  lines.push(
    `segments ${s.segmentsUsed} (skipped ${s.segmentsSkipped}) | found ${s.candidatesFound} | evaluated ${s.candidatesEvaluated} | passed rules ${s.passedRules} | duplicates ${s.duplicates} | rejected ${s.rejected} | returned ${s.returned}`,
  );
  for (const w of run.warnings) lines.push(`warning: ${w}`);
  if (run.topFailures.length) {
    lines.push("top failing rules:");
    for (const f of run.topFailures) lines.push(`  ${f.count}× ${f.label} (${f.ruleId})`);
  }
  lines.push("top candidates:");
  for (const c of run.candidates.slice(0, 5)) {
    lines.push(
      `  #${c.index} score ${c.score} ${c.startSec}s–${c.endSec}s rules ${c.rulesMatched}/${c.rulesTotal} "${c.title}"`,
    );
    lines.push(`     ${c.highlights?.join(" · ") ?? ""}`);
  }
  const bestRejected = [...run.analyzed]
    .filter((a) => !a.accepted)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 3);
  if (bestRejected.length) {
    lines.push("best rejected:");
    for (const a of bestRejected) {
      lines.push(`  ${a.window.id} score ${a.score.score}`);
      for (const e of a.result.evaluations.filter((x) => x.passed === false))
        lines.push(`     ✗ ${e.label}: ${e.reason}`);
    }
  }
  return lines.join("\n");
}
