import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Copy, Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  activateCampaign,
  createCampaign,
  deactivateCampaign,
  deleteCampaign,
  duplicateCampaign,
  exportCampaignJson,
  importCampaignJson,
  makeRequirement,
  updateCampaign,
  useCampaigns,
} from "@/lib/campaign/campaign-store";
import { detectAiConflict, parseBrief } from "@/lib/campaign/brief-parser";
import {
  CATEGORY_LABELS,
  CLIPPILOT_DEFAULTS,
  METHOD_LABELS,
  TYPE_LABELS,
  type Campaign,
  type CampaignRequirement,
  type DetectionMethod,
  type RequirementCategory,
  type RequirementType,
} from "@/lib/campaign/types";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Campaign Mode — ClipPilot" },
      {
        name: "description",
        content: "Turn any campaign brief into a reviewable checklist that ClipPilot checks your clips against.",
      },
      { property: "og:title", content: "Campaign Mode — ClipPilot" },
      {
        property: "og:description",
        content: "Campaign requirements, restrictions and recommendations for your clips.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampaignsPage,
});

const SECTIONS: { type: RequirementType; title: string; hint: string }[] = [
  { type: "required", title: "Campaign requirements", hint: "Must be satisfied." },
  { type: "prohibited", title: "Campaign restrictions", hint: "Must not happen." },
  { type: "recommended", title: "Campaign recommendations", hint: "Preferences, not mandatory." },
  { type: "review", title: "Needs your review", hint: "Unclear — confirm or reclassify." },
];

function CampaignsPage() {
  const { list, active } = useCampaigns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const selected = list.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && list.length) setSelectedId(active?.id ?? list[0]!.id);
  }, [list, active, selectedId]);

  const create = () => {
    try {
      const c = createCampaign({ name: newName || "New campaign" });
      setSelectedId(c.id);
      setNewName("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Campaign Mode"
        subtitle="ClipPilot works normally, plus checks your clips against one campaign's brief."
        actions={
          <>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const c = importCampaignJson(await f.text());
                  setSelectedId(c.id);
                  toast.success(`Imported "${c.name}"`);
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            />
            <Button variant="secondary" onClick={() => importRef.current?.click()}>
              <Upload className="size-4" /> Import JSON
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <div className="panel space-y-2 p-3">
            <Label className="text-xs text-muted-foreground">Create campaign</Label>
            <Input
              placeholder="Campaign name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <Button size="sm" className="w-full" onClick={create}>
              <Plus className="size-4" /> Create Campaign
            </Button>
          </div>
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={`panel block w-full p-3 text-left text-sm ${
                c.id === selectedId ? "ring-2 ring-primary" : ""
              }`}
            >
              <span className="font-medium">{c.name}</span>
              {active?.id === c.id ? <Badge className="ml-2 text-[10px]">Active</Badge> : null}
              <span className="block text-xs text-muted-foreground">
                {c.requirements.length} requirements
              </span>
            </button>
          ))}
          {!list.length ? (
            <p className="text-sm text-muted-foreground">No campaigns yet. Create one to begin.</p>
          ) : null}
        </aside>

        {selected ? (
          <CampaignEditor
            key={selected.id}
            campaign={selected}
            isActive={active?.id === selected.id}
            onDeleted={() => setSelectedId(null)}
            onDuplicated={(id) => setSelectedId(id)}
          />
        ) : (
          <div className="panel p-10 text-center text-sm text-muted-foreground">
            Select or create a campaign.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function CampaignEditor({
  campaign,
  isActive,
  onDeleted,
  onDuplicated,
}: {
  campaign: Campaign;
  isActive: boolean;
  onDeleted: () => void;
  onDuplicated: (id: string) => void;
}) {
  const [draft, setDraft] = useState(campaign);
  const [parsing, setParsing] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(campaign);
  const conflict = detectAiConflict(draft.brief);

  const set = (patch: Partial<Campaign>) => setDraft((d) => ({ ...d, ...patch }));
  const setReq = (id: string, patch: Partial<CampaignRequirement>) =>
    set({
      requirements: draft.requirements.map((r) =>
        r.id === id ? { ...r, ...patch, origin: "user" } : r,
      ),
    });

  const save = () => {
    try {
      updateCampaign(campaign.id, draft);
      toast.success("Campaign saved");
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  const analyze = async () => {
    setParsing(true);
    try {
      const o = await import("@/lib/detection/ollama-ranking-provider");
      const r = await parseBrief(draft.brief, draft.approvedSources, {
        ollama: o.loadOllamaSettings(),
        generate: (b, m, p) => o.ollamaGenerate(b, m, p, 120_000),
      });
      const userReqs = draft.requirements.filter((x) => x.origin === "user");
      set({ requirements: [...r.requirements, ...userReqs] });
      toast.success(
        `${r.requirements.length} requirements found (${r.source === "ollama" ? "Ollama" : "local"}). Review them before activating.`,
      );
      if (r.warning) toast.message(r.warning);
    } catch {
      toast.error("The brief couldn't be analyzed. Add requirements manually.");
    } finally {
      setParsing(false);
    }
  };

  const counts = (t: RequirementType) =>
    draft.requirements.filter((r) => r.active && r.type === t).length;

  return (
    <div className="space-y-6">
      <section className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold">{draft.name}</h2>
          <Badge variant={isActive ? "default" : "outline"}>{isActive ? "Active" : "Inactive"}</Badge>
          <span className="text-xs text-muted-foreground">
            {counts("required")} requirements · {counts("prohibited")} restrictions ·{" "}
            {counts("recommended")} recommendations · {counts("review")} to review
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {isActive ? (
              <Button size="sm" variant="secondary" onClick={() => deactivateCampaign()}>
                Deactivate (Normal Mode)
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  if (dirty && !save()) return;
                  activateCampaign(campaign.id);
                  toast.success(`Campaign Mode: ${draft.name}`);
                }}
              >
                Activate Campaign
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={save}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Duplicate"
              onClick={() => onDuplicated(duplicateCampaign(campaign.id).id)}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Export JSON"
              onClick={() => {
                const blob = new Blob([exportCampaignJson(draft)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${draft.name.replace(/[^a-z0-9]+/gi, "_")}.campaign.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              }}
            >
              <Download className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete"
              onClick={() => {
                if (!window.confirm(`Delete "${draft.name}"?`)) return;
                deleteCampaign(campaign.id);
                onDeleted();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        {dirty ? (
          <p className="text-xs text-accent">Unsaved changes — they apply only after Save.</p>
        ) : null}

        {conflict ? (
          <div className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <p>
              <strong>Campaign conflict:</strong> this brief appears to prohibit AI or automated
              clipping tools. ClipPilot can still help with manual editing and compliance checks,
              but confirm the campaign permits AI-assisted workflows before submitting.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Campaign URL (optional)">
            <Input value={draft.url ?? ""} onChange={(e) => set({ url: e.target.value })} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <Input
            value={draft.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <Field label="Campaign requirements / brief — paste it as-is">
          <Textarea
            rows={8}
            value={draft.brief}
            placeholder="Paste the full campaign brief here…"
            onChange={(e) => set({ brief: e.target.value })}
          />
        </Field>
        <Button variant="secondary" disabled={parsing || !draft.brief.trim()} onClick={() => void analyze()}>
          {parsing ? <Loader2 className="size-4 animate-spin" /> : null}
          Analyze brief
        </Button>
        <p className="text-xs text-muted-foreground">
          Uses Ollama when it's turned on, otherwise a local extractor. Results are suggestions —
          review every line below.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Approved source files (one filename per line, or import CSV)">
            <Textarea
              rows={3}
              value={draft.approvedSources.join("\n")}
              onChange={(e) =>
                set({ approvedSources: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
              }
            />
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="text-xs"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const names = (await f.text())
                  .split(/\r?\n/)
                  .map((l) => l.split(",")[0]!.replace(/^"|"$/g, "").trim())
                  .filter((n) => n && !/^(file|filename|name)$/i.test(n));
                set({ approvedSources: [...new Set([...draft.approvedSources, ...names])] });
                toast.success(`${names.length} approved files added`);
              }}
            />
          </Field>
          <Field label="Notes (optional)">
            <Textarea rows={3} value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="font-semibold">ClipPilot defaults</h3>
        <p className="text-xs text-muted-foreground">Always on, in Normal and Campaign Mode.</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
          {CLIPPILOT_DEFAULTS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>

      {SECTIONS.map((sec) => {
        const reqs = draft.requirements.filter((r) => r.type === sec.type);
        return (
          <section key={sec.type} className="panel space-y-2 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {sec.title} <span className="text-muted-foreground">({reqs.length})</span>
                </h3>
                <p className="text-xs text-muted-foreground">{sec.hint}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  set({
                    requirements: [
                      ...draft.requirements,
                      makeRequirement("New requirement", "other", sec.type),
                    ],
                  })
                }
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
            {reqs.map((r) => (
              <div
                key={r.id}
                className={`grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_130px_120px_110px_auto_auto] ${
                  r.active ? "" : "opacity-50"
                }`}
              >
                <Input value={r.text} onChange={(e) => setReq(r.id, { text: e.target.value, check: undefined })} />
                <Select
                  value={r.category}
                  onValueChange={(v) => setReq(r.id, { category: v as RequirementCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={r.type} onValueChange={(v) => setReq(r.id, { type: v as RequirementType })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={r.method}
                  onValueChange={(v) => setReq(r.id, { method: v as DetectionMethod })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Switch
                  aria-label="Active"
                  checked={r.active}
                  onCheckedChange={(v) => setReq(r.id, { active: v })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove requirement"
                  onClick={() => set({ requirements: draft.requirements.filter((x) => x.id !== r.id) })}
                >
                  <Trash2 className="size-4" />
                </Button>
                {r.check ? (
                  <p className="text-[11px] text-muted-foreground sm:col-span-6">
                    Auto check: {r.check.kind}
                    {r.check.values?.length ? ` · ${r.check.values.join(", ")}` : ""}
                    {r.check.seconds != null ? ` · ${r.check.seconds}s` : ""} ·{" "}
                    {r.origin === "ai" ? "from Ollama" : r.origin === "local" ? "from local parser" : "edited by you"}
                  </p>
                ) : null}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
