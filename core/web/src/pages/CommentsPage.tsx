import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { PostsNav } from '../components/PostsNav.js';
import { api, type CommentRow } from '../lib/api.js';
import { useToast } from '../components/ui/Toast.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { SkeletonRow } from '../components/ui/Skeleton.js';
import { Select, TextInput } from '../components/ui/Field.js';
import { IconYouTube, IconTikTok, IconInstagram, IconFacebook } from '../components/icons.js';
import { IconSend } from '@tabler/icons-react';
import type { Platform } from '@social-auto/shared';

const PLATFORM_ICON: Record<Platform, JSX.Element> = {
  youtube: <IconYouTube className="h-4 w-4" />,
  tiktok: <IconTikTok className="h-4 w-4" />,
  instagram: <IconInstagram className="h-4 w-4" />,
  facebook: <IconFacebook className="h-4 w-4" />,
};

const STATUS_LABEL: Record<CommentRow['reply_status'], string> = {
  none: 'Unanswered',
  auto: 'Auto-replied',
  manual: 'Replied',
  failed: 'Reply failed',
};

const STATUS_TONE: Record<CommentRow['reply_status'], 'neutral' | 'success' | 'danger'> = {
  none: 'neutral',
  auto: 'success',
  manual: 'success',
  failed: 'danger',
};

function ReplyBox({ comment }: { comment: CommentRow }): JSX.Element {
  const toast = useToast();
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const reply = useMutation({
    mutationFn: () => api.replyComment(comment.id, text.trim()),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Reply sent' });
      void qc.invalidateQueries({ queryKey: ['comments'] });
    },
    onError: () => toast.push({ tone: 'error', title: 'Reply failed' }),
  });
  if (comment.reply_status === 'auto' || comment.reply_status === 'manual') {
    return (
      <p className="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-sm text-ink-muted dark:bg-stone-800 dark:text-stone-300">
        <span className="font-medium">You:</span> {comment.reply_text}
      </p>
    );
  }
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) reply.mutate();
      }}
    >
      <input
        className="input flex-1"
        placeholder="Write a reply…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={reply.isPending || !text.trim()}>
        <IconSend className="h-4 w-4" />
      </Button>
    </form>
  );
}

function AutoReplyCard({ accountId, name, platform, enabled, template }: {
  accountId: string;
  name: string;
  platform: Platform;
  enabled: boolean;
  template: string;
}): JSX.Element {
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [tpl, setTpl] = useState(template);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.setAutoReply(accountId, on, tpl),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Auto-reply saved' });
      void qc.invalidateQueries({ queryKey: ['accounts-list'] });
    },
    onError: () => toast.push({ tone: 'error', title: 'Save failed' }),
  });
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            {PLATFORM_ICON[platform]}
            {name}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
            Auto-reply
          </label>
        </div>
        {on && (
          <>
            <input
              className="input w-full"
              placeholder="Thanks {author}!"
              value={tpl}
              onChange={(e) => setTpl(e.target.value)}
            />
            <p className="text-xs text-ink-muted dark:text-stone-500">
              {'{author}'} is replaced with the commenter's name.
            </p>
          </>
        )}
        <Button size="sm" variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

export function CommentsPage(): JSX.Element {
  const [status, setStatus] = useState('');
  const [accountId, setAccountId] = useState('');
  const [q, setQ] = useState('');
  const accounts = useQuery({ queryKey: ['accounts-list'], queryFn: () => api.listAccounts() });
  const comments = useQuery({
    queryKey: ['comments', status, accountId, q],
    queryFn: () =>
      api.listComments({
        reply_status: status || undefined,
        account_id: accountId || undefined,
        q: q || undefined,
      }),
  });

  const replyable = (accounts.data?.accounts ?? []).filter((a) => a.platform !== 'tiktok');

  return (
    <div className="space-y-6">
      <PostsNav />
      <header>
        <h1 className="text-2xl font-semibold">Comments</h1>
        <p className="mt-1 text-sm text-ink-muted dark:text-stone-400">
          Comments on your published posts. Reply manually or let auto-reply keep engagement.
          TikTok does not expose a comments API, so TikTok posts are not included.
        </p>
      </header>

      {replyable.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted dark:text-stone-400">
            Auto-reply
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {replyable.map((a) => (
              <AutoReplyCard
                key={a.id}
                accountId={a.id}
                name={a.display_name}
                platform={a.platform}
                enabled={!!a.auto_reply_enabled}
                template={a.auto_reply_template ?? ''}
              />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Reply status">
          {[
            { v: '', label: 'All' },
            { v: 'none', label: 'Unanswered' },
            { v: 'auto', label: 'Auto-replied' },
            { v: 'manual', label: 'Replied' },
            { v: 'failed', label: 'Failed' },
          ].map((c) => (
            <button
              key={c.v}
              type="button"
              aria-pressed={status === c.v}
              onClick={() => setStatus(c.v)}
              className="seg-btn"
            >
              {c.label}
            </button>
          ))}
        </div>
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="!w-auto">
          <option value="">All accounts</option>
          {(accounts.data?.accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
        </Select>
        <TextInput placeholder="Search comments…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} className="!w-56" />
      </div>

      {comments.isLoading ? (
        <div className="space-y-3">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : !comments.data?.comments.length ? (
        <EmptyState
          title="No comments yet"
          description="Comments on your published posts will appear here once the hourly sync picks them up."
        />
      ) : (
        <div className="space-y-3">
          {comments.data.comments.map((c) => (
            <Card key={c.id}>
              <CardBody>
                <div className="flex items-center gap-2">
                  {PLATFORM_ICON[c.platform]}
                  <span className="text-sm font-semibold">{c.author_name || 'Unknown'}</span>
                  <span className="text-xs text-ink-muted dark:text-stone-500">
                    {c.account_display_name} · {dayjs(c.commented_at).format('MMM D, HH:mm')}
                  </span>
                  <Badge tone={STATUS_TONE[c.reply_status]} className="ml-auto">
                    {STATUS_LABEL[c.reply_status]}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">{c.text}</p>
                <ReplyBox comment={c} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
