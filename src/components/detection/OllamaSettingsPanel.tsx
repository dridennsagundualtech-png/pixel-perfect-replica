import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  loadOllamaSettings,
  probeOllama,
  saveOllamaSettings,
  type OllamaStoredSettings,
} from "@/lib/detection/ollama-ranking-provider";

/**
 * Controls whether AI/Hybrid ranking uses Ollama on this PC.
 * Rule Mode never uses Ollama.
 */
export function OllamaSettingsPanel() {
  const [settings, setSettings] = useState<OllamaStoredSettings>(() => loadOllamaSettings());
  const [status, setStatus] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    setSettings(loadOllamaSettings());
  }, []);

  const update = (patch: Partial<OllamaStoredSettings>) => {
    const next = saveOllamaSettings(patch);
    setSettings(next);
  };

  const check = async () => {
    setChecking(true);
    setStatus("Checking Ollama…");
    const r = await probeOllama(settings.baseUrl, settings.model);
    setModels(r.models);
    setStatus(r.message);
    setChecking(false);
  };

  return (
    <div className="panel mb-4 space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Ollama (local AI on your PC)</h3>
          <p className="text-xs text-muted-foreground">
            Used only in AI / Hybrid modes. Nothing is sent to the cloud. Rule Mode ignores this.
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(v) => update({ enabled: v })}
          aria-label="Enable Ollama ranking"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Model</Label>
          <Input
            value={settings.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="llama3.2"
            disabled={!settings.enabled}
            list="ollama-models"
          />
          <datalist id="ollama-models">
            {models.map((m) => (
              <option key={m} value={m.split(":")[0]} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Ollama URL</Label>
          <Input
            value={settings.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434"
            disabled={!settings.enabled}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking…" : "Test connection"}
        </Button>
        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        First time: install Ollama → run{" "}
        <code className="text-foreground">ollama pull llama3.2</code> → allow browser: set env{" "}
        <code className="text-foreground">OLLAMA_ORIGINS=*</code> then restart Ollama.
      </p>
    </div>
  );
}
