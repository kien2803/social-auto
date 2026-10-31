import { NavLink, useLocation } from 'react-router-dom';
import { useState, type ComponentType, type SVGProps } from 'react';
import {
  IconAccounts,
  IconAnalytics,
  IconDashboard,
  IconHistory,
  IconSchedule,
  IconSettings,
  IconUpload,
} from './icons.js';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function linkClass(isActive: boolean, collapsed: boolean) {
  return [
    'flex items-center rounded-md text-sm font-medium transition-colors',
    collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100'
      : 'text-ink-muted hover:bg-stone-100 hover:text-ink dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100',
  ].join(' ');
}

function Item({ to, label, icon: IconC, collapsed, onNavigate, end }: {
  to: string; label: string; icon: Icon; collapsed: boolean; onNavigate?: () => void; end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate} title={collapsed ? label : undefined}
      className={({ isActive }) => linkClass(isActive, collapsed)}>
      <IconC className="h-4.5 w-4.5 h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

const POSTS_CHILDREN = [
  { to: '/posts/calendar', label: 'Calendar', icon: IconSchedule },
  { to: '/posts/pipeline', label: 'Pipeline', icon: IconHistory },
  { to: '/posts/history', label: 'History', icon: IconHistory },
];

export function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const postsActive = pathname.startsWith('/posts') || ['/calendar', '/pipeline', '/history'].includes(pathname);
  const [postsOpen, setPostsOpen] = useState(true);

  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-1 px-3 py-4">
      <div className="mb-3 flex items-center gap-2 px-2">
        <img src="/logo.svg" alt="" className="h-7 w-7 rounded-lg" />
        {!collapsed && <span className="font-display text-sm font-semibold text-ink dark:text-stone-100">Omnicast</span>}
      </div>

      <Item to="/dashboard" label="Overview" icon={IconDashboard} collapsed={collapsed} onNavigate={onNavigate} />
      <Item to="/library" label="Content Library" icon={IconUpload} collapsed={collapsed} onNavigate={onNavigate} />

      {/* Posts group — expandable */}
      <div>
        <button
          type="button"
          onClick={() => setPostsOpen((v) => !v)}
          className={`${linkClass(postsActive, collapsed)} w-full`}
          title={collapsed ? 'Posts' : undefined}
        >
          <IconSchedule className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Posts</span>
              <span aria-hidden="true" className="text-[10px] text-ink-subtle">{postsOpen ? '▾' : '▸'}</span>
            </>
          )}
        </button>
        {(postsOpen || collapsed) && (
          <div className={collapsed ? '' : 'ml-4 mt-1 space-y-0.5 border-l border-stone-200 pl-3 dark:border-stone-700'}>
            {POSTS_CHILDREN.map((c) => (
              <NavLink
                key={c.to}
                to={c.to}
                onClick={onNavigate}
                title={collapsed ? c.label : undefined}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                    collapsed ? 'text-center' : ''
                  } ${
                    isActive
                      ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-100'
                      : 'text-ink-muted hover:bg-stone-100 hover:text-ink dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                  }`
                }
              >
                {collapsed ? c.label.slice(0, 1) : c.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>

      <Item to="/accounts" label="Accounts" icon={IconAccounts} collapsed={collapsed} onNavigate={onNavigate} />
      <Item to="/analytics" label="Analytics" icon={IconAnalytics} collapsed={collapsed} onNavigate={onNavigate} />

      <div className="mt-auto">
        <Item to="/settings" label="Settings" icon={IconSettings} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
