import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import type { CleanupSettings } from "@/lib/video/cleanup-settings";

export function CleanupSettingsPanel({
  settings,
  onChange,
  fillerPreviewCount,
}: {
  settings: CleanupSettings;
  onChange: (patch: Partial<CleanupSettings>) => void;
  /** Optional live count for the selected clip range; omit when unknown. */
  fillerPreviewCount?: number | undefined;
}) {
  return (
    <div className="panel mb-4 space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold">Cleanup (Export Short)</h3>
        <p className="text-xs text-muted-foreground">
          Remove long pauses and optional filler words. Cuts stay on word boundaries. Runs locally.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">Remove dead air</p>
          <p className="text-xs text-muted-foreground">Long silences between words</p>
        </div>
        <Switch
          checked={settings.removeDeadAir}
          onCheckedChange={(v) => onChange({ removeDeadAir: v })}
          aria-label="Remove dead air"
        />
      </div>

      {settings.removeDeadAir ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sensitivity">
            <input
              type="range"
              min={0.15}
              max={0.95}
              step={0.05}
              value={settings.silenceThreshold}
              onChange={(e) => onChange({ silenceThreshold: Number(e.target.value) })}
              className="w-full"
            />
            <p className="text-[11px] text-muted-foreground">
              {settings.silenceThreshold < 0.4
                ? "Gentle"
                : settings.silenceThreshold > 0.7
                  ? "Aggressive"
                  : "Balanced"}
            </p>
          </Field>
          <Field label="Min silence (sec)">
            <Input
              type="number"
              min={0.2}
              max={2}
              step={0.05}
              value={settings.minSilenceSec}
              onChange={(e) => onChange({ minSilenceSec: Number(e.target.value) })}
            />
          </Field>
          <Field label="Keep silence (sec)">
            <Input
              type="number"
              min={0}
              max={0.4}
              step={0.02}
              value={settings.keepSilenceSec}
              onChange={(e) => onChange({ keepSilenceSec: Number(e.target.value) })}
            />
          </Field>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-sm">Remove filler words</p>
          <p className="text-xs text-muted-foreground">
            um, uh, er… Off by default. Ordinary “like” is kept when it looks like real speech.
            {typeof fillerPreviewCount === "number" ? (
              <span className="text-foreground"> · ~{fillerPreviewCount} in view</span>
            ) : null}
          </p>
        </div>
        <Switch
          checked={settings.removeFillers}
          onCheckedChange={(v) => onChange({ removeFillers: v })}
          aria-label="Remove filler words"
        />
      </div>

      {settings.removeFillers ? (
        <Field label="Filler list (comma-separated)">
          <Input
            value={settings.fillerWords.join(", ")}
            onChange={(e) =>
              onChange({
                fillerWords: e.target.value
                  .split(",")
                  .map((w) => w.trim().toLowerCase())
                  .filter(Boolean)
                  .slice(0, 40),
              })
            }
            placeholder="um, uh, er, ah, like, you know"
          />
        </Field>
      ) : null}
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
