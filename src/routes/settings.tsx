import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DetectionModeSelector } from "@/components/detection/DetectionModeSelector";
import { BUILT_IN_PROFILES } from "@/lib/detection/defaults";
import type { DetectionMode } from "@/lib/detection/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ClipPilot" },
      {
        name: "description",
        content: "Choose defaults for AI usage, video output, detection and storage in ClipPilot.",
      },
      { property: "og:title", content: "Settings — ClipPilot" },
      { property: "og:description", content: "ClipPilot defaults for AI, video and detection." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [aiEnabled, setAiEnabled] = useState(true);
  const [depth, setDepth] = useState("standard");
  const [mode, setMode] = useState<DetectionMode>("ai");
  const [profile, setProfile] = useState(BUILT_IN_PROFILES[0]?.id ?? "balanced");

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Defaults applied to every new project." />

      <div className="space-y-6">
        <Section title="AI" description="AI is always optional — rule mode works without it.">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
            <div>
              <Label>Use AI</Label>
              <p className="text-xs text-muted-foreground">
                Turn off to keep everything rule-based.
              </p>
            </div>
            <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
          </div>
          <Field label="Model">
            <Select disabled={!aiEnabled} value="not-configured">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not-configured">Not configured yet</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Analysis depth">
            <Select value={depth} onValueChange={setDepth} disabled={!aiEnabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick">Quick</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="deep">Deep</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Monthly AI budget">
            <Input placeholder="Not tracked yet" disabled />
          </Field>
        </Section>

        <Section title="Video" description="Defaults for exported clips.">
          <Field label="Aspect ratio">
            <Select defaultValue="9:16">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="9:16">9:16 vertical</SelectItem>
                <SelectItem value="1:1">1:1 square</SelectItem>
                <SelectItem value="16:9">16:9 horizontal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum clip length (s)">
              <Input type="number" defaultValue={15} />
            </Field>
            <Field label="Maximum clip length (s)">
              <Input type="number" defaultValue={60} />
            </Field>
          </div>
          <Field label="Captions">
            <Select defaultValue="bold">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">No captions</SelectItem>
                <SelectItem value="clean">Clean single line</SelectItem>
                <SelectItem value="bold">Bold word-by-word</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title="Detection" description="What new projects start with.">
          <DetectionModeSelector value={mode} onChange={setMode} allowExperimental={false} />
          <Field label="Default rule template">
            <Select value={profile} onValueChange={setProfile}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_PROFILES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section
          title="Storage"
          description="Uploads stay on your device until storage is connected."
        >
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Storage used</span>
              <span className="font-mono">— of —</span>
            </div>
            <Progress value={0} />
          </div>
        </Section>

        <Section title="Account" description="Sign-in is not set up yet.">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-secondary">
              🙂
            </span>
            <div>
              <p className="font-medium">Local user</p>
              <p className="text-xs text-muted-foreground">Projects are saved in this browser</p>
            </div>
            <Badge variant="outline" className="ml-auto">
              Not signed in
            </Badge>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
