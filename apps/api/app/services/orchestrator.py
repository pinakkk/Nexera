"""Orchestrator – deterministic state-machine that drives the research loop.

States
------
INTAKE -> PLAN -> QUERY_GENERATE -> SEARCH -> FETCH_PARSE -> INDEX ->
RETRIEVE -> SYNTHESIZE -> EVALUATE -> (REFINE -> QUERY_GENERATE ...) -> FINALIZE

On any unrecoverable error the machine transitions to FAILED.
"""

import enum
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, TypedDict
from uuid import UUID, uuid4

from .evaluator import EvaluatorService
from .fetcher import FetcherService
from .indexer import IndexerService
from .llm import LLMService, get_llm_service
from .planner import PlannerService
from .query_generator import QueryGeneratorService
from .refiner import RefinerService
from .retriever import RetrieverService
from .searcher import SearchService
from .synthesizer import SynthesizerService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------- #
# States
# ---------------------------------------------------------------------- #


class State(str, enum.Enum):
    """Deterministic states of the research agent."""

    INTAKE = "intake"
    PLAN = "plan"
    QUERY_GENERATE = "query_generate"
    SEARCH = "search"
    FETCH_PARSE = "fetch_parse"
    INDEX = "index"
    RETRIEVE = "retrieve"
    SYNTHESIZE = "synthesize"
    EVALUATE = "evaluate"
    REFINE = "refine"
    FINALIZE = "finalize"
    FAILED = "failed"


# ---------------------------------------------------------------------- #
# Working-memory typed dict
# ---------------------------------------------------------------------- #


class OrchestratorState(TypedDict, total=False):
    """Mutable working memory carried through the state machine."""

    run_id: str
    query: str
    constraints: dict[str, Any]
    status: str
    current_state: str

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
    iteration: int
    max_iterations: int

    # Error tracking
    errors: list[str]


# Type alias for the callback that streams events over SSE
EventCallback = Callable[[str, str, dict[str, Any]], Coroutine[Any, Any, None]]


# ---------------------------------------------------------------------- #
# Orchestrator
# ---------------------------------------------------------------------- #


class Orchestrator:
    """Runs the deterministic research-agent state machine.

    Each public call to :meth:`run` executes the full loop for a single
    research run, emitting events through *event_callback* (SSE stream)
    and persisting them to the database.
    """

    def __init__(self, db_session: Any, settings: Any) -> None:
        self._db = db_session
        self._settings = settings

        # Initialise all sub-services
        self._llm: LLMService = get_llm_service(settings)
        self._planner = PlannerService()
        self._query_gen = QueryGeneratorService()
        self._searcher = SearchService(
            api_key=getattr(settings, "TAVILY_API_KEY", ""),
            max_results_per_query=getattr(settings, "SEARCH_MAX_RESULTS", 5),
        )
        self._fetcher = FetcherService()
        self._indexer = IndexerService()
        self._retriever = RetrieverService()
        self._synthesizer = SynthesizerService()
        self._evaluator = EvaluatorService()
        self._refiner = RefinerService()

    # ------------------------------------------------------------------ #
    # Main entry point
    # ------------------------------------------------------------------ #

    async def run(
        self,
        run_id: UUID,
        query: str,
        constraints: dict[str, Any],
        event_callback: EventCallback,
    ) -> OrchestratorState:
        """Execute the full research pipeline for *run_id*.

        Parameters
        ----------
        run_id:
            Unique run identifier (created by the API layer).
        query:
            The user's research question.
        constraints:
            Dict of optional constraints (depth, timeframe, allowed_domains,
            citation_style, max_iterations).
        event_callback:
            ``async (state, message, payload) -> None`` – called on every
            state transition to push SSE events.

        Returns
        -------
        The final :class:`OrchestratorState`.
        """
        # Reset per-run caches
        self._searcher.reset()

        state = State.INTAKE
        memory: OrchestratorState = {
            "run_id": str(run_id),
            "query": query,
            "constraints": constraints,
            "status": "running",
            "current_state": state.value,
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
            "iteration": 0,
            "max_iterations": int(constraints.get("max_iterations", 3)),
            "errors": [],
        }

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
                    "scores": memory.get("eval_result", {}).get("scores", {}),
                    "errors": memory.get("errors", []),
                    "model_name": memory.get("model_name"),
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
            # ---------------------------------------------------------- #
            case State.INTAKE:
                return await self._handle_intake(memory)

            # ---------------------------------------------------------- #
            case State.PLAN:
                return await self._handle_plan(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.QUERY_GENERATE:
                return await self._handle_query_generate(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.SEARCH:
                return await self._handle_search(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.FETCH_PARSE:
                return await self._handle_fetch_parse(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.INDEX:
                return await self._handle_index(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.RETRIEVE:
                return await self._handle_retrieve(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.SYNTHESIZE:
                return await self._handle_synthesize(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.EVALUATE:
                return await self._handle_evaluate(memory, event_callback)

            # ---------------------------------------------------------- #
            case State.REFINE:
                return await self._handle_refine(memory, event_callback)

            # ---------------------------------------------------------- #
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
        constraints.setdefault("max_iterations", 3)

        memory["max_iterations"] = int(constraints["max_iterations"])

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
        """Decompose the research query into sub-questions and outline."""
        plan = await self._planner.plan(
            query=memory["query"],
            depth=memory["constraints"].get("depth", "standard"),
            llm=self._llm,
        )
        # If Groq auto-selection changed models during the first LLM call,
        # persist the effective smart model for traceability.
        if not memory.get("model_name") or memory.get("model_name") == self._settings.GROQ_SMART_MODEL:
            memory["model_name"] = self._llm.smart_model
        memory["plan"] = plan

        await self._emit_event(
            event_callback,
            "plan_complete",
            f"Created plan with {len(plan.get('sub_questions', []))} sub-questions",
            {"plan": plan},
            memory,
        )
        return State.QUERY_GENERATE

    async def _handle_query_generate(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Generate search queries from sub-questions."""
        sub_questions = memory["plan"].get("sub_questions", [])

        # On refinement iterations, include new sub-questions
        if memory.get("_refine_sub_questions"):
            sub_questions = sub_questions + memory.pop("_refine_sub_questions")

        queries = await self._query_gen.generate_queries(
            sub_questions=sub_questions,
            constraints=memory["constraints"],
            llm=self._llm,
        )

        # On refinement, also inject direct new queries from refiner
        if memory.get("_refine_queries"):
            extra = memory.pop("_refine_queries")
            queries.append({
                "sub_question": "Refinement gap-filling",
                "queries": extra,
            })

        memory["queries"] = queries

        # Track all query strings for dedup
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
        return State.SEARCH

    async def _handle_search(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Execute web searches via Tavily."""
        results = await self._searcher.search(
            queries=memory["queries"],
            allowed_domains=memory["constraints"].get("allowed_domains"),
            timeframe=memory["constraints"].get("timeframe"),
        )
        memory["search_results"] = results

        total_results = sum(len(r.get("results", [])) for r in results)
        await self._emit_event(
            event_callback,
            "search_complete",
            f"Found {total_results} results across all queries",
            {"result_count": total_results},
            memory,
        )

        if total_results == 0:
            search_errors: list[str] = [
                str(r.get("error", "")).strip()
                for r in results
                if isinstance(r.get("error"), str) and str(r.get("error")).strip()
            ]
            if search_errors:
                memory["errors"].append(
                    "Search provider failed. "
                    f"First error: {search_errors[0]}"
                )
            else:
                memory["errors"].append(
                    "No search results found. "
                    "Check query specificity, Tavily API key, and network access."
                )
            return State.FAILED

        return State.FETCH_PARSE

    async def _handle_fetch_parse(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Fetch and parse web pages."""
        # Collect unique URLs from search results
        urls: list[str] = []
        seen: set[str] = set()
        for group in memory["search_results"]:
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
            f"Fetched and parsed {len(documents)} / {len(urls)} URLs",
            {"fetched_count": len(documents), "total_urls": len(urls)},
            memory,
        )

        if not documents and not memory["fetched_documents"]:
            memory["errors"].append("No documents could be fetched")
            return State.FAILED

        return State.INDEX

    async def _handle_index(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Chunk and index fetched documents."""
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

        return State.RETRIEVE

    async def _handle_retrieve(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Retrieve evidence chunks for each sub-question."""
        sub_questions = memory["plan"].get("sub_questions", [])

        evidence = await self._retriever.retrieve(
            sub_questions=sub_questions,
            chunks=memory["chunks"],
            top_k=5,
        )
        memory["evidence"] = evidence

        total_ev = sum(len(e.get("evidence", [])) for e in evidence)
        await self._emit_event(
            event_callback,
            "retrieve_complete",
            f"Retrieved {total_ev} evidence chunks for {len(sub_questions)} sub-questions",
            {"evidence_count": total_ev},
            memory,
        )
        return State.SYNTHESIZE

    async def _handle_synthesize(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Synthesise a Markdown report from evidence."""
        citation_style = memory["constraints"].get("citation_style", "numbered")

        result = await self._synthesizer.synthesize(
            plan=memory["plan"],
            evidence=memory["evidence"],
            citation_style=citation_style,
            llm=self._llm,
        )

        memory["report_md"] = result["report_md"]
        memory["citations"] = result["citations"]

        await self._emit_event(
            event_callback,
            "synthesize_complete",
            f"Report synthesized ({len(result['report_md'])} chars, {len(result['citations'])} citations)",
            {"report_length": len(result["report_md"]), "citation_count": len(result["citations"])},
            memory,
        )
        return State.EVALUATE

    async def _handle_evaluate(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Evaluate the report quality."""
        eval_result = await self._evaluator.evaluate(
            report_md=memory["report_md"],
            evidence=memory["evidence"],
            plan=memory["plan"],
            llm=self._llm,
        )
        memory["eval_result"] = eval_result

        await self._emit_event(
            event_callback,
            "evaluate_complete",
            f"Evaluation: passed={eval_result['passed']}  scores={eval_result['scores']}",
            {"eval_result": eval_result},
            memory,
        )

        if eval_result["passed"]:
            return State.FINALIZE
        else:
            return State.REFINE

    async def _handle_refine(
        self,
        memory: OrchestratorState,
        event_callback: EventCallback,
    ) -> State:
        """Refine the research plan if evaluation failed."""
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

        # Extend the plan with new sub-questions
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

        return State.QUERY_GENERATE

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
        """Insert a row into the run_events table."""
        if self._db is None:
            return

        from sqlalchemy import text as sa_text

        # Serialise payload – drop large text fields to keep events lean
        lean_payload = {
            k: v for k, v in payload.items()
            if k not in ("report_md",)
        }
        # Serialize payload for raw SQL bind params (psycopg can't adapt plain
        # dicts here without explicit JSON typing on the text() statement).
        payload_str = json.dumps(lean_payload, default=str)
        if len(payload_str) > 50_000:
            payload_str = json.dumps({"truncated": True, "state": state})

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
                "payload": payload_str,
            },
        )

    # ------------------------------------------------------------------ #
    # Final persistence
    # ------------------------------------------------------------------ #

    async def _persist_final(self, memory: OrchestratorState) -> None:
        """Update the Run record with final report and scores."""
        if self._db is None:
            return

        from sqlalchemy import text as sa_text

        scores = memory.get("eval_result", {}).get("scores", {})
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
