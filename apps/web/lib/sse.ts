import { RunEvent, RunResult } from './types';
import { getRun, normalizeRunEvent } from './api';

/* ------------------------------------------------------------------ */
/*  SSE client for subscribing to run event streams                    */
/* ------------------------------------------------------------------ */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const SETTINGS_STORAGE_KEY = 'research-agent-settings';

function getBaseUrl(): string {
  if (typeof window === 'undefined') {
    return BASE_URL;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return BASE_URL;
    const parsed = JSON.parse(raw) as { apiUrl?: string };
    return parsed.apiUrl?.trim() || BASE_URL;
  } catch {
    return BASE_URL;
  }
}

export interface SSECallbacks {
  /** Called for each incremental event during the run */
  onEvent: (event: RunEvent) => void;
  /** Called when the run completes with the final result */
  onComplete: (result: RunResult) => void;
  /** Called on connection or parsing errors */
  onError: (error: Error) => void;
}

/**
 * Subscribe to the SSE stream for a research run.
 *
 * Returns a cleanup function that closes the connection.
 */
export function subscribeToRun(
  runId: string,
  { onEvent, onComplete, onError }: SSECallbacks,
): () => void {
  const url = `${getBaseUrl()}/v1/runs/${runId}/stream`;

  let eventSource: EventSource | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let completionRequested = false;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_BASE_DELAY = 1000;

  async function completeFromApi() {
    if (completionRequested || closed) return;
    completionRequested = true;
    try {
      const result = await getRun(runId);
      onComplete(result);
      cleanup();
    } catch (error) {
      completionRequested = false;
      onError(
        error instanceof Error
          ? error
          : new Error('Failed to fetch final run result'),
      );
    }
  }

  function isTerminalState(state: string): boolean {
    return state === 'finalize' || state === 'failed';
  }

  function handleRawMessage(data: string) {
    try {
      const raw = JSON.parse(data);
      const event: RunEvent = normalizeRunEvent(raw, runId);
      onEvent(event);

      if (isTerminalState(event.state)) {
        void completeFromApi();
      }
    } catch (error) {
      onError(
        error instanceof Error
          ? error
          : new Error('Failed to parse run event message'),
      );
    }
  }

  function connect() {
    if (closed) return;

    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      reconnectAttempts = 0;
    };

    // Backend emits standard "message" events with JSON data.
    eventSource.onmessage = (e: MessageEvent) => {
      handleRawMessage(e.data);
    };

    /** Handle error events from the server */
    eventSource.addEventListener('error_event', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onError(new Error(data.message ?? 'Unknown server error'));
      } catch {
        onError(new Error('Unknown error event'));
      }
    });

    /** Native EventSource error handler (includes connection drops) */
    eventSource.onerror = () => {
      if (closed) return;

      eventSource?.close();

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay =
          RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, delay);
      } else {
        onError(
          new Error(
            'Lost connection to event stream after max reconnection attempts.',
          ),
        );
      }
    };
  }

  function cleanup() {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  // Start the connection
  connect();

  // Return the cleanup function
  return cleanup;
}
