'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Citation, Source, EvaluationScores } from '@/lib/types';
import { SourcesPanel } from './SourcesPanel';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ReportViewerProps {
  reportMd: string | null;
  citations: Citation[];
  sources: Source[];
  evaluation: EvaluationScores | null;
  isRunning: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ReportViewer({
  reportMd,
  citations,
  sources,
  evaluation,
  isRunning,
}: ReportViewerProps) {
  if (!reportMd && isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-6 h-6 border-2 border-neutral-300 dark:border-neutral-700 border-t-neutral-500 dark:border-t-neutral-400 rounded-full animate-spin" />
        <p className="text-sm text-neutral-600 dark:text-neutral-500">
          Researching and writing report...
        </p>
      </div>
    );
  }

  if (!reportMd) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-neutral-600 dark:text-neutral-500">No report available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Evaluation scores bar */}
      {evaluation && <EvaluationBar scores={evaluation} />}

      {/* Report content */}
      <article className="markdown-body text-reveal">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            /* Render citation references as superscript links */
            a: ({ href, children, ...props }) => {
              // Check if this is a citation reference like [1]
              const text = String(children);
              const citationMatch = text.match(/^\[(\d+)\]$/);
              if (citationMatch) {
                const citNum = parseInt(citationMatch[1], 10);
                const citation = citations[citNum - 1];
                return (
                  <sup className="inline-flex">
                    <a
                      href={citation?.source_url ?? href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={citation?.source_title ?? ''}
                      className="inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded bg-sky-500/12 px-1 text-[10px] font-medium text-sky-700 transition-colors hover:bg-sky-500/20 dark:text-sky-300 no-underline"
                      {...props}
                    >
                      {citNum}
                    </a>
                  </sup>
                );
              }

              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-700 underline hover:text-sky-600 dark:text-sky-300 dark:hover:text-sky-200"
                  {...props}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {reportMd}
        </ReactMarkdown>
      </article>

      {/* Sources panel */}
      {sources.length > 0 && <SourcesPanel sources={sources} citations={citations} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Evaluation Bar                                                     */
/* ------------------------------------------------------------------ */

function EvaluationBar({ scores }: { scores: EvaluationScores }) {
  const entries = [
    { label: 'Coverage', value: scores.coverage },
    { label: 'Accuracy', value: scores.accuracy },
    { label: 'Coherence', value: scores.coherence },
    { label: 'Citations', value: scores.citation_quality },
    { label: 'Overall', value: scores.overall },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/80 p-3 dark:border-white/[0.06] dark:bg-[#111]/80 sm:gap-3 sm:p-4 backdrop-blur-sm">
      <span className="w-full text-xs font-medium text-neutral-500 sm:w-auto">Quality Scores</span>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-500">{entry.label}</span>
            <span
              className={`inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 text-[11px] font-semibold rounded-full ${
                entry.value >= 0.7
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : entry.value >= 0.5
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-red-500/10 text-red-400'
              }`}
            >
              {(entry.value * 100).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
