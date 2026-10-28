import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';

const STATIONS = [
  { name: 'YouTube', freq: 'CH-01', scope: 'upload + read' },
  { name: 'TikTok', freq: 'CH-02', scope: 'video.publish' },
  { name: 'Instagram', freq: 'CH-03', scope: 'content_publish' },
  { name: 'Facebook', freq: 'CH-04', scope: 'pages_manage_posts' },
] as const;

const SIGNAL = [
  { time: '09:00', event: 'video received — 148 MB, checksummed, deduplicated' },
  { time: '09:00', event: 'thumbnail rendered, duration probed' },
  { time: '18:30', event: 'broadcast opens — CH-01 YouTube, CH-03 Instagram' },
  { time: '18:31', event: 'published · CH-01 OK, CH-03 retry queued (rate limit)' },
  { time: '18:46', event: 'retry succeeds · CH-03 OK — broadcast complete' },
] as const;

const CAPABILITIES = [
  ['Encrypted channel auth', 'OAuth per platform, tokens sealed at rest, many channels per account.'],
  ['Upload once', 'Stream to storage, sha-256 dedup, thumbnail generated on ingest.'],
  ['Transmission schedule', 'Exact-time publishing, per-platform captions and visibility.'],
  ['Self-healing send', 'Backoff retries on transient failure; dead letters get flagged, not dropped.'],
  ['Quota governor', 'Per-platform daily budgets tracked so a burst never burns your API limit.'],
  ['Broadcast log', 'Full publish history, channel stats and per-platform analytics.'],
] as const;

export function LandingPage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-surface-muted font-sans text-ink dark:bg-[#1c1917] dark:text-stone-100">
      {/* Station header */}
      <header className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Omnicast" className="h-8 w-8" />
            <span className="font-display text-lg font-semibold tracking-tight">Omnicast</span>
          </Link>
          <nav className="flex items-center gap-2">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn-primary">Open Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">Sign in</Link>
                <Link to="/register" className="btn-primary">Get started</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Masthead — transmission identity */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-5xl px-6 pb-12 pt-12 md:pt-16">
          <p className="font-mono text-xs text-brand-600 dark:text-brand-500">
            broadcast · multi-platform video scheduler
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.06] tracking-tight md:text-6xl">
            One upload. Every channel, on schedule.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted dark:text-stone-400">
            Omnicast takes a single video and transmits it to YouTube, TikTok,
            Instagram and Facebook at the times you set — retries, quotas and
            history handled by the station, not by you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn-primary px-6 py-3 text-base">Open Dashboard</Link>
            ) : (
              <>
                <Link to="/register" className="btn-primary px-6 py-3 text-base">Create free account</Link>
                <Link to="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Channel lineup — the product's real material */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <h2 className="font-display text-xl font-semibold">Channel lineup</h2>
          <div className="mt-4 border-t border-stone-200 dark:border-stone-800">
            {STATIONS.map((s) => (
              <div key={s.name} className="grid grid-cols-[88px_1fr_auto] items-baseline gap-4 border-b border-stone-200 py-4 sm:grid-cols-[100px_1fr_1fr] dark:border-stone-800">
                <span className="font-mono text-xs text-ink-subtle dark:text-stone-500">{s.freq}</span>
                <span className="font-display font-medium">{s.name}</span>
                <span className="font-mono text-xs text-ink-muted dark:text-stone-400">{s.scope}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* A broadcast day — the product doing its one job */}
      <section className="border-b border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <h2 className="font-display text-xl font-semibold">A broadcast day</h2>
          <div className="mt-4 border-t border-stone-200 font-mono text-sm dark:border-stone-800">
            {SIGNAL.map((e, i) => (
              <div key={i} className="grid grid-cols-[64px_1fr] gap-4 border-b border-stone-200 py-3.5 dark:border-stone-800">
                <span className="text-ink-subtle dark:text-stone-500">{e.time}</span>
                <span className="text-ink-muted dark:text-stone-300">{e.event}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Station capabilities */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <h2 className="font-display text-xl font-semibold">Inside the station</h2>
          <div className="mt-4 border-t border-stone-200 dark:border-stone-800">
            {CAPABILITIES.map(([title, body]) => (
              <div key={title} className="group grid gap-1 border-b border-stone-200 py-5 transition-colors hover:bg-surface sm:grid-cols-[240px_1fr] sm:gap-8 sm:-mx-3 sm:px-3 dark:border-stone-800 dark:hover:bg-[#221e19]">
                <h3 className="font-display text-base font-medium transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-500">{title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted dark:text-stone-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sign off */}
      {!isAuthenticated && (
        <section className="border-b border-stone-200 dark:border-stone-800">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="font-display text-2xl font-semibold">Go on air</h2>
            <p className="mt-2 max-w-md text-sm text-ink-muted dark:text-stone-400">
              Create an account, connect a channel, and schedule your first
              broadcast in minutes.
            </p>
            <Link to="/register" className="btn-primary mt-6 inline-flex px-6 py-3 text-base">
              Get started
            </Link>
          </div>
        </section>
      )}

      <footer className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 font-mono text-xs text-ink-subtle dark:text-stone-500">
        <span>Omnicast — video scheduling for YouTube, TikTok, Instagram &amp; Facebook</span>
        <Link to="/privacy" className="underline underline-offset-2 hover:text-ink dark:hover:text-stone-300">Privacy</Link>
      </footer>
    </div>
  );
}
