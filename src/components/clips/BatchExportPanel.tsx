import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ClipCandidate } from "@/lib/detection/types";

export type BatchItemStatus = "waiting" | "rendering" | "done" | "failed" | "cancelled";

export interface BatchQueueItem {
  clip: ClipCandidate;
  status: BatchItemStatus;
  progress: number | null;
  label?: string;
  error?: string;
}

export function BatchExportPanel({
  selectedCount,
  queue,
  running,
  completed,
  failed,
  onStart,
  onCancelCurrent,
  onCancelRemaining,
  onCancelAll,
  onClearSelection,
  onSelectAll,
  totalClips,
}: {
  selectedCount: number;
  queue: BatchQueueItem[];
  running: boolean;
  completed: number;
  failed: number;
  onStart: () => void;
  onCancelCurrent: () => void;
  onCancelRemaining: () => void;
  onCancelAll: () => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  totalClips: number;
}) {
  const total = queue.length || selectedCount;
  const totalPct =
    total > 0
      ? ((completed + failed) / total) * 100 +
        (queue.find((q) => q.status === "rendering")?.progress ?? 0) * (100 / Math.max(1, total))
      : 0;

  return (
    <div className="panel mb-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Batch export</h3>
          <p className="text-xs text-muted-foreground">
            {selectedCount} clip{selectedCount === 1 ? "" : "s"} selected · one at a time (local)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onSelectAll}
            disabled={running || totalClips === 0}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            disabled={running || selectedCount === 0}
          >
            Deselect all
          </Button>
          <Button size="sm" onClick={onStart} disabled={running || selectedCount === 0}>
            Export selected
          </Button>
        </div>
      </div>

      {running || queue.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              Queue · {completed} done · {failed} failed
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={onCancelCurrent}
                disabled={!running}
              >
                Cancel current
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={onCancelRemaining}
                disabled={!running}
              >
                Cancel remaining
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={onCancelAll}
                disabled={!running}
              >
                Cancel all
              </Button>
            </div>
          </div>
          <Progress value={Math.min(100, totalPct)} className="h-1.5" />
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {queue.map((item) => (
              <li
                key={item.clip.id}
                className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5"
              >
                <span className="truncate font-medium">
                  Clip {item.clip.index} · {item.clip.title.slice(0, 40)}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                  {item.status === "rendering" ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      {item.label ?? "Rendering…"}
                      {item.progress != null ? ` ${Math.round(item.progress * 100)}%` : ""}
                    </>
                  ) : item.status === "done" ? (
                    <span className="text-primary">Done</span>
                  ) : item.status === "failed" ? (
                    <span className="text-destructive" title={item.error}>
                      Failed
                    </span>
                  ) : item.status === "cancelled" ? (
                    "Cancelled"
                  ) : (
                    "Waiting"
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
