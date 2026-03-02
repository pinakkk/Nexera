'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResearchInput } from '@/components/ResearchInput';
import { createRun, ingestSources, ingestSourceUrls } from '@/lib/api';
import { RunConstraints } from '@/lib/types';
import { FlaskConical } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    query: string,
    constraints: RunConstraints,
    extras: { files: File[]; urls: string[] },
  ) {
    setIsLoading(true);
    setError(null);

    try {
      if (extras.files.length > 0) {
        await ingestSources(extras.files);
      }

      if (extras.urls.length > 0) {
        await ingestSourceUrls(extras.urls);
      }

      const { run_id } = await createRun(query, constraints);
      router.push(`/runs/${run_id}`);
    } catch (err) {
      console.error('[HomePage] Failed to start run', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start research. Please try again.',
      );
      setIsLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 pb-10 pt-14 sm:px-6 sm:pt-16">
      <div className="pointer-events-none absolute left-1/2 top-[18%] h-[340px] w-[340px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl sm:top-[22%] sm:h-[460px] sm:w-[460px] dark:bg-sky-500/15" />
      <div className="pointer-events-none absolute right-[10%] top-[40%] h-[200px] w-[200px] rounded-full bg-purple-500/5 blur-3xl sm:h-[300px] sm:w-[300px] dark:bg-purple-500/10" />
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-5xl flex-col items-center justify-center">
        <div className="fade-up mb-10 flex flex-col items-center text-center">
          {/* <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-black/10 bg-white/90 text-neutral-900 shadow-sm dark:border-white/10 dark:bg-[#0e1117] dark:text-white">
            <FlaskConical size={28} strokeWidth={1.75} />
          </div> */}
          <h1 className="h-display text-3xl font-semibold text-neutral-900 dark:text-white sm:text-5xl">
            Nexara
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400 sm:mt-3 sm:text-base">
            Your Next Favourite Autonomous Agent.
          </p>
        </div>

        <div className="fade-up w-full" style={{ animationDelay: '120ms' }}>
          <ResearchInput onSubmit={handleSubmit} isLoading={isLoading} />
        </div>

        {error && (
          <div className="mt-4 w-full max-w-3xl rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
