import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CAPTION_PRESETS,
  CAPTION_SAFE_AREA,
  type CaptionPosition,
  type CaptionSettings,
  type CaptionSize,
  type CaptionStyleId,
} from "@/lib/video/dynamic-captions";
import {
  deleteCustomCaptionPreset,
  loadCustomCaptionPresets,
  saveCustomCaptionPreset,
  type CustomCaptionPreset,
} from "@/lib/video/caption-settings";
import {
  clearCustomCaptionFont,
  loadCustomCaptionFontMeta,
  saveCustomCaptionFont,
  updateCustomFontFamilyName,
} from "@/lib/video/caption-font-store";
import { clearCaptionFontCache } from "@/lib/video/local-video-renderer";

/** ASS BGR hex without &H prefix helpers for colour inputs (approx UI only). */
function assToCss(ass?: string): string {
  if (!ass || !ass.startsWith("&H") || ass.length < 10) return "#ffffff";
  const b = ass.slice(4, 6);
  const g = ass.slice(6, 8);
  const r = ass.slice(8, 10);
  return `#${r}${g}${b}`;
}

function cssToAss(css: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return "&H00FFFFFF";
  const hex = m[1]!;
  const r = hex.slice(0, 2);
  const g = hex.slice(2, 4);
  const b = hex.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

export function CaptionSettingsPanel({
  settings,
  onChange,
}: {
  settings: CaptionSettings;
  onChange: (patch: Partial<CaptionSettings>) => void;
}) {
  const off = !settings.enabled;
  const [customs, setCustoms] = useState<CustomCaptionPreset[]>(() => loadCustomCaptionPresets());
  const [saveName, setSaveName] = useState("");
  const [fontMeta, setFontMeta] = useState<{ fileName: string; familyName: string } | null>(null);
  const [fontBusy, setFontBusy] = useState(false);
  useEffect(() => {
    void loadCustomCaptionFontMeta().then(setFontMeta);
  }, []);

  return (
    <div className="panel mb-4 space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Short captions</h3>
          <p className="text-xs text-muted-foreground">
            Used by Export Short. Word timing comes from the transcript.
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
          aria-label="Burn in captions"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Preset">
          <Select
            disabled={off}
            value={settings.style}
            onValueChange={(v) => onChange({ style: v as CaptionStyleId })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CAPTION_PRESETS) as CaptionStyleId[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {CAPTION_PRESETS[id].label} — {CAPTION_PRESETS[id].description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Size">
          <Select
            disabled={off}
            value={settings.size}
            onValueChange={(v) => onChange({ size: v as CaptionSize })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="small">Small</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="large">Large</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Position">
          <Select
            disabled={off}
            value={settings.position}
            onValueChange={(v) => onChange({ position: v as CaptionPosition })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Top</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="lower">Lower (recommended)</SelectItem>
              <SelectItem value="bottom">Bottom</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Words per caption">
          <Select
            disabled={off}
            value={String(settings.maxWords)}
            onValueChange={(v) => onChange({ maxWords: Number(v) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Up to {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Max lines">
          <Select
            disabled={off}
            value={String(settings.maxLines ?? 2)}
            onValueChange={(v) => onChange({ maxLines: Number(v) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Text colour">
          <input
            type="color"
            disabled={off}
            className="h-9 w-full cursor-pointer rounded border border-border bg-transparent"
            value={assToCss(settings.textColor || CAPTION_PRESETS[settings.style]?.primary)}
            onChange={(e) => onChange({ textColor: cssToAss(e.target.value) })}
          />
        </Field>
        <Field label="Highlight colour">
          <input
            type="color"
            disabled={off || !settings.highlightWord}
            className="h-9 w-full cursor-pointer rounded border border-border bg-transparent"
            value={assToCss(settings.highlightColor || CAPTION_PRESETS[settings.style]?.active)}
            onChange={(e) => onChange({ highlightColor: cssToAss(e.target.value) })}
          />
        </Field>
        <Field label="Outline">
          <Input
            type="number"
            min={0}
            max={10}
            step={1}
            disabled={off}
            value={settings.outline ?? CAPTION_PRESETS[settings.style]?.outline ?? 4}
            onChange={(e) => onChange({ outline: Number(e.target.value) })}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          disabled={off}
          checked={settings.highlightWord}
          onCheckedChange={(v) => onChange({ highlightWord: v })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">End pad after last word (sec)</Label>
            <Input
              type="number"
              min={0}
              max={0.35}
              step={0.05}
              disabled={off}
              value={settings.endPadSec ?? 0.15}
              onChange={(e) => onChange({ endPadSec: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Silence gap to split groups (sec)
            </Label>
            <Input
              type="number"
              min={0.25}
              max={2}
              step={0.05}
              disabled={off}
              value={settings.groupPauseSec ?? 0.55}
              onChange={(e) => onChange({ groupPauseSec: Number(e.target.value) })}
            />
          </div>
        </div>
        Highlight the word being spoken
      </label>

      {/* Safe-area guide (visual only) */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Safe area (export uses the same margins)</p>
        <div className="relative mx-auto aspect-[9/16] max-h-40 w-28 rounded border border-border bg-muted/40">
          <div
            className="absolute border border-dashed border-primary/50"
            style={{
              top: `${CAPTION_SAFE_AREA.topPct * 100}%`,
              bottom: `${CAPTION_SAFE_AREA.bottomPct * 100}%`,
              left: `${CAPTION_SAFE_AREA.sidePct * 100}%`,
              right: `${CAPTION_SAFE_AREA.sidePct * 100}%`,
            }}
          />
          <div
            className={`absolute left-1/2 w-[70%] -translate-x-1/2 rounded bg-foreground/80 py-0.5 text-center text-[8px] text-background ${
              settings.position === "top"
                ? "top-[14%]"
                : settings.position === "center"
                  ? "top-1/2 -translate-y-1/2"
                  : settings.position === "bottom"
                    ? "bottom-[12%]"
                    : "bottom-[22%]"
            }`}
          >
            Aa
          </div>
        </div>
      </div>

      {/* Custom presets */}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium">
          {/* Custom font (your paid .ttf / .otf) */}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium">Caption font</p>
            <p className="text-[11px] text-muted-foreground">
              Upload a .ttf or .otf you own. Stored only in this browser. Leave empty to use Anton.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Font family name</Label>
                <Input
                  disabled={off}
                  placeholder="e.g. Montserrat Bold"
                  value={settings.fontFamily ?? fontMeta?.familyName ?? ""}
                  onChange={(e) => {
                    onChange({ fontFamily: e.target.value });
                    void updateCustomFontFamilyName(e.target.value);
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Use the real name of the font (as in the file), not the filename only.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Font file</Label>
                <Input
                  type="file"
                  accept=".ttf,.otf,font/ttf,font/otf"
                  disabled={off || fontBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setFontBusy(true);
                    void (async () => {
                      try {
                        const saved = await saveCustomCaptionFont(
                          file,
                          settings.fontFamily || undefined,
                        );
                        clearCaptionFontCache();
                        setFontMeta({ fileName: saved.fileName, familyName: saved.familyName });
                        onChange({ fontFamily: saved.familyName });
                      } catch (err) {
                        console.warn(err);
                      } finally {
                        setFontBusy(false);
                      }
                    })();
                  }}
                />
                {fontMeta ? (
                  <p className="text-[11px] text-muted-foreground">
                    Loaded: {fontMeta.fileName} · {fontMeta.familyName}{" "}
                    <button
                      type="button"
                      className="text-primary underline"
                      disabled={off}
                      onClick={() => {
                        void (async () => {
                          await clearCustomCaptionFont();
                          clearCaptionFontCache();
                          setFontMeta(null);
                          onChange({ fontFamily: undefined });
                        })();
                      }}
                    >
                      Remove
                    </button>
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Using default font (Anton)</p>
                )}
              </div>
            </div>
          </div>
          Custom presets (this browser)
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-[160px]"
            placeholder="Name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            disabled={off}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={off || !saveName.trim()}
            onClick={() => {
              const next = saveCustomCaptionPreset(saveName, settings);
              setCustoms(next);
              setSaveName("");
            }}
          >
            Save preset
          </Button>
        </div>
        {customs.length ? (
          <ul className="space-y-1 text-xs">
            {customs.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  disabled={off}
                  onClick={() => onChange({ ...p.settings })}
                >
                  {p.name}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-muted-foreground"
                  onClick={() => setCustoms(deleteCustomCaptionPreset(p.id))}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">No custom presets saved yet.</p>
        )}
      </div>
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
