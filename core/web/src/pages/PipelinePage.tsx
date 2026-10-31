import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../lib/api.js';
import { useAccounts } from '../lib/accounts.js';
import { useToast } from '../components/ui/Toast.js';
import { PostsNav } from '../components/PostsNav.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Button } from '../components/ui/Button.js';
import { PostDetailDrawer } from '../components/PostDetailDrawer.js';
import type { ScheduledPostRow } from '@social-auto/shared';

/** Kanban over post lifecycle — simple words, matching scheduled_posts.status. */
const LANES: { id: string; label: string; statuses: ScheduledPostRow['status'][] }[] = [
  { id: 'queued', label: 'scheduled', statuses: ['pending'] },
  { id: 'airing', label: 'publishing', statuses: ['uploading'] },
  { id: 'aired', label: 'published', statuses: ['published'] },
  { id: 'fault', label: 'failed', statuses: ['failed', 'dead'] },
];

function LaneCard({
  post,
  accountName,
  selected,
  onSelect,
  onClick,
  onRetry,
  onDuplicate,
  busy,
}: {
  post: ScheduledPostRow;
  accountName: string;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onClick: () => void;
  onRetry: () => void;
  onDuplicate: () => void;
  busy: boolean;
}) {
  const fault = post.status === 'failed' || post.status === 'dead';
  return (
    <div
      className={`group relative mx-2.5 border p-3 text-xs ${
        fault
          ? 'border-l-2 border-l-red-500 border-stone-200 bg-brand-50/60 dark:border-stone-800 dark:bg-brand-950/20'
          : 'border-stone-200 bg-surface-muted dark:border-stone-800 dark:bg-[#211d18]/60'
      } ${selected ? 'ring-1 ring-brand-500' : ''}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => { e.stopPropagation(); onSelect(e.target.checked); }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select post"
          className="mt-0.5 shrink-0 accent-brand-600"
        />
        <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
          <div className={`font-mono text-[10px] font-semibold ${fault ? 'text-red-600 dark:text-red-400' : 'text-brand-600 dark:text-brand-100'}`}>
            {dayjs(post.scheduled_at).format('ddd HH:mm')}
          </div>
          <div className="my-1 truncate font-medium text-[13px] text-ink dark:text-stone-100" title={post.caption}>
            {post.caption.split('\n')[0] || '(no caption)'}
          </div>
          <div className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">
            {accountName}
            {fault && post.last_error ? ` · ${post.last_error.slice(0, 60)}` : ''}
            {post.retry_count > 0 ? ` · retry ${post.retry_count}` : ''}
          </div>
        </button>
      </div>
      {/* hover actions */}
      <div className="mt-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        {fault && (
          <Button size="sm" variant="secondary" loading={busy} onClick={(e) => { e.stopPropagation(); onRetry(); }}>
            Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
          Duplicate
        </Button>
      </div>
    </div>
  );
}

export function PipelinePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<ScheduledPostRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const posts = useQuery({
    queryKey: ['schedule', 'pipeline', q],
    queryFn: () => api.listSchedule({ q: q || undefined }),
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
    return m;
  }, [posts.data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['schedule'] });

  const retry = useMutation({
    mutationFn: (id: string) => api.retrySchedule(id),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Retry queued' }); invalidate(); },
    onError: (e) => toast.push({ tone: 'error', title: 'Retry failed', description: e instanceof Error ? e.message : 'unknown_error' }),
  });
  const duplicate = useMutation({
    mutationFn: (p: ScheduledPostRow) =>
      api.createSchedule({
        video_id: p.video_id,
        account_ids: [p.account_id],
        caption: p.caption,
        visibility: p.visibility,
        scheduled_at: Math.max(p.scheduled_at + 24 * 3600_000, Date.now() + 3600_000),
      }),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Post duplicated (+24h)' }); invalidate(); },
    onError: (e) => toast.push({ tone: 'error', title: 'Duplicate failed', description: e instanceof Error ? e.message : 'unknown_error' }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: invalidate,
  });

  const [bulkBusy, setBulkBusy] = useState(false);
  const runBulk = async (action: 'retry' | 'delete') => {
    setBulkBusy(true);
    try {
      for (const id of selected) {
        const p = posts.data?.posts.find((x) => x.id === id);
        if (!p) continue;
        if (action === 'retry' && (p.status === 'failed' || p.status === 'dead')) await retry.mutateAsync(id);
        if (action === 'delete' && p.status === 'pending') await del.mutateAsync(id);
      }
      setSelected(new Set());
      invalidate();
      toast.push({ tone: 'success', title: `Bulk ${action} done` });
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PostsNav />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-ink-subtle dark:text-stone-500">post flow · live</p>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-stone-100">Pipeline</h1>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts…"
          className="w-56 rounded-sm border border-stone-300 bg-surface px-3 py-1.5 text-sm placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none dark:border-stone-700 dark:bg-[#211d18] dark:text-stone-100 dark:placeholder:text-stone-500"
          aria-label="Search posts"
        />
      </header>

      {/* flow strip */}
      <div className="flex items-center gap-2 font-mono text-[11px] text-ink-subtle dark:text-stone-500">
        {LANES.map((l, i) => (
          <span key={l.id} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">→</span>}
            {l.label}
          </span>
        ))}
      </div>

      {/* bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-10 flex items-center gap-3 border border-stone-200 bg-surface px-4 py-2 shadow-float dark:border-stone-800 dark:bg-[#1e1a15]">
          <span className="font-mono text-xs text-ink-muted dark:text-stone-400">{selected.size} selected</span>
          <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => void runBulk('retry')}>Retry all failed</Button>
          <Button size="sm" variant="danger" loading={bulkBusy} onClick={() => void runBulk('delete')}>Cancel pending</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {posts.isLoading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {LANES.map((l) => <Skeleton key={l.id} className="h-64" />)}
        </div>
      ) : posts.isError ? (
        <EmptyState
          title="Couldn't load pipeline"
          description={posts.error instanceof Error ? posts.error.message : 'unknown_error'}
          action={<Button size="sm" onClick={() => void posts.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-4">
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
                  {items.length === 0 && (
                    <p className="px-3 py-2 font-mono text-[10px] text-ink-subtle dark:text-stone-600">empty</p>
                  )}
                  {items.map((p) => (
                    <LaneCard
                      key={p.id}
                      post={p}
                      accountName={accountById.get(p.account_id)?.display_name ?? 'account'}
                      selected={selected.has(p.id)}
                      onSelect={(v) => {
                        const next = new Set(selected);
                        v ? next.add(p.id) : next.delete(p.id);
                        setSelected(next);
                      }}
                      onClick={() => setDetail(p)}
                      onRetry={() => retry.mutate(p.id)}
                      onDuplicate={() => duplicate.mutate(p)}
                      busy={retry.isPending}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {detail && (
        <PostDetailDrawer
          post={detail}
          account={accountById.get(detail.account_id)}
          video={undefined}
          onClose={() => setDetail(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}
