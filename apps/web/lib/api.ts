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
import { getAnonymousSessionId } from './request-scope';

/* ------------------------------------------------------------------ */
/*  API client for the Research Agent backend                          */
/* ------------------------------------------------------------------ */

const BASE_URL = (() => {
  const raw = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').trim();
  if (!raw) return 'http://localhost:8000';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'http://localhost:8000';
  }
})();
const API_KEYS_STORAGE_KEY = 'nexara-api-keys';

/* ------------------------------------------------------------------ */
/*  Auth token management                                              */
/* ------------------------------------------------------------------ */

/** Module-level auth token getter set by the Providers component. */
let _getAuthToken: (() => Promise<string | null>) | null = null;

/** Called once from Providers to wire up the Supabase auth token getter. */
export function setAuthTokenGetter(getter: () => Promise<string | null>): void {
  _getAuthToken = getter;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  if (!_getAuthToken) return {};
  try {
    const token = await _getAuthToken();
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // Token unavailable (not signed in)
  }
  return {};
}

export async function getActorHeaders(): Promise<Record<string, string>> {
  const authHeaders = await getAuthHeader();
  if (authHeaders.Authorization) {
    return authHeaders;
  }
  return { 'X-Anonymous-Session-ID': getAnonymousSessionId() };
}

/* ------------------------------------------------------------------ */
/*  User API Keys (BYOAPI)                                             */
/* ------------------------------------------------------------------ */

export interface UserApiKeys {
  groqApiKey?: string;
  brightdataApiKey?: string;
  tavilyApiKey?: string;
  cohereApiKey?: string;
}

export function getUserApiKeys(): UserApiKeys {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as UserApiKeys;
  } catch {
    return {};
  }
}

export function saveUserApiKeys(keys: UserApiKeys): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

function getApiKeyHeaders(): Record<string, string> {
  const keys = getUserApiKeys();
  const headers: Record<string, string> = {};
  if (keys.groqApiKey) headers['X-Groq-Api-Key'] = keys.groqApiKey;
  if (keys.brightdataApiKey) headers['X-Brightdata-Api-Key'] = keys.brightdataApiKey;
  if (keys.tavilyApiKey) headers['X-Tavily-Api-Key'] = keys.tavilyApiKey;
  if (keys.cohereApiKey) headers['X-Cohere-Api-Key'] = keys.cohereApiKey;
  return headers;
}

/* ------------------------------------------------------------------ */
/*  User-friendly error messages                                       */
/* ------------------------------------------------------------------ */

function parseApiError(status: number, body: string): string {
  // Try to extract detail from JSON
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    const rawDetail = parsed.detail || parsed.message || '';
    if (typeof rawDetail === 'string') {
      detail = rawDetail;
    } else if (Array.isArray(rawDetail)) {
      // Handle FastAPI validation error arrays
      detail = rawDetail.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
    } else {
      detail = JSON.stringify(rawDetail);
    }
  } catch {
    detail = String(body);
  }

  const lower = detail.toLowerCase();

  // MongoDB / Database errors
  if (lower.includes('ssl handshake failed') || lower.includes('tlsv1_alert')) {
    return 'Unable to connect to the database. The database server may be temporarily unavailable. Please try again in a few minutes.';
  }
  if (lower.includes('mongo') && lower.includes('connection')) {
    return 'Database connection issue. Please check your backend configuration or try again later.';
  }
  if (lower.includes('database operation failed')) {
    return 'A database error occurred. Please try again later.';
  }

  // Auth errors — distinguish between session/auth issues and API-key issues.
  if (status === 401 || status === 403) {
    // Backend provider-key errors mention groq/brightdata/tavily/cohere/api key.
    const looksLikeProviderKey =
      lower.includes('api key') ||
      lower.includes('api_key') ||
      lower.includes('groq') ||
      lower.includes('brightdata') ||
      lower.includes('tavily') ||
      lower.includes('cohere');
    if (looksLikeProviderKey) {
      return 'Authentication failed. Please check your API keys in Settings.';
    }
    // Otherwise it's a session/token problem (expired login, bad JWT, etc.).
    return detail || 'Your session has expired or is invalid. Please sign in again.';
  }

  // Rate limiting
  if (status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  // Service unavailable – pass through backend detail when available (e.g. model terms)
  if (status === 503) {
    return detail || 'The service is temporarily unavailable. Please try again in a moment.';
  }

  // Not found – pass through backend detail when available (e.g. model not found info)
  if (status === 404) {
    return detail || 'The requested resource was not found.';
  }

  // Server error
  if (status >= 500) {
    return 'An unexpected server error occurred. Please try again later.';
  }

  // Validation
  if (status === 422) {
    return detail || 'Invalid input. Please check your request.';
  }

  // Fallback
  if (detail && detail.length < 200) {
    return detail;
  }

  return `Request failed (${status}). Please try again.`;
}

/* ------------------------------------------------------------------ */
/*  Fetch utilities                                                     */
/* ------------------------------------------------------------------ */

async function apiFetchRaw(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  try {
    const actorHeaders = await getActorHeaders();
    return await fetch(url, {
      ...options,
      headers: {
        ...actorHeaders,
        ...(options?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      'Unable to connect to the API server. Please ensure the backend is running.',
    );
  }
}

/** Generic fetch wrapper with JSON parsing and error handling */
async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const apiKeyHeaders = getApiKeyHeaders();
  const actorHeaders = await getActorHeaders();
  const res = await apiFetchRaw(path, {
    headers: {
      'Content-Type': 'application/json',
      ...apiKeyHeaders,
      ...actorHeaders,
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const userMessage = parseApiError(res.status, body);
    throw new Error(userMessage);
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
    thread_id:
      typeof row.thread_id === 'string' ? row.thread_id : null,
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

  // Extract gate_route from report_json if present
  const reportJson = typeof row.report_json === 'object' && row.report_json !== null
    ? row.report_json as Record<string, unknown>
    : null;
  const gateRoute = typeof reportJson?.gate_route === 'string' ? reportJson.gate_route : null;

  return {
    ...base,
    report_md: typeof row.report_md === 'string' ? row.report_md : null,
    citations,
    sources,
    evaluation,
    gate_route: gateRoute,
  };
}

/* ---------- Runs ---------- */

/** Create a new research run and return its run_id */
export async function createRun(
  query: string,
  constraints?: RunConstraints,
  thread_id?: string,
): Promise<{ run_id: string; thread_id: string }> {
  const payloadConstraints = constraints
    ? {
      ...constraints,
      initial_model: constraints.initial_model ?? constraints.model,
    }
    : undefined;
  if (payloadConstraints && 'model' in payloadConstraints) {
    delete payloadConstraints.model;
  }

  return apiFetch<{ run_id: string; thread_id: string }>('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ query, constraints: payloadConstraints, thread_id }),
  });
}

/** Get the full result for a run (includes report, citations, sources) */
export async function getRun(runId: string): Promise<RunResult> {
  const response = await apiFetch<unknown>(`/v1/runs/${runId}`);
  return normalizeRunResult(response);
}

export async function getThreadRuns(threadId: string): Promise<RunResult[]> {
  const response = await apiFetch<unknown[]>(`/v1/runs/thread/${threadId}`);
  if (!Array.isArray(response)) return [];
  return response.map(normalizeRunResult);
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

  const apiKeyHeaders = getApiKeyHeaders();
  const actorHeaders = await getActorHeaders();
  const res = await apiFetchRaw('/v1/sources/ingest', {
    method: 'POST',
    headers: { ...apiKeyHeaders, ...actorHeaders },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(parseApiError(res.status, body));
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

/** Delete a research run */
export async function deleteRun(runId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/v1/runs/${runId}`, {
    method: 'DELETE',
  });
}

/** Submit user input for interactive steering */
export async function submitUserInput(
  runId: string,
  data: {
    action: 'approve' | 'edit';
    sub_questions?: string[];
    constraints?: Record<string, unknown>;
    excluded_domains?: string[];
    focus_topics?: string[];
  },
): Promise<{ accepted: boolean; message: string }> {
  return apiFetch<{ accepted: boolean; message: string }>(
    `/v1/runs/${runId}/user-input`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
}

/** Submit non-blocking steering context for an active run */
export async function submitSteeringInput(
  runId: string,
  message: string,
): Promise<{ queued: boolean; message: string }> {
  return apiFetch<{ queued: boolean; message: string }>(
    `/v1/runs/${runId}/steering`,
    {
      method: 'POST',
      body: JSON.stringify({ message }),
    },
  );
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

/* ------------------------------------------------------------------ */
/*  Text-to-Speech (TTS)                                               */
/* ------------------------------------------------------------------ */

/** Convert text to speech using Orpheus English via Groq.
 *  Returns a Blob containing the audio data (wav format). */
export async function textToSpeech(
  text: string,
  voice: string = 'zac',
): Promise<Blob> {
  const apiKeyHeaders = getApiKeyHeaders();
  const actorHeaders = await getActorHeaders();
  const res = await apiFetchRaw('/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...apiKeyHeaders,
      ...actorHeaders,
    },
    body: JSON.stringify({ text, voice }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(parseApiError(res.status, body));
  }

  return res.blob();
}

/* ------------------------------------------------------------------ */
/*  Vision / Image Analysis                                            */
/* ------------------------------------------------------------------ */

/** Analyze an image using Llama 4 Scout via Groq.
 *  Accepts an image File and an optional prompt. */
export async function analyzeImage(
  file: File,
  prompt: string = 'Describe this image in detail. What do you see?',
): Promise<{ analysis: string; model_used: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('prompt', prompt);

  const apiKeyHeaders = getApiKeyHeaders();
  const actorHeaders = await getActorHeaders();
  const res = await apiFetchRaw('/v1/vision/analyze', {
    method: 'POST',
    headers: { ...apiKeyHeaders, ...actorHeaders },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(parseApiError(res.status, body));
  }

  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Memory System                                                       */
/* ------------------------------------------------------------------ */

export async function listMemories(
  category?: string,
  limit: number = 50,
): Promise<{ id: string; category: string; content: string; confidence: number; created_at: string }[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  params.set('limit', String(limit));
  const res = await apiFetch<{ memories: { id: string; category: string; content: string; confidence: number; created_at: string }[] }>(`/v1/memory/?${params.toString()}`);
  return res.memories ?? [];
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await apiFetch(`/v1/memory/${memoryId}`, { method: 'DELETE' });
}

export async function getMemoryStats(): Promise<{ total: number; by_category: Record<string, number> }> {
  return apiFetch('/v1/memory/stats');
}

export async function listTrustedSources(): Promise<{ id: string; domain: string; label: string | null; trust_level: number }[]> {
  const res = await apiFetch<{ sources: { id: string; domain: string; label: string | null; trust_level: number }[] }>('/v1/memory/trusted-sources');
  return res.sources ?? [];
}

export async function addTrustedSource(
  domain: string,
  label?: string,
  trustLevel?: number,
): Promise<{ id: string; domain: string }> {
  return apiFetch('/v1/memory/trusted-sources', {
    method: 'POST',
    body: JSON.stringify({
      domain,
      label: label || null,
      trust_level: trustLevel ?? 1.0,
    }),
  });
}

export async function removeTrustedSource(sourceId: string): Promise<void> {
  await apiFetch(`/v1/memory/trusted-sources/${sourceId}`, { method: 'DELETE' });
}
