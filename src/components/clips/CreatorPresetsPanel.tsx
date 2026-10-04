import { useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  captureValues,
  createPreset,
  deletePreset,
  getActivePresetId,
  listPresets,
  setActivePresetId,
  updatePreset,
  type CreatorPreset,
  type CreatorPresetValues,
} from "@/lib/creator-presets";
import type { CaptionSettings } from "@/lib/video/dynamic-captions";
import type { AudioEnhanceSettings } from "@/lib/video/audio-enhance";
import {
  EXPORT_PRESETS,
  FORMAT_META,
  REFRAME_LABELS,
  getOutputSize,
  type AspectFormat,
  type OutputSettings,
  type ReframeChoice,
} from "@/lib/video/output-format";

const STEPS = ["Analyze", "Best Moments", "Edit", "Customize", "Export"];

export function CreatorPresetsPanel({
  output,
  onOutputChange,
  captionSettings,
  onCaptionChange,
  audioEnhance,
  onAudioChange,
  musicOn,
  musicVolume,
  onMusicVolume,
  step,
}: {
  output: OutputSettings;
  onOutputChange: (patch: Partial<OutputSettings>) => void;
  captionSettings: CaptionSettings;
  onCaptionChange: (patch: Partial<CaptionSettings>) => void;
  audioEnhance: AudioEnhanceSettings;
  onAudioChange: (patch: Partial<AudioEnhanceSettings>) => void;
  musicOn: boolean;
  musicVolume: number;
  onMusicVolume: (v: number) => void;
  /** 0-based workflow step currently reached. */
  step: number;
}) {
  const [presets, setPresets] = useState<CreatorPreset[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [name, setName] = useState("");

  useEffect(() => {
    setPresets(listPresets());
    setActiveId(getActivePresetId() ?? "");
  }, []);

  const active = presets.find((p) => p.id === activeId) ?? null;
  const size = getOutputSize(output.format, output.resolution);

  const apply = (p: CreatorPreset) => {
    try {
      const v: CreatorPresetValues = p.values;
      onOutputChange(v.output);
      onCaptionChange(v.caption);
      onAudioChange(v.audioEnhance);
      if (musicOn) onMusicVolume(v.musicVolume);
      setActiveId(p.id);
      setActivePresetId(p.id);
      toast.success(`Preset "${p.name}" applied`);
    } catch {
      toast.error("This preset could not be loaded. Your current settings were preserved.");
    }
  };

  const current = () => captureValues(output, captionSettings, audioEnhance, musicVolume);

  const saveNew = () => {
    const p = createPreset(name || "My preset", current());
    setPresets(listPresets());
    setActiveId(p.id);
    setActivePresetId(p.id);
    setName("");
    toast.success(`Saved preset "${p.name}"`);
  };

  const update = () => {
    if (!active || active.builtIn) return;
    const p = updatePreset(active.id, { values: current() });
    setPresets(listPresets());
    if (p) toast.success(`Updated "${p.name}"`);
    else toast.error("This preset could not be updated.");
  };

  const remove = () => {
    if (!active || active.builtIn) return;
    deletePreset(active.id);
    setPresets(listPresets());
    setActiveId("");
    setActivePresetId(null);
    toast.message(`Deleted "${active.name}"`);
  };

  return (
    <div className="panel mb-3 space-y-4 p-4">
      <ol className="flex flex-wrap gap-1.5 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              i <= step
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            <span className="font-mono">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Creator preset</Label>
          <div className="flex gap-2">
            <Select
              value={activeId || undefined}
              onValueChange={(id) => {
                const p = presets.find((x) => x.id === id);
                if (p) apply(p);
                else toast.error("This preset could not be loaded. Your current settings were preserved.");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.builtIn ? "" : " (yours)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Update preset with current settings"
              disabled={!active || active.builtIn}
              onClick={update}
            >
              <Save className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete preset"
              disabled={!active || active.builtIn}
              onClick={remove}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="New preset name"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
            <Button size="sm" variant="secondary" onClick={saveNew}>
              Save as new
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The chosen preset becomes the default for new clips. Saved in this browser only.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Format</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(FORMAT_META) as AspectFormat[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={output.format === f ? "default" : "outline"}
                  onClick={() => onOutputChange({ format: f })}
                >
                  {FORMAT_META[f].ratio}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Export preset</Label>
              <Select
                value={
                  EXPORT_PRESETS.find(
                    (p) => p.format === output.format && p.resolution === output.resolution,
                  )?.id
                }
                onValueChange={(id) => {
                  const p = EXPORT_PRESETS.find((x) => x.id === id);
                  if (p) onOutputChange({ format: p.format, resolution: p.resolution });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Custom" />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reframe</Label>
              <Select
                value={output.reframe}
                onValueChange={(v) => onOutputChange({ reframe: v as ReframeChoice })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REFRAME_LABELS) as ReframeChoice[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {REFRAME_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <Badge variant="secondary">
          {FORMAT_META[output.format].ratio} · {size.width}×{size.height}
        </Badge>
        <Badge variant="outline">Preset: {active?.name ?? "None"}</Badge>
        <Badge variant="outline">Captions {captionSettings.enabled ? "on" : "off"}</Badge>
        <Badge variant="outline">Audio enhance {audioEnhance.enabled ? "on" : "off"}</Badge>
        <Badge variant="outline">Music {musicOn ? "on" : "off"}</Badge>
        <Badge variant="outline">
          Reframe {output.reframe === "auto" ? "automatic" : `manual (${REFRAME_LABELS[output.reframe]})`}
        </Badge>
      </div>
    </div>
  );
}
