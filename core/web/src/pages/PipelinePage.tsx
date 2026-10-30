import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../lib/api.js';
import { useAccounts } from '../lib/accounts.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Button } from '../components/ui/Button.js';
import type { ScheduledPostRow } from '@social-auto/shared';

/** Kanban over post lifecycle — mirrors scheduled_posts.status:
 *  queued (pending) → airing (uploading) → aired (published) / fault
 *  (failed + dead). `intake` is a videos-side lane, shown once upload
 *  (R2) lands. */
const LANES: { id: string; label: string; statuses: ScheduledPostRow['status'][] }[] = [
  { id: 'queued', label: 'scheduled', statuses: ['pending'] },
  { id: 'airing', label: 'publishing', statuses: ['uploading'] },
  { id: 'aired', label: 'published', statuses: ['published'] },
  { id: 'fault', label: 'failed', statuses: ['failed', 'dead'] },
];

function LaneCard({ post, accountName }: { post: ScheduledPostRow; accountName: string }) {
  const fault = post.status === 'failed' || post.status === 'dead';
  return (
    <div
      className={`mx-2.5 border p-3 text-xs ${
        fault
          ? 'border-l-2 border-l-red-500 border-stone-200 bg-brand-50/60 dark:border-stone-800 dark:bg-brand-950/20'
          : 'border-stone-200 bg-surface-muted dark:border-stone-800 dark:bg-[#211d18]/60'
      }`}
    >
      <div className={`font-mono text-[10px] font-semibold ${fault ? 'text-red-600 dark:text-red-400' : 'text-brand-600 dark:text-brand-100'}`}>
        {dayjs(post.scheduled_at).format('ddd HH:mm')}
      </div>
      <div className="my-1 truncate font-medium text-[13px] text-ink dark:text-stone-100" title={post.caption}>
        {post.caption.split('\n')[0] || '(no caption)'}
      </div>
      <div className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">
        {accountName}
        {fault && post.last_error ? ` · ${post.last_error}` : ''}
        {post.retry_count > 0 ? ` · retry ${post.retry_count}` : ''}
      </div>
    </div>
  );
}

export function PipelinePage() {
  const posts = useQuery({
    queryKey: ['schedule', 'pipeline'],
    queryFn: () => api.listSchedule({}),
    refetchInterval: 15_000,
    retry: 1,
  });
  const accounts = useAccounts();
  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );
  const byLane = useMemo(() => {
    const m = new Map<string, ScheduledPostRow[]>();
    for (const lane of LANES) m.set(lane.id, []);
    for (const p of posts.data?.posts ?? []) {
      const lane = LANES.find((l) => l.statuses.includes(p.status));
      if (lane) m.get(lane.id)!.push(p);
    }
    for (const lane of LANES) {
      m.get(lane.id)!.sort((a, b) => a.scheduled_at - b.scheduled_at);
    }
    return m;
  }, [posts.data]);

  return (
    <div className="space-y-4">
      <header className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <p className="font-mono text-[11px] text-ink-subtle dark:text-stone-500">post flow · live</p>
        <h1 className="font-display text-2xl font-bold text-ink dark:text-stone-100">Pipeline</h1>
      </header>

      <div className="flex justify-around font-mono text-[10px] text-ink-subtle dark:text-stone-500">
        {LANES.map((l, i) => (
          <span key={l.id} className="relative flex-1 text-center">
            {l.label}
            {i < LANES.length - 1 && <span className="absolute -right-1.5 text-stone-300 dark:text-stone-700">→</span>}
          </span>
        ))}
      </div>

      {posts.isLoading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {LANES.map((l) => <Skeleton key={l.id} className="h-64 w-full" />)}
        </div>
      ) : posts.isError ? (
        <EmptyState
          title="Couldn't load pipeline"
          description={posts.error instanceof Error ? posts.error.message : 'unknown_error'}
          action={<Button size="sm" onClick={() => void posts.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-4">
          {LANES.map((lane) => {
            const items = byLane.get(lane.id) ?? [];
            return (
              <section
                key={lane.id}
                className="min-h-[20rem] border border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]"
                aria-label={lane.label}
              >
                <header className="flex items-center justify-between border-b border-stone-200 bg-surface-muted px-3 py-2 dark:border-stone-800 dark:bg-[#211d18]/60">
                  <span className={`text-xs font-semibold capitalize ${lane.id === 'fault' ? 'text-red-600 dark:text-red-400' : 'text-ink dark:text-stone-100'}`}>
                    {lane.label}
                  </span>
                  <span className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">{items.length}</span>
                </header>
                <div className="space-y-2.5 py-2.5">
                  {items.map((p) => (
                    <LaneCard
                      key={p.id}
                      post={p}
                      accountName={accountById.get(p.account_id)?.display_name ?? p.account_id.slice(0, 8)}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="px-3 py-2 text-[11px] text-ink-subtle dark:text-stone-500">empty</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PipelinePage;
