'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  Server,
  Sparkles,
  Palette,
  Save,
  Check,
  RotateCcw,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from '@/components/theme';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppSettings {
  apiUrl: string;
  defaultModel: string;
  defaultDepth: 'quick' | 'standard' | 'deep';
}

const STORAGE_KEY = 'research-agent-settings';

const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
  defaultModel: 'auto',
  defaultDepth: 'standard',
};

const MODEL_OPTIONS = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'fast', label: 'Fast (llama-3.1-8b-instant)' },
  { value: 'expert', label: 'Expert (llama-3.1-70b-versatile)' },
];

const DEPTH_OPTIONS = [
  {
    value: 'quick' as const,
    label: 'Quick',
    description: 'Fast overview with fewer iterations',
  },
  {
    value: 'standard' as const,
    label: 'Standard',
    description: 'Balanced depth and speed',
  },
  {
    value: 'deep' as const,
    label: 'Deep',
    description: 'Thorough research with more iterations',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/* ------------------------------------------------------------------ */
/*  Toast component                                                    */
/* ------------------------------------------------------------------ */

function Toast({
  message,
  visible,
}: {
  message: string;
  visible: boolean;
}) {
  return (
    <div
      className={`fixed bottom-6 left-4 right-4 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-emerald-600/90 backdrop-blur-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all duration-300 sm:left-auto sm:right-6 sm:w-auto ${
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
    >
      <Check size={16} strokeWidth={2.5} />
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/80 dark:bg-[#111]/80 backdrop-blur-sm border border-black/[0.06] dark:border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-4 py-4 border-b border-black/[0.06] dark:border-white/[0.06] sm:px-6 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06]">
            <Icon size={16} strokeWidth={1.75} className="text-neutral-500 dark:text-neutral-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-500 mt-0.5">{description}</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-4 space-y-5 sm:px-6 sm:py-5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Field components                                                   */
/* ------------------------------------------------------------------ */

function FieldLabel({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <label className="text-sm font-medium text-neutral-800 dark:text-neutral-300">{label}</label>
      {hint && <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5">{hint}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-2.5 text-sm text-neutral-900 dark:text-white placeholder-neutral-500 dark:placeholder-neutral-600 bg-white dark:bg-[#0a0a0a] border border-black/10 dark:border-white/[0.06] rounded-xl focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-colors font-mono"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-2.5 text-sm text-neutral-900 dark:text-white bg-white dark:bg-[#0a0a0a] border border-black/10 dark:border-white/[0.06] rounded-xl focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-colors appearance-none cursor-pointer"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [mounted, setMounted] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    setSettings(loadSettings());
    setMounted(true);
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2500);
  }, []);

  function handleSave() {
    saveSettings(settings);
    showToast('Settings saved successfully');
  }

  function handleReset() {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
    showToast('Settings reset to defaults');
  }

  function updateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  // Avoid hydration mismatch
  if (!mounted) {
    return (
      <div className="flex min-h-screen flex-col px-4 pb-6 pt-6 sm:px-8 sm:pt-8">
        <div className="shrink-0 pb-6">
          <div className="flex items-center gap-3 mb-1">
            <Settings
              size={20}
              strokeWidth={1.75}
              className="text-neutral-500 dark:text-neutral-400"
            />
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Settings</h1>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-500 ml-8">
            Configure your research agent preferences.
          </p>
        </div>
        <div className="max-w-2xl space-y-6">
          {/* Skeleton placeholders */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-2xl h-48 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col px-3 pb-6 pt-14 sm:px-8 sm:pt-8">
      {/* Header */}
      <div className="shrink-0 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Settings
                size={20}
                strokeWidth={1.75}
                  className="text-neutral-500 dark:text-neutral-400"
              />
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Settings</h1>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-500 ml-8">
              Configure your research agent preferences.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white bg-white dark:bg-[#111] border border-black/10 dark:border-white/[0.06] rounded-xl hover:border-black/20 dark:hover:border-white/[0.1] transition-colors"
            >
              <RotateCcw size={14} strokeWidth={2} />
              Reset
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-500 rounded-xl transition-colors"
            >
              <Save size={14} strokeWidth={2} />
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* Settings sections */}
      <div className="max-w-2xl flex-1 space-y-6">
        {/* API Configuration */}
        <Section
          icon={Server}
          title="API Configuration"
          description="Configure the connection to your research agent backend."
        >
          <div>
            <FieldLabel
              label="API Base URL"
              hint="The URL where your research agent API is running. Changes take effect on next request."
            />
            <TextInput
              value={settings.apiUrl}
              onChange={(v) => updateSetting('apiUrl', v)}
              placeholder="http://localhost:8000"
            />
          </div>
        </Section>

        <Section
          icon={Palette}
          title="Appearance"
          description="Choose the UI theme for the app."
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                theme === 'light'
                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                  : 'border-black/10 dark:border-white/[0.06] bg-white dark:bg-[#0a0a0a] text-neutral-700 dark:text-neutral-300'
              }`}
            >
              <Sun size={14} />
              Light
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
                theme === 'dark'
                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                  : 'border-black/10 dark:border-white/[0.06] bg-white dark:bg-[#0a0a0a] text-neutral-700 dark:text-neutral-300'
              }`}
            >
              <Moon size={14} />
              Dark
            </button>
          </div>
        </Section>

        {/* Model Preferences */}
        <Section
          icon={Sparkles}
          title="Model Preferences"
          description="Set default model and research depth for new runs."
        >
          <div>
            <FieldLabel
              label="Default Model"
              hint="The LLM to use for research synthesis. Auto selects the best available model."
            />
            <SelectInput
              value={settings.defaultModel}
              onChange={(v) => updateSetting('defaultModel', v)}
              options={MODEL_OPTIONS}
            />
          </div>

          <div>
            <FieldLabel
              label="Default Research Depth"
              hint="Controls how many iterations the agent performs."
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {DEPTH_OPTIONS.map((opt) => {
                const isSelected = settings.defaultDepth === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting('defaultDepth', opt.value)}
                    className={`flex flex-col items-start p-4 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-orange-500/10 border-orange-500/30 ring-1 ring-orange-500/20'
                        : 'bg-white dark:bg-[#0a0a0a] border-black/10 dark:border-white/[0.06] hover:border-black/20 dark:hover:border-white/[0.1]'
                    }`}
                  >
                    <span
                      className={`text-sm font-medium ${
                        isSelected ? 'text-orange-500 dark:text-orange-400' : 'text-neutral-900 dark:text-white'
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span className="text-xs text-neutral-500 mt-1">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>
      </div>

      {/* Toast notification */}
      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}
