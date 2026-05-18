import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function apiBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').trim();
  return raw || 'http://localhost:8000';
}

export async function GET() {
  const url = `${apiBaseUrl()}/health`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(
      { status: res.ok ? 'ok' : 'error', provider: 'supabase-postgres', result: body },
      { status: res.ok ? 200 : 503 },
    );
  } catch (error) {
    console.error('[api/db/health] Supabase health check failed', error);
    return NextResponse.json(
      {
        status: 'error',
        provider: 'supabase-postgres',
        message: error instanceof Error ? error.message : 'Unknown DB health error',
      },
      { status: 503 },
    );
  }
}
