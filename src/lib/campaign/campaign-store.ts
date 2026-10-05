import { useEffect, useState } from "react";
import type { KeyValueStorage } from "@/lib/creator-presets";
import type {
  Campaign,
  CampaignRequirement,
  DetectionMethod,
  RequirementCategory,
  RequirementType,
} from "./types";
import { CATEGORY_LABELS, METHOD_LABELS, TYPE_LABELS } from "./types";

/**
 * Local campaign storage. Only one campaign is active; deactivating returns
 * ClipPilot to Normal Mode. Campaign data never touches global settings.
 */

const KEY = "clippilot.campaigns.v1";
const ACTIVE_KEY = "clippilot.activeCampaign.v1";

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

let seq = 0;
export function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }
}

function validRequirement(raw: unknown): CampaignRequirement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CampaignRequirement>;
  if (typeof r.text !== "string" || !r.text.trim()) return null;
  return {
    id: typeof r.id === "string" && r.id ? r.id : newId("req"),
    category: r.category && r.category in CATEGORY_LABELS ? r.category : "other",
    text: r.text.trim().slice(0, 300),
    type: r.type && r.type in TYPE_LABELS ? r.type : "review",
    method: r.method && r.method in METHOD_LABELS ? r.method : "manual",
    active: r.active !== false,
    check: r.check && typeof r.check === "object" && r.check.kind ? r.check : undefined,
    origin: r.origin === "ai" || r.origin === "local" ? r.origin : "user",
  };
}

export function validateCampaign(raw: unknown): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Campaign>;
  if (typeof c.name !== "string" || !c.name.trim()) return null;
  const now = new Date().toISOString();
  return {
    id: typeof c.id === "string" && c.id ? c.id : newId("campaign"),
    name: c.name.trim().slice(0, 80),
    description: typeof c.description === "string" ? c.description : undefined,
    brief: typeof c.brief === "string" ? c.brief : "",
    url: typeof c.url === "string" ? c.url : undefined,
    approvedSources: Array.isArray(c.approvedSources)
      ? c.approvedSources.map((s) => String(s).trim()).filter(Boolean)
      : [],
    notes: typeof c.notes === "string" ? c.notes : undefined,
    requirements: Array.isArray(c.requirements)
      ? c.requirements.map(validRequirement).filter((r): r is CampaignRequirement => r !== null)
      : [],
    createdAt: typeof c.createdAt === "string" ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : now,
  };
}

export function listCampaigns(storage = defaultStorage()): Campaign[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.map(validateCampaign).filter((c): c is Campaign => c !== null)
      : [];
  } catch {
    return [];
  }
}

function write(list: Campaign[], storage: KeyValueStorage | null) {
  if (!storage) return;
  storage.setItem(KEY, JSON.stringify(list));
  emit();
}

export class CampaignError extends Error {}

function nameTaken(list: Campaign[], name: string, exceptId?: string) {
  const n = name.trim().toLowerCase();
  return list.some((c) => c.id !== exceptId && c.name.toLowerCase() === n);
}

export function createCampaign(
  input: Partial<Campaign> & { name: string },
  storage = defaultStorage(),
): Campaign {
  const list = listCampaigns(storage);
  if (nameTaken(list, input.name))
    throw new CampaignError(`A campaign named "${input.name.trim()}" already exists.`);
  const c = validateCampaign({ ...input, id: newId("campaign") });
  if (!c) throw new CampaignError("Campaign name is required.");
  write([...list, c], storage);
  return c;
}

export function updateCampaign(
  id: string,
  patch: Partial<Campaign>,
  storage = defaultStorage(),
): Campaign {
  const list = listCampaigns(storage);
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) throw new CampaignError("Campaign not found.");
  if (patch.name !== undefined && nameTaken(list, patch.name, id))
    throw new CampaignError(`A campaign named "${patch.name.trim()}" already exists.`);
  const next = validateCampaign({
    ...list[i]!,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  });
  if (!next) throw new CampaignError("Campaign name is required.");
  list[i] = next;
  write(list, storage);
  return next;
}

function uniqueName(list: Campaign[], base: string): string {
  let name = base;
  let n = 2;
  while (nameTaken(list, name)) name = `${base} ${n++}`;
  return name;
}

export function duplicateCampaign(id: string, storage = defaultStorage()): Campaign {
  const list = listCampaigns(storage);
  const src = list.find((c) => c.id === id);
  if (!src) throw new CampaignError("Campaign not found.");
  const copy = validateCampaign({
    ...JSON.parse(JSON.stringify(src)),
    id: newId("campaign"),
    name: uniqueName(list, `${src.name} (copy)`),
    requirements: src.requirements.map((r) => ({ ...r, id: newId("req") })),
    createdAt: new Date().toISOString(),
  })!;
  write([...list, copy], storage);
  return copy;
}

export function deleteCampaign(id: string, storage = defaultStorage()): void {
  const list = listCampaigns(storage);
  write(
    list.filter((c) => c.id !== id),
    storage,
  );
  if (getActiveCampaignId(storage) === id) deactivateCampaign(storage);
}

export function getActiveCampaignId(storage = defaultStorage()): string | null {
  try {
    return storage?.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function getActiveCampaign(storage = defaultStorage()): Campaign | null {
  const id = getActiveCampaignId(storage);
  return id ? (listCampaigns(storage).find((c) => c.id === id) ?? null) : null;
}

export function activateCampaign(id: string, storage = defaultStorage()): void {
  if (!listCampaigns(storage).some((c) => c.id === id))
    throw new CampaignError("Campaign not found.");
  storage?.setItem(ACTIVE_KEY, id);
  emit();
}

export function deactivateCampaign(storage = defaultStorage()): void {
  storage?.setItem(ACTIVE_KEY, "");
  emit();
}

export function exportCampaignJson(c: Campaign): string {
  return JSON.stringify({ clippilotCampaign: 1, campaign: c }, null, 2);
}

/** Import a campaign JSON. Name clashes get a unique suffix; ids are regenerated. */
export function importCampaignJson(json: string, storage = defaultStorage()): Campaign {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CampaignError("This file isn't valid campaign JSON.");
  }
  const raw = (parsed as { campaign?: unknown })?.campaign ?? parsed;
  const c = validateCampaign(raw);
  if (!c) throw new CampaignError("This file doesn't contain a campaign with a name.");
  const list = listCampaigns(storage);
  const imported: Campaign = {
    ...c,
    id: newId("campaign"),
    name: uniqueName(list, c.name),
    requirements: c.requirements.map((r) => ({ ...r, id: newId("req") })),
  };
  write([...list, imported], storage);
  return imported;
}

export function makeRequirement(
  text: string,
  category: RequirementCategory = "other",
  type: RequirementType = "review",
  method: DetectionMethod = "manual",
): CampaignRequirement {
  return { id: newId("req"), category, text, type, method, active: true, origin: "user" };
}

/** Reactive active campaign + list for UI. */
export function useCampaigns() {
  const [state, setState] = useState<{ list: Campaign[]; active: Campaign | null }>({
    list: [],
    active: null,
  });
  useEffect(() => {
    const sync = () => setState({ list: listCampaigns(), active: getActiveCampaign() });
    sync();
    listeners.add(sync);
    window.addEventListener("storage", sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return state;
}
