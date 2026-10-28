import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';

const PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'Facebook'] as const;

const FEATURES = [
  {
    title: 'Connect accounts',
    body: 'OAuth-secured linking for every platform. Multiple channels per platform, tokens encrypted at rest.',
  },
  {
    title: 'Upload once',
    body: 'Drop a video, get thumbnails and dedup automatically. Storage quota tracking included.',
  },
  {
    title: 'Schedule posts',
    body: 'Pick the exact time, per-platform captions and visibility. The background worker publishes for you.',
  },
  {
    title: 'Retries built in',
    body: 'Transient failures back off and retry; revoked tokens are flagged so you know to reconnect.',
  },
  {
    title: 'Quota aware',
    body: 'Daily per-platform limits are tracked so a burst of uploads never burns your API quota.',
  },
  {
    title: 'Analytics',
    body: 'Publish history, per-platform performance and channel stats in one dashboard.',
  },
] as const;

export function LandingPage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-surface-muted font-sans text-ink dark:bg-[#1c1917] dark:text-stone-100">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Omnicast" className="h-8 w-8" />
          <span className="font-display text-lg font-semibold tracking-tight">Omnicast</span>
        </Link>
        <nav className="flex items-center gap-2">
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn-primary">
              Open Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">
                Sign in
              </Link>
              <Link to="/register" className="btn-primary">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero — left aligned, editorial; faint network motif as backdrop */}
      <section className="relative mx-auto max-w-5xl overflow-hidden px-6 pb-14 pt-10 md:pt-16">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-4 h-72 w-72 text-brand-600 opacity-[0.07] dark:text-brand-500"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"
        >
          <circle cx="12" cy="12" r="2.6" />
          <circle cx="4.5" cy="5.5" r="1.9" />
          <circle cx="19.5" cy="5.5" r="1.9" />
          <circle cx="12" cy="19.5" r="1.9" />
          <path d="m6.2 6.9 3.7 3.3M17.8 6.9l-3.7 3.3M12 14.8v2.8" />
        </svg>
        <p className="font-mono text-xs text-brand-600 dark:text-brand-500">
          multi-platform video scheduler
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
          Upload once,
          <br />
          publish everywhere.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted dark:text-stone-400">
          Drop a video, pick a time, and Omnicast publishes it to YouTube, TikTok,
          Instagram and Facebook on schedule, with retries and quota tracking
          handled for you.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn-primary px-6 py-3 text-base">
              Open Dashboard
            </Link>
          ) : (
            <>
              <Link to="/register" className="btn-primary px-6 py-3 text-base">
                Create free account
              </Link>
              <Link to="/login" className="btn-secondary px-6 py-3 text-base">
                Sign in
              </Link>
            </>
          )}
          <span className="ml-1 font-mono text-xs text-ink-subtle dark:text-stone-500">
            {PLATFORMS.join(' / ')}
          </span>
        </div>
      </section>

      {/* Features — ruled list, no card grid */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="font-display text-xl font-semibold">What it does</h2>
        <div className="mt-4 border-t border-stone-200 dark:border-stone-800">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group grid gap-1 border-b border-stone-200 py-5 transition-colors hover:bg-surface sm:grid-cols-[220px_1fr] sm:gap-8 sm:-mx-3 sm:px-3 dark:border-stone-800 dark:hover:bg-[#221e19]"
            >
              <h3 className="font-display text-base font-medium transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-500">{f.title}</h3>
              <p className="text-sm leading-relaxed text-ink-muted dark:text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA — hairline rule, no boxed section */}
      {!isAuthenticated && (
        <section className="border-t border-stone-200 dark:border-stone-800">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="font-display text-2xl font-semibold">Start scheduling today</h2>
            <p className="mt-2 max-w-md text-sm text-ink-muted dark:text-stone-400">
              Create an account, connect a platform, and schedule your first post
              in minutes.
            </p>
            <Link to="/register" className="btn-primary mt-6 inline-flex px-6 py-3 text-base">
              Get started
            </Link>
          </div>
        </section>
      )}

      <footer className="border-t border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 font-mono text-xs text-ink-subtle dark:text-stone-500">
          <span>Omnicast — video scheduling for YouTube, TikTok, Instagram &amp; Facebook</span>
          <Link to="/privacy" className="underline underline-offset-2 hover:text-ink dark:hover:text-stone-300">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
