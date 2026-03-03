# Detailed project overview

You will build an **Autonomous Research Agent (Recursive RAG Agent)** that converts a
user’s question into a **well-structured research report with citations** by running an iterative
loop: **plan → search/ingest → index → retrieve → synthesize → evaluate → refine →
finalize**. Instead of answering in one shot, the agent decomposes complex questions into
sub-questions, gathers evidence from the web (and optionally user-uploaded documents),
stores that evidence with metadata, retrieves the most relevant passages using hybrid retrieval
+ reranking, and writes a report where each key claim is backed by citations. After drafting, a
dedicated evaluator checks for groundedness (claims supported by evidence), coverage (all
sub-questions answered), contradictions (conflicting sources are acknowledged), and source
quality/diversity; if any threshold fails, the agent automatically refines queries and repeats the
loop until it meets quality targets or hits a safe iteration cap. The UI shows a **live research
trace** (what it searched, what it read, why it selected sources), making the project demonstrably
“agentic” and interview-ready.

## Flowchart:

flowchart TD
U[User - Web UI] -->|Question + constraints| API[Backend API]
API --> ORCH[Orchestrator - Agent State Machine]
ORCH --> PLAN[Planner: Decompose into sub-questions]
PLAN --> QGEN[Query Generator]
QGEN --> SEARCH[Search Tool: Tavily/Brave/SerpAPI]
SEARCH --> FETCH[Fetcher/Scraper: Playwright + Readability]
FETCH --> PARSE[Parser: HTML/PDF -> Clean Text]
PARSE --> DOCS[(Document Store: Postgres)]
PARSE --> CHUNK[Chunker]
ORCH --> RET[Retriever: BM25 + Metadata Scoring]
DOCS --> RET
RET --> RERANK[Reranker: Cross-Encoder/Cohere]
RERANK --> WRITE[Writer: Draft Report + Inline Citations]
WRITE --> EVAL[Evaluator: Groundedness/Coverage/Contradictions]
EVAL -->|Pass| OUT[Final Report + Sources + Scores]
EVAL -->|Fail| REFINE[Refiner: Improve Queries & Missing Evidence]
REFINE --> QGEN
OUT --> U
EVAL --> MEM[(Learning Memory: Patterns & Failures)]
MEM --> ORCH


# System design and component responsibilities

## 1) Frontend (Next.js + TypeScript)

**Responsibilities**
● Accept user question + constraints (depth, timeframe, allowed domains, citation style)
● Show _live agent trace_ (steps + intermediate artifacts)
● Render final report (Markdown) + citations panel + “sources used”
● Optional: export to PDF, save runs, compare runs
**Key UI screens**
● Research Console (input + settings)
● Run Trace (timeline of states, queries, selected sources)
● Report Viewer (final output + citations)
● Sources Viewer (URLs, snippet, fetched time, reliability tags)

## 2) Backend API (FastAPI recommended)

**Responsibilities**
● Run management (create run, stream progress, return final output)
● Tool execution layer (search, fetch, parse)
● Storage layer (documents, chunks, citations, run events)
● Auth (optional), rate-limits, safe browsing controls


## 3) Orchestrator (LangGraph state machine)

**Responsibilities**
● Deterministic agent flow with checkpointing
● State transitions and retry caps
● Maintains working memory: question, plan, sub-questions, collected sources, drafts, eval
results
**Typical states**

1. **Intake** : normalize request, set constraints, define “done criteria”
2. **Plan** : produce sub-questions + report outline
3. **QueryGenerate** : create search queries per sub-question
4. **Search** : execute search, shortlist candidate URLs
5. **Fetch/Parse** : extract clean text + metadata
6. **Index** : chunk + embed + store
7. **Retrieve** : gather evidence per sub-question
8. **Synthesize** : write report with citations
9. **Evaluate** : score quality; detect missing evidence/contradictions
10. **Refine** : if needed, adjust plan/queries and loop
11. **Finalize** : return report + sources + trace


## 4) Tooling layer

**Search Tool**
● Tavily / Brave / SerpAPI; enforce allowed domains / recency
**Fetcher/Scraper**
● Playwright for dynamic pages
● Readability for main content extraction
● PDF fetch + parse via pypdf/pdfminer
**Parser**
● Convert to clean text
● Extract metadata: title, author, publish date (if available), domain, language


# Backend API endpoints

```
● POST /v1/runs
○ Body: { query, constraints, mode }
○ Returns: { run_id }
● GET /v1/runs/{run_id}
○ Returns run status + final result (if done)
● GET /v1/runs/{run_id}/events
○ Returns event log (for replay / debugging)
● GET /v1/runs/{run_id}/stream (SSE or WebSocket)
○ Streams events: planning, searching, fetching, indexing, retrieving, writing,
evaluating
```
## Documents & Sources

```
● POST /v1/sources/ingest
○ Upload files or paste URLs for a “private corpus”
○ Returns: { source_ids }
● GET /v1/sources/{source_id}
○ Metadata + extracted text summary
```
## Evaluation (optional exposed endpoints)

```
● POST /v1/eval
○ Evaluate a report vs evidence; returns metrics
```

## Admin/Health

```
● GET /health
● GET /metrics (optional Prometheus-style)
```
# Data layer (storage design)

## Recommended: MongoDB Atlas + Prisma

**Core tables**
● runs
○ id, query, constraints_json, status, created_at, finished_at
● run_events
○ id, run_id, ts, state, payload_json
(powers the trace UI)
● documents
○ id, url, title, domain, published_at, fetched_at, raw_text,
clean_text, metadata_json, content_hash
● chunks
○ id, document_id, chunk_index, chunk_text,
token_count, metadata_json
● citations
○ id, run_id, document_id, chunk_id, claim_id, snippet, url
● learning_memory (add-on)


○ id, type, key, value_json, score, updated_at
**Why this design works**
● Reproducibility: you can replay what the agent saw
● Traceability: every claim can point to chunks
● Incremental indexing: avoid re-embedding same content via content_hash

# Retrieval stack (advanced but doable)

## 1) Chunking

```
● Default: 400–800 tokens with 10–15% overlap
● Add metadata to each chunk:
○ source_domain, published_at, document_title, section_heading
```
## 2) Retrieval

```
● BM25 (exact term match) + metadata/domain scoring
● Add filters:
○ recency, domain allowlist/blocklist, language
```
## 3) Reranking (big quality jump)

```
● Cross-encoder reranker (or Cohere Rerank)
● Produces top-N “evidence chunks” per sub-question
```

## 4) Evidence packing strategy

```
● Avoid dumping huge context:
○ pick top 3–8 chunks per sub-question
○ deduplicate near-identical chunks
○ enforce source diversity
```
# Evaluation and self-improving loop (add-on, but you

# asked to include)

## Evaluation goals

1. **Groundedness**
    ○ Are claims supported by retrieved evidence?
    ○ Practical metric: % of key claims with citations + LLM judge check
       that cited snippet supports claim
2. **Coverage**
    ○ Did we answer all sub-questions from the plan?
3. **Contradictions**
    ○ If evidence conflicts, report must include a “Conflicting evidence / uncertainty”
       section
4. **Source quality & diversity**
    ○ Avoid single-domain dominance
    ○ Penalize low-quality sources (you can start with a lightweight domain scoring list)

## Self-improving loop mechanics

```
● After evaluation fails, the Refiner produces:
```

```
○ missing sub-questions
○ missing evidence types (definitions, statistics, primary sources)
○ new targeted queries (with constraints)
● Repeat with a max iteration cap (e.g., 3–5 loops)
```
## Learning memory (persisted improvements)

Store small, safe, useful signals:
● “Query templates that worked” by intent (definition, comparison, timeline)
● “Trusted sources list” and “avoid list”
● Frequent failure modes:
○ “Missing citations in section X”
○ “Too few primary sources”
○ “Contradiction unresolved”
This lets future runs converge faster without changing core logic.
