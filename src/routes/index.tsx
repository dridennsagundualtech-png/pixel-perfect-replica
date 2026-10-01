import { createFileRoute, Link } from "@tanstack/react-router";
import { Clapperboard, Clock, HardDrive, Plus, Scissors, Video } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/lib/projects";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClipPilot — Turn long videos into short-form clips" },
      {
        name: "description",
        content:
          "ClipPilot is a personal clipping studio: upload long videos and find short-form moments with AI, your own rules, or both.",
      },
      { property: "og:title", content: "ClipPilot — Turn long videos into short-form clips" },
      {
        property: "og:description",
        content: "A personal clipping studio with AI mode, rule mode and hybrid detection.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { projects, ready } = useProjects();
  const clipCount = projects.reduce((sum, p) => sum + p.clips.length, 0);

  return (
    <AppShell>
      <PageHeader
        title="ClipPilot"
        subtitle="Turn long videos into short-form clips."
        actions={
          <Button asChild size="lg">
            <Link to="/projects/new">
              <Plus className="size-4" /> New Project
            </Link>
          </Button>
        }
      />

      <section className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Video} label="Videos processed" value="0" note="No processing run yet" />
        <Stat icon={Scissors} label="Clips created" value={String(clipCount)} note="Exported clips" />
        <Stat icon={Clock} label="Processing time" value="—" note="Tracked once jobs run" />
        <Stat icon={HardDrive} label="Storage used" value="—" note="Tracked once uploads are stored" />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Recent projects</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/projects">View all</Link>
          </Button>
        </div>

        {!ready ? (
          <div className="panel h-48 animate-pulse" />
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.slice(0, 6).map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Video;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-3 font-display text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="panel flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <Clapperboard className="size-7" />
      </span>
      <div>
        <h3 className="text-lg font-semibold">No projects yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Start a project, add a long video, and set up how clips should be found — with AI, with
          your own rules, or both.
        </p>
      </div>
      <Button asChild>
        <Link to="/projects/new">
          <Plus className="size-4" /> New Project
        </Link>
      </Button>
    </div>
  );
}
