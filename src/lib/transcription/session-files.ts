/**
 * The actual video File for each project, held in memory for this browser tab
 * only (files can't be saved to localStorage). After a reload the user
 * re-selects the file; once cloud storage exists this goes away.
 *
 * Stored on globalThis so a hot-reloaded or duplicated copy of this module
 * still sees the same files (otherwise the workspace loses the File).
 */
type Store = { files: Map<string, File>; listeners: Set<() => void> };
const g = globalThis as typeof globalThis & { __clippilotSessionFiles?: Store };
const store: Store = (g.__clippilotSessionFiles ??= { files: new Map(), listeners: new Set() });

export function setProjectFile(projectId: string, file: File) {
  store.files.set(projectId, file);
  store.listeners.forEach((l) => l());
}

export function getProjectFile(projectId: string): File | undefined {
  return store.files.get(projectId);
}

export function subscribeProjectFiles(listener: () => void) {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}
