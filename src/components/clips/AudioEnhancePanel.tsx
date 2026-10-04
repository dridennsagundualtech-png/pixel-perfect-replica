import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AudioEnhanceSettings, AudioEnhanceStrength } from "@/lib/video/audio-enhance";

export function AudioEnhancePanel({
  settings,
  onChange,
}: {
  settings: AudioEnhanceSettings;
  onChange: (patch: Partial<AudioEnhanceSettings>) => void;
}) {
  const row = (label: string, key: "noiseReduction" | "voiceClarity" | "loudnessNormalize") => (
    <div className="flex items-center justify-between">
      <Label className="font-normal text-muted-foreground">{label}</Label>
      <Switch
        checked={settings[key]}
        disabled={!settings.enabled}
        onCheckedChange={(v) => onChange({ [key]: v })}
      />
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Audio enhance (export)</p>
          <p className="text-xs text-muted-foreground">
            Applied only when exporting — does not change silence cuts or the edit timeline.
          </p>
        </div>
        <Switch checked={settings.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
      </div>
      {row("Noise reduction", "noiseReduction")}
      {row("Voice clarity", "voiceClarity")}
      {row("Loudness normalize", "loudnessNormalize")}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Strength</Label>
        <Select
          value={settings.strength}
          disabled={!settings.enabled}
          onValueChange={(v) => onChange({ strength: v as AudioEnhanceStrength })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Prioritizes natural speech. Preview uses the original audio; enhancement is on the final
        MP4 only (keeps the browser stable).
      </p>
    </div>
  );
}
