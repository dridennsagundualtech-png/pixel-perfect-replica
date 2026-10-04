import { useEffect, useState } from "react";
import { createDefaultAiSettings, createDefaultRules } from "./detection/defaults";
import type {
  AiSettings,
  ClipCandidate,
  DetectionMode,
  DetectionRule,
  ProjectStatus,
} from "./detection/types";
import type { TranscriptionResult } from "./detection/transcript";

/**
 * Local project store.
 *
 * Deliberately swappable: every read/write goes through this module, so it can
 * later be replaced by Lovable Cloud tables (projects, videos, transcripts,
 * detection_profiles, detection_rules, clip_candidates, clips, processing_jobs,
 * exports) without touching component code.
 */

export interface VideoMeta {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  durationSec?: number | undefined;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  mode: DetectionMode;
  video?: VideoMeta | undefined;
  ai: AiSettings;
  rules: DetectionRule[];
  clips: ClipCandidate[];
  /** True once a real transcript exists. */
  hasTranscript: boolean;
  /** Real timestamped transcript from a transcription provider (none connected yet). */
  transcript?: TranscriptionResult | undefined;
  lastAnalysis?: AnalysisSummary | undefined;
}

export interface AnalysisSummary {
  ranAt: string;
  mode: DetectionMode;
  status: string;
  message: string;
  candidatesEvaluated: number;
  /** Passed every hard filter. */
  passedRules: number;
  /** Failed a hard filter. */
  rejected: number;
  candidatesFound?: number | undefined;
  duplicates?: number | undefined;
  returned?: number | undefined;
  topFailures: { ruleId: string; label: string; count: number }[];
  warnings: string[];
}

const STORAGE_KEY = "clippilot.projects.v1";

let cache: Project[] | null = null;
const listeners = new Set<() => void>();

function read(): Project[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: Project[]) {
  cache = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((l) => l());
}

export function listProjects(): Project[] {
  return [...read()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project | undefined {
  return read().find((p) => p.id === id);
}

export function createProject(input: {
  name: string;
  video?: VideoMeta | undefined;
  mode?: DetectionMode | undefined;
}): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name.trim() || "Untitled project",
    createdAt: now,
    updatedAt: now,
    status: input.video ? "uploaded" : "draft",
    mode: input.mode ?? "ai",
    video: input.video,
    ai: createDefaultAiSettings(),
    rules: createDefaultRules(),
    clips: [],
    hasTranscript: false,
  };
  write([...read(), project]);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>) {
  write(
    read().map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)),
  );
}

export function deleteProject(id: string) {
  write(read().filter((p) => p.id !== id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** SSR-safe subscription to the project list. */
export function useProjects(): { projects: Project[]; ready: boolean } {
  const [state, setState] = useState<{ projects: Project[]; ready: boolean }>({
    projects: [],
    ready: false,
  });

  useEffect(() => {
    const sync = () => setState({ projects: listProjects(), ready: true });
    sync();
    return subscribe(sync);
  }, []);

  return state;
}

export function useProject(id: string): { project?: Project | undefined; ready: boolean } {
  const [state, setState] = useState<{ project?: Project | undefined; ready: boolean }>({
    ready: false,
  });

  useEffect(() => {
    const sync = () => setState({ project: getProject(id), ready: true });
    sync();
    return subscribe(sync);
  }, [id]);

  return state;
}
