'use client';

import { Citation, Source } from '@/lib/types';
import { ExternalLink, Shield, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { TEXT_CONFIG } from '@/lib/text-config';

/* ------------------------------------------------------------------ */
/*  Reliability heuristics                                             */
/* ------------------------------------------------------------------ */

const RELIABLE_DOMAINS = new Set([
  'arxiv.org',
  'scholar.google.com',
  'nature.com',
  'science.org',
  'sciencedirect.com',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'ieee.org',
  'acm.org',
  'springer.com',
  'wiley.com',
  'github.com',
  'docs.python.org',
  'developer.mozilla.org',
  'en.wikipedia.org',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  'gov',
  'edu',
]);

function getReliability(domain: string): 'reliable' | 'moderate' | 'unverified' {
  if (RELIABLE_DOMAINS.has(domain)) return 'reliable';
  // Check TLD
  const tld = domain.split('.').pop() ?? '';
  if (['gov', 'edu'].includes(tld)) return 'reliable';
  if (['org', 'int'].includes(tld)) return 'moderate';
  return 'unverified';
}

const reliabilityConfig = {
  reliable: {
    label: TEXT_CONFIG.sourcesPanel.reliability.reliable,
    icon: Shield,
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  moderate: {
    label: TEXT_CONFIG.sourcesPanel.reliability.moderate,
    icon: ShieldAlert,
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  unverified: {
    label: TEXT_CONFIG.sourcesPanel.reliability.unverified,
    icon: ShieldQuestion,
    className: 'bg-black/[0.04] dark:bg-white/[0.06] text-neutral-600 dark:text-neutral-500 border-black/10 dark:border-white/[0.06]',
  },
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface SourcesPanelProps {
  sources: Source[];
  citations: Citation[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SourcesPanel({ sources, citations }: SourcesPanelProps) {
  if (sources.length === 0) return null;

  return (
    <div className="border-t border-black/10 dark:border-white/[0.06] pt-6">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-4">
        {TEXT_CONFIG.sourcesPanel.sourcesTitle} ({sources.length})
      </h3>
      <div className="grid gap-2 sm:gap-3">
        {sources.map((source, index) => {
          const reliability = source.reliability ?? getReliability(source.domain);
          const config = reliabilityConfig[reliability];
          const ReliabilityIcon = config.icon;
          const citationIds = citations
            .map((citation, citationIndex) => ({ citation, citationIndex }))
            .filter((entry) => entry.citation.source_url === source.url)
            .map((entry) => entry.citationIndex + 1);

          return (
            <div
              key={index}
              className="flex items-start gap-2 p-2.5 rounded-xl bg-white dark:bg-[#111] border border-black/[0.06] dark:border-white/[0.06] hover:border-black/15 dark:hover:border-white/[0.1] transition-colors group sm:gap-3 sm:p-3"
            >
              {/* Index number */}
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] text-[11px] font-medium text-neutral-600 dark:text-neutral-500 shrink-0 mt-0.5">
                {index + 1}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                      {source.title || source.url}
                    </p>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-500 truncate mt-0.5">
                      {source.domain}
                    </p>
                  </div>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300 transition-colors opacity-0 group-hover:opacity-100"
                    title={TEXT_CONFIG.sourcesPanel.openSourceTitle}
                  >
                    <ExternalLink size={14} strokeWidth={2} />
                  </a>
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 mt-1.5">
                  {/* Reliability badge */}
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${config.className}`}
                  >
                    <ReliabilityIcon size={10} strokeWidth={2} />
                    {config.label}
                  </span>

                  {/* Fetched time */}
                  {source.fetched_at && (
                    <span className="text-[10px] text-neutral-600 dark:text-neutral-600">
                      {TEXT_CONFIG.sourcesPanel.fetchedPrefix}{' '}
                      {new Date(source.fetched_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}

                  {/* Citation refs */}
                  {citationIds.length > 0 && (
                    <span className="text-[10px] text-neutral-600 dark:text-neutral-500">
                      {TEXT_CONFIG.sourcesPanel.citedAsPrefix} [{citationIds.join(', ')}]
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
