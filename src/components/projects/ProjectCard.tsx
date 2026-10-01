import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MODE_META } from "@/lib/detection/defaults";
import { formatDuration, formatRelativeDate } from "@/lib/format";
import type { Project } from "@/lib/projects";

const STATUS_LABEL: Record<Project["status"], string> = {
  draft: "Draft",
  uploaded: "Not analysed",
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="panel group block overflow-hidden transition-colors hover:border-primary/50"
    >
      <div className="flex aspect-video items-center justify-center bg-muted/60">
        <Film className="size-8 text-muted-foreground" />
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold">{project.name}</h3>
          <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {project.video?.fileName ?? "No video uploaded"}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{formatDuration(project.video?.durationSec)}</span>
          <span>· {project.clips.length} clips</span>
          <span>· {formatRelativeDate(project.updatedAt)}</span>
          <span className="ml-auto">
            {MODE_META[project.mode].icon} {MODE_META[project.mode].label}
          </span>
        </div>
      </div>
    </Link>
  );
}
