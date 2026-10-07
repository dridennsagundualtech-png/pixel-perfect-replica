import { Captions, Download, Loader2, Pencil, Play, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AI_FACTORS, MODE_META } from "@/lib/detection/defaults";
import { formatTimecode } from "@/lib/format";
import type { ClipCandidate } from "@/lib/detection/types";

export function ClipCard({
  clip,
  onPreview,
  onEdit,
  onReject,
  onExport,
  onExportVideo,
  onCancelRender,
  render,
  renderDisabled,
  captionsEnabled,
  thumbnailPending,
  selected,
  onToggleSelect,
  campaignSlot,
}: {
  campaignSlot?: React.ReactNode;
  clip: ClipCandidate;
  onPreview?: (c: ClipCandidate) => void;
  onEdit?: (c: ClipCandidate) => void;
  onReject?: (c: ClipCandidate) => void;
  onExport?: (c: ClipCandidate) => void;
  onExportVideo?: (c: ClipCandidate) => void;
  onCancelRender?: () => void;
  render?: { label: string; progress: number | null } | undefined;
  renderDisabled?: boolean | undefined;
  captionsEnabled?: boolean | undefined;
  thumbnailPending?: boolean | undefined;
  selected?: boolean | undefined;
  onToggleSelect?: (c: ClipCandidate) => void;
}) {
  const meta = MODE_META[clip.mode];
  const duration = Math.round(Math.max(0, clip.endSec - clip.startSec));

  return (
    <article className={`panel overflow-hidden ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={!!selected}
            onChange={() => onToggleSelect?.(clip)}
            aria-label={`Select clip ${clip.index}`}
          />
          Select
        </label>
      </div>
      <div className="relative mx-auto aspect-[9/16] max-h-56 w-full max-w-[140px] overflow-hidden bg-muted/60 sm:max-h-64 sm:max-w-[160px]">
        {clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
            {thumbnailPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Thumbnail…
              </>
            ) : (
              "No thumbnail yet"
            )}
          </div>
        )}
        <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {duration}s
          </Badge>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">Clip {clip.index}</Badge>
          <span className="font-mono">
            {formatTimecode(clip.startSec)} – {formatTimecode(clip.endSec)}
          </span>
          <Badge variant="outline" className="ml-auto">
            {meta.icon} {meta.label}
          </Badge>
        </div>

        <div>
          <h3 className="text-base font-semibold leading-snug">{clip.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="text-foreground">Hook:</span> {clip.hook}
          </p>
        </div>

        {campaignSlot}
        {/* Status chips */}
        <div className="flex flex-wrap gap-1.5">
          {typeof clip.score === "number" ? (
            <Badge variant="secondary" className="font-mono font-normal">
              Score {clip.score}
            </Badge>
          ) : null}
          {typeof clip.engagementPotential === "number" ? (
            <Badge variant="secondary" className="font-mono font-normal">
              EP {clip.engagementPotential}
            </Badge>
          ) : null}
          <Badge variant="outline" className="font-normal">
            {captionsEnabled ? "Captions on" : "Captions off"}
          </Badge>
          <Badge variant="outline" className="font-normal">
            9:16 reframe
          </Badge>
          {render ? (
            <Badge className="font-normal">Exporting…</Badge>
          ) : clip.thumbnailUrl ? (
            <Badge variant="secondary" className="font-normal">
              Ready
            </Badge>
          ) : null}
        </div>

        {clip.mode === "rules" ||
        (clip.mode === "hybrid" && clip.engagementPotential === undefined) ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-4 text-sm">
              {typeof clip.score === "number" ? (
                <p title="Rule Score is a deterministic ranking score based on your selected rules. It is not a prediction of performance.">
                  <span className="text-muted-foreground">Rule Score: </span>
                  <span className="font-mono text-primary">{clip.score}</span>
                </p>
              ) : null}
              <p>
                <span className="text-muted-foreground">Quality signals: </span>
                <span className="font-mono text-accent">
                  {clip.qualityMatched ?? clip.rulesMatched}/{clip.qualityTotal ?? clip.rulesTotal}
                </span>
              </p>
            </div>
            {clip.highlights?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {clip.highlights.map((h) => (
                  <Badge key={h} variant="secondary" className="font-normal">
                    {h}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : typeof clip.engagementPotential === "number" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Engagement Potential</span>
              <span className="font-mono text-primary">{clip.engagementPotential}</span>
            </div>
            <Progress value={clip.engagementPotential} />
            {clip.factorScores ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-xs">
                {AI_FACTORS.filter((f) => clip.factorScores?.[f.key] !== undefined).map((f) => (
                  <div key={f.key} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="font-mono">{clip.factorScores?.[f.key]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">{clip.reason}</p>

        <p className="text-[11px] text-muted-foreground">
          Export Short uses <span className="text-foreground">Smart Reframe</span> when a face is
          detected locally; otherwise <span className="text-foreground">Center Crop</span>.
        </p>

        {render ? (
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> {render.label}
              </span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => onCancelRender?.()}>
                Cancel
              </Button>
            </div>
            <Progress value={render.progress === null ? undefined : render.progress * 100} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => onPreview?.(clip)}>
            <Play className="size-4" /> Preview
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onEdit?.(clip)} disabled={!!render}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onExportVideo?.(clip)}
            disabled={!!render || renderDisabled}
            title={
              renderDisabled
                ? "Another clip is rendering"
                : "9:16 vertical + smart reframe + burned-in captions"
            }
          >
            <Download className="size-4" /> Export Short
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onExport?.(clip)}>
            <Captions className="size-4" /> Captions
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onReject?.(clip)} disabled={!!render}>
            <X className="size-4" /> Reject
          </Button>
        </div>
      </div>
    </article>
  );
}
