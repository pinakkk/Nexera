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

  const tierScore: Record<string, number> = {
    reliable: 0.94,
    moderate: 0.82,
    unverified: 0.6,
  };
  const citingCount = new Set(
    citations.map((c) => c.source_url).filter(Boolean),
  ).size;

  return (
    <div>
      {/* Rail header */}
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="h-display text-base font-bold text-[rgb(var(--fg))]">
          {TEXT_CONFIG.sourcesPanel.sourcesTitle}
        </h3>
        <span className="font-mono text-[11px] text-[rgb(var(--fg-subtle))]">
          {citingCount || sources.length} citing
        </span>
      </div>
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--fg-subtle))]">
        Ranked by trust × relevance
      </p>

      <div className="space-y-0.5">
        {sources.map((source, index) => {
          const reliability =
            source.reliability ?? getReliability(source.domain);
          const config = reliabilityConfig[reliability];
          const ReliabilityIcon = config.icon;
          const citationIds = citations
            .map((citation, citationIndex) => ({ citation, citationIndex }))
            .filter((entry) => entry.citation.source_url === source.url)
            .map((entry) => entry.citationIndex + 1);
          const pct = Math.round(tierScore[reliability] * 100);
          const initial = (source.domain || '?').charAt(0).toUpperCase();

          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={TEXT_CONFIG.sourcesPanel.openSourceTitle}
              className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            >
              <span className="w-5 shrink-0 self-start pt-0.5 text-right font-mono text-[11px] text-[rgb(var(--fg-subtle))]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-lg bg-orange-500/[0.08] font-mono text-[11px] font-bold text-orange-600 dark:text-orange-400">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg))]">
                  {source.title || source.url}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate font-mono text-[11px] text-[rgb(var(--fg-subtle))]">
                    {source.domain}
                  </span>
                  <span className="text-[rgb(var(--fg-subtle))]">·</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[rgb(var(--fg-subtle))]">
                    <ReliabilityIcon size={10} strokeWidth={2} />
                    {config.label}
                  </span>
                  {citationIds.length > 0 && (
                    <span className="font-mono text-[10px] text-[rgb(var(--fg-subtle))]">
                      · [{citationIds.join(', ')}]
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start pt-0.5">
                <span className="font-mono text-[11px] font-medium text-[rgb(var(--fg-muted))]">
                  {pct}%
                </span>
                <ExternalLink
                  size={13}
                  strokeWidth={2}
                  className="text-[rgb(var(--fg-subtle))] opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
