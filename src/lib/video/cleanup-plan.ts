/**
 * Orchestrates silence + filler detection into a single EditPlan.
 */

import type { TranscriptSegment } from "@/lib/detection/transcript";
import {
  buildEditPlan,
  type EditPlan,
  type RemovalRange,
} from "./edit-timeline";
import type { CleanupSettings } from "./cleanup-settings";
import { detectFillerRemovals } from "./filler-detect";
import { detectSilenceRemovals } from "./silence-detect";

export interface CleanupPlanResult {
  plan: EditPlan;
  fillerCount: number;
  silenceMethod: string;
  warnings: string[];
}

/**
 * Build the keep/cut plan for one clip. On any failure returns an identity plan
 * so export can proceed without cleanup.
 */
export async function buildCleanupPlan(opts: {
  file?: File;
  segments: TranscriptSegment[];
  clipStart: number;
  clipEnd: number;
  settings: CleanupSettings;
  signal?: AbortSignal;
}): Promise<CleanupPlanResult> {
  const warnings: string[] = [];
  const { settings, clipStart, clipEnd, segments, signal } = opts;

  if (!settings.removeDeadAir && !settings.removeFillers) {
    const plan = buildEditPlan(clipStart, clipEnd, []);
    return { plan, fillerCount: 0, silenceMethod: "none", warnings };
  }

  try {
    const removals: RemovalRange[] = [];
    let fillerCount = 0;
    let silenceMethod = "none";

    if (settings.removeDeadAir) {
      const sil = await detectSilenceRemovals(
        opts.file,
        segments,
        clipStart,
        clipEnd,
        settings,
        signal,
      );
      silenceMethod = sil.method;
      removals.push(...sil.removals);
      warnings.push(...sil.warnings);
    }

    if (settings.removeFillers) {
      const fill = detectFillerRemovals(
        segments,
        clipStart,
        clipEnd,
        settings.fillerWords,
      );
      fillerCount = fill.count;
      removals.push(...fill.removals);
    }

    const plan = buildEditPlan(clipStart, clipEnd, removals);
    warnings.push(...plan.warnings);
    return { plan, fillerCount, silenceMethod, warnings };
  } catch (e) {
    console.warn("[cleanup] plan failed", e);
    warnings.push("Cleanup analysis failed; exporting the original clip.");
    const plan = buildEditPlan(clipStart, clipEnd, []);
    return { plan, fillerCount: 0, silenceMethod: "none", warnings };
  }
}
