import { IconSchedule } from '../components/icons.js';
import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ScheduledPostRow } from '@social-auto/shared';
import { api } from '../lib/api.js';
import { useAccounts } from '../lib/accounts.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge, statusToTone } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { SkeletonRow } from '../components/ui/Skeleton.js';
import { Field, Select, TextArea } from '../components/ui/Field.js';
import { useToast } from '../components/ui/Toast.js';
import type { AccountInfo } from '../lib/accounts.js';

type StatusFilter = 'all' | 'pending' | 'uploading' | 'published' | 'failed' | 'dead';

const STATUSES: StatusFilter[] = ['all', 'pending', 'uploading', 'published', 'failed', 'dead'];

// Component to show upload progress for uploading posts
function UploadProgressRow({ post }: { post: ScheduledPostRow }) {
  const [progress, setProgress] = useState<number>(0);
  const [cancelling, setCancelling] = useState<boolean>(false);
  const toast = useToast();
  
  useEffect(() => {
    // Poll for progress updates using video_id from the post
    const interval = setInterval(async () => {
      try {
        const progressData = await api.getUploadProgress(post.video_id);
        setProgress(progressData.progress);
        if (progressData.progress >= 100) {
          clearInterval(interval);
        }
      } catch (error) {
        // Progress endpoint might not be available yet
        console.warn('Failed to fetch progress:', error);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [post.video_id]);
  
  const handleCancel = async () => {
    setCancelling(true);
    try {
      // For now, this is a placeholder - actual cancellation requires
      // backend integration with the upload stream
      toast.push({
        tone: 'info',
        title: 'Cancel upload feature coming soon',
      });
    } catch (error) {
      console.error('Failed to cancel upload:', error);
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      toast.push({
        tone: 'error',
        title: 'Failed to cancel upload',
        description: message,
      });
    } finally {
      setCancelling(false);
    }
  };
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-ink-muted dark:text-stone-400">
        <span>Uploading...</span>
        <div className="flex items-center gap-2">
          <span>{progress.toFixed(0)}%</span>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs text-red-600 hover:text-red-700 disabled:text-stone-400 disabled:cursor-not-allowed"
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-stone-200 dark:bg-stone-800">
        <div
          className="h-full bg-brand-600 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function SchedulePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);

  const accounts = useAccounts();
  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );

  const posts = useQuery({
    queryKey: ['schedule', filter, accountFilter],
    queryFn: () =>
      api.listSchedule({
        status: filter === 'all' ? undefined : filter,
        account_id: accountFilter || undefined,
      }),
    refetchInterval: 10_000,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.push({ tone: 'success', title: 'Post deleted' });
    },
    onError: (err) =>
      toast.push({ tone: 'error', title: 'Delete failed', description: err.message }),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { caption?: string; scheduled_at?: number };
    }) => api.updateSchedule(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      setEditing(null);
      toast.push({ tone: 'success', title: 'Saved' });
    },
    onError: (err) =>
      toast.push({ tone: 'error', title: 'Save failed', description: err.message }),
  });

  const grouped = groupByDay(posts.data?.posts ?? []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-stone-100">Schedule</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-stone-400">
            Upcoming and recent posts. Edit pending ones; published posts are read-only.
          </p>
        </div>
      </header>

      <Card>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Status">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as StatusFilter)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account">
            <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
              <option value="">All accounts</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform} — {a.display_name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {posts.isLoading ? (
        <SkeletonRow count={4} />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={<IconSchedule className="h-6 w-6" />}
          title="No posts to show"
          description={
            filter === 'all' && !accountFilter
              ? 'Use Upload & Schedule to create your first post.'
              : 'Try changing the filters above.'
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted dark:text-stone-400">
                {day}
              </h2>
              <div className="space-y-2">
                {list.map((p) => (
                  <ScheduleRow
                    key={p.id}
                    post={p}
                    account={accountById.get(p.account_id)}
                    isEditing={editing === p.id}
                    onStartEdit={() => setEditing(p.id)}
                    onCancelEdit={() => setEditing(null)}
                    onSave={(patch) => update.mutate({ id: p.id, patch })}
                    onDelete={() => del.mutate(p.id)}
                    saving={update.isPending && update.variables?.id === p.id}
                    deleting={del.isPending && del.variables === p.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  post,
  account,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  post: ScheduledPostRow;
  account: AccountInfo | undefined;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { caption: string; scheduled_at: number }) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  if (isEditing) {
    return (
      <EditRow
        initialCaption={post.caption}
        initialScheduledAt={post.scheduled_at}
        onCancel={onCancelEdit}
        onSave={onSave}
        saving={saving}
      />
    );
  }

  const accountLabel = account
    ? `${account.platform} — ${account.display_name}`
    : post.account_id.slice(0, 8);

  return (
    <Card>
      <CardBody className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink dark:text-stone-100">
              {dayjs(post.scheduled_at).format('HH:mm')}
            </span>
            <Badge tone={statusToTone(post.status)}>{post.status}</Badge>
            <span className="text-xs text-ink-muted dark:text-stone-400">
              {post.visibility}
            </span>
            {post.retry_count > 0 && (
              <Badge tone="warn">retry {post.retry_count}</Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-ink dark:text-stone-200">
            {post.caption.split('\n')[0] || '(no caption)'}
          </p>
          <p className="mt-1 text-xs text-ink-muted dark:text-stone-400">
            {accountLabel}
            {post.external_post_id && ` · ${post.external_post_id}`}
            {post.last_error && ` · ${post.last_error}`}
          </p>
          {post.status === 'uploading' && (
            <UploadProgressRow post={post} />
          )}
        </div>
        {post.status === 'pending' && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onStartEdit}>
              Edit
            </Button>
            <Button size="sm" variant="danger" loading={deleting} onClick={onDelete}>
              Delete
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EditRow({
  initialCaption,
  initialScheduledAt,
  onCancel,
  onSave,
  saving,
}: {
  initialCaption: string;
  initialScheduledAt: number;
  onCancel: () => void;
  onSave: (patch: { caption: string; scheduled_at: number }) => void;
  saving: boolean;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const [time, setTime] = useState(dayjs(initialScheduledAt).format('YYYY-MM-DDTHH:mm'));
  return (
    <Card>
      <CardBody className="space-y-3">
        <Field label="Caption">
          <TextArea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scheduled at">
            <input
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="input"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                caption,
                scheduled_at: new Date(time).getTime(),
              })
            }
            loading={saving}
          >
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function groupByDay(posts: ScheduledPostRow[]): [string, ScheduledPostRow[]][] {
  const out = new Map<string, ScheduledPostRow[]>();
  for (const p of posts) {
    const day = dayjs(p.scheduled_at).format('YYYY-MM-DD ddd');
    out.set(day, [...(out.get(day) ?? []), p]);
  }
  return [...out.entries()];
}