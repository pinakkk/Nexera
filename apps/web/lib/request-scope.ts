const ANONYMOUS_SESSION_STORAGE_KEY = 'nexara-anonymous-session-id';
export const ANONYMOUS_SESSION_QUERY_PARAM = 'anonymous_session_id';

function fallbackId(): string {
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnonymousSessionId(): string {
  if (typeof window === 'undefined') {
    return 'anon-server';
  }

  const existing = window.localStorage.getItem(ANONYMOUS_SESSION_STORAGE_KEY);
  if (existing) return existing;

  const generated =
    typeof window.crypto?.randomUUID === 'function'
      ? `anon-${window.crypto.randomUUID()}`
      : fallbackId();
  window.localStorage.setItem(ANONYMOUS_SESSION_STORAGE_KEY, generated);
  return generated;
}
