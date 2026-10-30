import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  api,
  type CreateScheduleInput,
  type UpdateScheduleInput,
  type VideoWire,
} from '../lib/api.js';
import type { Platform, ScheduledPostRow } from '@social-auto/shared';
import { useAccounts, type AccountInfo } from '../lib/accounts.js';
import { Button } from '../components/ui/Button.js';
import { Field, Select, TextArea } from '../components/ui/Field.js';
import { Badge } from '../components/ui/Badge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Modal } from '../components/ui/Modal.js';
import { useToast } from '../components/ui/Toast.js';
import { track } from '../lib/telemetry.js';

type ViewMode = 'week' | 'month';

/** Left border + dot color per platform — status is shown via Badge inside
 *  the detail modal, so chips differentiate by platform only. */
const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'border-red-500 bg-red-50 dark:bg-red-950/40',
  tiktok: 'border-stone-800 bg-stone-100 dark:bg-stone-800/60',
  instagram: 'border-pink-500 bg-pink-50 dark:bg-pink-950/40',
  facebook: 'border-blue-700 bg-blue-50 dark:bg-blue-950/40',
};

const STATUS_TONES: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  pending: 'warn',
  uploading: 'neutral',
  published: 'success',
  failed: 'danger',
  dead: 'danger',
};

interface Filters {
  platform: '' | Platform;
  account_id: string;
  status: string;
}

/** Calendar range for the current view — month needs the full 6-week grid
 *  so boundary weeks fetch correctly. */
function rangeFor(view: ViewMode, anchor: dayjs.Dayjs): { from: number; to: number } {
  if (view === 'week') {
    return {
      from: anchor.startOf('week').valueOf(),
      to: anchor.endOf('week').valueOf(),
    };
  }
  return {
    from: anchor.startOf('month').startOf('week').valueOf(),
    to: anchor.endOf('month').endOf('week').valueOf(),
  };
}

function PostChip({
  post,
  account,
  onClick,
}: {
  post: ScheduledPostRow;
  account: AccountInfo | undefined;
  onClick: () => void;
}) {
  const platform = account?.platform ?? '';
  const statusStyle: Record<string, string> = {
    pending: 'text-ink-muted dark:text-stone-400',
    uploading: 'text-amber-600 dark:text-amber-400',
    published: 'text-emerald-600 dark:text-emerald-400',
    failed: 'text-red-600 dark:text-red-400',
    dead: 'text-stone-500 line-through dark:text-stone-500',
  };
  return (
    <button
      type="button"
      draggable={post.status === 'pending'}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/post-id', post.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${account?.display_name ?? ''} — ${post.caption.split('\n')[0]}`}
      className={`block w-full border-l-2 px-1.5 py-1 text-left text-[11px] leading-tight ${PLATFORM_COLORS[platform] ?? 'border-stone-300 bg-surface-muted dark:border-stone-700 dark:bg-stone-800/60'} ${post.status === 'dead' ? 'opacity-60' : ''} ${post.status === 'pending' ? 'cursor-grab' : 'cursor-pointer'}`}
    >
      <span className="font-mono font-semibold text-ink dark:text-stone-100">{dayjs(post.scheduled_at).format('HH:mm')}</span>{' '}
      <span className="capitalize text-ink-muted dark:text-stone-400">{platform || 'platform'}</span>
      <span className="mt-0.5 block truncate text-ink dark:text-stone-200">{post.caption.split('\n')[0] || '(no caption)'}</span>
      <span className={`mt-0.5 block font-mono text-[10px] ${statusStyle[post.status] ?? statusStyle.pending}`}>{post.status}</span>
    </button>
  );
}


function DayCell({
  date,
  posts,
  accountById,
  inMonth,
  onDayClick,
  onPostClick,
  onDropPost,
}: {
  date: dayjs.Dayjs;
  posts: ScheduledPostRow[];
  accountById: Map<string, AccountInfo>;
  inMonth: boolean;
  onDayClick: (d: dayjs.Dayjs) => void;
  onPostClick: (p: ScheduledPostRow) => void;
  onDropPost: (postId: string, day: dayjs.Dayjs) => void;
}) {
  const isToday = date.isSame(dayjs(), 'day');
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={date.format('dddd, MMM D')}
      onClick={() => onDayClick(date)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDayClick(date);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/post-id');
        if (id) onDropPost(id, date);
      }}
      className={`flex min-h-[6.5rem] flex-col gap-1 border-b border-r border-stone-200 p-1.5 text-left align-top dark:border-stone-800 ${
        inMonth ? 'bg-surface dark:bg-[#211d18]' : 'bg-surface-muted/40 text-ink-subtle dark:bg-[#211d18]/40'
      } ${over ? 'bg-brand-50 dark:bg-brand-950/30' : ''} transition-colors hover:bg-surface-muted/50 dark:hover:bg-stone-800/40`}
    >
      <div className={`font-mono text-xs ${isToday ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : 'text-ink-muted dark:text-stone-400'}`}>
        {date.date()}
      </div>
      <div className="flex flex-col gap-1">
        {posts.slice(0, 4).map((p) => (
          <PostChip key={p.id} post={p} account={accountById.get(p.account_id)} onClick={() => onPostClick(p)} />
        ))}
        {posts.length > 4 && (
          <span className="px-1 text-[10px] text-ink-subtle dark:text-stone-500">+{posts.length - 4} more</span>
        )}
      </div>
    </div>
  );
}

function QuickScheduleModal({
  date,
  accounts,
  videos,
  onClose,
  onCreated,
}: {
  date: dayjs.Dayjs;
  accounts: AccountInfo[];
  videos: VideoWire[] | undefined;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [videoId, setVideoId] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [time, setTime] = useState(date.hour(12).minute(0).format('YYYY-MM-DDTHH:mm'));
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('private');

  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const create = useMutation({
    mutationFn: (body: CreateScheduleInput) => api.createSchedule(body),
    onSuccess: () => {
      track('schedule post', { surface: 'calendar' });
      toast.push({ tone: 'success', title: 'Scheduled' });
      onCreated();
      onClose();
    },
    onError: (err) =>
      toast.push({ tone: 'error', title: 'Schedule failed', description: err instanceof Error ? err.message : 'unknown_error' }),
  });

  const canSubmit = videoId && accountIds.length > 0 && caption.trim() && !create.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Schedule — ${date.format('ddd, MMM D')}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={() =>
              create.mutate({
                video_id: videoId,
                account_ids: accountIds,
                scheduled_at: new Date(time).getTime(),
                caption,
                visibility,
              })
            }
          >
            Schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Video" required>
          {videos && videos.length > 0 ? (
            <Select value={videoId} onChange={(e) => setVideoId(e.target.value)}>
              <option value="">Select a video…</option>
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.filename}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm text-ink-muted dark:text-stone-400">
              No videos uploaded yet — upload one first from the Upload page.
            </p>
          )}
        </Field>
        <Field label="Accounts" required hint="One post is created per selected account.">
          <div className="flex flex-wrap gap-2">
            {activeAccounts.map((a) => {
              const on = accountIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setAccountIds((ids) => (on ? ids.filter((x) => x !== a.id) : [...ids, a.id]))
                  }
                  className={`rounded border px-2.5 py-1 text-xs font-medium capitalize ${
                    on
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-stone-300 text-ink-muted hover:bg-surface-muted dark:border-stone-700 dark:text-stone-400'
                  }`}
                >
                  {a.platform} · {a.display_name}
                </button>
              );
            })}
            {activeAccounts.length === 0 && (
              <p className="text-sm text-ink-muted dark:text-stone-400">Connect an account first.</p>
            )}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Publish at" required>
            <input
              type="datetime-local"
              className="input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Visibility">
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </Select>
          </Field>
        </div>
        <Field label="Caption" required>
          <TextArea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} maxLength={5000} />
        </Field>
      </div>
    </Modal>
  );
}

function PostDetailModal({
  post,
  account,
  video,
  onClose,
  onChanged,
}: {
  post: ScheduledPostRow;
  account: AccountInfo | undefined;
  video: VideoWire | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [time, setTime] = useState(dayjs(post.scheduled_at).format('YYYY-MM-DDTHH:mm'));
  const [visibility, setVisibility] = useState(post.visibility);

  const update = useMutation({
    mutationFn: (patch: UpdateScheduleInput) => api.updateSchedule(post.id, patch),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Updated' });
      onChanged();
      onClose();
    },
    onError: (err) =>
      toast.push({ tone: 'error', title: 'Update failed', description: err instanceof Error ? err.message : 'unknown_error' }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteSchedule(post.id),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Post cancelled' });
      onChanged();
      onClose();
    },
    onError: (err) =>
      toast.push({ tone: 'error', title: 'Cancel failed', description: err instanceof Error ? err.message : 'unknown_error' }),
  });

  const pending = post.status === 'pending';
  const actions = (
    <>
      {pending && !editing && (
            <>
              <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
                Cancel post
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>Back</Button>
              <Button
                loading={update.isPending}
                onClick={() =>
                  update.mutate({
                    caption,
                    scheduled_at: new Date(time).getTime(),
                    visibility,
                  })
                }
              >
                Save
              </Button>
            </>
          )}
          {!pending && !editing && <Button variant="secondary" onClick={onClose}>Close</Button>}
        </>
  );
  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30 dark:bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="Scheduled post"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-stone-200 bg-surface shadow-float dark:border-stone-800 dark:bg-[#211d18]"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <h2 className="font-display text-base font-semibold text-ink dark:text-stone-100">Scheduled post</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink dark:text-stone-400 dark:hover:text-stone-100">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
      {editing ? (
        <div className="space-y-4">
          <Field label="Caption">
            <TextArea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} maxLength={5000} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Publish at">
              <input type="datetime-local" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Visibility">
              <Select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                <option value="private">private</option>
                <option value="unlisted">unlisted</option>
                <option value="public">public</option>
              </Select>
            </Field>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONES[post.status] ?? 'neutral'}>{post.status}</Badge>
            <span className="text-xs text-ink-muted dark:text-stone-400">{post.visibility}</span>
          </div>
          <dl className="space-y-1.5">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-subtle dark:text-stone-500">When</dt>
              <dd className="font-mono">{dayjs(post.scheduled_at).format('ddd, MMM D · HH:mm')}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-subtle dark:text-stone-500">Account</dt>
              <dd className="capitalize">{account ? `${account.platform} — ${account.display_name}` : post.account_id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-subtle dark:text-stone-500">Video</dt>
              <dd>{video?.filename ?? post.video_id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-subtle dark:text-stone-500">Caption</dt>
              <dd className="whitespace-pre-wrap break-words">{post.caption || '—'}</dd>
            </div>
            {post.last_error && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-ink-subtle dark:text-stone-500">Error</dt>
                <dd className="text-red-600 dark:text-red-400">{post.last_error}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3 dark:border-stone-800">
          {actions}
        </div>
      </aside>
    </>
  );
}

export function CalendarPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(() => dayjs());
  const [filters, setFilters] = useState<Filters>({ platform: '', account_id: '', status: '' });
  const [dayModal, setDayModal] = useState<dayjs.Dayjs | null>(null);
  const [postModal, setPostModal] = useState<ScheduledPostRow | null>(null);

  const accounts = useAccounts();
  const videos = useQuery({
    queryKey: ['videos'],
    queryFn: () => api.listVideos(),
    retry: 1,
  });

  const range = rangeFor(view, anchor);
  const scheduleQuery = useQuery({
    queryKey: ['schedule', view, range.from, range.to, filters.account_id, filters.status],
    queryFn: () =>
      api.listSchedule({
        from: range.from,
        to: range.to,
        account_id: filters.account_id || undefined,
        status: filters.status || undefined,
      }),
    refetchInterval: 60_000,
    retry: 1,
  });

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );
  const videoById = useMemo(
    () => new Map((videos.data?.videos ?? []).map((v) => [v.id, v] as const)),
    [videos.data],
  );

  // Platform filter happens client-side — the API filters by account_id and
  // status; mapping platform → account ids keeps it one indexed query.
  const posts = useMemo(() => {
    const all = scheduleQuery.data?.posts ?? [];
    if (!filters.platform) return all;
    return all.filter((p) => accountById.get(p.account_id)?.platform === filters.platform);
  }, [scheduleQuery.data, filters.platform, accountById]);

  const postsByDay = useMemo(() => {
    const m = new Map<string, ScheduledPostRow[]>();
    for (const p of posts) {
      const key = dayjs(p.scheduled_at).format('YYYY-MM-DD');
      const arr = m.get(key) ?? [];
      arr.push(p);
      arr.sort((a, b) => a.scheduled_at - b.scheduled_at);
      m.set(key, arr);
    }
    return m;
  }, [posts]);

  // Native drag-drop move: drop a chip on a day → same time-of-day, new date.
  const move = useMutation({
    mutationFn: ({ id, at }: { id: string; at: number }) => api.updateSchedule(id, { scheduled_at: at }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['schedule'] }),
  });
  const onDropPost = (postId: string, day: dayjs.Dayjs): void => {
    const post = posts.find((p) => p.id === postId);
    if (!post || post.status !== 'pending') return;
    const t = dayjs(post.scheduled_at);
    move.mutate({
      id: postId,
      at: day.hour(t.hour()).minute(t.minute()).second(0).millisecond(0).valueOf(),
    });
  };

  const days: dayjs.Dayjs[] = useMemo(() => {
    if (view === 'week') {
      return Array.from({ length: 7 }, (_, i) => anchor.startOf('week').add(i, 'day'));
    }
    const start = anchor.startOf('month').startOf('week');
    return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
  }, [view, anchor]);

  const step = (dir: -1 | 1): void =>
    setAnchor((a) => (view === 'week' ? a.add(dir * 7, 'day') : a.add(dir, 'month')));

  const inCurrentMonth = (d: dayjs.Dayjs): boolean => view === 'week' || d.month() === anchor.month();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
        <div>
          <p className="font-mono text-[11px] text-ink-subtle dark:text-stone-500">content schedule</p>
          <h1 className="font-display text-2xl font-bold text-ink dark:text-stone-100">
            {view === 'week'
              ? `${days[0]!.format('MMM D')} – ${days[6]!.format('MMM D, YYYY')}`
              : anchor.format('MMMM YYYY')}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAnchor(dayjs())}>
            Today
          </Button>
          <Button size="sm" variant="ghost" onClick={() => step(-1)} aria-label="Previous">
            ←
          </Button>
          <Button size="sm" variant="ghost" onClick={() => step(1)} aria-label="Next">
            →
          </Button>
          <div role="group" aria-label="View" className="inline-flex rounded border border-stone-300 dark:border-stone-700">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1.5 text-xs font-medium capitalize ${
                  view === v
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface text-ink-muted hover:bg-surface-muted dark:bg-[#211d18] dark:text-stone-400'
                } ${v === 'month' ? 'border-l border-stone-300 dark:border-stone-700' : ''}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.platform}
          onChange={(e) => setFilters((f) => ({ ...f, platform: e.target.value as Filters['platform'] }))}
          aria-label="Filter by platform"
        >
          <option value="">All platforms</option>
          <option value="youtube">YouTube</option>
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
        </Select>
        <Select
          value={filters.account_id}
          onChange={(e) => setFilters((f) => ({ ...f, account_id: e.target.value }))}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.platform} — {a.display_name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONES).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {/* weekday header row — week view shows weekday + date */}
      <div className="grid grid-cols-7 border-x border-t border-stone-200 text-center font-mono text-[11px] text-ink-subtle dark:border-stone-800 dark:text-stone-500">
        {view === 'week'
          ? days.map((d) => (
              <div key={d.format('DD')} className="border-b border-r border-stone-200 py-1.5 last:border-r-0 dark:border-stone-800">
                <span className="capitalize">{d.format('ddd D')}</span>
              </div>
            ))
          : ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => (
              <div key={d} className="border-b border-r border-stone-200 py-1.5 last:border-r-0 dark:border-stone-800">
                {d}
              </div>
            ))}
      </div>

      {scheduleQuery.isLoading ? (
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: view === 'week' ? 7 : 35 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : scheduleQuery.isError ? (
        <EmptyState
          icon={<span>!</span>}
          title="Couldn't load schedule"
          description={scheduleQuery.error instanceof Error ? scheduleQuery.error.message : 'unknown_error'}
          action={<Button size="sm" onClick={() => void scheduleQuery.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="grid grid-cols-7">
          {days.map((d) => (
            <DayCell
              key={d.format('YYYY-MM-DD')}
              date={d}
              posts={postsByDay.get(d.format('YYYY-MM-DD')) ?? []}
              accountById={accountById}
              inMonth={inCurrentMonth(d)}
              onDayClick={(day) => setDayModal(day)}
              onPostClick={(p) => setPostModal(p)}
              onDropPost={onDropPost}
            />
          ))}
        </div>
      )}

      {!scheduleQuery.isLoading && posts.length === 0 && !scheduleQuery.isError && (
        <p className="text-center text-sm text-ink-muted dark:text-stone-400">
          Nothing scheduled — click a day to create a post.
        </p>
      )}

      {dayModal && (
        <QuickScheduleModal
          date={dayModal}
          accounts={accounts.data ?? []}
          videos={videos.data?.videos}
          onClose={() => setDayModal(null)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['schedule'] })}
        />
      )}
      {postModal && (
        <PostDetailModal
          post={postModal}
          account={accountById.get(postModal.account_id)}
          video={videoById.get(postModal.video_id)}
          onClose={() => setPostModal(null)}
          onChanged={() => void qc.invalidateQueries({ queryKey: ['schedule'] })}
        />
      )}
    </div>
  );
}

export default CalendarPage;
