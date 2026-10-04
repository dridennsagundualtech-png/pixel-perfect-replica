import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AI_DETECTION_FLAGS, AI_FACTORS } from "@/lib/detection/defaults";
import type { AiSettings } from "@/lib/detection/types";

export function AiSettingsPanel({
  settings,
  onChange,
}: {
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
}) {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Clip length
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ai-min">Minimum (seconds)</Label>
            <Input
              id="ai-min"
              type="number"
              min={1}
              value={settings.minDurationSec}
              onChange={(e) =>
                onChange({ ...settings, minDurationSec: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-max">Maximum (seconds)</Label>
            <Input
              id="ai-max"
              type="number"
              min={1}
              value={settings.maxDurationSec}
              onChange={(e) =>
                onChange({ ...settings, maxDurationSec: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ranking factors
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Weights for local Engagement Potential ranking (AI / Hybrid modes). Free and offline — not
          a prediction of reach.
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {AI_FACTORS.map((factor) => (
            <div key={factor.key} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-sm">{factor.label}</Label>
                <span className="font-mono text-xs text-primary">
                  {settings.factors[factor.key]}
                </span>
              </div>
              <Slider
                value={[settings.factors[factor.key]]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) =>
                  onChange({ ...settings, factors: { ...settings.factors, [factor.key]: v } })
                }
              />
              <p className="text-xs text-muted-foreground">{factor.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Highlight when present
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {AI_DETECTION_FLAGS.map((flag) => (
            <label
              key={flag.key}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
            >
              <Checkbox
                checked={settings.detect[flag.key]}
                onCheckedChange={(checked) =>
                  onChange({
                    ...settings,
                    detect: { ...settings.detect, [flag.key]: Boolean(checked) },
                  })
                }
              />
              {flag.label}
            </label>
          ))}
        </div>
      </section>

      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Engagement Potential</strong> ranks moments from the
        transcript using your factor weights. It is never a virality guarantee. Rule Mode stays
        fully deterministic and does not use these weights. Hybrid applies hard rule filters first,
        then ranks survivors.
      </p>
    </div>
  );
}
