'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Paperclip,
  Rocket,
  Send,
  Sparkles,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { RunConstraints } from '@/lib/types';
import { listAvailableModels } from '@/lib/api';

interface ModelOption {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
}

const DEFAULT_MODELS: ModelOption[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Balanced for speed and depth',
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'llama-3.1-8b-instant',
    description: 'Fast default model',
    isDefault: true,
  },
  {
    id: 'llama-3.3-70b-versatile',
    label: 'llama-3.3-70b-versatile',
    description: 'Smart default model',
    isDefault: true,
  },
];

const MODE_CHIPS = [
  {
    id: 'deepsearch',
    label: 'DeepSearch',
    icon: Rocket,
    apply: {
      depth: 'deep' as const,
      prepend: '',
    },
  },
  {
    id: 'imagine',
    label: 'Imagine',
    icon: Sparkles,
    apply: {
      depth: 'standard' as const,
      prepend: 'Think creatively and include alternative scenarios: ',
    },
  },
  {
    id: 'personas',
    label: 'Personas',
    icon: UserRound,
    apply: {
      depth: 'standard' as const,
      prepend: 'Answer from 3 expert perspectives with citations: ',
    },
  },
];

function parseUrls(raw: string): string[] {
  return raw
    .split(/[\n,]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

interface ResearchInputProps {
  onSubmit: (
    query: string,
    constraints: RunConstraints,
    extras: { files: File[]; urls: string[] },
  ) => void;
  isLoading?: boolean;
}

export function ResearchInput({ onSubmit, isLoading = false }: ResearchInputProps) {
  const [query, setQuery] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(DEFAULT_MODELS);
  const [selectedModelId, setSelectedModelId] = useState('auto');
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [files, setFiles] = useState<File[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowAttachMenu(false);
        setShowModelMenu(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const remoteModels = await listAvailableModels();
      if (remoteModels.length === 0) return;

      const next: ModelOption[] = [
        {
          id: 'auto',
          label: 'Auto',
          description: 'Balanced for speed and depth',
        },
        ...remoteModels.map((model) => ({
          id: model.id,
          label: model.id,
          description: model.is_default
            ? `Default (${model.owned_by ?? 'Groq'})`
            : `Provided by ${model.owned_by ?? 'Groq'}`,
          isDefault: model.is_default,
        })),
      ];
      setModelOptions(next);
    })();
  }, []);

  useEffect(() => {
    if (!modelOptions.some((model) => model.id === selectedModelId)) {
      setSelectedModelId('auto');
    }
  }, [modelOptions, selectedModelId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [query]);

  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.id === selectedModelId) ?? modelOptions[0],
    [modelOptions, selectedModelId],
  );
  const parsedUrls = useMemo(() => parseUrls(urlInput), [urlInput]);

  function handleSubmit() {
    if (!query.trim() || isLoading) return;

    const constraints: RunConstraints = {
      initial_model: selectedModel.id === 'auto' ? undefined : selectedModel.id,
      depth,
      citation_style: 'numbered',
    };

    onSubmit(query.trim(), constraints, { files, urls: parsedUrls });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function onPickMode(modeId: (typeof MODE_CHIPS)[number]['id']) {
    const mode = MODE_CHIPS.find((chip) => chip.id === modeId);
    if (!mode) return;
    setDepth(mode.apply.depth);
    if (mode.apply.prepend && !query.startsWith(mode.apply.prepend)) {
      setQuery((prev) => `${mode.apply.prepend}${prev}`.trim());
    }
  }

  function onPickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;
    setFiles((prev) => [...prev, ...selected]);
    event.target.value = '';
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-4xl">
      <div className="glass-panel rounded-2xl border px-3 pb-3 pt-3 sm:rounded-[30px] sm:px-5">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to know?"
          rows={3}
          disabled={isLoading}
          className="max-h-[240px] min-h-[80px] w-full resize-none bg-transparent px-1 py-2 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500 sm:min-h-[96px] sm:text-[16px]"
        />

        {files.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/80 px-2 py-1 text-xs text-neutral-700 dark:border-white/10 dark:bg-[#0f1218] dark:text-neutral-200"
              >
                {file.name}
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                  aria-label="Remove file"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {urlInput.trim().length > 0 && (
          <div className="mt-2">
            <textarea
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              rows={4}
              placeholder="Paste multiple URLs (one per line or comma-separated)"
              className="w-full rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-sky-500/25 dark:border-white/10 dark:bg-[#0b0e13] dark:text-neutral-200"
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {parsedUrls.length} URL{parsedUrls.length === 1 ? '' : 's'} detected
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onPickFiles}
            />

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowAttachMenu((value) => !value);
                  setShowModelMenu(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/90 px-3 py-2 text-sm text-neutral-700 transition hover:bg-black/[0.04] dark:border-white/10 dark:bg-[#0d0f13] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
              >
                <Paperclip size={14} />
                Attach
                <ChevronDown size={14} />
              </button>

              {showAttachMenu && (
                <div className="absolute left-0 top-12 z-20 w-56 rounded-2xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#12151c]">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setShowAttachMenu(false);
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
                  >
                    Upload file
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUrlInput((prev) => (prev ? prev : 'https://'));
                      setShowAttachMenu(false);
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
                  >
                    Add URLs
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUrlInput('');
                      setShowAttachMenu(false);
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
                  >
                    Clear URLs
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowModelMenu((value) => !value);
                  setShowAttachMenu(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/80 px-2.5 py-1.5 text-xs transition hover:bg-black/[0.04] sm:px-3 sm:py-2 sm:text-sm text-neutral-700 dark:border-white/[0.08] dark:bg-[#0d0f13]/80 dark:text-neutral-200 dark:hover:bg-white/[0.06]"
              >
                  <Zap size={14} />
                  <span className="hidden sm:inline">{selectedModel.label}</span>
                  <span className="sm:hidden">{selectedModel.label.length > 12 ? selectedModel.label.slice(0, 12) + '...' : selectedModel.label}</span>
                  <ChevronDown size={14} />
              </button>

              {showModelMenu && (
                <div className="absolute left-0 top-12 z-20 w-72 max-h-72 overflow-y-auto rounded-2xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#12151c]">
                  {modelOptions.map((mode) => {
                    const selected = mode.id === selectedModelId;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          setSelectedModelId(mode.id);
                          setShowModelMenu(false);
                        }}
                        className="flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      >
                        <span>
                          <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {mode.label}
                          </span>
                          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                            {mode.description}
                          </span>
                        </span>
                        {selected && <Check size={14} className="mt-1 text-sky-500" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!query.trim() || isLoading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-lg shadow-black/20 transition-all hover:scale-105 hover:shadow-xl active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none dark:bg-white dark:text-black dark:shadow-white/10"
            title={isLoading ? 'Running...' : 'Start research (Cmd+Enter)'}
          >
            {isLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white dark:border-black/30 dark:border-t-black" />
            ) : (
              <Send size={15} strokeWidth={2.25} />
            )}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        {MODE_CHIPS.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => onPickMode(mode.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs transition hover:bg-black/[0.04] hover:scale-[1.02] active:scale-[0.98] sm:px-3.5 sm:py-2 sm:text-sm text-neutral-700 dark:border-white/[0.08] dark:bg-[#0f1218]/80 dark:text-neutral-200 dark:hover:bg-white/[0.07]"
          >
            <mode.icon size={14} />
            {mode.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-center text-[10px] text-neutral-400 dark:text-neutral-500 sm:text-xs">
        Cmd+Enter to send
      </p>
    </div>
  );
}
