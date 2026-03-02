/* ------------------------------------------------------------------ */
/*  Core types for the Research Agent frontend                        */
/* ------------------------------------------------------------------ */

export type AgentState = string;

/** Human-readable labels for the common backend states */
export const AgentStateLabels: Record<string, string> = {
  intake: 'Understanding Prompt',
  plan: 'Planning',
  plan_complete: 'Planning Completed',
  query_generate: 'Generating Queries',
  queries_generated: 'Queries Ready',
  search: 'Searching',
  search_complete: 'Search Completed',
  fetch_parse: 'Fetching Pages',
  fetch_complete: 'Fetch Completed',
  index: 'Indexing',
  index_complete: 'Indexing Completed',
  retrieve: 'Retrieving Evidence',
  retrieve_complete: 'Evidence Ready',
  synthesize: 'Writing Response',
  synthesize_complete: 'Draft Completed',
  evaluate: 'Evaluating',
  evaluate_complete: 'Evaluation Completed',
  refine: 'Refining',
  refine_complete: 'Refinement Completed',
  max_iterations_reached: 'Iteration Limit Reached',
  finalize: 'Completed',
  failed: 'Failed',
  error: 'Error',
};

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
