'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  Paperclip,
  Link2,
  X,
  Gauge,
  Cpu,
  Loader2,
  Plus,
  Globe,
  FileText,
  Mic,
  Square,
  ChevronDown,
} from 'lucide-react';
import type { RunConstraints } from '@/lib/types';
import clsx from 'clsx';
import { getActorHeaders } from '@/lib/api';
import { TEXT_CONFIG } from '@/lib/text-config';

/* ------------------------------------------------------------------ */
/*  Depth presets                                                      */
/* ------------------------------------------------------------------ */

const DEPTH_PRESETS = [
  { value: 'quick' as const, label: TEXT_CONFIG.researchInput.depthQuick, color: 'text-amber-500' },
  { value: 'standard' as const, label: TEXT_CONFIG.researchInput.depthStandard, color: 'text-sky-500' },
  { value: 'deep' as const, label: TEXT_CONFIG.researchInput.depthDeep, color: 'text-purple-500' },
];

/* ------------------------------------------------------------------ */
/*  Model presets (simplified — only 2 choices)                        */
/* ------------------------------------------------------------------ */

const MODEL_PRESETS = [
  { id: 'llama-3.3-70b-versatile', label: TEXT_CONFIG.researchInput.model70b, color: 'text-purple-500' },
  { id: 'llama-3.1-8b-instant', label: TEXT_CONFIG.researchInput.model8b, color: 'text-amber-500' },
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ResearchInputProps {
  onSubmit: (
    query: string,
    constraints: RunConstraints,
    extras: { files: File[]; urls: string[] },
  ) => void;
  isLoading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ResearchInput({
  onSubmit,
  isLoading = false,
}: ResearchInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [selectedModel, setSelectedModel] = useState(MODEL_PRESETS[0].id);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openMenu, setOpenMenu] = useState<'depth' | 'model' | 'attach' | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [query, resizeTextarea]);

  useEffect(() => {
    if (!openMenu) return;

    const handleClickAway = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && menuContainerRef.current && !menuContainerRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('mousedown', handleClickAway);
    document.addEventListener('touchstart', handleClickAway);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickAway);
      document.removeEventListener('touchstart', handleClickAway);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [openMenu]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    const constraints: RunConstraints = {
      depth,
      model: selectedModel || undefined,
    };

    onSubmit(trimmed, constraints, { files, urls });

    // Clear input state immediately after submitting
    setQuery('');
    setFiles([]);
    setUrls([]);
    setUrlInput('');
    setShowUrlInput(false);
  }, [query, isLoading, depth, selectedModel, onSubmit, files, urls]);

  // Keyboard shortcut (Cmd/Ctrl + Enter)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // File handling
  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    setFiles((prev) => [...prev, ...Array.from(fileList)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // URL handling
  const addUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
      setUrls((prev) => [...prev, trimmed]);
      setUrlInput('');
    } catch {
      // Invalid URL
    }
  }, [urlInput]);

  const removeUrl = useCallback((index: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Voice Recording ─────────────────────────────────────────────────
  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const actorHeaders = await getActorHeaders();
      const res = await fetch(`${baseUrl}/v1/transcribe`, {
        method: 'POST',
        headers: actorHeaders,
        body: formData,
      });

      if (!res.ok) throw new Error(`Transcription failed: ${res.statusText}`);

      const data = await res.json();
      if (data.text) {
        setQuery((prev) => (prev ? `${prev} ${data.text}` : data.text));
      }
    } catch (err) {
      console.error('Transcription error:', err);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [transcribeAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const canSubmit = query.trim().length > 0 && !isLoading;
  const selectedDepthPreset = DEPTH_PRESETS.find((preset) => preset.value === depth) ?? DEPTH_PRESETS[1];
  const selectedModelPreset = MODEL_PRESETS.find((model) => model.id === selectedModel) ?? MODEL_PRESETS[0];
  const hasAttachments = files.length > 0 || urls.length > 0;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Main input card */}
      <div className="glass-panel rounded-2xl sm:rounded-3xl overflow-visible">
        {/* Textarea */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRecording
                ? TEXT_CONFIG.researchInput.placeholderListening
                : isTranscribing
                  ? TEXT_CONFIG.researchInput.placeholderTranscribing
                  : TEXT_CONFIG.researchInput.placeholderDefault
            }
            rows={1}
            disabled={isLoading || isRecording}
            className={clsx(
              'w-full resize-none bg-transparent px-4 pb-3 pt-4 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none dark:text-white dark:placeholder-neutral-600 sm:px-6 sm:pt-5 sm:text-base leading-relaxed',
              isRecording && 'placeholder-red-400 dark:placeholder-red-400',
            )}
          />

          {/* Recording indicator */}
          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute right-3 top-3 flex items-center gap-2 sm:right-4 sm:top-4"
              >
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-xs font-medium text-red-500">
                  {TEXT_CONFIG.researchInput.recordingStatus}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Transcribing indicator */}
          <AnimatePresence>
            {isTranscribing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute right-3 top-3 flex items-center gap-2 sm:right-4 sm:top-4"
              >
                <Loader2 size={14} className="animate-spin text-orange-500" />
                <span className="text-xs font-medium text-orange-500">
                  {TEXT_CONFIG.researchInput.transcribingStatus}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Attachments preview */}
        <AnimatePresence>
          {(files.length > 0 || urls.length > 0) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 sm:px-6"
            >
              <div className="flex flex-wrap gap-2 pb-3">
                {files.map((file, i) => (
                  <span
                    key={`f-${i}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-white/[0.06] rounded-lg border border-neutral-200 dark:border-white/[0.08]"
                  >
                    <FileText size={12} className="text-orange-500" />
                    {file.name.length > 20 ? file.name.slice(0, 17) + '\u2026' : file.name}
                    <button onClick={() => removeFile(i)} className="ml-0.5 text-neutral-400 hover:text-red-500 transition-colors">
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {urls.map((url, i) => (
                  <span
                    key={`u-${i}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-white/[0.06] rounded-lg border border-neutral-200 dark:border-white/[0.08]"
                  >
                    <Globe size={12} className="text-blue-500" />
                    {(() => { try { return new URL(url).hostname; } catch { return url.slice(0, 25); } })()}
                    <button onClick={() => removeUrl(i)} className="ml-0.5 text-neutral-400 hover:text-red-500 transition-colors">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* URL input row */}
        <AnimatePresence>
          {showUrlInput && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 sm:px-6"
            >
              <div className="flex gap-2 pb-3">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
                  placeholder={TEXT_CONFIG.researchInput.addUrlPlaceholder}
                  className="glass-input flex-1 text-xs"
                  autoFocus
                />
                <button onClick={addUrl} className="btn-secondary text-xs py-1.5 px-3">
                  <Plus size={14} />
                  {TEXT_CONFIG.researchInput.addButton}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom toolbar — single row, no wrap */}
        <div className="flex items-center gap-1.5 border-t border-black/[0.05] dark:border-white/[0.05] px-2 py-2 sm:px-3 sm:gap-2 sm:py-2.5">
          {/* Left side: action buttons */}
          <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
            {/* Voice button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              className={clsx(
                'shrink-0 btn-ghost !px-2 !py-1.5 transition-all',
                isRecording
                  ? 'text-red-500 hover:text-red-600 bg-red-500/10 rounded-lg animate-pulse'
                  : isTranscribing
                    ? 'text-orange-400 cursor-wait'
                    : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
              )}
              title={
                isRecording
                  ? TEXT_CONFIG.researchInput.voiceTitleStop
                  : TEXT_CONFIG.researchInput.voiceTitleStart
              }
            >
              {isRecording ? (
                <Square size={16} fill="currentColor" strokeWidth={0} />
              ) : isTranscribing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mic size={16} strokeWidth={1.75} />
              )}
            </button>

            {/* Combined attach button (files + links) */}
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <div className="relative" ref={menuContainerRef}>
              <button
                onClick={() => setOpenMenu((v) => (v === 'attach' ? null : 'attach'))}
                className={clsx(
                  'shrink-0 btn-ghost !px-2 !py-1.5 transition-all',
                  (openMenu === 'attach' || hasAttachments) ? 'text-orange-500' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
                )}
                title="Attach files or links"
              >
                <Paperclip size={16} strokeWidth={1.75} />
              </button>

              {/* Attach dropdown */}
              <AnimatePresence>
                {openMenu === 'attach' && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-[calc(100%+8px)] left-0 z-30 min-w-[160px] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg shadow-black/10 dark:border-white/[0.08] dark:bg-neutral-900 dark:shadow-black/40"
                  >
                    <button
                      onClick={() => {
                        fileInputRef.current?.click();
                        setOpenMenu(null);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-neutral-600 hover:bg-black/[0.03] dark:text-neutral-300 dark:hover:bg-white/[0.06] transition-colors"
                    >
                      <FileText size={14} className="text-orange-500" />
                      {TEXT_CONFIG.researchInput.attachFilesTitle}
                    </button>
                    <button
                      onClick={() => {
                        setShowUrlInput((v) => !v);
                        setOpenMenu(null);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-neutral-600 hover:bg-black/[0.03] dark:text-neutral-300 dark:hover:bg-white/[0.06] transition-colors"
                    >
                      <Link2 size={14} className="text-blue-500" />
                      {TEXT_CONFIG.researchInput.addUrlTitle}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Divider */}
              <div className="hidden sm:block" />
            </div>

            <div className="w-px h-5 bg-black/[0.06] dark:bg-white/[0.06] mx-0.5 shrink-0 hidden sm:block" />

            {/* Depth selector */}
            <div className="relative">
              <button
                onClick={() => setOpenMenu((value) => (value === 'depth' ? null : 'depth'))}
                className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] dark:border-white/[0.09] bg-white/60 dark:bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-neutral-700 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white sm:gap-1.5 sm:px-2.5"
                title={TEXT_CONFIG.researchInput.researchModeTitle}
              >
                <Gauge size={13} className="text-orange-500 shrink-0" />
                <span className="hidden sm:inline whitespace-nowrap">{selectedDepthPreset.label}</span>
                <ChevronDown size={11} className={clsx('transition-transform shrink-0', openMenu === 'depth' && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {openMenu === 'depth' && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-[calc(100%+8px)] left-0 z-30 min-w-[150px] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg shadow-black/10 dark:border-white/[0.08] dark:bg-neutral-900 dark:shadow-black/40"
                  >
                    {DEPTH_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => {
                          setDepth(preset.value);
                          setOpenMenu(null);
                        }}
                        className={clsx(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          depth === preset.value
                            ? 'bg-orange-50 text-neutral-900 dark:bg-orange-500/15 dark:text-white'
                            : 'text-neutral-600 hover:bg-black/[0.03] dark:text-neutral-300 dark:hover:bg-white/[0.06]',
                        )}
                      >
                        <Gauge size={13} className={depth === preset.value ? 'text-orange-500' : preset.color} />
                        {preset.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="w-px h-5 bg-black/[0.06] dark:bg-white/[0.06] shrink-0 hidden sm:block" />

            {/* Advanced / Model selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((value) => (value === 'model' ? null : 'model'))}
                className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] dark:border-white/[0.09] bg-white/60 dark:bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-neutral-700 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white sm:gap-1.5 sm:px-2.5"
              >
                <Cpu size={13} className="text-orange-500 shrink-0" />
                <span className="hidden sm:inline whitespace-nowrap">{selectedModelPreset.label}</span>
                <ChevronDown size={11} className={clsx('transition-transform shrink-0', openMenu === 'model' && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {openMenu === 'model' && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-[calc(100%+8px)] left-0 z-30 min-w-[150px] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg shadow-black/10 dark:border-white/[0.08] dark:bg-neutral-900 dark:shadow-black/40"
                  >
                    <div className="px-3 py-1.5 border-b border-black/[0.05] dark:border-white/[0.05] bg-black/[0.02] dark:bg-white/[0.02]">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-500">Advanced Models</span>
                    </div>
                    {MODEL_PRESETS.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setSelectedModel(model.id);
                          setOpenMenu(null);
                        }}
                        className={clsx(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                          selectedModel === model.id
                            ? 'bg-orange-50 text-neutral-900 dark:bg-orange-500/15 dark:text-white'
                            : 'text-neutral-600 hover:bg-black/[0.03] dark:text-neutral-300 dark:hover:bg-white/[0.06]',
                        )}
                      >
                        <Cpu size={13} className={selectedModel === model.id ? 'text-orange-500' : model.color} />
                        {model.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1 min-w-0" />

          {/* Submit — always stays on the same line */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-200 shrink-0 sm:gap-2 sm:px-4 sm:text-sm',
              canSubmit
                ? 'bg-gradient-to-r from-orange-600 to-orange-500 text-white shadow-md shadow-orange-600/20 hover:shadow-lg hover:shadow-orange-600/30 active:scale-[0.96]'
                : 'bg-neutral-100 dark:bg-white/[0.04] text-neutral-400 dark:text-neutral-600 cursor-not-allowed',
            )}
          >
            {isLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowUp size={15} strokeWidth={2.5} />
            )}
            <span className="hidden sm:inline">
              {isLoading
                ? TEXT_CONFIG.researchInput.submitStarting
                : TEXT_CONFIG.researchInput.submitDefault}
            </span>
          </button>
        </div>


      </div>

      {/* Keyboard hint */}
      <p className="mt-2.5 text-center text-[11px] text-neutral-400 dark:text-neutral-700 whitespace-pre-wrap">
        {TEXT_CONFIG.researchInput.keyboardHint}
      </p>
    </div>
  );
}
