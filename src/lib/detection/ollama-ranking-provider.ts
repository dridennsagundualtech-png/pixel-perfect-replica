/**
 * Ollama ranking provider — runs on YOUR PC via http://localhost:11434
 * No cloud API keys. Falls back to local heuristic if Ollama is offline.
 */

import type { AiFactorKey, AiSettings } from "./types";
import {
  localHeuristicRankingProvider,
  rankCandidatesSync,
  type ClipRankingProvider,
  type RankedCandidate,
  type RankingCandidateInput,
} from "./ranking-provider";

const FACTOR_KEYS: AiFactorKey[] = [
  "hook",
  "curiosity",
  "emotion",
  "story",
  "information",
  "quotability",
  "humor",
  "surprise",
  "pacing",
];

export interface OllamaRankingOptions {
  /** Model tag, e.g. "llama3.2" or "qwen2.5:7b" */
  model: string;
  /** Default http://127.0.0.1:11434 */
  baseUrl?: string;
  /** Max candidates to send to the model (rest keep heuristic scores). */
  maxCandidates?: number;
  /** Timeout per request ms */
  timeoutMs?: number;
}

const KEY = "clippilot.ollamaRanking.v1";

export interface OllamaStoredSettings {
  enabled: boolean;
  model: string;
  baseUrl: string;
}

export function loadOllamaSettings(): OllamaStoredSettings {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { enabled: false, model: "llama3.2", baseUrl: "http://127.0.0.1:11434" };
    const v = JSON.parse(raw) as Partial<OllamaStoredSettings>;
    return {
      enabled: !!v.enabled,
      model: (v.model || "llama3.2").trim() || "llama3.2",
      baseUrl: (v.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, ""),
    };
  } catch {
    return { enabled: false, model: "llama3.2", baseUrl: "http://127.0.0.1:11434" };
  }
}

export function saveOllamaSettings(patch: Partial<OllamaStoredSettings>): OllamaStoredSettings {
  const next = { ...loadOllamaSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function clamp100(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)));
}

function buildPrompt(candidates: RankingCandidateInput[], settings: AiSettings): string {
  const weights = FACTOR_KEYS.map((k) => `${k}:${settings.factors[k] ?? 50}`).join(", ");
  const body = candidates
    .map((c, i) => {
      const text = c.window.text.slice(0, 500).replace(/\s+/g, " ").trim();
      return (
        `[${i + 1}] id=${c.id}\n` +
        `duration=${Math.round(c.window.durationSec)}s ruleScore=${c.ruleScore}\n` +
        `signals=${c.signalLabels.slice(0, 6).join("; ")}\n` +
        `text: ${text}`
      );
    })
    .join("\n\n");

  return `You rank short-form video clip candidates for social media.
Score each clip's Engagement Potential from 0-100 (NOT virality probability — just how engaging the moment seems).
Consider: hook strength, curiosity, emotion, story completeness, information density, quotability, humor, surprise, pacing.
User factor weights (0-100): ${weights}

Return ONLY valid JSON array, no markdown, no commentary:
[
  {"id":"...","engagementPotential":72,"explanations":["Strong opening question","Clear payoff"],"factorScores":{"hook":80,"curiosity":70,"emotion":40,"story":55,"information":60,"quotability":75,"humor":20,"surprise":50,"pacing":65}}
]

Candidates:
${body}`;
}

function parseResponse(raw: string, fallback: RankedCandidate[]): RankedCandidate[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return fallback;
  try {
    const arr = JSON.parse(raw.slice(start, end + 1)) as Array<{
      id?: string;
      engagementPotential?: number;
      explanations?: string[];
      factorScores?: Partial<Record<AiFactorKey, number>>;
    }>;
    if (!Array.isArray(arr)) return fallback;
    const byId = new Map(fallback.map((f) => [f.id, f]));
    for (const row of arr) {
      if (!row?.id || !byId.has(row.id)) continue;
      const prev = byId.get(row.id)!;
      const factorScores: Partial<Record<AiFactorKey, number>> = { ...prev.factorScores };
      if (row.factorScores) {
        for (const k of FACTOR_KEYS) {
          const v = row.factorScores[k];
          if (typeof v === "number") factorScores[k] = clamp100(v);
        }
      }
      const explanations = Array.isArray(row.explanations)
        ? row.explanations.map((e) => String(e).slice(0, 80)).filter(Boolean).slice(0, 5)
        : prev.explanations;
      byId.set(row.id, {
        id: row.id,
        engagementPotential: clamp100(Number(row.engagementPotential) || prev.engagementPotential),
        factorScores,
        explanations,
      });
    }
    return fallback.map((f) => byId.get(f.id) ?? f);
  } catch {
    return fallback;
  }
}

async function ollamaGenerate(
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_predict: 2048 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as { response?: string };
    return data.response ?? "";
  } finally {
    clearTimeout(t);
  }
}

/** Probe whether Ollama is reachable and the model exists. */
export async function probeOllama(
  baseUrl = "http://127.0.0.1:11434",
  model = "llama3.2",
): Promise<{ ok: boolean; message: string; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, message: `Ollama returned ${res.status}`, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const has =
      models.some((n) => n === model || n.startsWith(`${model}:`) || n.startsWith(model));
    if (!models.length)
      return {
        ok: false,
        message: "Ollama is running but no models are installed. Run: ollama pull llama3.2",
        models,
      };
    if (!has)
      return {
        ok: false,
        message: `Model "${model}" not found. Installed: ${models.slice(0, 5).join(", ")}. Run: ollama pull ${model}`,
        models,
      };
    return { ok: true, message: `Connected · ${model}`, models };
  } catch {
    return {
      ok: false,
      message:
        "Cannot reach Ollama. Start it (ollama serve) and allow browser access (set OLLAMA_ORIGINS=*).",
      models: [],
    };
  }
}

export function createOllamaRankingProvider(opts?: Partial<OllamaRankingOptions>): ClipRankingProvider {
  const model = opts?.model || loadOllamaSettings().model;
  const baseUrl = (opts?.baseUrl || loadOllamaSettings().baseUrl).replace(/\/$/, "");
  const maxCandidates = opts?.maxCandidates ?? 12;
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  return {
    id: "ollama",
    label: `Ollama (${model})`,

    async rankCandidates(candidates, settings) {
      // Always compute heuristic baseline first (fast + fallback).
      const baseline = rankCandidatesSync(candidates, settings);
      if (!candidates.length) return baseline;

      const slice = candidates.slice(0, maxCandidates);
      const prompt = buildPrompt(slice, settings);

      try {
        const raw = await ollamaGenerate(baseUrl, model, prompt, timeoutMs);
        const merged = parseResponse(raw, baseline);
        // Candidates beyond max keep heuristic scores (already in baseline order by id map).
        return merged;
      } catch (e) {
        console.warn("[ollama-ranking] fallback to heuristic", e);
        return baseline;
      }
    },
  };
}

/** Active provider based on saved settings (call before analyze). */
export function resolveRankingProvider(): ClipRankingProvider {
  const s = loadOllamaSettings();
  if (s.enabled) return createOllamaRankingProvider({ model: s.model, baseUrl: s.baseUrl });
  return localHeuristicRankingProvider;
}
