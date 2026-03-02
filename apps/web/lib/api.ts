import {
  RunConstraints,
  RunResult,
  RunEvent,
  RunStatus,
  RunStatusValue,
  EvaluationScores,
  Citation,
  Source,
  AvailableModel,
} from './types';

/* ------------------------------------------------------------------ */
/*  API client for the Research Agent backend                          */
/* ------------------------------------------------------------------ */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const SETTINGS_STORAGE_KEY = 'research-agent-settings';

function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    return BASE_URL;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return BASE_URL;
    const parsed = JSON.parse(raw) as { apiUrl?: string };
    return parsed.apiUrl?.trim() || BASE_URL;
  } catch {
    return BASE_URL;
  }
}

/** Generic fetch wrapper with JSON parsing and error handling */
async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    });
  } catch (error) {
    console.error('[apiFetch] Network error', {
      url,
      method: options?.method ?? 'GET',
      error,
    });
    throw error instanceof Error
      ? error
      : new Error('Network error while calling API');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[apiFetch] HTTP error', {
      url,
      method: options?.method ?? 'GET',
      status: res.status,
      statusText: res.statusText,
      body,
    });
    throw new Error(
      `API error ${res.status}: ${res.statusText}${body ? ` - ${body}` : ''}`,
    );
  }

  return res.json() as Promise<T>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeCitation(raw: unknown): Citation | null {
  const row = asRecord(raw);
  if (!row) return null;
  const sourceUrl = asString(row.url);
  if (!sourceUrl) return null;

  return {
    id: asString(row.id, `citation-${Math.random().toString(36).slice(2, 9)}`),
    source_url: sourceUrl,
    source_title: deriveDomain(sourceUrl) || sourceUrl,
    excerpt: asString(row.snippet),
    claim_text: asString(row.claim_text),
    section_key: typeof row.section_key === 'string' ? row.section_key : null,
  };
}

function normalizeSources(citations: Citation[]): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const citation of citations) {
    if (seen.has(citation.source_url)) continue;
    seen.add(citation.source_url);
    const domain = deriveDomain(citation.source_url);
    sources.push({
      url: citation.source_url,
      title: citation.source_title || domain || citation.source_url,
      domain,
      fetched_at: null,
    });
  }
  return sources;
}

function normalizeEvaluation(scoresRaw: unknown): EvaluationScores | null {
  const scores = asRecord(scoresRaw);
  if (!scores) return null;

  const keys = Object.keys(scores);
  if (keys.length === 0) return null;

  return {
    coverage: clampScore(scores.coverage),
    accuracy: clampScore(scores.accuracy),
    coherence: clampScore(scores.coherence),
    citation_quality: clampScore(scores.citation_quality),
    overall: clampScore(
      scores.overall ??
        (() => {
          const picked = [
            clampScore(scores.coverage),
            clampScore(scores.accuracy),
            clampScore(scores.coherence),
            clampScore(scores.citation_quality),
          ];
          return picked.reduce((acc, value) => acc + value, 0) / picked.length;
        })(),
    ),
  };
}

function normalizeRunStatus(raw: unknown): RunStatus {
  const row = asRecord(raw) ?? {};
  const status = asString(row.status, 'pending').toLowerCase();
  const statusValue: RunStatusValue =
    status === 'running' || status === 'completed' || status === 'failed'
      ? status
      : 'pending';
  const constraints = asRecord(row.constraints_json);
  const maxIterations = asNumber(constraints?.max_iterations, 0);
  const createdAt = asString(row.created_at, new Date().toISOString());
  const finishedAt = asString(row.finished_at || row.completed_at, '');

  return {
    run_id: asString(row.id || row.run_id),
    query: asString(row.query),
    status: statusValue,
    current_state:
      typeof row.current_state === 'string'
        ? row.current_state.toLowerCase()
        : null,
    iteration: asNumber(row.iteration_count ?? row.iteration, 0),
    max_iterations: maxIterations,
    created_at: createdAt,
    updated_at: finishedAt || createdAt,
    completed_at: finishedAt || null,
    model_name:
      typeof row.model_name === 'string' ? row.model_name : null,
  };
}

function extractIteration(payload: Record<string, unknown> | null): number {
  if (!payload) return 0;
  const direct = asNumber(payload.iteration, 0);
  if (direct > 0) return direct;

  const nestedEval = asRecord(payload.eval_result);
  if (nestedEval) {
    return asNumber(nestedEval.iteration, 0);
  }

  return 0;
}

export function normalizeRunEvent(raw: unknown, fallbackRunId = ''): RunEvent {
  const row = asRecord(raw) ?? {};
  const payload = asRecord(row.payload);
  const timestamp = asString(row.timestamp, new Date().toISOString());
  const state = asString(row.state, 'running').toLowerCase();
  const runId = asString(row.run_id, fallbackRunId);

  return {
    id:
      asString(row.id) ||
      `${runId || 'run'}:${state}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`,
    run_id: runId,
    state,
    message: asString(row.message),
    timestamp,
    iteration: extractIteration(payload),
    payload,
  };
}

function normalizeRunResult(raw: unknown): RunResult {
  const row = asRecord(raw) ?? {};
  const base = normalizeRunStatus(row);

  const citations = Array.isArray(row.citations)
    ? row.citations.map(normalizeCitation).filter(Boolean) as Citation[]
    : [];
  const sources = normalizeSources(citations);
  const evaluation = normalizeEvaluation(row.scores || row.evaluation);

  return {
    ...base,
    report_md: typeof row.report_md === 'string' ? row.report_md : null,
    citations,
    sources,
    evaluation,
  };
}

/* ---------- Runs ---------- */

/** Create a new research run and return its run_id */
export async function createRun(
  query: string,
  constraints?: RunConstraints,
): Promise<{ run_id: string }> {
  const payloadConstraints = constraints
    ? {
        ...constraints,
        initial_model: constraints.initial_model ?? constraints.model,
      }
    : undefined;
  if (payloadConstraints && 'model' in payloadConstraints) {
    delete payloadConstraints.model;
  }

  return apiFetch<{ run_id: string }>('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ query, constraints: payloadConstraints }),
  });
}

/** Get the full result for a run (includes report, citations, sources) */
export async function getRun(runId: string): Promise<RunResult> {
  const response = await apiFetch<unknown>(`/v1/runs/${runId}`);
  return normalizeRunResult(response);
}

/** Get all events for a run */
export async function getRunEvents(runId: string): Promise<RunEvent[]> {
  const response = await apiFetch<unknown[]>(`/v1/runs/${runId}/events`);
  return response.map((event) => normalizeRunEvent(event, runId));
}

/** List recent runs */
export async function listRuns(
  limit = 20,
  offset = 0,
): Promise<RunStatus[]> {
  const response = await apiFetch<unknown[]>(
    `/v1/runs?limit=${limit}&offset=${offset}`,
  );
  return response.map((run) => normalizeRunStatus(run));
}

/** Ingest source files (multipart form upload) */
export async function ingestSources(
  files: File[],
): Promise<{ id: string; filename: string; status: string }[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  const url = `${getBaseUrl()}/v1/sources/ingest`;
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Upload error ${res.status}: ${body}`);
  }

  return res.json();
}

/** Ingest source URLs for grounding */
export async function ingestSourceUrls(
  urls: string[],
): Promise<{ id: string; url: string; status: string }[]> {
  return apiFetch<{ id: string; url: string; status: string }[]>('/v1/sources/ingest/urls', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
}

/** Health check */
export async function healthCheck(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/health');
}

/** List available LLM models from backend (Groq) */
export async function listAvailableModels(): Promise<AvailableModel[]> {
  try {
    const response = await apiFetch<{ models?: unknown[] }>('/v1/models');
    const items = Array.isArray(response.models) ? response.models : [];
    return items
      .map((item) => asRecord(item))
      .filter(Boolean)
      .map((item) => ({
        id: asString(item!.id),
        owned_by:
          typeof item!.owned_by === 'string' ? item!.owned_by : null,
        is_default: Boolean(item!.is_default),
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}
