import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';

const PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'Facebook'] as const;

const FEATURES = [
  {
    icon: '◉',
    title: 'Connect accounts',
    body: 'OAuth-secured linking for every platform. Multiple channels per platform, tokens encrypted at rest.',
  },
  {
    icon: '↑',
    title: 'Upload once',
    body: 'Drop a video, get thumbnails and dedup automatically. Storage quota tracking included.',
  },
  {
    icon: '⏱',
    title: 'Schedule posts',
    body: 'Pick the exact time, per-platform captions and visibility. The background worker publishes for you.',
  },
  {
    icon: '↻',
    title: 'Retries built in',
    body: 'Transient failures back off and retry; revoked tokens are flagged so you know to reconnect.',
  },
  {
    icon: '◐',
    title: 'Quota aware',
    body: 'Daily per-platform limits are tracked so a burst of uploads never burns your API quota.',
  },
  {
    icon: '📊',
    title: 'Analytics',
    body: 'Publish history, per-platform performance and channel stats in one dashboard.',
  },
] as const;

export function LandingPage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-surface-muted text-ink dark:bg-[#0b1220] dark:text-slate-100">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">
            S
          </span>
          <span className="text-lg font-semibold">Social Auto</span>
        </div>
        <nav className="flex items-center gap-3">
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

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center md:px-8 md:pt-20">
        <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100">
          Self-hosted · Multi-platform
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
          Schedule once. Publish everywhere.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted dark:text-slate-400">
          Upload a video, pick a time, and Social Auto publishes it to YouTube, TikTok,
          Instagram and Facebook — automatically, from your own infrastructure.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
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
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {PLATFORMS.map((p) => (
            <span
              key={p}
              className="chip border border-slate-200 bg-surface text-ink-muted dark:border-slate-700 dark:bg-[#0f1729] dark:text-slate-300"
            >
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
        <h2 className="text-center text-2xl font-bold">Everything you need to publish at scale</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-lg text-brand-600 dark:bg-brand-500/10 dark:text-brand-100">
                {f.icon}
              </div>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-ink-muted dark:text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      {!isAuthenticated && (
        <section className="border-t border-slate-200 bg-surface dark:border-slate-800 dark:bg-[#0f1729]">
          <div className="mx-auto max-w-6xl px-4 py-14 text-center md:px-8">
            <h2 className="text-2xl font-bold">Ready to automate your posting?</h2>
            <p className="mt-2 text-ink-muted dark:text-slate-400">
              Create an account, connect a platform, and schedule your first post in minutes.
            </p>
            <Link to="/register" className="btn-primary mt-6 inline-flex px-6 py-3 text-base">
              Get started
            </Link>
          </div>
        </section>
      )}

      <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-ink-subtle md:px-8 dark:text-slate-500">
        Social Auto — self-hosted video scheduling for YouTube, TikTok, Instagram &amp; Facebook.
      </footer>
    </div>
  );
}
