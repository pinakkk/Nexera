/* ------------------------------------------------------------------ */
/*  Core types for the Research Agent frontend                        */
/* ------------------------------------------------------------------ */
import { TEXT_CONFIG } from './text-config';

export type AgentState = string;

/** Human-readable labels for the common backend states */
export const AgentStateLabels: Record<string, string> =
  TEXT_CONFIG.agentStateLabels;

export function formatAgentStateLabel(state: string): string {
  if (AgentStateLabels[state]) return AgentStateLabels[state];
  return state
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ---------- Run ---------- */

export interface RunConstraints {
  model?: string;
  initial_model?: string;
  depth?: 'quick' | 'standard' | 'deep';
  timeframe?: string;
  allowed_domains?: string[];
  citation_style?: 'numbered' | 'author-date';
  max_iterations?: number;
}

export interface RunCreate {
  query: string;
  constraints?: RunConstraints;
}

export type RunStatusValue = 'pending' | 'running' | 'completed' | 'failed';

export interface RunStatus {
  run_id: string;
  query: string;
  status: RunStatusValue;
  current_state: AgentState | null;
  iteration: number;
  max_iterations: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  model_name: string | null;
}

export interface RunResult extends RunStatus {
  report_md: string | null;
  citations: Citation[];
  sources: Source[];
  evaluation: EvaluationScores | null;
}

/* ---------- Events ---------- */

export interface RunEvent {
  id: string;
  run_id: string;
  state: AgentState;
  message: string;
  timestamp: string;
  iteration: number;
  payload: Record<string, unknown> | null;
}

/* ---------- Citations & Sources ---------- */

export interface Citation {
  id: string;
  source_url: string;
  source_title: string;
  excerpt: string;
  claim_text?: string;
  section_key?: string | null;
}

export interface Source {
  url: string;
  title: string;
  domain: string;
  fetched_at: string | null;
  content_length?: number;
  reliability?: 'reliable' | 'moderate' | 'unverified';
}

/* ---------- Evaluation ---------- */

export interface EvaluationScores {
  coverage: number;
  accuracy: number;
  coherence: number;
  citation_quality: number;
  overall: number;
}

/* ---------- SSE ---------- */

export interface SSEEvent {
  event: string;
  data: RunEvent | RunResult;
}

export interface AvailableModel {
  id: string;
  owned_by?: string | null;
  is_default?: boolean;
}
