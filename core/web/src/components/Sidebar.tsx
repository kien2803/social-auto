import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '◐' },
  { to: '/upload', label: 'Upload & Schedule', icon: '↑' },
  { to: '/schedule', label: 'Schedule', icon: '⏱' },
  { to: '/history', label: 'History', icon: '⌛' },
  { to: '/analytics', label: 'Analytics', icon: '📊' },
  { to: '/accounts', label: 'Accounts', icon: '◉' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function linkClass({ isActive, collapsed }: { isActive: boolean; collapsed?: boolean }) {
  return [
    'flex items-center rounded-md text-sm font-medium transition-colors',
    collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100'
      : 'text-ink-muted hover:bg-slate-100 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
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
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle dark:text-slate-500">
            Workspace
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-1 text-ink-muted hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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
          <span aria-hidden="true" className="text-base leading-none">
            {n.icon}
          </span>
          {!collapsed && <span>{n.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export { NAV };