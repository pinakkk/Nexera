export enum AgentState {
  INTAKE = 'intake',
  PLAN = 'plan',
  QUERY_GENERATE = 'query_generate',
  SEARCH = 'search',
  FETCH_PARSE = 'fetch_parse',
  INDEX = 'index',
  RETRIEVE = 'retrieve',
  SYNTHESIZE = 'synthesize',
  EVALUATE = 'evaluate',
  REFINE = 'refine',
  FINALIZE = 'finalize',
  FAILED = 'failed',
}

export interface RunEventPayload {
  data?: Record<string, unknown>;
  sub_questions?: string[];
  queries?: string[];
  search_results?: Array<{
    url: string;
    title: string;
    snippet: string;
    score?: number;
  }>;
  fetched_documents?: Array<{
    url: string;
    title: string;
    domain: string;
  }>;
  chunks_count?: number;
  evidence_count?: number;
  evidence_snippets?: Array<{
    text: string;
    source: string;
    score: number;
  }>;
  scores?: {
    groundedness: number;
    coverage: number;
    contradictions: number;
    source_diversity: number;
  };
  passed?: boolean;
  feedback?: string;
  refinements?: string[];
  report_preview?: string;
  report_md?: string;
  citations?: Array<{
    id: string;
    claim_text: string;
    snippet: string;
    url: string;
    title?: string;
  }>;
}

export interface RunEvent {
  id: string;
  run_id: string;
  timestamp: string;
  state: AgentState;
  message: string;
  payload?: RunEventPayload;
}

export interface SSEEvent {
  event: string;
  data: {
    run_id: string;
    timestamp: string;
    state: AgentState;
    message: string;
    payload?: RunEventPayload;
  };
}
