import { IconMenu, IconMoon, IconSun } from './icons.js';
import { useTheme } from '../lib/useTheme.js';
import { useAuth } from '../contexts/AuthContext.js';

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
  const { user, logout } = useAuth();
  const envClass =
    envTone === 'mock'
      ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
      : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 bg-surface/90 px-4 backdrop-blur dark:border-stone-800 dark:bg-[#1c1917]/85">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuToggle}
          className="rounded-md p-1.5 text-ink-muted hover:bg-stone-100 md:hidden dark:text-stone-400 dark:hover:bg-stone-800"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="h-6 w-6" />
          <span className="font-display text-sm font-semibold text-ink dark:text-stone-100">
            Omnicast
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
        {user && (
          <span className="text-sm text-ink-muted dark:text-stone-400">
            {user.name}
          </span>
        )}
        {user && (
          <button
            type="button"
            onClick={logout}
            className="rounded-md p-1.5 text-ink-muted hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            title="Sign out"
          >
            Sign out
          </button>
        )}
        <button
          type="button"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          onClick={toggle}
          className="rounded-md p-1.5 text-ink-muted hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
        >
          {theme === 'dark' ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}