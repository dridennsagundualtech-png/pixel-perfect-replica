import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/lib/projects";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — ClipPilot" },
      { name: "description", content: "All of your ClipPilot clipping projects in one place." },
      { property: "og:title", content: "Projects — ClipPilot" },
      { property: "og:description", content: "All of your ClipPilot clipping projects." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { projects, ready } = useProjects();

  return (
    <AppShell>
      <PageHeader
        title="Projects"
        subtitle="Every video you've brought into ClipPilot."
        actions={
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="size-4" /> New Project
            </Link>
          </Button>
        }
      />

      {!ready ? (
        <div className="panel h-48 animate-pulse" />
      ) : projects.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <h3 className="text-lg font-semibold">Nothing here yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first project to get started.
          </p>
          <Button asChild className="mt-5">
            <Link to="/projects/new">
              <Plus className="size-4" /> New Project
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
