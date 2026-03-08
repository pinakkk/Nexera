'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Citation, Source, EvaluationScores } from '@/lib/types';
import { SourcesPanel } from './SourcesPanel';
import { Download, FileText, Loader2, Volume2, Square } from 'lucide-react';
import { useState, useRef, useCallback } from 'react';
import { TEXT_CONFIG } from '@/lib/text-config';
import { textToSpeech } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ReportViewerProps {
  reportMd: string | null;
  citations: Citation[];
  sources: Source[];
  evaluation: EvaluationScores | null;
  isRunning: boolean;
  runId?: string;
}

function isDetailedResearchReport(
  reportMd: string,
  citations: Citation[],
  evaluation: EvaluationScores | null,
): boolean {
  const plainLength = reportMd.replace(/[#>*`\-\n\r]/g, ' ').trim().length;
  const citationCount = citations.length;
  const hasSections = /(^|\n)#{2,}\s+/m.test(reportMd);
  const hasEvaluation = (evaluation?.overall ?? 0) > 0;

  return (
    plainLength >= 550
    && citationCount >= 2
    && (hasSections || hasEvaluation)
  );
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
  runId,
}: ReportViewerProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isTTSLoading, setIsTTSLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Strip markdown to plain text for TTS
  const stripMarkdown = useCallback((md: string): string => {
    return md
      .replace(/#{1,6}\s+/g, '')         // headers
      .replace(/\*\*(.+?)\*\*/g, '$1')    // bold
      .replace(/\*(.+?)\*/g, '$1')        // italic
      .replace(/`{1,3}[^`]*`{1,3}/g, '') // code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
      .replace(/^\s*[-*+]\s+/gm, '')      // list markers
      .replace(/^\s*\d+\.\s+/gm, '')      // numbered lists
      .replace(/>\s*/g, '')               // blockquotes
      .replace(/---+/g, '')               // horizontal rules
      .replace(/\n{3,}/g, '\n\n')         // excess newlines
      .trim();
  }, []);

  const handleTTS = useCallback(async () => {
    if (!reportMd) return;

    // If already playing, stop
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    // If we have cached audio, replay
    if (audioUrlRef.current) {
      const audio = new Audio(audioUrlRef.current);
      audioRef.current = audio;
      audio.onended = () => setIsPlaying(false);
      audio.play();
      setIsPlaying(true);
      return;
    }

    // Generate new TTS
    setIsTTSLoading(true);
    try {
      const plainText = stripMarkdown(reportMd);
      // Limit to ~4000 chars for TTS (avoid very long requests)
      const truncated = plainText.length > 4000
        ? plainText.slice(0, 4000) + '...'
        : plainText;

      const audioBlob = await textToSpeech(truncated);
      const url = URL.createObjectURL(audioBlob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setIsPlaying(false);
      audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('TTS error:', err);
      const msg = err instanceof Error ? err.message : 'Text-to-speech failed';
      alert(msg);
    } finally {
      setIsTTSLoading(false);
    }
  }, [reportMd, isPlaying, stripMarkdown]);

  if (!reportMd && isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-6 h-6 border-2 border-neutral-300 dark:border-neutral-700 border-t-neutral-500 dark:border-t-neutral-400 rounded-full animate-spin" />
        <p className="text-sm text-neutral-600 dark:text-neutral-500">
          {TEXT_CONFIG.reportViewer.runningMessage}
        </p>
      </div>
    );
  }

  if (!reportMd) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-neutral-600 dark:text-neutral-500">
          {TEXT_CONFIG.reportViewer.noReport}
        </p>
      </div>
    );
  }

  const canDownloadPdf = isDetailedResearchReport(reportMd, citations, evaluation);

  const handleDownloadPdf = async () => {
    if (!runId) return;
    setIsDownloading(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(`${baseUrl}/v1/runs/${runId}/pdf`);
      if (!res.ok) throw new Error(`PDF download failed: ${res.statusText}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `research_report_${runId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      alert(TEXT_CONFIG.reportViewer.pdfDownloadFailed);
    } finally {
      setIsDownloading(false);
    }
  };

  // Confidence badge based on overall score
  const confidenceBadge = (() => {
    const score = evaluation?.overall ?? null;
    if (score === null || score === 0) return null;
    if (score >= 0.8) return { label: 'High Confidence', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
    if (score >= 0.5) return { label: 'Moderate Confidence', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
    return { label: 'Low Confidence', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' };
  })();

  return (
    <div className="space-y-5">
      {/* Confidence badge */}
      {confidenceBadge && (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${confidenceBadge.className}`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {confidenceBadge.label}
          </span>
        </div>
      )}

      {/* Top bar: Evaluation + Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {evaluation && <EvaluationBar scores={evaluation} />}

        <div className="flex items-center gap-2 shrink-0 self-start">
          {/* TTS Listen button */}
          {!isRunning && reportMd && (
            <button
              onClick={handleTTS}
              disabled={isTTSLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/[0.08] px-4 py-2.5 text-xs font-semibold text-violet-600 dark:text-violet-400 transition-all hover:bg-violet-500/[0.15] hover:shadow-sm active:scale-[0.97] disabled:opacity-50 disabled:cursor-wait"
            >
              {isTTSLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generating…
                </>
              ) : isPlaying ? (
                <>
                  <Square size={14} fill="currentColor" strokeWidth={0} />
                  Stop
                </>
              ) : (
                <>
                  <Volume2 size={14} />
                  Listen
                </>
              )}
            </button>
          )}

          {/* PDF Download button */}
          {runId && !isRunning && canDownloadPdf && (
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="inline-flex items-center gap-2 rounded-xl border border-orange-500/25 bg-orange-500/[0.08] px-4 py-2.5 text-xs font-semibold text-orange-600 dark:text-orange-400 transition-all hover:bg-orange-500/[0.15] hover:shadow-sm active:scale-[0.97] disabled:opacity-50 disabled:cursor-wait"
            >
              {isDownloading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {TEXT_CONFIG.reportViewer.generatingPdf}
                </>
              ) : (
                <>
                  <Download size={14} />
                  {TEXT_CONFIG.reportViewer.downloadPdf}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Report content — with contained overflow */}
      <article className="markdown-body text-reveal overflow-x-auto break-words">
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
            /* Prevent tables from breaking layout */
            table: ({ children, ...props }) => (
              <div className="overflow-x-auto -mx-1 rounded-lg">
                <table className="min-w-full" {...props}>{children}</table>
              </div>
            ),
            /* Prevent code blocks from breaking layout */
            pre: ({ children, ...props }) => (
              <pre className="overflow-x-auto rounded-lg" {...props}>{children}</pre>
            ),
            /* Prevent long links/text from breaking layout */
            p: ({ children, ...props }) => (
              <p className="break-words" {...props}>{children}</p>
            ),
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
    { label: TEXT_CONFIG.reportViewer.scoreCoverage, value: scores.coverage },
    { label: TEXT_CONFIG.reportViewer.scoreAccuracy, value: scores.accuracy },
    { label: TEXT_CONFIG.reportViewer.scoreCoherence, value: scores.coherence },
    { label: TEXT_CONFIG.reportViewer.scoreCitations, value: scores.citation_quality },
    { label: TEXT_CONFIG.reportViewer.scoreOverall, value: scores.overall },
  ];

  // Don't show bar if all scores are 0
  const hasScores = entries.some((e) => e.value > 0);
  if (!hasScores) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/80 p-3 dark:border-white/[0.06] dark:bg-[#111]/80 sm:gap-3 sm:p-4 backdrop-blur-sm flex-1">
      <span className="w-full text-xs font-medium text-neutral-500 sm:w-auto">
        {TEXT_CONFIG.reportViewer.qualityScores}
      </span>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-500">{entry.label}</span>
            <span
              className={`inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 text-[11px] font-semibold rounded-full ${entry.value >= 0.7
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
