import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CampaignEvaluation, CheckResult } from "@/lib/campaign/compliance";

const ICON: Record<CheckResult, string> = { pass: "✓", fail: "✕", review: "⚠", unmet: "–" };
const VARIANT = { PASS: "default", REVIEW: "secondary", FAIL: "destructive" } as const;

/** Campaign Fit + Compliance, kept separate from Engagement Potential; click for why. */
export function CampaignClipStatus({ evaluation }: { evaluation: CampaignEvaluation | null }) {
  if (!evaluation) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-wrap items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs hover:bg-primary/10"
        >
          <span className="text-muted-foreground">Campaign Fit</span>
          <span className="font-mono">{evaluation.fit ?? "—"}</span>
          <span className="text-muted-foreground">· Compliance</span>
          <Badge variant={VARIANT[evaluation.status]} className="text-[10px]">
            {evaluation.status}
          </Badge>
          <span className="text-primary underline">Why?</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs">
        <CampaignChecklist evaluation={evaluation} />
      </PopoverContent>
    </Popover>
  );
}

export function CampaignChecklist({ evaluation }: { evaluation: CampaignEvaluation }) {
  if (!evaluation.outcomes.length)
    return <p className="text-muted-foreground">This campaign has no active requirements yet.</p>;
  return (
    <div className="space-y-2">
      <p className="font-semibold">
        Campaign check · {evaluation.status}
        {evaluation.fit != null ? ` · Fit ${evaluation.fit}` : ""}
      </p>
      <ul className="space-y-1">
        {evaluation.outcomes.map((o) => (
          <li key={o.requirement.id} className="flex gap-2">
            <span
              className={
                o.result === "pass"
                  ? "text-primary"
                  : o.result === "fail"
                    ? "text-destructive"
                    : "text-accent"
              }
            >
              {ICON[o.result]}
            </span>
            <span>
              <span className="text-foreground">{o.requirement.text}</span>
              <span className="block text-muted-foreground">
                {o.requirement.type} · {o.evidence}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        REVIEW means ClipPilot can't verify it automatically — the final decision is yours.
      </p>
    </div>
  );
}
