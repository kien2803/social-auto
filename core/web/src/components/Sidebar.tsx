import { NavLink } from 'react-router-dom';
import type { ComponentType, SVGProps } from 'react';
import {
  IconAccounts,
  IconAnalytics,
  IconDashboard,
  IconHistory,
  IconSchedule,
  IconSettings,
  IconUpload,
} from './icons.js';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { to: '/upload', label: 'Upload & Schedule', icon: IconUpload },
  { to: '/schedule', label: 'Schedule', icon: IconSchedule },
  { to: '/history', label: 'History', icon: IconHistory },
  { to: '/analytics', label: 'Analytics', icon: IconAnalytics },
  { to: '/accounts', label: 'Accounts', icon: IconAccounts },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function linkClass({ isActive, collapsed }: { isActive: boolean; collapsed?: boolean }) {
  return [
    'flex items-center rounded-md text-sm font-medium transition-colors',
    collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100'
      : 'text-ink-muted hover:bg-stone-100 hover:text-ink dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100',
  ].join(' ');
}

export function Sidebar({ 
  collapsed = false, 
  onToggle, 
  onNavigate 
}: { 
  collapsed?: boolean; 
  onToggle?: () => void; 
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-1 px-3 py-4">
      <div className="mb-2 flex items-center justify-between px-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="Omnicast" className="h-7 w-7 rounded-lg" />
            <span className="text-sm font-semibold text-ink dark:text-stone-100">Omnicast</span>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-1 text-ink-muted hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) => linkClass({ isActive, collapsed })}
          title={collapsed ? n.label : undefined}
        >
          <n.icon aria-hidden="true" className="h-[18px] w-[18px]" />
          {!collapsed && <span>{n.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export { NAV };