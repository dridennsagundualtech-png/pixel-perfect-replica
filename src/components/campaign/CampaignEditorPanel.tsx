import { useMemo, useState } from "react";
import { Loader2, Megaphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCampaigns } from "@/lib/campaign/campaign-store";
import {
  assessmentPrompt,
  evaluateClipForCampaign,
  parseAiAssessment,
  type AiClipAssessment,
  type ClipCampaignContext,
} from "@/lib/campaign/compliance";
import { CampaignChecklist } from "./CampaignClipStatus";

/**
 * Campaign assistant inside the clip editor: checklist, hook suggestions and
 * "Fix with Campaign" previews. Only shown in Campaign Mode; edits only the
 * title/description/hashtags fields the user can still change.
 */
export function CampaignEditorPanel({
  ctx,
  engagementPotential,
  onUseHook,
  hashtags,
  onHashtags,
  description,
  onDescription,
}: {
  ctx: ClipCampaignContext;
  engagementPotential?: number | undefined;
  onUseHook: (hook: string) => void;
  hashtags: string;
  onHashtags: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
}) {
  const { active } = useCampaigns();
  const [ai, setAi] = useState<{ key: string; value: AiClipAssessment } | null>(null);
  const [busy, setBusy] = useState<"hooks" | "ai" | null>(null);
  const [hooks, setHooks] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | null>(null);

  const key = `${active?.id}:${ctx.startSec}:${ctx.endSec}`;
  const evaluation = useMemo(
    () => evaluateClipForCampaign(active, { ...ctx, ai: ai?.key === key ? ai.value : undefined }),
    [active, ctx, ai, key],
  );
  if (!active || !evaluation) return null;

  const fixes = evaluation.outcomes.filter((o) => o.fix);

  const ollamaDeps = async () => {
    const o = await import("@/lib/detection/ollama-ranking-provider");
    return {
      ollama: o.loadOllamaSettings(),
      generate: (b: string, m: string, p: string) => o.ollamaGenerate(b, m, p, 60_000),
    };
  };

  const genHooks = async () => {
    setBusy("hooks");
    try {
      const { suggestHooks } = await import("@/lib/campaign/campaign-hooks");
      const r = await suggestHooks(active, ctx.transcriptText, await ollamaDeps());
      setHooks((h) => [...new Set([...r.hooks, ...h])].slice(0, 10));
      if (r.warning) toast.message(r.warning);
    } catch {
      toast.error("Hook suggestions are unavailable right now. You can write one manually.");
    } finally {
      setBusy(null);
    }
  };

  const askAi = async () => {
    setBusy("ai");
    try {
      const deps = await ollamaDeps();
      if (!deps.ollama.enabled) {
        toast.message("Turn on Ollama in the AI settings to get an AI campaign check.");
        return;
      }
      const raw = await deps.generate(
        deps.ollama.baseUrl,
        deps.ollama.model,
        assessmentPrompt(active, ctx.transcriptText),
      );
      const parsed = parseAiAssessment(raw, active);
      if (!parsed) throw new Error("invalid");
      setAi({ key, value: parsed });
    } catch {
      toast.error("AI check unavailable — uncertain items stay as REVIEW.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Megaphone className="size-4 text-primary" />
        <span className="font-semibold">Campaign: {active.name}</span>
        <span className="ml-auto font-mono text-xs">
          Engagement Potential {engagementPotential ?? "—"} · Campaign Fit {evaluation.fit ?? "—"}{" "}
          · {evaluation.status}
        </span>
      </div>
      <CampaignChecklist evaluation={evaluation} />
      {ai?.key === key && ai.value.notes.length ? (
        <p className="text-muted-foreground">AI notes: {ai.value.notes.join(" · ")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void askAi()}>
          {busy === "ai" ? <Loader2 className="size-3 animate-spin" /> : null}
          Ask Ollama to check fit
        </Button>
      </div>

      {fixes.length ? (
        <div className="space-y-1.5">
          <p className="font-medium">Fix with Campaign</p>
          {fixes.map((o) => (
            <div key={o.requirement.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {o.fix!.label}
                {o.fix!.hashtags ? ` → hashtags: ${o.fix!.hashtags.join(" ")}` : ""}
                {o.fix!.descriptionAppend ? ` → description: +"${o.fix!.descriptionAppend}"` : ""}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (o.fix!.hashtags)
                    onHashtags(`${hashtags} ${o.fix!.hashtags.join(" ")}`.trim());
                  if (o.fix!.descriptionAppend)
                    onDescription(`${description} ${o.fix!.descriptionAppend}`.trim());
                }}
              >
                Accept
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="font-medium">Suggested hooks (editorial text, not quotes)</p>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void genHooks()}>
            {busy === "hooks" ? <Loader2 className="size-3 animate-spin" /> : null}
            {hooks.length ? "Generate more" : "Suggest hooks"}
          </Button>
        </div>
        {hooks.map((h, i) => (
          <div key={`${i}-${h}`} className="flex items-center gap-1.5">
            {editing === i ? (
              <Input
                value={h}
                autoFocus
                onChange={(e) => setHooks((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                onBlur={() => setEditing(null)}
              />
            ) : (
              <span className="flex-1">
                {i + 1}. {h}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
              Edit
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onUseHook(h)}>
              Use as title
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Reject hook"
              onClick={() => setHooks((all) => all.filter((_, j) => j !== i))}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
