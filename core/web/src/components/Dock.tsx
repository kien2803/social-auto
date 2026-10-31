import { NavLink, useLocation } from 'react-router-dom';
import type { ComponentType, SVGProps } from 'react';
import {
  IconDashboard,
  IconUpload,
  IconAccounts,
  IconAnalytics,
  IconSettings,
} from './icons.js';
import { IconTimeline, IconPlus } from '@tabler/icons-react';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
interface DockItem {
  to: string;
  label: string;
  icon: IconComponent;
  /** Custom active rule — Posts lights up on calendar/pipeline/history but
   *  not on the composer (/posts/new is the Create button's own state). */
  match?: (pathname: string) => boolean;
}

const postsMatch = (p: string) => p.startsWith('/posts/') && p !== '/posts/new';

const PRIMARY: DockItem[] = [
  { to: '/dashboard', label: 'Overview', icon: IconDashboard },
  { to: '/library', label: 'Library', icon: IconUpload },
  { to: '/posts/new', label: 'Create', icon: IconPlus as unknown as IconComponent },
  { to: '/posts/calendar', label: 'Posts', icon: IconTimeline as unknown as IconComponent, match: postsMatch },
  { to: '/accounts', label: 'Accounts', icon: IconAccounts },
];

const SECONDARY: DockItem[] = [
  { to: '/analytics', label: 'Analytics', icon: IconAnalytics },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function DockEntry({ to, label, icon: Icon, match }: DockItem) {
  const { pathname } = useLocation();
  const customActive = match?.(pathname) ?? false;
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) => {
        const active = match ? customActive : isActive;
        return `group relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-200 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-2 hover:scale-[1.15] sm:h-12 sm:w-12 sm:hover:-translate-y-2.5 sm:hover:scale-[1.18] ${
          active
            ? 'border-brand-200 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-950/40 dark:text-brand-100'
            : 'border-stone-200 bg-paper text-ink-muted hover:bg-surface dark:border-stone-700 dark:bg-[#16130f] dark:text-stone-400 dark:hover:bg-stone-800'
        }`;
      }}
    >
      {({ isActive }) => (
        <>
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          {/* macOS running-app dot under the active icon */}
          {(match ? customActive : isActive) && (
            <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-600" />
          )}
          {/* tooltip — hover AND keyboard focus (focus-within covers :focus-visible) */}
          <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-paper opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-stone-100 dark:text-ink">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/** Bottom navigation dock — macOS-style, the app's only nav on every
 *  screen size. Icon buttons shrink on narrow phones so the bar never
 *  clips horizontally. */
export function Dock() {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-end gap-1 rounded-2xl border border-stone-200 bg-surface/90 p-2 shadow-float backdrop-blur-md sm:gap-1.5 sm:p-2.5 dark:border-stone-800 dark:bg-[#1e1a15]/90"
    >
      {PRIMARY.map((item) => (
        <DockEntry key={item.to} {...item} />
      ))}
      <span className="mx-0.5 w-px self-stretch bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
      {SECONDARY.map((item) => (
        <DockEntry key={item.to} {...item} />
      ))}
    </nav>
  );
}
