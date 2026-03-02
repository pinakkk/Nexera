// Run types
export interface RunConstraints {
  depth: 'quick' | 'standard' | 'deep';
  timeframe?: string;
  allowed_domains?: string[];
  citation_style: 'numbered' | 'author-date';
  initial_model?: string;
}

export interface RunCreate {
  query: string;
  constraints?: RunConstraints;
}

export interface RunStatus {
  id: string;
  query: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  finished_at?: string;
  iteration_count: number;
  model_name?: string;
}

export interface Citation {
  id: string;
  claim_text: string;
  snippet: string;
  url: string;
  title?: string;
  domain?: string;
  section_key?: string;
}

export interface EvalScores {
  groundedness: number;
  coverage: number;
  contradictions: number;
  source_diversity: number;
}

export interface RunResult extends RunStatus {
  report_md?: string;
  report_json?: Record<string, unknown>;
  scores?: EvalScores;
  citations?: Citation[];
}

export interface Source {
  id: string;
  url: string;
  title?: string;
  domain?: string;
  published_at?: string;
  fetched_at: string;
  reliability?: 'high' | 'medium' | 'low' | 'unknown';
  content_type?: string;
}
