"""In-memory event bus for SSE streaming to connected clients."""
import asyncio
from typing import Any

# Global registry: run_id -> list of queues
_queues: dict[str, list[asyncio.Queue]] = {}


def register_queue(run_id: str) -> asyncio.Queue:
    """Register a new queue for a run_id and return it."""
    if run_id not in _queues:
        _queues[run_id] = []
    queue: asyncio.Queue = asyncio.Queue()
    _queues[run_id].append(queue)
    return queue


def unregister_queue(run_id: str, queue: asyncio.Queue) -> None:
    """Remove a queue from the registry."""
    if run_id in _queues:
        try:
            _queues[run_id].remove(queue)
        except ValueError:
            pass
        if not _queues[run_id]:
            del _queues[run_id]


async def broadcast_event(run_id: str, event_data: dict[str, Any]) -> None:
    """Broadcast an event to all registered queues for a run_id."""
    if run_id in _queues:
        for queue in _queues[run_id]:
            await queue.put(event_data)


async def broadcast_complete(run_id: str) -> None:
    """Signal completion to all queues."""
    if run_id in _queues:
        for queue in _queues[run_id]:
            await queue.put(None)  # None signals stream end
