import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BUILT_IN_PROFILES, MODE_META, RULE_GROUP_META } from "@/lib/detection/defaults";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Templates — ClipPilot" },
      {
        name: "description",
        content: "Reusable detection templates for AI, rule-based and hybrid clip finding.",
      },
      { property: "og:title", content: "Templates — ClipPilot" },
      {
        property: "og:description",
        content: "Starting points for how ClipPilot should find clips.",
      },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  return (
    <AppShell>
      <PageHeader
        title="Templates"
        subtitle="Saved starting points for clip length, rules and AI weighting."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BUILT_IN_PROFILES.map((profile) => {
          const enabled = profile.rules.rules.filter((r) => r.enabled).length;
          return (
            <article key={profile.id} className="panel flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold">{profile.name}</h3>
                <Badge variant="outline">
                  {MODE_META[profile.mode].icon} {MODE_META[profile.mode].label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{profile.description}</p>
              <dl className="mt-auto space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Clip length</dt>
                  <dd className="font-mono">
                    {profile.ai.minDurationSec}–{profile.ai.maxDurationSec}s
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Active rules</dt>
                  <dd className="font-mono">{enabled}</dd>
                </div>
              </dl>
              <Button variant="secondary" size="sm" disabled>
                Use template
              </Button>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Applying and saving your own templates arrives with the detection engine. Each template
        covers {Object.values(RULE_GROUP_META).length} rule sections plus AI weighting.
      </p>
    </AppShell>
  );
}
