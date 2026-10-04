/**
 * Pure batch-export queue runner (no React). One failed item never stops the
 * batch; cancelling the current item only skips it unless "cancel remaining"
 * is set. The page wires UI state through `onUpdate`.
 */
export const MAX_BATCH_CLIPS = 12;

export type BatchItemStatus = "waiting" | "rendering" | "done" | "failed" | "cancelled";

export interface BatchItemPatch {
  status: BatchItemStatus;
  label?: string;
  progress?: number | null;
  error?: string;
}

export interface BatchRunOptions<T> {
  items: T[];
  /** Render one item; must reject with `{ code: "cancelled" }` or abort the signal when cancelled. */
  render: (
    item: T,
    index: number,
    controller: AbortController,
    onProgress: (label: string, progress: number | null) => void,
  ) => Promise<void>;
  onUpdate: (index: number, patch: BatchItemPatch) => void;
  /** Called with the controller for the item about to start (null when finished). */
  onActive?: (index: number | null, controller: AbortController | null) => void;
  shouldCancelRemaining: () => boolean;
}

export interface BatchRunResult {
  completed: number;
  failed: number;
  cancelled: number;
}

export function validateBatch(count: number, hasSource: boolean): string | null {
  if (count <= 0) return "Select at least one clip.";
  if (count > MAX_BATCH_CLIPS)
    return `Browser limit: export at most ${MAX_BATCH_CLIPS} clips at a time.`;
  if (!hasSource) return "Select the original video file again before exporting.";
  return null;
}

export async function runBatch<T>(opts: BatchRunOptions<T>): Promise<BatchRunResult> {
  const r: BatchRunResult = { completed: 0, failed: 0, cancelled: 0 };
  const cancelFrom = (from: number) => {
    for (let k = from; k < opts.items.length; k++) {
      opts.onUpdate(k, { status: "cancelled", label: "Cancelled" });
      r.cancelled += 1;
    }
  };
  for (let i = 0; i < opts.items.length; i++) {
    if (opts.shouldCancelRemaining()) {
      cancelFrom(i);
      break;
    }
    const controller = new AbortController();
    opts.onActive?.(i, controller);
    opts.onUpdate(i, { status: "rendering", label: "Preparing…", progress: 0 });
    try {
      await opts.render(opts.items[i]!, i, controller, (label, progress) =>
        opts.onUpdate(i, { status: "rendering", label, progress }),
      );
      r.completed += 1;
      opts.onUpdate(i, { status: "done", label: "Done", progress: 1 });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === "cancelled" || controller.signal.aborted) {
        r.cancelled += 1;
        opts.onUpdate(i, { status: "cancelled", label: "Cancelled" });
        if (opts.shouldCancelRemaining()) {
          cancelFrom(i + 1);
          break;
        }
      } else {
        r.failed += 1;
        console.error("batch item failed", e);
        opts.onUpdate(i, {
          status: "failed",
          label: "Failed",
          error: err?.message || "Export failed",
        });
      }
    } finally {
      opts.onActive?.(null, null);
    }
  }
  return r;
}
