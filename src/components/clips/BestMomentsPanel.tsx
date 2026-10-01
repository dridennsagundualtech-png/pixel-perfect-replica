import { Button } from "@/components/ui/button";
import type { BestMomentRecommendation } from "@/lib/detection/best-moments";
import type { ClipCandidate } from "@/lib/detection/types";

export function BestMomentsPanel({
  recommendations,
  maxShow,
  onMaxChange,
  onPreview,
  onEdit,
  onCreateClip,
  onReject,
}: {
  recommendations: BestMomentRecommendation[];
  maxShow: number;
  onMaxChange: (n: number) => void;
  onPreview?: (c: ClipCandidate) => void;
  onEdit?: (c: ClipCandidate) => void;
  onCreateClip?: (c: ClipCandidate) => void;
  onReject?: (c: ClipCandidate) => void;
}) {
  if (!recommendations.length) return null;

  return (
    <div className="panel mb-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Best Moments</h3>
          <p className="text-xs text-muted-foreground">
            Top recommendations from your current analysis — Engagement Potential is a ranking
            signal, not a virality probability.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Show top
          <select
            className="rounded border border-border bg-background px-2 py-1 text-foreground"
            value={maxShow}
            onChange={(e) => onMaxChange(Number(e.target.value))}
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="space-y-3">
        {recommendations.map((r) => (
          <li
            key={r.clip.id}
            className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  #{r.rank} · {r.hook || r.clip.title || `Clip ${r.clip.index}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.startSec.toFixed(1)}s – {r.endSec.toFixed(1)}s · {r.durationSec.toFixed(1)}s
                </p>
              </div>
              <div className="text-right text-xs">
                <p>
                  Engagement Potential{" "}
                  <span className="font-semibold text-foreground">{r.engagementPotential}</span>
                </p>
                <p className="text-muted-foreground">Rule Score {r.ruleScore}</p>
              </div>
            </div>

            {r.transcript ? (
              <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
                {r.transcript}
              </p>
            ) : null}

            {r.reasons.length ? (
              <ul className="flex flex-wrap gap-1">
                {r.reasons.map((reason) => (
                  <li
                    key={reason}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            ) : null}

            {r.signals.length ? (
              <p className="text-[11px] text-muted-foreground">
                Signals: {r.signals.slice(0, 5).join(" · ")}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              {onPreview ? (
                <Button size="sm" variant="secondary" onClick={() => onPreview(r.clip)}>
                  Preview
                </Button>
              ) : null}
              {onEdit ? (
                <Button size="sm" variant="secondary" onClick={() => onEdit(r.clip)}>
                  Edit
                </Button>
              ) : null}
              {onCreateClip ? (
                <Button size="sm" onClick={() => onCreateClip(r.clip)}>
                  Create Clip
                </Button>
              ) : null}
              {onReject ? (
                <Button size="sm" variant="ghost" onClick={() => onReject(r.clip)}>
                  Reject
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
