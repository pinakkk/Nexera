'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
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
  Key,
  ExternalLink,
  Eye,
  EyeOff,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { useTheme } from '@/components/theme';
import { TEXT_CONFIG } from '@/lib/text-config';
import { getUserApiKeys, saveUserApiKeys, type UserApiKeys } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppSettings {
  defaultModel: string;
  defaultDepth: 'quick' | 'standard' | 'deep';
  customInstructions: string;
}

type SectionId = 'apiKeys' | 'appearance' | 'model' | 'personalization';

const STORAGE_KEY = 'research-agent-settings';

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: TEXT_CONFIG.settings.defaultModel,
  defaultDepth: TEXT_CONFIG.settings.defaultDepth as AppSettings['defaultDepth'],
  customInstructions: '',
};

const MODEL_OPTIONS = [
  ...TEXT_CONFIG.settings.modelOptions,
];

const DEPTH_OPTIONS = [
  {
    value: 'quick' as const,
    label: TEXT_CONFIG.settings.depthOptions[0].label,
    description: TEXT_CONFIG.settings.depthOptions[0].description,
    icon: Zap,
    color: 'text-amber-500',
  },
  {
    value: 'standard' as const,
    label: TEXT_CONFIG.settings.depthOptions[1].label,
    description: TEXT_CONFIG.settings.depthOptions[1].description,
    icon: Brain,
    color: 'text-sky-500',
  },
  {
    value: 'deep' as const,
    label: TEXT_CONFIG.settings.depthOptions[2].label,
    description: TEXT_CONFIG.settings.depthOptions[2].description,
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
  id,
  icon: Icon,
  title,
  description,
  children,
  delay = 0,
}: {
  id: SectionId;
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="glass-panel-solid rounded-2xl overflow-hidden scroll-mt-24"
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
/*  API Key Input                                                      */
/* ------------------------------------------------------------------ */

function ApiKeyField({
  label,
  help,
  placeholder,
  link,
  linkLabel,
  value,
  onChange,
}: {
  label: string;
  help: string;
  placeholder: string;
  link: string;
  linkLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const hasValue = value.trim().length > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">{label}</label>
        {hasValue && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <ShieldCheck size={11} />
            Configured
          </span>
        )}
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-600">{help}</p>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="glass-input font-mono text-xs pr-10"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
      >
        <ExternalLink size={11} />
        {linkLabel}
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar nav                                                        */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'apiKeys', label: 'API Keys', icon: Key },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'model', label: 'Model', icon: Sparkles },
  { id: 'personalization', label: 'Personalization', icon: UserIcon },
];

function SidebarNav({ active, onSelect }: { active: SectionId; onSelect: (id: SectionId) => void }) {
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:pb-0">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`group inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 lg:w-full ${
              isActive
                ? 'bg-orange-500/[0.08] text-orange-600 dark:text-orange-400'
                : 'text-neutral-600 hover:bg-black/[0.03] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.04] dark:hover:text-white'
            }`}
          >
            <Icon
              size={15}
              strokeWidth={1.75}
              className={isActive ? 'text-orange-500' : 'text-neutral-500 dark:text-neutral-500'}
            />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [apiKeys, setApiKeys] = useState<UserApiKeys>({});
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('apiKeys');

  useEffect(() => {
    setSettings(loadSettings());
    setApiKeys(getUserApiKeys());
    setMounted(true);
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2500);
  }, []);

  function handleSave() {
    saveSettings(settings);
    saveUserApiKeys(apiKeys);
    showToast(TEXT_CONFIG.settings.toastSaved);
  }

  function handleReset() {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
    showToast(TEXT_CONFIG.settings.toastReset);
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function updateApiKey<K extends keyof UserApiKeys>(key: K, value: string) {
    setApiKeys((prev) => ({ ...prev, [key]: value }));
  }

  function handleSelectSection(id: SectionId) {
    setActiveSection(id);
    if (typeof document !== 'undefined') {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (!mounted) {
    return (
      <div className="flex min-h-screen flex-col px-4 pb-6 pt-16 sm:px-8 sm:pt-8">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <div className="glass-panel-solid h-16 rounded-2xl animate-pulse" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="glass-panel-solid h-64 rounded-2xl animate-pulse" />
            <div className="space-y-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-panel-solid h-48 rounded-2xl animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col px-3 pb-6 pt-16 sm:px-8 sm:pt-8">
      <div className="mx-auto w-full max-w-6xl">
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
                  <h1 className="text-xl font-bold text-neutral-900 dark:text-white">{TEXT_CONFIG.settings.title}</h1>
                  <p className="text-xs text-neutral-500 dark:text-neutral-600">
                    {TEXT_CONFIG.settings.subtitle}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleReset} className="btn-secondary">
                <RotateCcw size={14} strokeWidth={2} />
                {TEXT_CONFIG.settings.reset}
              </button>
              <button onClick={handleSave} className="btn-primary">
                <Save size={14} strokeWidth={2} />
                {TEXT_CONFIG.settings.save}
              </button>
            </div>
          </div>
        </motion.div>

        {/* Two-column layout: sidebar nav + content */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            className="lg:sticky lg:top-8 lg:self-start"
          >
            <div className="glass-panel-solid rounded-2xl p-2">
              <SidebarNav active={activeSection} onSelect={handleSelectSection} />
            </div>
          </motion.aside>

          {/* Content */}
          <div className="space-y-5">
            {/* API Keys (BYOAPI) */}
            <Section
              id="apiKeys"
              icon={Key}
              title={TEXT_CONFIG.settings.sections.apiKeysTitle}
              description={TEXT_CONFIG.settings.sections.apiKeysDesc}
              delay={0.05}
            >
              <div className="rounded-xl bg-orange-50/50 dark:bg-orange-500/[0.04] border border-orange-200/50 dark:border-orange-500/10 px-4 py-3">
                <p className="text-xs text-orange-800 dark:text-orange-300 leading-relaxed">
                  <strong>Groq API Key is required</strong> for all LLM operations. Other keys are optional and enable additional features (web search, reranking). All keys are stored <strong>locally in your browser</strong> and sent securely with each request.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
                <ApiKeyField
                  label={TEXT_CONFIG.settings.apiKeys.groq.label + ' (Required)'}
                  help={TEXT_CONFIG.settings.apiKeys.groq.help}
                  placeholder={TEXT_CONFIG.settings.apiKeys.groq.placeholder}
                  link={TEXT_CONFIG.settings.apiKeys.groq.link}
                  linkLabel={TEXT_CONFIG.settings.apiKeys.groq.linkLabel}
                  value={apiKeys.groqApiKey ?? ''}
                  onChange={(v) => updateApiKey('groqApiKey', v)}
                />

                <ApiKeyField
                  label={TEXT_CONFIG.settings.apiKeys.brightdata.label + ' (Optional)'}
                  help={TEXT_CONFIG.settings.apiKeys.brightdata.help}
                  placeholder={TEXT_CONFIG.settings.apiKeys.brightdata.placeholder}
                  link={TEXT_CONFIG.settings.apiKeys.brightdata.link}
                  linkLabel={TEXT_CONFIG.settings.apiKeys.brightdata.linkLabel}
                  value={apiKeys.brightdataApiKey ?? ''}
                  onChange={(v) => updateApiKey('brightdataApiKey', v)}
                />

                <ApiKeyField
                  label={TEXT_CONFIG.settings.apiKeys.tavily.label + ' (Optional)'}
                  help={TEXT_CONFIG.settings.apiKeys.tavily.help}
                  placeholder={TEXT_CONFIG.settings.apiKeys.tavily.placeholder}
                  link={TEXT_CONFIG.settings.apiKeys.tavily.link}
                  linkLabel={TEXT_CONFIG.settings.apiKeys.tavily.linkLabel}
                  value={apiKeys.tavilyApiKey ?? ''}
                  onChange={(v) => updateApiKey('tavilyApiKey', v)}
                />

                <ApiKeyField
                  label={TEXT_CONFIG.settings.apiKeys.cohere.label + ' (Optional)'}
                  help={TEXT_CONFIG.settings.apiKeys.cohere.help}
                  placeholder={TEXT_CONFIG.settings.apiKeys.cohere.placeholder}
                  link={TEXT_CONFIG.settings.apiKeys.cohere.link}
                  linkLabel={TEXT_CONFIG.settings.apiKeys.cohere.linkLabel}
                  value={apiKeys.cohereApiKey ?? ''}
                  onChange={(v) => updateApiKey('cohereApiKey', v)}
                />
              </div>
            </Section>

            {/* Appearance + Model side-by-side on large screens */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Section
                id="appearance"
                icon={Palette}
                title={TEXT_CONFIG.settings.sections.appearanceTitle}
                description={TEXT_CONFIG.settings.sections.appearanceDesc}
                delay={0.15}
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setTheme('light')}
                    className={`inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 ${theme === 'light'
                      ? 'border-orange-500/30 bg-orange-500/[0.08] text-orange-600 dark:text-orange-400 shadow-sm'
                      : 'border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-neutral-700 dark:text-neutral-300 hover:border-black/[0.1] dark:hover:border-white/[0.1]'
                      }`}
                  >
                    <Sun size={15} />
                    {TEXT_CONFIG.settings.light}
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200 ${theme === 'dark'
                      ? 'border-orange-500/30 bg-orange-500/[0.08] text-orange-600 dark:text-orange-400 shadow-sm'
                      : 'border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-neutral-700 dark:text-neutral-300 hover:border-black/[0.1] dark:hover:border-white/[0.1]'
                      }`}
                  >
                    <Moon size={15} />
                    {TEXT_CONFIG.settings.dark}
                  </button>
                </div>
              </Section>

              <Section
                id="model"
                icon={Sparkles}
                title={TEXT_CONFIG.settings.sections.modelTitle}
                description={TEXT_CONFIG.settings.sections.modelDesc}
                delay={0.2}
              >
                <div>
                  <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">{TEXT_CONFIG.settings.defaultModelLabel}</label>
                  <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 mb-2">
                    {TEXT_CONFIG.settings.defaultModelHelp}
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
                  <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">{TEXT_CONFIG.settings.defaultDepthLabel}</label>
                  <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 mb-3">
                    {TEXT_CONFIG.settings.defaultDepthHelp}
                  </p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {DEPTH_OPTIONS.map((opt) => {
                      const isSelected = settings.defaultDepth === opt.value;
                      const DepthIcon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => updateSetting('defaultDepth', opt.value)}
                          className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all duration-200 ${isSelected
                            ? 'bg-orange-500/[0.08] border-orange-500/25 shadow-sm'
                            : 'bg-white dark:bg-white/[0.02] border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.1]'
                            }`}
                        >
                          <DepthIcon
                            size={18}
                            className={isSelected ? 'text-orange-500' : opt.color}
                          />
                          <span className={`text-xs font-semibold ${isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-900 dark:text-white'
                            }`}>
                            {opt.label}
                          </span>
                          <span className="text-[10px] leading-tight text-neutral-500">{opt.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Section>
            </div>

            {/* Personalization (Custom Instructions) */}
            <Section
              id="personalization"
              icon={UserIcon}
              title={TEXT_CONFIG.settings.sections.customInstructionsTitle}
              description={TEXT_CONFIG.settings.sections.customInstructionsDesc}
              delay={0.25}
            >
              <div>
                <label className="text-sm font-semibold text-neutral-800 dark:text-neutral-300">
                  {TEXT_CONFIG.settings.customInstructionsLabel}
                </label>
                <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-0.5 mb-2">
                  {TEXT_CONFIG.settings.customInstructionsHelp}
                </p>
                <textarea
                  value={settings.customInstructions}
                  onChange={(e) => updateSetting('customInstructions', e.target.value)}
                  placeholder={TEXT_CONFIG.settings.customInstructionsPlaceholder}
                  rows={5}
                  className="glass-input w-full resize-y min-h-[140px]"
                />
              </div>
            </Section>
          </div>
        </div>
      </div>

      <Toast message={toastMessage} visible={toastVisible} />
    </div>
  );
}
