'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Zap,
  Brain,
  Layers,
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
    description: 'Fast overview',
    icon: Zap,
    color: 'text-amber-500',
  },
  {
    value: 'standard' as const,
    label: 'Standard',
    description: 'Balanced depth',
    icon: Brain,
    color: 'text-sky-500',
  },
  {
    value: 'deep' as const,
    label: 'Deep',
    description: 'Thorough research',
    icon: Layers,
    color: 'text-purple-500',
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
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-6 left-4 right-4 flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 backdrop-blur-sm rounded-2xl shadow-xl shadow-emerald-600/20 sm:left-auto sm:right-6 sm:w-auto z-50"
        >
          <Check size={16} strokeWidth={2.5} />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
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
  delay = 0,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="glass-panel-solid rounded-2xl overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-black/[0.05] dark:border-white/[0.05] sm:px-6 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 border border-neutral-200/60 dark:from-white/[0.06] dark:to-white/[0.02] dark:border-white/[0.08]">
            <Icon size={16} strokeWidth={1.75} className="text-neutral-600 dark:text-neutral-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-neutral-900 dark:text-white">{title}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5">{description}</p>
          </div>
        </div>
      </div>
      <div className="px-5 py-5 space-y-5 sm:px-6">{children}</div>
    </motion.div>
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

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  if (!mounted) {
    return (
      <div className="flex min-h-screen flex-col px-4 pb-6 pt-16 sm:px-8 sm:pt-8">
        <div className="max-w-2xl space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-panel-solid rounded-2xl h-48 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col px-3 pb-6 pt-16 sm:px-8 sm:pt-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="shrink-0 pb-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-50 border border-neutral-200/60 dark:from-white/[0.06] dark:to-white/[0.02] dark:border-white/[0.08]">
                <Settings size={17} strokeWidth={1.75} className="text-neutral-600 dark:text-neutral-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Settings</h1>
                <p className="text-xs text-neutral-500 dark:text-neutral-600">
                  Configure your research agent preferences
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleReset} className="btn-secondary">
              <RotateCcw size={14} strokeWidth={2} />
              Reset
            </button>
            <button onClick={handleSave} className="btn-primary">
              <Save size={14} strokeWidth={2} />
              Save Settings
            </button>
          </div>
        </div>
      </motion.div>

      {/* Settings sections */}
      <div className="max-w-2xl flex-1 space-y-5">
        {/* API Configuration */}
        <Section icon={Server} title="API Configuration" description="Backend connection settings" delay={0.1}>
          <div>
            <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">API Base URL</label>
            <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 mb-2">
              The URL where your research agent API is running.
            </p>
            <input
              type="text"
              value={settings.apiUrl}
              onChange={(e) => updateSetting('apiUrl', e.target.value)}
              placeholder="http://localhost:8000"
              className="glass-input font-mono"
            />
          </div>
        </Section>

        {/* Appearance */}
        <Section icon={Palette} title="Appearance" description="Choose the UI theme" delay={0.2}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTheme('light')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 ${theme === 'light'
                  ? 'border-orange-500/30 bg-orange-500/[0.08] text-orange-600 dark:text-orange-400 shadow-sm'
                  : 'border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-neutral-700 dark:text-neutral-300 hover:border-black/[0.1] dark:hover:border-white/[0.1]'
                }`}
            >
              <Sun size={15} />
              Light
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 ${theme === 'dark'
                  ? 'border-orange-500/30 bg-orange-500/[0.08] text-orange-600 dark:text-orange-400 shadow-sm'
                  : 'border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-neutral-700 dark:text-neutral-300 hover:border-black/[0.1] dark:hover:border-white/[0.1]'
                }`}
            >
              <Moon size={15} />
              Dark
            </button>
          </div>
        </Section>

        {/* Model Preferences */}
        <Section icon={Sparkles} title="Model Preferences" description="Default model and research depth" delay={0.3}>
          <div>
            <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">Default Model</label>
            <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 mb-2">
              Auto selects the best available model.
            </p>
            <select
              value={settings.defaultModel}
              onChange={(e) => updateSetting('defaultModel', e.target.value)}
              className="glass-input appearance-none cursor-pointer"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
              }}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">Default Research Depth</label>
            <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 mb-3">
              Controls how many iterations the agent performs.
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {DEPTH_OPTIONS.map((opt) => {
                const isSelected = settings.defaultDepth === opt.value;
                const DepthIcon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting('defaultDepth', opt.value)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all duration-200 ${isSelected
                        ? 'bg-orange-500/[0.08] border-orange-500/25 shadow-sm'
                        : 'bg-white dark:bg-white/[0.02] border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.1]'
                      }`}
                  >
                    <DepthIcon
                      size={20}
                      className={isSelected ? 'text-orange-500' : opt.color}
                    />
                    <span className={`text-sm font-semibold ${isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-900 dark:text-white'
                      }`}>
                      {opt.label}
                    </span>
                    <span className="text-[11px] text-neutral-500">{opt.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}
