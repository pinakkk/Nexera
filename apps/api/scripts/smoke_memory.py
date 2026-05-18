"""Smoke test: verify Supabase persistence + cross-turn memory.

Runs against the configured Supabase DATABASE_URL. Exercises the store and
the memory service the same way the API does, and asserts that a follow-up
turn can recall the prior turn's thread summary (the bug this fixes).

Usage:
    .venv/bin/python -m scripts.smoke_memory
"""

from __future__ import annotations

import asyncio
import uuid

from app.db.store import get_store
from app.services.memory import get_memory_service


async def main() -> None:
    store = get_store()
    mem = get_memory_service()

    await store.ping()
    print("[1/6] DB ping OK")

    run_id = str(uuid.uuid4())
    thread_id = run_id
    session_id = f"smoke-sess-{uuid.uuid4().hex[:8]}"

    await store.create_run(
        {
            "id": run_id,
            "user_id": None,
            "session_id": session_id,
            "query": "What is the capital of France?",
            "constraints_json": {},
            "status": "pending",
            "thread_id": thread_id,
        }
    )
    assert await store.run_exists(run_id, session_id=session_id)
    print("[2/6] create_run + scoped run_exists OK")

    await store.append_event(
        event_id=str(uuid.uuid4()),
        run_id=run_id,
        state="planning",
        message="smoke event",
        payload={"k": "v"},
    )
    events = await store.get_events(run_id)
    assert len(events) == 1 and events[0]["state"] == "planning"
    print("[3/6] append_event + get_events OK")

    await store.update_run_final(
        run_id=run_id,
        status="completed",
        report_md="Paris is the capital of France.",
        report_json={"gate_route": "DIRECT_ANSWER"},
        scores_json={},
        citations=[{"url": "https://example.com", "snippet": "Paris", "claim_text": "x"}],
        model_name="smoke",
        iteration_count=0,
    )
    row = await store.get_run(run_id, session_id=session_id)
    assert row and row["status"] == "completed"
    assert row["report_md"].startswith("Paris")
    assert isinstance(row.get("citations"), list) and len(row["citations"]) == 1
    print("[4/6] update_run_final + get_run (citations mirrored) OK")

    # Cross-scope isolation: a different session must NOT see this run.
    assert await store.get_run(run_id, session_id="other-sess") is None
    print("[5/6] scope isolation OK (other session cannot read run)")

    # The actual memory-bug check: persist a thread summary on turn 1,
    # then confirm turn 2's context bundle recalls it.
    await mem.upsert_thread_summary(
        thread_id=thread_id,
        query="What is the capital of France?",
        summary="Q: capital of France?\nA: Paris.",
        session_id=session_id,
        source_run_id=run_id,
    )
    bundle = await mem.get_context_bundle(
        query="and its population?",
        thread_id=thread_id,
        session_id=session_id,
        recent_chat_history=[
            {"role": "user", "content": "What is the capital of France?"},
            {"role": "assistant", "content": "Paris."},
        ],
    )
    assert "Paris" in bundle["thread_summary_context"], bundle
    assert bundle["counts"]["thread_summary"] == 1
    assert bundle["counts"]["recent_turns"] == 2
    print("[6/6] cross-turn memory OK — follow-up recalls prior thread summary")

    # Cleanup
    await store.delete_run(run_id, session_id=session_id)
    print("\nSMOKE PASS: Supabase persistence + context memory verified")


if __name__ == "__main__":
    asyncio.run(main())
