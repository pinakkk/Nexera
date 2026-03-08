"""Orchestrator – deterministic state-machine that drives the research loop.

Updated States
--------------
INTAKE -> PLAN -> WAIT_FOR_USER -> RESEARCH_LOOP (parallel workers) ->
RETRIEVE_EVIDENCE -> KG_EXTRACT -> SYNTHESIZE -> VERIFY ->
(REFINE -> RESEARCH_LOOP ...) -> FINALIZE

On any unrecoverable error the machine transitions to FAILED.
"""

import asyncio
import enum
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, TypedDict
from uuid import UUID, uuid4

from .fetcher import FetcherService
from .indexer import IndexerService
from .llm import LLMService, get_llm_service
from .planner import PlannerService
from .query_generator import QueryGeneratorService
from .refiner import RefinerService
from .retriever import RetrieverService
from .synthesizer import SynthesizerService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------- #
# States
# ---------------------------------------------------------------------- #


class State(str, enum.Enum):
    """Deterministic states of the research agent."""

    INTAKE = "intake"
    PLAN = "plan"
    WAIT_FOR_USER = "wait_for_user"
    RESEARCH_LOOP = "research_loop"
    RETRIEVE_EVIDENCE = "retrieve_evidence"
    RERANK = "rerank"
    KG_EXTRACT = "kg_extract"
    SYNTHESIZE = "synthesize"
    VERIFY = "verify"
    REFINE = "refine"
    FINALIZE = "finalize"
    FAILED = "failed"


# ---------------------------------------------------------------------- #
# Working-memory typed dict
# ---------------------------------------------------------------------- #


class OrchestratorState(TypedDict, total=False):
    """Mutable working memory carried through the state machine."""

    run_id: str
    user_id: str | None
    query: str
    constraints: dict[str, Any]
    status: str
    current_state: str
    memory_context: str  # injected from persistent memory
    chat_context: str  # conversation history from chat_history constraint

    # Planning
    plan: dict[str, Any]  # {sub_questions, outline, focus_areas}

    # Query generation & search
    queries: list[dict[str, Any]]
    all_query_strings: list[str]          # flat list of every query executed
    search_results: list[dict[str, Any]]

    # Fetching & indexing
    fetched_documents: list[dict[str, Any]]
    chunks: list[dict[str, Any]]

    # Retrieval & synthesis
    evidence: list[dict[str, Any]]
    report_md: str
    report_json: dict[str, Any]
    citations: list[dict[str, Any]]
    model_name: str | None

    # Evaluation & refinement
    eval_result: dict[str, Any]
    verification_result: dict[str, Any]
    iteration: int
    max_iterations: int

    # Knowledge Graph
    kg_summary: str

    # Interactive steering
    user_input_received: bool
    user_modifications: dict[str, Any]
    steering_notes: list[str]

    # Error tracking
    errors: list[str]


# Type alias for the callback that streams events over SSE
EventCallback = Callable[[str, str, dict[str, Any]], Coroutine[Any, Any, None]]

# Registry for pending user input (run_id -> asyncio.Event + data)
_user_input_registry: dict[str, dict[str, Any]] = {}
# Registry for non-blocking steering updates (run_id -> queued notes)
_steering_registry: dict[str, list[dict[str, Any]]] = {}


def register_user_input_wait(run_id: str) -> asyncio.Event:
    """Register that a run is waiting for user input."""
    event = asyncio.Event()
    _user_input_registry[run_id] = {"event": event, "data": None}
    return event


def submit_user_input(run_id: str, data: dict[str, Any]) -> bool:
    """Submit user input for a waiting run. Returns True if accepted."""
    entry = _user_input_registry.get(run_id)
    if entry is None:
        return False
    entry["data"] = data
    entry["event"].set()
    return True


def get_user_input_data(run_id: str) -> dict[str, Any] | None:
    """Get submitted user input for a run."""
    entry = _user_input_registry.get(run_id)
    if entry is None:
        return None
    return entry.get("data")


def cleanup_user_input(run_id: str) -> None:
    """Clean up user input registry for a run."""
    _user_input_registry.pop(run_id, None)


def register_steering_channel(run_id: str) -> None:
    """Ensure a steering queue exists for this run."""
    _steering_registry.setdefault(run_id, [])


def submit_steering_input(run_id: str, data: dict[str, Any]) -> bool:
    """Queue non-blocking steering input for an active run."""
    queue = _steering_registry.get(run_id)
    if queue is None:
        return False
    queue.append(data)
    return True


def drain_steering_inputs(run_id: str) -> list[dict[str, Any]]:
    """Drain and return queued steering inputs for this run."""
    queue = _steering_registry.get(run_id)
    if not queue:
        return []
    drained = list(queue)
    queue.clear()
    return drained


def cleanup_steering_channel(run_id: str) -> None:
    """Remove steering queue for completed/failed runs."""
    _steering_registry.pop(run_id, None)


# ---------------------------------------------------------------------- #
# Orchestrator
# ---------------------------------------------------------------------- #


class Orchestrator:
    """Runs the deterministic research-agent state machine.

    Each public call to :meth:`run` executes the full loop for a single
    research run, emitting events through *event_callback* (SSE stream)
    and persisting them to the database.
    """

    def __init__(self, db_session: Any, settings: Any, run_store: Any | None = None) -> None:
        self._db = db_session
        self._settings = settings
        self._run_store = run_store

        # Initialise all sub-services
        self._llm: LLMService = get_llm_service(settings)
        self._planner = PlannerService()
        self._query_gen = QueryGeneratorService()

        from .searcher import SearchService
        self._searcher = SearchService(
            api_key=getattr(settings, "TAVILY_API_KEY", ""),
            max_results_per_query=getattr(settings, "SEARCH_MAX_RESULTS", 5),
        )
        logger.info("[orchestrator] Search provider: Tavily")

        self._fetcher = FetcherService()
        self._indexer = IndexerService()
        self._retriever = RetrieverService()
        self._synthesizer = SynthesizerService()
        self._refiner = RefinerService()

        # New services
        from .knowledge_graph import KnowledgeGraphService
        from .verifier import VerificationService
        from .academic import AcademicService

        self._kg = KnowledgeGraphService()
        self._verifier = VerificationService()
        self._academic = AcademicService(
            semantic_scholar_key=getattr(settings, "SEMANTIC_SCHOLAR_API_KEY", ""),
            semantic_scholar_endpoint=getattr(settings, "SEMANTIC_SCHOLAR_ENDPOINT", ""),
            arxiv_endpoint=getattr(settings, "ARXIV_ENDPOINT", ""),
        )

        # Parallel worker pool
        from .worker_pool import WorkerPool
        self._worker_pool = WorkerPool(
            max_concurrency=getattr(settings, "MAX_FETCH_CONCURRENCY", 5),
        )

        # ── Hierarchical agent services ──────────────────────────────────
        from .model_router import ModelRouter
        from .team_leader import TeamLeaderService
        from .evidence_packer import EvidencePackerService
        from .evaluator import EvaluatorService
        from .safety_guard import SafetyGuardService

        self._model_router = ModelRouter(settings)
        self._team_leader = TeamLeaderService()
        self._evidence_packer = EvidencePackerService()
        self._evaluator = EvaluatorService()
        self._safety_guard = SafetyGuardService()

    # ------------------------------------------------------------------ #
    # Main entry point
    # ------------------------------------------------------------------ #

    async def run(
        self,
        run_id: UUID,
        query: str,
        constraints: dict[str, Any],
        event_callback: EventCallback,
        user_id: str | None = None,
    ) -> OrchestratorState:
        """Execute the full research pipeline for *run_id*."""
        # Reset per-run caches
        self._searcher.reset()
        register_steering_channel(str(run_id))

        state = State.INTAKE
        memory: OrchestratorState = {
            "run_id": str(run_id),
            "user_id": user_id,
            "query": query,
            "constraints": constraints,
            "status": "running",
            "current_state": state.value,
            "memory_context": "",
            "plan": {},
            "queries": [],
            "all_query_strings": [],
            "search_results": [],
            "fetched_documents": [],
            "chunks": [],
            "evidence": [],
            "report_md": "",
            "report_json": {},
            "citations": [],
            "model_name": self._llm.smart_model,
            "eval_result": {},
            "verification_result": {},
            "iteration": 0,
            "max_iterations": min(
                int(constraints.get("max_iterations", self._settings.MAX_AGENT_ITERS)),
                5,  # Hard cap per spec
            ),
            "kg_summary": "",
            "user_input_received": False,
            "user_modifications": {},
            "steering_notes": [],
            "errors": [],
        }

        # ── Complexity scoring & model routing ────────────────────────────
        try:
            complexity = await self._model_router.score_complexity(query, self._llm)
            mode = complexity.get("mode", "BALANCED")
            routing_plan = self._model_router.get_routing_plan(mode)
            memory["_complexity"] = complexity
            memory["_routing_plan"] = routing_plan
            memory["_mode"] = mode

            await self._emit_event(
                event_callback,
                "complexity_scored",
                f"Complexity: {complexity.get('complexity_score', '?')}/10 → {mode}",
                {"complexity": complexity, "routing_plan": routing_plan},
                memory,
            )
        except Exception as exc:
            logger.warning("Complexity scoring failed: %s – using defaults", exc)
            memory["_complexity"] = {"complexity_score": 5, "mode": "BALANCED"}
            memory["_routing_plan"] = self._model_router.get_routing_plan("BALANCED")
            memory["_mode"] = "BALANCED"

        selected_model = constraints.get("initial_model")
        if isinstance(selected_model, str) and selected_model.strip():
            model_id = selected_model.strip()
            self._llm.set_run_model_override(model_id)
            memory["model_name"] = model_id

        try:
            while state not in (State.FINALIZE, State.FAILED):
                memory["current_state"] = state.value

                await self._emit_event(
                    event_callback,
                    state.value,
                    f"Entering state: {state.value}",
                    {"iteration": memory["iteration"]},
                    memory,
                )

                state = await self._step(state, memory, event_callback)

            # Terminal state
            memory["current_state"] = state.value
            memory["status"] = "completed" if state == State.FINALIZE else "failed"

            await self._emit_event(
                event_callback,
                state.value,
                "Research run finished" if state == State.FINALIZE else "Research run failed",
                {
                    "report_md": memory.get("report_md", ""),
                    "citations": memory.get("citations", []),
                    "scores": memory.get("verification_result", {}).get("scores", memory.get("eval_result", {}).get("scores", {})),
                    "errors": memory.get("errors", []),
                    "model_name": memory.get("model_name"),
                    "kg_summary": memory.get("kg_summary", ""),
                },
                memory,
            )

            # Persist final state to DB
            await self._persist_final(memory)

        except Exception as exc:
            logger.exception("Orchestrator fatal error for run %s", run_id)
            memory["status"] = "failed"
            memory["current_state"] = State.FAILED.value
            memory["errors"].append(str(exc))
            await self._emit_event(
                event_callback,
                State.FAILED.value,
                f"Fatal error: {exc}",
                {"error": str(exc)},
                memory,
            )
            try:
                await self._persist_final(memory)
            except Exception:
                logger.exception("Failed to persist fatal error state")
        finally:
            cleanup_user_input(str(run_id))
            cleanup_steering_channel(str(run_id))

        return memory

    # ------------------------------------------------------------------ #
    # State transition dispatcher
    # ------------------------------------------------------------------ #

    async def _step(
        self,
        state: State,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Execute the logic for *state* and return the next state."""

        match state:
            case State.INTAKE:
                return await self._handle_intake(memory)
            case State.PLAN:
                return await self._handle_plan(memory, event_callback)
            case State.WAIT_FOR_USER:
                return await self._handle_wait_for_user(memory, event_callback)
            case State.RESEARCH_LOOP:
                return await self._handle_research_loop(memory, event_callback)
            case State.RETRIEVE_EVIDENCE:
                return await self._handle_retrieve(memory, event_callback)
            case State.RERANK:
                return await self._handle_rerank(memory, event_callback)
            case State.KG_EXTRACT:
                return await self._handle_kg_extract(memory, event_callback)
            case State.SYNTHESIZE:
                return await self._handle_synthesize(memory, event_callback)
            case State.VERIFY:
                return await self._handle_verify(memory, event_callback)
            case State.REFINE:
                return await self._handle_refine(memory, event_callback)
            case _:
                logger.error("Unknown state: %s", state)
                return State.FAILED

    # ------------------------------------------------------------------ #
    # State handlers
    # ------------------------------------------------------------------ #

    async def _handle_intake(self, memory: OrchestratorState) -> State:
        """Validate input and normalise constraints."""
        query = memory["query"].strip()
        if not query:
            memory["errors"].append("Empty query")
            return State.FAILED

        # Apply defaults
        constraints = memory["constraints"]
        constraints.setdefault("depth", "standard")
        constraints.setdefault("citation_style", "numbered")
        constraints.setdefault("timeframe", None)
        constraints.setdefault("allowed_domains", None)
        constraints.setdefault("max_iterations", self._settings.MAX_AGENT_ITERS)

        memory["max_iterations"] = int(constraints["max_iterations"])

        # ── Inject chat history as conversation context ──────────────────
        chat_history = constraints.pop("chat_history", None)
        if chat_history and isinstance(chat_history, list):
            lines = ["## Conversation History (prior messages in this thread)\n"]
            for msg in chat_history[-10:]:
                role = msg.get("role", "user").capitalize()
                content = msg.get("content", "")[:2000]
                lines.append(f"**{role}**: {content}\n")
            memory["chat_context"] = "\n".join(lines)
        else:
            memory["chat_context"] = ""

        # ── Inject persistent memory context ─────────────────────────────
        user_id = memory.get("user_id")
        if user_id and getattr(self._settings, "MEMORY_ENABLED", False):
            try:
                from .memory import get_memory_service
                mem_svc = get_memory_service()
                memory_context = await mem_svc.get_memory_context(user_id, query)
                if memory_context:
                    memory["memory_context"] = memory_context
                    logger.info("Injected %d chars of memory context", len(memory_context))
            except Exception as exc:
                logger.warning("Memory context injection failed: %s", exc)

        # Prepend chat context to memory context so the LLM sees conversation history
        chat_ctx = memory.get("chat_context", "")
        if chat_ctx:
            memory["memory_context"] = chat_ctx + "\n\n" + memory.get("memory_context", "")

        logger.info(
            "Intake complete – query=%r  depth=%s  max_iter=%d",
            query[:80],
            constraints["depth"],
            memory["max_iterations"],
        )
        return State.PLAN

    async def _handle_plan(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Decompose the research query using Team Leader (with fallback to Planner)."""
        mode = memory.get("_mode", "BALANCED")
        depth = memory["constraints"].get("depth", "standard")

        try:
            plan = await self._team_leader.create_plan(
                query=memory["query"],
                depth=depth,
                mode=mode,
                constraints=memory["constraints"],
                llm=self._llm,
                memory_context=memory.get("memory_context", ""),
            )
        except Exception as exc:
            logger.warning("Team leader failed, falling back to planner: %s", exc)
            plan = await self._planner.plan(
                query=memory["query"],
                depth=depth,
                llm=self._llm,
            )

        if not memory.get("model_name") or memory.get("model_name") == self._settings.GROQ_SMART_MODEL:
            memory["model_name"] = self._llm.smart_model
        memory["plan"] = plan

        await self._emit_event(
            event_callback,
            "plan_complete",
            f"Created plan with {len(plan.get('sub_questions', []))} sub-questions (mode={mode})",
            {"plan": plan, "mode": mode},
            memory,
        )

        constraints = memory["constraints"]
        if constraints.get("interactive", False):
            return State.WAIT_FOR_USER
        return State.RESEARCH_LOOP

    async def _handle_wait_for_user(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Wait for user input or timeout, then proceed."""
        run_id = memory["run_id"]
        timeout = self._settings.USER_INPUT_TIMEOUT_SECONDS

        await self._emit_event(
            event_callback,
            "needs_user_input",
            "Waiting for user review of research plan",
            {
                "sub_questions": memory["plan"].get("sub_questions", []),
                "outline": memory["plan"].get("outline", ""),
                "constraints": memory["constraints"],
                "timeout_seconds": timeout,
            },
            memory,
        )

        # Register wait
        wait_event = register_user_input_wait(run_id)

        try:
            await asyncio.wait_for(wait_event.wait(), timeout=timeout)
            # User responded
            user_data = get_user_input_data(run_id)
            if user_data:
                memory["user_input_received"] = True
                memory["user_modifications"] = user_data

                # Apply user modifications
                action = user_data.get("action", "approve")

                if action == "approve":
                    pass  # Proceed with current plan

                elif action == "edit":
                    # User edited sub-questions
                    if user_data.get("sub_questions"):
                        memory["plan"]["sub_questions"] = user_data["sub_questions"]
                    if user_data.get("constraints"):
                        memory["constraints"].update(user_data["constraints"])
                    if user_data.get("excluded_domains"):
                        memory["constraints"]["excluded_domains"] = user_data["excluded_domains"]
                    if user_data.get("focus_topics"):
                        memory["plan"]["focus_areas"] = user_data["focus_topics"]

                await self._emit_event(
                    event_callback,
                    "user_input_received",
                    f"User {action}: proceeding with research",
                    {"action": action, "modifications": user_data},
                    memory,
                )

        except asyncio.TimeoutError:
            await self._emit_event(
                event_callback,
                "user_input_timeout",
                f"No user input after {timeout}s, proceeding automatically",
                {"timeout_seconds": timeout},
                memory,
            )

        cleanup_user_input(run_id)
        return State.RESEARCH_LOOP

    async def _handle_research_loop(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Run parallel research workers for each sub-question.

        Pipeline per worker:
        query_gen → search → dedupe → extract → parse → store → chunk → retrieve
        """
        await self._consume_pending_steering(
            memory=memory,
            event_callback=event_callback,
            phase="research_loop",
        )

        sub_questions = memory["plan"].get("sub_questions", [])

        # On refinement iterations, include new sub-questions
        if memory.get("_refine_sub_questions"):
            sub_questions = sub_questions + memory.pop("_refine_sub_questions")

        # --- Step 1: Generate queries ---
        queries = await self._query_gen.generate_queries(
            sub_questions=sub_questions,
            constraints=memory["constraints"],
            llm=self._llm,
        )

        if memory.get("_refine_queries"):
            extra = memory.pop("_refine_queries")
            queries.append({
                "sub_question": "Refinement gap-filling",
                "queries": extra,
            })

        memory["queries"] = queries

        # Track all query strings
        for group in queries:
            for q in group.get("queries", []):
                if q not in memory["all_query_strings"]:
                    memory["all_query_strings"].append(q)

        total_q = sum(len(g.get("queries", [])) for g in queries)
        await self._emit_event(
            event_callback,
            "queries_generated",
            f"Generated {total_q} search queries",
            {"queries": queries},
            memory,
        )

        # --- Step 2: Search ---
        logger.info("[orchestrator] Searching with Tavily (%d query groups)", len(queries))
        results = await self._searcher.search(
            queries=queries,
            allowed_domains=memory["constraints"].get("allowed_domains"),
            timeframe=memory["constraints"].get("timeframe"),
        )
        logger.info("[orchestrator] Tavily returned %d result groups", len(results))
        memory["search_results"] = results

        total_results = sum(len(r.get("results", [])) for r in results)
        await self._emit_event(
            event_callback,
            "search_complete",
            f"Found {total_results} results across all queries",
            {"result_count": total_results},
            memory,
        )

        # --- Step 2b: Academic search (if scholarly query) ---
        from .academic import is_scholarly_query
        if is_scholarly_query(memory["query"]) or total_results < 5:
            await self._emit_event(
                event_callback,
                "academic_search_started",
                "Querying academic sources (Semantic Scholar + arXiv)",
                {},
                memory,
            )

            for group in queries[:3]:  # Limit academic searches
                for q in group.get("queries", [])[:2]:
                    papers = await self._academic.search(q, limit=3, event_callback=event_callback)
                    if papers:
                        academic_docs = self._academic.papers_to_documents(papers)
                        memory["fetched_documents"].extend(academic_docs)

            await self._emit_event(
                event_callback,
                "academic_search_complete",
                f"Added {len(memory.get('fetched_documents', []))} academic documents",
                {},
                memory,
            )

        # --- Step 3: Fetch and parse ---
        urls: list[str] = []
        seen: set[str] = set()
        for group in results:
            for r in group.get("results", []):
                url = r.get("url", "")
                if url and url not in seen:
                    urls.append(url)
                    seen.add(url)

        documents = await self._fetcher.fetch_and_parse(urls)
        memory["fetched_documents"].extend(documents)

        await self._emit_event(
            event_callback,
            "fetch_complete",
            f"Fetched {len(documents)} / {len(urls)} URLs",
            {"fetched_count": len(documents), "total_urls": len(urls)},
            memory,
        )

        if not memory["fetched_documents"]:
            if total_results == 0:
                memory["errors"].append("No search results or documents found")
                return State.FAILED

        # --- Step 4: Index ---
        new_chunks = await self._indexer.index_documents(
            documents=memory["fetched_documents"],
            db_session=self._db,
        )
        memory["chunks"].extend(new_chunks)

        await self._emit_event(
            event_callback,
            "index_complete",
            f"Indexed {len(new_chunks)} chunks (total: {len(memory['chunks'])})",
            {"new_chunks": len(new_chunks), "total_chunks": len(memory["chunks"])},
            memory,
        )

        if not memory["chunks"]:
            memory["errors"].append("No chunks produced from documents")
            return State.FAILED

        return State.RETRIEVE_EVIDENCE

    async def _handle_retrieve(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Retrieve evidence chunks for each sub-question, then pack evidence."""
        sub_questions = memory["plan"].get("sub_questions", [])

        evidence = await self._retriever.retrieve(
            sub_questions=sub_questions,
            chunks=memory["chunks"],
            top_k=5,
        )

        # ── Evidence Packing ──────────────────────────────────────────────
        try:
            packed = await self._evidence_packer.pack(evidence, llm=self._llm)
            packed_evidence = packed.get("packed_evidence", [])
            for pe in packed_evidence:
                if "evidence" in pe:
                    for orig in evidence:
                        if orig.get("sub_question") == pe.get("sub_question"):
                            orig["evidence"] = pe["evidence"]
                            break

            await self._emit_event(
                event_callback,
                "evidence_packed",
                f"Packed evidence: {packed.get('total_unique_sources', 0)} unique sources, "
                f"diversity={packed.get('source_diversity_score', 0):.2f}",
                {
                    "source_diversity": packed.get("source_diversity_score"),
                    "unique_sources": packed.get("total_unique_sources"),
                    "total_chunks": packed.get("total_chunks_packed"),
                },
                memory,
            )
        except Exception as exc:
            logger.warning("Evidence packing failed (non-fatal): %s", exc)

        memory["evidence"] = evidence

        total_ev = sum(len(e.get("evidence", [])) for e in evidence)
        await self._emit_event(
            event_callback,
            "retrieve_complete",
            f"Retrieved {total_ev} evidence chunks for {len(sub_questions)} sub-questions",
            {"evidence_count": total_ev},
            memory,
        )
        return State.RERANK

    async def _handle_rerank(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Rerank evidence chunks using cross-encoder for better relevance."""
        if not getattr(self._settings, "RERANKER_ENABLED", True):
            return State.KG_EXTRACT

        try:
            from .reranker import get_reranker
            reranker = get_reranker()
            query = memory["query"]
            top_n = getattr(self._settings, "RERANKER_TOP_N", 10)

            for ev_group in memory.get("evidence", []):
                chunks = ev_group.get("evidence", [])
                if not chunks:
                    continue
                reranked = await reranker.rerank(
                    query=query,
                    chunks=chunks,
                    top_n=top_n,
                )
                ev_group["evidence"] = reranked

            await self._emit_event(
                event_callback,
                "rerank_complete",
                "Evidence reranked by cross-encoder relevance",
                {"reranker_top_n": top_n},
                memory,
            )
        except Exception as exc:
            logger.warning("Reranker failed (non-fatal), using original order: %s", exc)

        return State.KG_EXTRACT

    async def _handle_kg_extract(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Extract entities and relations for the Knowledge Graph."""
        if self._db is None:
            await self._emit_event(
                event_callback,
                "kg_extraction_skipped",
                "KG extraction skipped (Mongo mode does not use SQL KG store)",
                {},
                memory,
            )
            return State.SYNTHESIZE

        try:
            await self._emit_event(
                event_callback,
                "kg_extraction_started",
                "Extracting knowledge graph entities and relations",
                {},
                memory,
            )

            # Process top documents for KG extraction
            for doc in memory["fetched_documents"][:10]:
                await self._kg.process_document(
                    db=self._db,
                    document_text=doc.get("clean_text", "")[:10000],
                    document_title=doc.get("title", ""),
                    run_id=UUID(memory["run_id"]),
                    llm=self._llm,
                )

            # Detect gaps
            sub_questions = memory["plan"].get("sub_questions", [])
            gaps = await self._kg.detect_gaps(
                db=self._db,
                sub_questions=sub_questions,
                run_id=UUID(memory["run_id"]),
            )

            # Detect contradictions
            contradictions = await self._kg.detect_contradictions(
                db=self._db,
                run_id=UUID(memory["run_id"]),
            )

            # Generate summary for report
            kg_summary = await self._kg.generate_summary(
                db=self._db,
                run_id=UUID(memory["run_id"]),
            )
            memory["kg_summary"] = kg_summary

            await self._emit_event(
                event_callback,
                "kg_extraction_complete",
                f"KG: {len(gaps)} gaps, {len(contradictions)} contradictions",
                {
                    "gaps": gaps,
                    "contradictions": contradictions,
                    "summary_length": len(kg_summary),
                },
                memory,
            )

        except Exception as exc:
            logger.warning("KG extraction failed (non-fatal): %s", exc)
            await self._emit_event(
                event_callback,
                "kg_extraction_skipped",
                f"KG extraction skipped: {exc}",
                {"error": str(exc)},
                memory,
            )

        return State.SYNTHESIZE

    async def _handle_synthesize(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Synthesise a Markdown report from evidence."""
        await self._consume_pending_steering(
            memory=memory,
            event_callback=event_callback,
            phase="synthesize",
        )

        citation_style = memory["constraints"].get("citation_style", "numbered")

        result = await self._synthesizer.synthesize(
            plan=memory["plan"],
            evidence=memory["evidence"],
            citation_style=citation_style,
            llm=self._llm,
            chat_context=memory.get("chat_context", ""),
            memory_context=memory.get("memory_context", ""),
        )

        # Append KG summary if available
        report_md = result["report_md"]
        if memory.get("kg_summary"):
            report_md += f"\n\n---\n\n{memory['kg_summary']}"

        memory["report_md"] = report_md
        memory["citations"] = result["citations"]

        await self._emit_event(
            event_callback,
            "synthesize_complete",
            f"Report synthesized ({len(report_md)} chars, {len(result['citations'])} citations)",
            {"report_length": len(report_md), "citation_count": len(result["citations"])},
            memory,
        )
        return State.VERIFY

    async def _handle_verify(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Run verification + structured evaluation."""
        await self._emit_event(
            event_callback,
            "verification_started",
            "Running verification pipeline (Evaluator + CoVe + Critic)",
            {},
            memory,
        )

        # ── Structured Evaluator (new) ──────────────────────────────────
        eval_result = {}
        try:
            eval_result = await self._evaluator.evaluate(
                report_md=memory["report_md"],
                plan=memory["plan"],
                evidence=memory["evidence"],
                llm=self._llm,
            )
            await self._emit_event(
                event_callback,
                "evaluation_complete",
                f"Evaluator: overall={eval_result.get('scores', {}).get('overall', 0):.2f} "
                f"passed={eval_result.get('passed', False)}",
                {"evaluation_result": eval_result},
                memory,
            )
        except Exception as exc:
            logger.warning("Structured evaluator failed: %s", exc)

        # ── Legacy CoVe + Critic verifier ───────────────────────────────
        verification_result = await self._verifier.run_verification(
            report_md=memory["report_md"],
            plan=memory["plan"],
            evidence=memory["evidence"],
            llm=self._llm,
            db=self._db,
            run_id=UUID(memory["run_id"]),
            iteration=memory["iteration"],
        )

        memory["verification_result"] = verification_result

        # Merge eval results (use structured evaluator scores if available)
        if eval_result.get("scores"):
            merged_scores = eval_result["scores"]
        else:
            merged_scores = verification_result.get("scores", {})

        memory["eval_result"] = {
            "scores": merged_scores,
            "passed": eval_result.get("passed", verification_result.get("overall_passed", False)),
            "feedback": str(eval_result.get("revision_suggestions", verification_result.get("revision_suggestions", []))),
            "missing_areas": eval_result.get("missing_topics", verification_result.get("missing_topics", [])),
        }

        overall_passed = eval_result.get("passed", verification_result.get("overall_passed", False))

        await self._emit_event(
            event_callback,
            "verification_complete",
            f"Verification: passed={overall_passed}",
            {
                "verification_result": verification_result,
                "evaluation_result": eval_result,
                "overall_passed": overall_passed,
            },
            memory,
        )

        if overall_passed:
            return State.FINALIZE
        else:
            return State.REFINE

    async def _handle_refine(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Refine the research plan if verification failed."""
        await self._consume_pending_steering(
            memory=memory,
            event_callback=event_callback,
            phase="refine",
        )

        memory["iteration"] += 1

        if memory["iteration"] >= memory["max_iterations"]:
            logger.info(
                "Max iterations (%d) reached – finalizing with current report",
                memory["max_iterations"],
            )
            await self._emit_event(
                event_callback,
                "max_iterations_reached",
                f"Reached iteration cap ({memory['max_iterations']}); finalizing",
                {},
                memory,
            )
            return State.FINALIZE

        refinement = await self._refiner.refine(
            eval_result=memory["eval_result"],
            plan=memory["plan"],
            previous_queries=memory["all_query_strings"],
            llm=self._llm,
        )

        # Inject refinement outputs into memory for next loop
        new_sub_questions = refinement.get("new_sub_questions", [])
        new_queries = refinement.get("new_queries", [])

        if new_sub_questions:
            memory["plan"]["sub_questions"].extend(new_sub_questions)
            memory["_refine_sub_questions"] = new_sub_questions

        if new_queries:
            memory["_refine_queries"] = new_queries

        await self._emit_event(
            event_callback,
            "refine_complete",
            f"Refinement iteration {memory['iteration']}: "
            f"+{len(new_sub_questions)} sub-questions, +{len(new_queries)} queries",
            {"refinement": refinement, "iteration": memory["iteration"]},
            memory,
        )

        return State.RESEARCH_LOOP

    async def _consume_pending_steering(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
        *,
        phase: str,
    ) -> None:
        """Apply queued non-blocking user steering updates at safe checkpoints."""
        queued = drain_steering_inputs(memory["run_id"])
        if not queued:
            return

        incoming_notes: list[str] = []
        for item in queued:
            note = str(item.get("message", "")).strip()
            if not note:
                continue
            incoming_notes.append(note[:500])

        if not incoming_notes:
            return

        applied_notes: list[str] = []
        steering_notes = memory.setdefault("steering_notes", [])
        for note in incoming_notes:
            if note in steering_notes:
                continue
            steering_notes.append(note)
            applied_notes.append(note)

        if not applied_notes:
            return

        constraints = memory.setdefault("constraints", {})
        steering_constraints = constraints.get("steering_notes")
        if not isinstance(steering_constraints, list):
            steering_constraints = []
        for note in applied_notes:
            if note not in steering_constraints:
                steering_constraints.append(note)
        constraints["steering_notes"] = steering_constraints[-10:]

        plan = memory.setdefault("plan", {})
        focus_areas = plan.get("focus_areas")
        if not isinstance(focus_areas, list):
            focus_areas = []
        for note in applied_notes:
            if note not in focus_areas:
                focus_areas.append(note)
        plan["focus_areas"] = focus_areas[-10:]

        if phase in {"research_loop", "refine"}:
            sub_questions = plan.get("sub_questions")
            if not isinstance(sub_questions, list):
                sub_questions = []
            for note in applied_notes:
                sq = f"Incorporate user steering context: {note}"
                if sq not in sub_questions:
                    sub_questions.append(sq)
            plan["sub_questions"] = sub_questions

        if phase in {"synthesize", "verify", "finalize"}:
            outline = plan.get("outline")
            if not isinstance(outline, list):
                outline = []
            steering_desc = "; ".join(applied_notes[-3:])[:700]
            updated = False
            for section in outline:
                if (
                    isinstance(section, dict)
                    and str(section.get("title", "")).strip().lower() == "user steering"
                ):
                    section["description"] = steering_desc
                    updated = True
                    break
            if not updated:
                outline.append(
                    {
                        "title": "User Steering",
                        "description": steering_desc,
                    }
                )
            plan["outline"] = outline

        await self._emit_event(
            event_callback,
            "steering_applied",
            f"Applied {len(applied_notes)} steering update(s) at {phase}",
            {
                "phase": phase,
                "notes_count": len(applied_notes),
                "notes": applied_notes,
            },
            memory,
        )

    # ------------------------------------------------------------------ #
    # Event emission
    # ------------------------------------------------------------------ #

    async def _emit_event(
        self,
        callback: EventCallback,
        state: str,
        message: str,
        payload: dict[str, Any],
        memory: OrchestratorState,
    ) -> None:
        """Persist a RunEvent to DB and push it via the SSE callback."""
        event_id = str(uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        # Persist to DB
        try:
            await self._persist_event(
                run_id=memory["run_id"],
                event_id=event_id,
                state=state,
                message=message,
                payload=payload,
                timestamp=timestamp,
            )
        except Exception:
            logger.warning("Failed to persist event to DB", exc_info=True)

        # Push via SSE callback
        try:
            await callback(state, message, payload)
        except Exception:
            logger.warning("Event callback failed", exc_info=True)

    async def _persist_event(
        self,
        run_id: str,
        event_id: str,
        state: str,
        message: str,
        payload: dict[str, Any],
        timestamp: str,
    ) -> None:
        """Persist an event in Mongo (primary) or SQL (legacy fallback)."""
        # Serialise payload – drop large text fields to keep events lean
        lean_payload = {
            k: v for k, v in payload.items()
            if k not in ("report_md",)
        }
        payload_json: dict[str, Any] = lean_payload
        payload_str = json.dumps(lean_payload, default=str)
        if len(payload_str) > 50_000:
            payload_json = {"truncated": True, "state": state}

        if self._run_store is not None:
            await self._run_store.append_event(
                event_id=event_id,
                run_id=run_id,
                state=state,
                message=message,
                payload=payload_json,
                timestamp=timestamp,
            )
            return

        if self._db is None:
            return

        from sqlalchemy import text as sa_text

        await self._db.execute(
            sa_text(
                "INSERT INTO run_events (id, run_id, timestamp, state, message, payload_json) "
                "VALUES (:id, :run_id, :ts, :state, :message, :payload)"
            ),
            {
                "id": event_id,
                "run_id": run_id,
                "ts": timestamp,
                "state": state,
                "message": message,
                "payload": json.dumps(payload_json, default=str),
            },
        )

    # ------------------------------------------------------------------ #
    # Final persistence
    # ------------------------------------------------------------------ #

    async def _persist_final(self, memory: OrchestratorState) -> None:
        """Update the Run record with final report and scores."""
        scores = memory.get("verification_result", {}).get("scores", memory.get("eval_result", {}).get("scores", {}))
        citations = self._normalize_citations(memory.get("citations", []))

        # ── Store run summary in persistent memory ───────────────────────
        user_id = memory.get("user_id")
        if user_id and memory.get("status") == "completed" and getattr(self._settings, "MEMORY_ENABLED", False):
            try:
                from .memory import get_memory_service
                mem_svc = get_memory_service()
                report_md = memory.get("report_md", "")
                summary = report_md[:500] if report_md else ""
                await mem_svc.store_run_summary(
                    user_id=user_id,
                    run_id=memory["run_id"],
                    query=memory["query"],
                    report_summary=summary,
                )
            except Exception as exc:
                logger.warning("Failed to store run summary in memory: %s", exc)

        if self._run_store is not None:
            await self._run_store.update_run_final(
                run_id=memory["run_id"],
                status=memory["status"],
                report_md=memory.get("report_md", ""),
                report_json=memory.get("report_json", {}),
                scores_json=scores if isinstance(scores, dict) else {},
                citations=citations,
                model_name=memory.get("model_name"),
                iteration_count=memory.get("iteration", 0),
            )
            logger.info("Persisted final state for run %s (Mongo)", memory["run_id"])
            return

        if self._db is None:
            return

        from sqlalchemy import text as sa_text
        scores_json = json.dumps(scores, default=str)

        try:
            await self._db.execute(
                sa_text(
                    "UPDATE runs SET status = :status, "
                    "report_md = :report, "
                    "scores_json = :scores, "
                    "model_name = :model_name, "
                    "iteration_count = :iterations, "
                    "finished_at = :finished "
                    "WHERE id = :run_id"
                ),
                {
                    "status": memory["status"],
                    "report": memory.get("report_md", ""),
                    "scores": scores_json,
                    "model_name": memory.get("model_name"),
                    "iterations": memory.get("iteration", 0),
                    "finished": datetime.now(timezone.utc).isoformat(),
                    "run_id": memory["run_id"],
                },
            )
            await self._db.commit()
            logger.info("Persisted final state for run %s", memory["run_id"])
        except Exception:
            logger.exception("Failed to persist final run state")

    @staticmethod
    def _normalize_citations(raw: list[dict[str, Any]] | Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        out: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url", "")).strip()
            if not url:
                continue
            out.append(
                {
                    "id": str(uuid4()),
                    "claim_text": str(item.get("claim_text", "")),
                    "snippet": str(item.get("snippet", "")),
                    "url": url,
                    "section_key": (
                        str(item.get("section_key"))
                        if item.get("section_key") is not None
                        else None
                    ),
                }
            )
        return out
