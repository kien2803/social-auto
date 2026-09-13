import { useTheme } from '../lib/useTheme.js';

export function Topbar({
  onMenuToggle,
  envLabel,
  envTone,
}: {
  onMenuToggle: () => void;
  envLabel: string;
  envTone: 'mock' | 'live';
}) {
  const { theme, toggle } = useTheme();
  const envClass =
    envTone === 'mock'
      ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
      : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-surface/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-[#0b1220]/85">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuToggle}
          className="rounded-md p-1.5 text-ink-muted hover:bg-slate-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
        >
          ☰
        </button>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full bg-brand-600"
          />
          <span className="text-sm font-semibold text-ink dark:text-slate-100">
            social-auto
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          title={`API mode: ${envLabel}`}
          className={`chip ${envClass} font-mono`}
        >
          {envLabel}
        </span>
        <button
          type="button"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          onClick={toggle}
          className="rounded-md p-1.5 text-ink-muted hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}