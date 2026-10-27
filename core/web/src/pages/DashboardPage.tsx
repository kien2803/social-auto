import { IconHistory, IconSchedule, IconUpload } from '../components/icons.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, type QuotaResponse } from '../lib/api.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { useAccounts } from '../lib/accounts.js';
import type { ScheduledPostRow } from '@social-auto/shared';


interface DashboardCounts {
  by_status: Record<string, number>;
  published_last_7d: number;
}

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'brand';
}) {
  const ring: Record<typeof tone, string> = {
    neutral: 'border-stone-200 dark:border-stone-800',
    success: 'border-emerald-200 dark:border-emerald-900/50',
    warn: 'border-amber-200 dark:border-amber-900/50',
    danger: 'border-red-200 dark:border-red-900/50',
    brand: 'border-brand-100 dark:border-brand-500/30',
  } as const;
  return (
    <Card className={`border ${ring[tone]}`}>
      <CardBody className="space-y-1.5">
        <p className="font-mono text-[11px] tracking-wide text-ink-muted dark:text-stone-400">
          {label}
        </p>
        <p className="font-display text-3xl font-semibold tracking-tight text-ink dark:text-stone-100">{value}</p>
        {hint && (
          <p className="text-xs text-ink-muted dark:text-stone-400">{hint}</p>
        )}
      </CardBody>
    </Card>
  );
}

 function QuotaSection() {
  const quota = useQuery<QuotaResponse>({
    queryKey: ['quota'],
    queryFn: () => api.quota(),
    refetchInterval: 60_000,
  });
  return (
    <Card>
      <CardHeader
        title="Platform quotas"
        description="Today's per-platform usage. Resets at midnight UTC."
      />
      <CardBody className="space-y-3">
        {quota.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : quota.data?.quotas.length ? (
          quota.data.quotas.map((q) => {
            const pct = q.limit > 0 ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 0;
            const tone: 'neutral' | 'warn' | 'danger' =
              pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'neutral';
            const resetIn = dayjs(q.reset_at).diff(dayjs(), 'minute');
            return (
              <div
                key={q.platform}
                className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
                data-testid={`quota-${q.platform}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold capitalize text-ink dark:text-stone-100">
                      {q.platform}
                    </span>
                    {tone === 'warn' && <Badge tone="warn">approaching limit</Badge>}
                    {tone === 'danger' && <Badge tone="danger">exhausted</Badge>}
                  </div>
                  <div className="text-xs text-ink-muted dark:text-stone-400">
                    {q.used.toLocaleString()} / {q.limit.toLocaleString()} units
                  </div>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-stone-200 dark:bg-stone-800">
                  <div
                    className={
                      tone === 'danger'
                        ? 'h-full rounded-full bg-red-500'
                        : tone === 'warn'
                          ? 'h-full rounded-full bg-amber-500'
                          : 'h-full rounded-full bg-emerald-500'
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-muted dark:text-stone-400">
                  Resets in {resetIn} min · {q.remaining.toLocaleString()} units remaining
                </p>
              </div>
            );
          })
        ) : (
          <EmptyState title="No quota data" description="Connect an account to start tracking." />
        )}
      </CardBody>
    </Card>
  );
}
 function QuickActions() {
   return (
   <Card>
      <CardBody className="flex flex-wrap items-center gap-2">
        <Link
          to="/upload"
          className="btn-primary"
        >
          ↑ New upload
        </Link>
        <Link to="/schedule" className="btn-secondary">
          <IconSchedule className="h-4 w-4" /> Schedule list
        </Link>
        <Link to="/history" className="btn-secondary">
          <IconHistory className="h-4 w-4" /> History
        </Link>
        <Link to="/accounts" className="btn-ghost ml-auto">
          Manage accounts →
        </Link>
      </CardBody>
    </Card>
  );
}

function UpcomingList() {
  const q = useQuery({
    queryKey: ['schedule', 'pending'],
    queryFn: () => api.listSchedule({ status: 'pending' }),
    refetchInterval: 15_000,
  });
  const accounts = useAccounts();
  const map = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const upcoming = (q.data?.posts ?? [])
    .filter((p) => p.scheduled_at > Date.now())
    .sort((a, b) => a.scheduled_at - b.scheduled_at)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader
        title="Upcoming posts"
        description="Next 5 scheduled posts, soonest first."
        action={
          <Link to="/schedule" className="text-xs text-brand-600 hover:underline dark:text-brand-100">
            View all
          </Link>
        }
      />
      <CardBody>
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={<IconSchedule className="h-6 w-6" />}
            title="Nothing scheduled"
            description="Create an upload and pick a time to see it here."
          />
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {upcoming.map((p) => (
              <UpcomingRow key={p.id} post={p} accountLabel={map.get(p.account_id)?.display_name ?? '?'} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function UpcomingRow({ post, accountLabel }: { post: ScheduledPostRow; accountLabel: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink dark:text-stone-100">
            {dayjs(post.scheduled_at).format('ddd MMM D, HH:mm')}
          </span>
          <Badge tone="pending">{post.status}</Badge>
        </div>
        <p className="mt-0.5 truncate text-ink-muted dark:text-stone-400">
          {post.caption.split('\n')[0] || '(no caption)'}
        </p>
      </div>
      <div className="shrink-0 text-right text-xs text-ink-muted dark:text-stone-400">
        <div className="font-medium text-ink dark:text-stone-200">{accountLabel}</div>
        <div className="capitalize">{post.visibility}</div>
      </div>
    </li>
  );
}

function FailureList() {
  const q = useQuery({
    queryKey: ['schedule', 'failed'],
    queryFn: () => api.listSchedule({ status: 'failed' }),
    refetchInterval: 30_000,
  });
  const accounts = useAccounts();
  const map = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const items = (q.data?.posts ?? [])
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader
        title="Recent failures"
        description="Last 5 failed posts — fix and retry from the schedule page."
        action={
          <Link to="/schedule" className="text-xs text-brand-600 hover:underline dark:text-brand-100">
            Schedule
          </Link>
        }
      />
      <CardBody>
        {q.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<span>✓</span>}
            title="No failures"
            description="All scheduled posts are healthy."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <li
                key={p.id}
                className="rounded border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink dark:text-stone-100">
                    {map.get(p.account_id)?.display_name ?? p.account_id.slice(0, 8)}
                  </span>
                  <Badge tone="failed">{p.status}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-ink-muted dark:text-stone-400">
                  {p.last_error ?? 'no error message'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function DashboardPage() {
  const counts = useQuery<DashboardCounts>({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboardCounts(),
    refetchInterval: 10_000,
  });
  const accounts = useAccounts();

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-stone-100">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-stone-400">
            Overview of your scheduled and published content.
          </p>
        </div>
        <Link to="/upload" className="btn-primary">
          <IconUpload className="h-4 w-4" /> New upload
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Pending"
          value={counts.data?.by_status.pending ?? 0}
          tone="neutral"
        />
        <StatCard
          label="Published (7d)"
          value={counts.data?.published_last_7d ?? 0}
          tone="success"
          hint="Last 7 days"
        />
        <StatCard
          label="Failed"
          value={counts.data?.by_status.failed ?? 0}
          tone="warn"
        />
        <StatCard
          label="Accounts"
          value={accounts.data?.length ?? 0}
          tone="brand"
          hint={`${accounts.data?.filter((a) => a.status === 'active').length ?? 0} active`}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <QuotaSection />
        <QuickActions />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <UpcomingList />
        <FailureList />
      </section>
    </div>
  );
}