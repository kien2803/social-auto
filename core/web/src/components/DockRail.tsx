import { NavLink, useLocation } from 'react-router-dom';
import type { ComponentType, SVGProps } from 'react';
import {
  IconDashboard,
  IconUpload,
  IconSchedule,
  IconAccounts,
  IconAnalytics,
  IconSettings,
} from './icons.js';
import { IconTimeline, IconPlus } from '@tabler/icons-react';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface RailItem {
  to: string;
  label: string;
  icon: IconComponent;
  /** Active also when path starts with this prefix (Posts group). */
  matchPrefix?: string;
}

const ITEMS: RailItem[] = [
  { to: '/dashboard', label: 'Overview', icon: IconDashboard },
  { to: '/library', label: 'Library', icon: IconUpload },
  { to: '/posts/new', label: 'Create Post', icon: IconPlus as unknown as IconComponent },
  { to: '/posts/calendar', label: 'Posts', icon: IconTimeline as unknown as IconComponent, matchPrefix: '/posts' },
];

const BOTTOM: RailItem[] = [
  { to: '/accounts', label: 'Accounts', icon: IconAccounts },
  { to: '/analytics', label: 'Analytics', icon: IconAnalytics },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function RailEntry({ to, label, icon: Icon, matchPrefix }: RailItem) {
  const { pathname } = useLocation();
  const prefixActive = matchPrefix
    ? pathname.startsWith(matchPrefix) && !(matchPrefix === '/posts' && pathname === '/posts/new')
    : false;
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) => {
        const active = isActive || prefixActive;
        return `group relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-150 hover:scale-110 ${
          active
            ? 'border-brand-200 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-950/40 dark:text-brand-100'
            : 'border-stone-200 bg-paper text-ink-muted hover:bg-surface dark:border-stone-700 dark:bg-[#16130f] dark:text-stone-400 dark:hover:bg-stone-800'
        }`;
      }}
    >
      {({ isActive }) => (
        <>
          {/* macOS running-app dot — on the rail edge for a vertical dock */}
          {(isActive || prefixActive) && (
            <span className="absolute -right-1.5 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-brand-600" />
          )}
          <Icon className="h-5 w-5" />
          {/* tooltip — slides out to the right of the rail */}
          <span className="pointer-events-none absolute left-14 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-paper opacity-0 transition-opacity group-hover:opacity-100 dark:bg-stone-100 dark:text-ink">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/** Vertical macOS-dock rail — icon rail on desktop, hidden on mobile
 *  (the bottom Dock covers it there). */
export function DockRail() {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-16 flex-col items-center gap-1.5 border-r border-stone-200 bg-surface/90 py-3 dark:border-stone-800 dark:bg-[#1e1a15]/90"
    >
      <img src="/logo.svg" alt="Omnicast" className="mb-2 h-8 w-8 rounded-lg" />
      {ITEMS.map((it) => (
        <RailEntry key={it.to} {...it} />
      ))}
      <span className="my-0.5 h-px w-6 bg-stone-200 dark:bg-stone-700" aria-hidden="true" />
      {BOTTOM.map((it) => (
        <RailEntry key={it.to} {...it} />
      ))}
    </nav>
  );
}
