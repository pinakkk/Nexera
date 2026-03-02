import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl || databaseUrl.includes('<')) {
    return NextResponse.json(
      {
        status: 'error',
        provider: 'neon-postgres-prisma',
        message:
          'DATABASE_URL is not configured. Set a valid Neon connection string.',
      },
      { status: 503 },
    );
  }

  try {
    const result = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(
      'SELECT 1 as ok',
    );
    return NextResponse.json({
      status: 'ok',
      provider: 'neon-postgres-prisma',
      result,
    });
  } catch (error) {
    console.error('[api/db/health] Prisma/Neon check failed', error);
    return NextResponse.json(
      {
        status: 'error',
        provider: 'neon-postgres-prisma',
        message:
          error instanceof Error ? error.message : 'Unknown Prisma DB error',
      },
      { status: 500 },
    );
  }
}
