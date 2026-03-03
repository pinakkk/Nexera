import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const isMongoUrl =
    databaseUrl.startsWith('mongodb://') ||
    databaseUrl.startsWith('mongodb+srv://');
  if (!databaseUrl || databaseUrl.includes('<') || !isMongoUrl) {
    return NextResponse.json(
      {
        status: 'error',
        provider: 'mongodb-atlas-prisma',
        message:
          'DATABASE_URL is not configured. Set a valid MongoDB Atlas connection string.',
      },
      { status: 503 },
    );
  }

  try {
    const result = await prisma.$runCommandRaw({ ping: 1 });
    return NextResponse.json({
      status: 'ok',
      provider: 'mongodb-atlas-prisma',
      result,
    });
  } catch (error) {
    console.error('[api/db/health] Prisma/MongoDB check failed', error);
    return NextResponse.json(
      {
        status: 'error',
        provider: 'mongodb-atlas-prisma',
        message:
          error instanceof Error ? error.message : 'Unknown Prisma DB error',
      },
      { status: 500 },
    );
  }
}
