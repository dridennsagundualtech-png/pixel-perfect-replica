import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RULE_GROUP_META, RULE_GROUP_ORDER, RULE_HELP, ruleLabel } from "@/lib/detection/defaults";
import { getRuleKind } from "@/lib/detection/rule-engine";
import type { DetectionRule, RuleGroup } from "@/lib/detection/types";

/**
 * Renders rules generically from their configuration objects, so new rule types
 * only need to exist as data — not as new UI branches.
 */
export function RuleSettingsPanel({
  rules,
  onChange,
}: {
  rules: DetectionRule[];
  onChange: (next: DetectionRule[]) => void;
}) {
  const patch = (id: string, changes: Partial<DetectionRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const remove = (id: string) => onChange(rules.filter((x) => x.id !== id));

  const category = (r: DetectionRule): SectionKey =>
    r.group === "exclusion" ? "exclusion" : getRuleKind(r);
  const byGroupOrder = (a: DetectionRule, b: DetectionRule) =>
    RULE_GROUP_ORDER.indexOf(a.group) - RULE_GROUP_ORDER.indexOf(b.group);

  return (
    <div className="space-y-8">
      {SECTIONS.map((section) => {
        const sectionRules = rules.filter((r) => category(r) === section.key).sort(byGroupOrder);
        if (sectionRules.length === 0) return null;
        return (
          <section key={section.key}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {sectionRules.map((r) => (
                <RuleRow key={r.id} rule={r} patch={patch} remove={remove} />
              ))}
            </div>
          </section>
        );
      })}

      <AddRuleDialog onAdd={(r) => onChange([...rules, r])} existingIds={rules.map((r) => r.id)} />

      <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p>
          Hard filters can remove clips that break your limits. Quality signals raise the Rule Score
          but never remove a clip on their own — ticking "Prefer questions" means clips with
          questions rank higher, not that every other clip is thrown away.
        </p>
        <p>
          Rule Score is a deterministic ranking score based on your selected rules. It is not a
          prediction of performance. Everything runs on the transcript without any AI model, so the
          same transcript and settings always give the same clips. Wording checks look for common
          phrases, so they can miss things.
        </p>
      </div>
    </div>
  );
}

type SectionKey = "hard-filter" | "quality-signal" | "exclusion";
const SECTIONS: { key: SectionKey; label: string; description: string }[] = [
  { key: "hard-filter", label: "Hard filters", description: "These can remove a clip." },
  { key: "quality-signal", label: "Quality signals", description: "These improve the Rule Score." },
  {
    key: "exclusion",
    label: "Duplicate / exclusion filters",
    description: "These remove unusable or repeated clips.",
  },
];

function RuleRow({
  rule: r,
  patch,
  remove,
}: {
  rule: DetectionRule;
  patch: (id: string, changes: Partial<DetectionRule>) => void;
  remove: (id: string) => void;
}) {
  const del = r.custom ? (
    <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
      <Trash2 className="size-4" />
    </Button>
  ) : null;
  if (typeof r.value === "number") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <Label className="text-sm">{ruleLabel(r)}</Label>
          <RuleHelp rule={r} />
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              type="number"
              className="h-8 w-24"
              value={r.value}
              disabled={!r.enabled}
              onChange={(e) => patch(r.id, { value: Number(e.target.value) || 0 })}
            />
            <span className="text-xs text-muted-foreground">{r.unit ?? ""}</span>
          </div>
        </div>
        <Switch checked={r.enabled} onCheckedChange={(c) => patch(r.id, { enabled: c })} />
        {del}
      </div>
    );
  }
  return (
    <label className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
      <Checkbox
        checked={Boolean(r.value) && r.enabled}
        onCheckedChange={(c) => patch(r.id, { value: Boolean(c), enabled: true })}
      />
      <span className="flex-1">
        {ruleLabel(r)}
        <RuleHelp rule={r} />
      </span>
      {del}
    </label>
  );
}

function AddRuleDialog({
  onAdd,
  existingIds,
}: {
  onAdd: (rule: DetectionRule) => void;
  existingIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState<RuleGroup>("content");
  const [kind, setKind] = useState<"requirement" | "limit">("requirement");
  const [limitDirection, setLimitDirection] = useState<"min" | "max">("max");
  const [amount, setAmount] = useState(5);
  const [unit, setUnit] = useState("s");

  const submit = () => {
    const base = label.trim();
    if (!base) return;
    let id = `custom.${base.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    while (existingIds.includes(id)) id = `${id}-1`;
    onAdd({
      id,
      type: id,
      group,
      label: base,
      operator: kind === "requirement" ? "isTrue" : limitDirection,
      value: kind === "requirement" ? true : amount,
      unit: kind === "limit" ? unit : undefined,
      enabled: true,
      custom: true,
    });
    setLabel("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Plus className="size-4" /> Add rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a rule</DialogTitle>
          <DialogDescription>
            Describe what a clip must do. Your rule is saved with the project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-label">Rule</Label>
            <Input
              id="rule-label"
              placeholder="Must mention the product name"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Section</Label>
              <Select value={group} onValueChange={(v) => setGroup(v as RuleGroup)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_GROUP_ORDER.map((g) => (
                    <SelectItem key={g} value={g}>
                      {RULE_GROUP_META[g].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "requirement" | "limit")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="requirement">Yes / no requirement</SelectItem>
                  <SelectItem value="limit">Numeric limit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {kind === "limit" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Limit</Label>
                <Select
                  value={limitDirection}
                  onValueChange={(v) => setLimitDirection(v as "min" | "max")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="min">At least</SelectItem>
                    <SelectItem value="max">At most</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value</Label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!label.trim()}>
            Add rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleHelp({ rule }: { rule: DetectionRule }) {
  const help = RULE_HELP[rule.type];
  const text = rule.description ?? help?.checks;
  if (!text) return null;
  return (
    <span className="mt-0.5 block text-xs text-muted-foreground" title={help?.onFail}>
      {text}
      {help ? <span className="text-muted-foreground/70"> {help.onFail}</span> : null}
    </span>
  );
}
