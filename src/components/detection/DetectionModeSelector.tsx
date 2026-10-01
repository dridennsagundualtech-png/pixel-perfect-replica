import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MODE_META } from "@/lib/detection/defaults";
import type { DetectionMode } from "@/lib/detection/types";

const MODES: DetectionMode[] = ["ai", "rules", "hybrid"];

export function DetectionModeSelector({
  value,
  onChange,
  allowExperimental = true,
}: {
  value: DetectionMode;
  onChange: (mode: DetectionMode) => void;
  allowExperimental?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {MODES.map((mode) => {
        const meta = MODE_META[mode];
        const disabled = Boolean(meta.experimental) && !allowExperimental;
        const selected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(mode)}
            className={cn(
              "rounded-xl border p-4 text-left transition-all",
              "border-border bg-card hover:border-primary/50",
              selected && "border-primary bg-primary/10 shadow-glow",
              disabled && "cursor-not-allowed opacity-50 hover:border-border",
            )}
          >
            <div className="flex items-center gap-2">
              <span aria-hidden className="text-lg">
                {meta.icon}
              </span>
              <span className="font-display font-semibold">{meta.label}</span>
              {meta.experimental ? (
                <Badge variant="outline" className="ml-auto border-accent/50 text-accent">
                  Experimental
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{meta.description}</p>
          </button>
        );
      })}
    </div>
  );
}
