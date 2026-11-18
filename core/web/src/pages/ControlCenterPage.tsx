import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, fetchVideoThumbnail } from '../lib/api.js';
import type { PublishingJob, PublishingJobPost } from '../lib/api.js';
import { useToast } from '../components/ui/Toast.js';
import { PostsNav } from '../components/PostsNav.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Button } from '../components/ui/Button.js';
import { Badge, statusToTone } from '../components/ui/Badge.js';

/** Classified failure → plain-language reason (backend error_class). */
const ERROR_REASON: Record<string, string> = {
  token_expired: 'token expired — reconnect the account',
  invalid_video: 'platform rejected the video',
  missing_permission: 'missing permission on the account',
  rate_limited: 'platform rate limit hit',
  duplicate: 'already posted on this account',
  transient: 'temporary platform error',
};

const STATUS_LABEL: Record<PublishingJobPost['status'], string> = {
  draft: 'Draft',
  pending: 'Queued',
  uploading: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  dead: 'Dead',
};

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function fmtDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Authenticated thumbnail → object URL. Revoked on unmount. */
function useThumbUrl(videoId: string, hasThumbnail: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasThumbnail) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void fetchVideoThumbnail(videoId).then((u) => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      objectUrl = u;
      setUrl(u);
    });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [videoId, hasThumbnail]);
  return url;
}

function JobRow({
  post,
  onRetry,
  retryBusy,
}: {
  post: PublishingJobPost;
  onRetry: (id: string) => void;
  retryBusy: boolean;
}) {
  const fault = post.status === 'failed' || post.status === 'dead';
  const reason = post.error_class ? ERROR_REASON[post.error_class] ?? post.error_class : null;
  const retryIn = post.status === 'pending' && post.next_retry_at && post.next_retry_at > Date.now()
    ? post.next_retry_at - Date.now()
    : null;

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 ${
        fault ? 'border-l-2 border-l-red-500 bg-red-50/40 dark:bg-red-500/5' : ''
      }`}
    >
      <img src={`/icons/${post.platform}.svg`} alt="" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium capitalize text-ink dark:text-stone-100">{post.platform}</span>
          <span className="truncate font-mono text-[11px] text-ink-subtle dark:text-stone-500">
            {post.account_name}
            {post.channel_handle ? ` · ${post.channel_handle}` : ''}
          </span>
        </div>
        {fault && (
          <p className="mt-0.5 font-mono text-[11px] text-red-600 dark:text-red-400">
            {reason ?? 'unknown failure'}
            {post.last_error ? ` — ${post.last_error.slice(0, 120)}` : ''}
          </p>
        )}
        {post.status === 'pending' && retryIn !== null && (
          <p className="mt-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-300">
            retry {post.retry_count} in ~{Math.max(1, Math.round(retryIn / 60_000))}m
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={statusToTone(post.status)}>{STATUS_LABEL[post.status]}</Badge>
        <span className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">
          {dayjs(post.status === 'published' ? post.updated_at : post.scheduled_at).format('MMM D HH:mm')}
        </span>
        {fault && (
          <Button size="sm" variant="secondary" loading={retryBusy} onClick={() => onRetry(post.id)}>
            Retry
          </Button>
        )}
        {post.error_class === 'token_expired' && (
          <Link to="/accounts" className="font-mono text-[11px] text-brand-600 underline hover:text-brand-700 dark:text-brand-100">
            reconnect
          </Link>
        )}
      </div>
    </div>
  );
}

function JobCard({ job, onRetry, retryBusy }: { job: PublishingJob; onRetry: (id: string) => void; retryBusy: boolean }) {
  const thumb = useThumbUrl(job.video.id, job.video.has_thumbnail);
  const live = job.counts.published;
  const failedN = job.counts.failed + job.counts.dead;
  const total = job.posts.length;
  const duration = fmtDuration(job.video.duration_sec);

  return (
    <article className="border border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]">
      <header className="flex items-center gap-3 border-b border-stone-200 px-3 py-2.5 dark:border-stone-800">
        <div className="h-11 w-[4.5rem] shrink-0 overflow-hidden bg-stone-200 dark:bg-stone-800">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink dark:text-stone-100" title={job.video.filename}>
            {job.video.filename}
          </h2>
          <p className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">
            {[duration, fmtBytes(job.video.size_bytes), `${total} target${total === 1 ? '' : 's'}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-[11px]">
          <span className={failedN ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'}>
            {live}/{total} published
          </span>
          <p className="text-[10px] text-ink-subtle dark:text-stone-500">
            {dayjs(job.last_activity_at).format('MMM D HH:mm')}
          </p>
        </div>
      </header>
      <div className="divide-y divide-stone-100 dark:divide-stone-800/60">
        {job.posts.map((p) => (
          <JobRow key={p.id} post={p} onRetry={onRetry} retryBusy={retryBusy} />
        ))}
      </div>
    </article>
  );
}

type Filter = 'all' | 'attention' | 'inflight' | 'done';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'all jobs' },
  { id: 'attention', label: 'needs attention' },
  { id: 'inflight', label: 'in flight' },
  { id: 'done', label: 'fully published' },
];

export function ControlCenterPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');

  const jobs = useQuery({
    queryKey: ['publishing', 'jobs'],
    queryFn: () => api.publishingJobs(),
    refetchInterval: 10_000,
    retry: 1,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.retrySchedule(id),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Retry queued' });
      void qc.invalidateQueries({ queryKey: ['publishing'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (e) =>
      toast.push({ tone: 'error', title: 'Retry failed', description: e instanceof Error ? e.message : 'unknown_error' }),
  });

  const filtered = useMemo(() => {
    const all = jobs.data?.jobs ?? [];
    switch (filter) {
      case 'attention':
        return all.filter((j) => j.counts.failed + j.counts.dead > 0);
      case 'inflight':
        return all.filter((j) => j.counts.pending + j.counts.uploading > 0);
      case 'done':
        return all.filter((j) => j.posts.length > 0 && j.counts.published === j.posts.length);
      default:
        return all;
    }
  }, [jobs.data, filter]);

  const attentionCount = useMemo(
    () => (jobs.data?.jobs ?? []).filter((j) => j.counts.failed + j.counts.dead > 0).length,
    [jobs.data],
  );

  return (
    <div className="space-y-4">
      <PostsNav />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-ink-subtle dark:text-stone-500">one video → every platform</p>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-stone-100">Publishing Control</h1>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Filter jobs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                filter === f.id
                  ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100'
                  : 'border-stone-200 text-ink-muted hover:text-ink dark:border-stone-700 dark:text-stone-400 dark:hover:text-stone-100'
              }`}
            >
              {f.label}
              {f.id === 'attention' && attentionCount > 0 ? ` (${attentionCount})` : ''}
            </button>
          ))}
        </div>
      </header>

      {jobs.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : jobs.isError ? (
        <EmptyState
          title="Couldn't load publishing jobs"
          description={jobs.error instanceof Error ? jobs.error.message : 'unknown_error'}
          action={<Button size="sm" onClick={() => void jobs.refetch()}>Retry</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No publishing jobs yet' : `No jobs in “${FILTERS.find((f) => f.id === filter)?.label}”`}
          description={
            filter === 'all'
              ? 'Upload a video, pick accounts, and schedule — every platform target lands here.'
              : 'Try a different filter.'
          }
          action={
            filter === 'all' ? (
              <Link to="/posts/new">
                <Button size="sm">New post</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <JobCard key={job.video.id} job={job} onRetry={(id) => retry.mutate(id)} retryBusy={retry.isPending} />
          ))}
        </div>
      )}
    </div>
  );
}
