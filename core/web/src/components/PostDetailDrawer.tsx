import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, type UpdateScheduleInput, type VideoWire } from '../lib/api.js';
import type { AccountInfo } from '../lib/accounts.js';
import { useToast } from './ui/Toast.js';
import { Button } from './ui/Button.js';
import { Badge } from './ui/Badge.js';
import { Field, Select, TextArea } from './ui/Field.js';
import type { ScheduledPostRow } from '@social-auto/shared';

const STATUS_TONES: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  pending: 'warn',
  uploading: 'neutral',
  published: 'success',
  failed: 'danger',
  dead: 'danger',
};

export function PostDetailDrawer({
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
  const draft = post.status === 'draft';
  const editable = pending || draft;
  const actions = (
    <>
      {draft && !editing && (
        <Button onClick={() => setEditing(true)}>Schedule post</Button>
      )}
      {editable && !editing && (
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
