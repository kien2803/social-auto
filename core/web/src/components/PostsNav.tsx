import { NavLink } from 'react-router-dom';

/** Secondary tabs shared by the three Posts views. */
const TABS = [
  { to: '/posts/calendar', label: 'Calendar' },
  { to: '/posts/pipeline', label: 'Pipeline' },
  { to: '/posts/history', label: 'History' },
];

export function PostsNav() {
  return (
    <nav aria-label="Posts" className="flex gap-1 border-b border-stone-200 dark:border-stone-800">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-brand-600 text-brand-700 dark:text-brand-100'
                : 'border-transparent text-ink-muted hover:text-ink dark:text-stone-400 dark:hover:text-stone-100'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
