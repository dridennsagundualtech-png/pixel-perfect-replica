import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileVideo, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { DetectionModeSelector } from "@/components/detection/DetectionModeSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "@/lib/format";
import { createProject, type VideoMeta } from "@/lib/projects";
import type { DetectionMode } from "@/lib/detection/types";
import { setProjectFile } from "@/lib/transcription/session-files";

const ACCEPTED = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_SIZE_PLACEHOLDER = "Maximum file size: 2 GB (placeholder until storage is connected)";

export const Route = createFileRoute("/projects/new")({
  head: () => ({
    meta: [
      { title: "New project — ClipPilot" },
      {
        name: "description",
        content: "Name a project, add a long video, and choose how ClipPilot should find clips.",
      },
      { property: "og:title", content: "New project — ClipPilot" },
      {
        property: "og:description",
        content: "Start a ClipPilot project and choose AI, rule or hybrid detection.",
      },
    ],
  }),
  component: NewProjectPage,
});

function NewProjectPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<DetectionMode>("ai");
  const [dragging, setDragging] = useState(false);
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const accept = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Please choose an MP4, MOV or WEBM video.");
      return;
    }
    const durationSec = await readDuration(file).catch(() => undefined);
    setFile(file);
    setVideo({
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      durationSec,
    });
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  };

  const submit = () => {
    const project = createProject({ name, video: video ?? undefined, mode });
    if (file && video) setProjectFile(project.id, file);
    toast.success("Project created");
    navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
  };

  return (
    <AppShell>
      <PageHeader title="New project" subtitle="Add a video and pick a detection mode." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="panel space-y-6 p-6 lg:col-span-2">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              placeholder="Episode 42 — full interview"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Upload video</Label>
            {video ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <FileVideo className="size-6 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{video.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(video.sizeBytes)} · {formatDuration(video.durationSec)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setVideo(null);
                    setFile(null);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void accept(file);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-input px-6 py-14 text-center transition-colors",
                  dragging && "border-primary bg-primary/10",
                )}
              >
                <UploadCloud className="size-8 text-muted-foreground" />
                <p className="font-medium">Drag your video here or browse files</p>
                <p className="text-xs text-muted-foreground">MP4, MOV or WEBM</p>
                <p className="text-xs text-muted-foreground">{MAX_SIZE_PLACEHOLDER}</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void accept(file);
              }}
            />
            <p className="text-xs text-muted-foreground">
              The file stays on your device for now. Uploads move to cloud storage once the
              processing backend is connected.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Detection mode</Label>
            <DetectionModeSelector value={mode} onChange={setMode} allowExperimental={false} />
          </div>

          <div className="flex gap-2">
            <Button onClick={submit} disabled={!name.trim() && !video}>
              Create project
            </Button>
          </div>
        </div>

        <aside className="panel space-y-3 p-6 text-sm text-muted-foreground">
          <h2 className="font-display text-base font-semibold text-foreground">
            What happens next
          </h2>
          <p>
            Once created, the project opens in the workspace where you fine-tune detection settings.
          </p>
          <p>
            Transcription runs on your device with a free Whisper model, then Rule mode finds clips.
            Cutting and rendering clips isn't connected yet.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Math.round(el.duration));
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("metadata unavailable"));
    };
    el.src = url;
  });
}
