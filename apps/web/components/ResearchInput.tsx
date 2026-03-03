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
  Zap,
  Brain,
  Layers,
  Loader2,
  Plus,
  Globe,
  FileText,
  Mic,
  Square,
} from 'lucide-react';
import type { RunConstraints } from '@/lib/types';
import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  Depth presets                                                      */
/* ------------------------------------------------------------------ */

const DEPTH_PRESETS = [
  { value: 'quick' as const, label: 'Quick', icon: Zap, color: 'text-amber-500' },
  { value: 'standard' as const, label: 'Standard', icon: Brain, color: 'text-sky-500' },
  { value: 'deep' as const, label: 'Deep', icon: Layers, color: 'text-purple-500' },
];

/* ------------------------------------------------------------------ */
/*  Model presets (simplified — only 2 choices)                        */
/* ------------------------------------------------------------------ */

const MODEL_PRESETS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 70B', icon: Brain, color: 'text-purple-500' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 8B', icon: Zap, color: 'text-amber-500' },
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

  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

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

  // Submit handler
  const handleSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    const constraints: RunConstraints = {
      depth,
      model: selectedModel || undefined,
    };

    onSubmit(trimmed, constraints, { files, urls });
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
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(`${baseUrl}/v1/transcribe`, {
        method: 'POST',
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

  const canSubmit = query.trim().length > 0 && !isLoading;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Main input card */}
      <div className="glass-panel rounded-3xl overflow-hidden">
        {/* Textarea */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? '🎙️ Listening...' : isTranscribing ? '✨ Transcribing...' : 'What would you like to research?'}
            rows={1}
            disabled={isLoading || isRecording}
            className={clsx(
              'w-full resize-none bg-transparent px-5 pb-3 pt-5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none dark:text-white dark:placeholder-neutral-600 sm:px-6 sm:text-base leading-relaxed',
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
                className="absolute right-4 top-4 flex items-center gap-2"
              >
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-xs font-medium text-red-500">REC</span>
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
                className="absolute right-4 top-4 flex items-center gap-2"
              >
                <Loader2 size={14} className="animate-spin text-orange-500" />
                <span className="text-xs font-medium text-orange-500">Transcribing...</span>
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
              className="px-5 sm:px-6"
            >
              <div className="flex flex-wrap gap-2 pb-3">
                {files.map((file, i) => (
                  <span
                    key={`f-${i}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-white/[0.06] rounded-lg border border-neutral-200 dark:border-white/[0.08]"
                  >
                    <FileText size={12} className="text-orange-500" />
                    {file.name.length > 20 ? file.name.slice(0, 17) + '…' : file.name}
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
              className="px-5 sm:px-6"
            >
              <div className="flex gap-2 pb-3">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
                  placeholder="https://example.com"
                  className="glass-input flex-1 text-xs"
                  autoFocus
                />
                <button onClick={addUrl} className="btn-secondary text-xs py-1.5 px-3">
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between gap-2 border-t border-black/[0.05] dark:border-white/[0.05] px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
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
              title={isRecording ? 'Stop recording' : 'Voice dictation'}
            >
              {isRecording ? (
                <Square size={16} fill="currentColor" strokeWidth={0} />
              ) : isTranscribing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mic size={16} strokeWidth={1.75} />
              )}
            </button>

            {/* File attach */}
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 btn-ghost !px-2 !py-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="Attach files"
            >
              <Paperclip size={16} strokeWidth={1.75} />
            </button>

            {/* URL attach */}
            <button
              onClick={() => setShowUrlInput((v) => !v)}
              className={clsx(
                'shrink-0 btn-ghost !px-2 !py-1.5',
                showUrlInput ? 'text-orange-500' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
              )}
              title="Add URL"
            >
              <Link2 size={16} strokeWidth={1.75} />
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-black/[0.06] dark:bg-white/[0.06] mx-1 shrink-0" />

            {/* Inline depth pills */}
            <div className="flex items-center gap-0.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-0.5 shrink-0">
              {DEPTH_PRESETS.map((preset) => {
                const isSelected = depth === preset.value;
                return (
                  <button
                    key={preset.value}
                    onClick={() => setDepth(preset.value)}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all duration-150',
                      isSelected
                        ? 'bg-white dark:bg-white/[0.12] text-neutral-900 dark:text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
                    )}
                  >
                    <preset.icon size={11} className={isSelected ? 'text-orange-500' : preset.color} />
                    <span className="hidden sm:inline">{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Divider */}
            <div className="w-px h-5 bg-black/[0.06] dark:bg-white/[0.06] mx-1 shrink-0" />

            {/* Inline model pills */}
            <div className="flex items-center gap-0.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-0.5 shrink-0">
              {MODEL_PRESETS.map((model) => {
                const isSelected = selectedModel === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-all duration-150',
                      isSelected
                        ? 'bg-white dark:bg-white/[0.12] text-neutral-900 dark:text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
                    )}
                  >
                    <model.icon size={11} className={isSelected ? 'text-orange-500' : model.color} />
                    <span className="hidden sm:inline">{model.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={clsx(
              'flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 shrink-0',
              canSubmit
                ? 'bg-gradient-to-r from-orange-600 to-orange-500 text-white shadow-md shadow-orange-600/20 hover:shadow-lg hover:shadow-orange-600/30 active:scale-[0.96]'
                : 'bg-neutral-100 dark:bg-white/[0.04] text-neutral-400 dark:text-neutral-600 cursor-not-allowed',
            )}
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ArrowUp size={16} strokeWidth={2.5} />
            )}
            <span className="hidden sm:inline">
              {isLoading ? 'Starting…' : 'Research'}
            </span>
          </button>
        </div>
      </div>

      {/* Keyboard hint */}
      <p className="mt-3 text-center text-[11px] text-neutral-400 dark:text-neutral-700">
        Press <kbd className="px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.04] font-mono text-[10px]">⌘</kbd>
        <span className="mx-0.5">+</span>
        <kbd className="px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.04] font-mono text-[10px]">Enter</kbd>
        {' '}to submit
      </p>
    </div>
  );
}
