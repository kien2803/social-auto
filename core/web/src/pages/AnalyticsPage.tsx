import { IconAnalytics } from '../components/icons.js';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  api,
  type AccountRow,
  type AnalyticsRow,
  type ChannelVideo,
} from '../lib/api.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Field, Select } from '../components/ui/Field.js';
import { Badge, statusToTone } from '../components/ui/Badge.js';
import { BarChart } from '../components/ui/BarChart.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { useToast } from '../components/ui/Toast.js';
import { track } from '../lib/telemetry.js';

const STATUS_KEYS = ['pending', 'uploading', 'published', 'failed', 'dead'] as const;

function AccountHeader({ row }: { row: AnalyticsRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-ink dark:text-stone-100">
            {row.display_name}
          </span>
          <Badge tone="neutral" className="capitalize">
            {row.platform}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-ink-muted dark:text-stone-400">
          {row.total} post{row.total === 1 ? '' : 's'} total
          {row.last_published_at
            ? ` · last published ${dayjs(row.last_published_at).format('MMM D, HH:mm')}`
            : ' · never published'}
        </p>
      </div>
    </div>
  );
}

function StatusTable({ row }: { row: AnalyticsRow }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {STATUS_KEYS.map((k) => (
        <div
          key={k}
          className="rounded-md border border-stone-200 bg-surface-muted px-3 py-2 text-center dark:border-stone-800 dark:bg-[#211d18]"
        >
          <div className="text-xl font-semibold tabular-nums text-ink dark:text-stone-100">
            {row.by_status[k] ?? 0}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ink-subtle dark:text-stone-500">
            {k}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const accountsQuery = useQuery({
    queryKey: ['accounts-list', {}],
    queryFn: () => api.listAccounts(),
  });
  const fullAccounts: AccountRow[] = accountsQuery.data?.accounts ?? [];
  const [accountId, setAccountId] = useState<string>('');

  const q = useQuery({
    queryKey: ['analytics', accountId],
    queryFn: () => api.analytics(accountId || undefined),
    refetchInterval: 30_000,
  });

  const rows = q.data?.rows ?? [];
  // Explicit, position-independent match: find the analytics row whose
  // account_id equals the selected id. Using rows[0] here would rely on
  // the server returning rows in the same order as fullAccounts, which
  // is not part of the contract — a server change would silently focus
  // the wrong channel. Both the analytics row AND the full account row
  // must be present; if either is missing (e.g. the account was
  // disconnected while the user was on this view), drop back to the
  // all-accounts view rather than render a half-populated snapshot.
  const focusedRow: AnalyticsRow | null = accountId
    ? rows.find((r) => r.account_id === accountId) ?? null
    : null;
  const focusedAccount: AccountRow | null = accountId
    ? fullAccounts.find((a) => a.id === accountId) ?? null
    : null;
  const focused = focusedRow;
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-stone-100">Analytics</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-stone-400">
            All-time stats per account. Pick a channel to drill in.
          </p>
        </div>
      </header>
      <Card>
        <CardBody>
          <Field label="Channel" hint="Pick one account or 'All' for the aggregate view.">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {fullAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform} — {a.display_name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconAnalytics className="h-6 w-6" />}
          title="No data yet"
          description={
            accountId
              ? 'This account has no scheduled or published posts.'
              : 'No accounts connected. Connect one to start collecting stats.'
          }
        />
      ) : focused && focusedAccount ? (
        <SingleAccountAnalytics row={focused} account={focusedAccount} />
      ) : (
        <AllAccountsAnalytics rows={rows} onFocusAccount={setAccountId} />
      )}
    </div>
  );
}

function SnapshotTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-surface-muted px-2 py-1.5 text-center dark:border-stone-800 dark:bg-[#211d18]">
      <div className="text-base font-semibold tabular-nums text-ink dark:text-stone-100">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-ink-subtle dark:text-stone-500">
        {label}
      </div>
    </div>
  );
}

function formatBigNumber(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatAvgWatch(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatDropOff(pct: number | null): string {
  if (pct == null) return '—';
  return `${Math.round(pct * 100)}%`;
}

function FullSnapshot({ account }: { account: AccountRow }) {
  const { channel } = account;
  const synced = channel.snapshot_at != null;
  return (
    <Card>
      <CardHeader
        title="Channel snapshot"
        description={
          synced
            ? `Synced ${dayjs(channel.snapshot_at).format('MMM D, HH:mm')}`
            : 'Never synced — click Sync to refresh from YouTube.'
        }
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <SnapshotTile label="Subs" value={formatBigNumber(channel.subscribers)} />
          <SnapshotTile label="Videos" value={formatBigNumber(channel.video_count)} />
          <SnapshotTile label="Views" value={formatBigNumber(channel.views)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <SnapshotTile label="Likes" value={formatBigNumber(channel.like_count)} />
          <SnapshotTile label="Avg view" value={formatAvgWatch(channel.avg_watch_seconds)} />
          <SnapshotTile label="Drop-off" value={formatDropOff(channel.drop_off_pct)} />
        </div>
      </CardBody>
    </Card>
  );
}

function VideoListCard({ accountId }: { accountId: string }) {
  const q = useQuery({
    queryKey: ['channel-videos', accountId],
    queryFn: () => api.listChannelVideos(accountId),
  });
  const videos = q.data?.videos ?? [];
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.isError) {
    return (
      <EmptyState
        icon={<span>!</span>}
        title="Couldn't load videos"
        description="Try again from the Sync button."
      />
    );
  }
  if (videos.length === 0) {
    return (
      <EmptyState
        icon={<span>▶</span>}
        title="No videos yet"
        description="Sync will pull the latest uploads from YouTube."
      />
    );
  }
  return (
    <Card>
      <CardHeader
        title="Recent videos"
        description="Latest 10 uploads from this channel."
      />
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-ink-muted dark:bg-[#211d18] dark:text-stone-400">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium text-right">Views</th>
              <th className="px-4 py-2 font-medium text-right">Likes</th>
              <th className="px-4 py-2 font-medium text-right">Comments</th>
              <th className="px-4 py-2 font-medium text-right">Duration</th>
              <th className="px-4 py-2 font-medium">Published</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v: ChannelVideo) => (
              <tr key={v.id} className="border-t border-stone-200 dark:border-stone-800">
                <td className="max-w-md truncate px-4 py-2">
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink hover:underline dark:text-stone-200"
                  >
                    {v.title}
                  </a>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatBigNumber(v.view_count)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatBigNumber(v.like_count)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatBigNumber(v.comment_count)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatAvgWatch(v.duration_sec)}
                </td>
                <td className="px-4 py-2 text-xs text-ink-muted dark:text-stone-400">
                  {dayjs(v.published_at).format('MMM D, YYYY')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function SingleAccountAnalytics({
  row,
  account,
}: {
  row: AnalyticsRow;
  account: AccountRow;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const chartData = STATUS_KEYS.map((k) => ({
    label: k,
    value: row.by_status[k] ?? 0,
    colorClass: k,
  }));
  const syncMut = useMutation({
    mutationFn: () => api.syncAccount(account.id),
    onSuccess: () => {
      track('analytics sync', { account_id: account.id, platform: account.platform });
      toast.push({
        tone: 'success',
        title: 'Synced',
        description: `${account.display_name} stats refreshed.`,
      });
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['accounts-list'] });
      void qc.invalidateQueries({ queryKey: ['channel-videos', account.id] });
    },
    onError: (err) =>
      toast.push({
        tone: 'error',
        title: 'Sync failed',
        description: err instanceof Error ? err.message : 'unknown_error',
      }),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Snapshot"
          action={
            <button
              type="button"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
              className="rounded-md border border-stone-200 px-3 py-1 text-xs font-medium text-ink hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              {syncMut.isPending ? 'Syncing…' : 'Sync'}
            </button>
          }
        />
        <CardBody className="space-y-4">
          <AccountHeader row={row} />
          <StatusTable row={row} />
        </CardBody>
      </Card>

      <FullSnapshot account={account} />

      <Card>
        <CardHeader
          title="Posts by status"
          description="Bar chart — counts per status."
        />
        <CardBody>
          <BarChart data={chartData} height={260} />
        </CardBody>
      </Card>

      <VideoListCard accountId={account.id} />
    </div>
  );
}

function AllAccountsAnalytics({
  rows,
  onFocusAccount,
}: {
  rows: AnalyticsRow[];
  onFocusAccount: (id: string) => void;
}) {
  // Aggregate across accounts: one bar per status (sum).
  const totals: Record<string, number> = {};
  for (const k of STATUS_KEYS) totals[k] = 0;
  for (const r of rows) {
    for (const k of STATUS_KEYS) {
      totals[k] = (totals[k] ?? 0) + (r.by_status[k] ?? 0);
    }
  }
  const chartData = STATUS_KEYS.map((k) => ({
    label: k,
    value: totals[k] ?? 0,
    colorClass: k,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="All accounts · totals"
          description={`Across ${rows.length} connected account${rows.length === 1 ? '' : 's'}.`}
        />
        <CardBody>
          <BarChart data={chartData} height={240} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Per-account breakdown"
          description="Click an account row to drill in."
        />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-ink-muted dark:bg-[#211d18] dark:text-stone-400">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                {STATUS_KEYS.map((k) => (
                  <th key={k} className="px-4 py-2 font-medium capitalize">
                    {k}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Last published</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.account_id}
                  className="cursor-pointer border-t border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-[#211d18]"
                  onClick={() => onFocusAccount(r.account_id)}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-ink hover:underline dark:text-stone-200">
                        {r.display_name}
                      </span>
                      <Badge tone="neutral" className="capitalize">
                        {r.platform}
                      </Badge>
                    </div>
                  </td>
                  {STATUS_KEYS.map((k) => (
                    <td key={k} className="px-4 py-2 text-center tabular-nums">
                      <Badge tone={statusToTone(k)}>{r.by_status[k] ?? 0}</Badge>
                    </td>
                  ))}
                  <td className="px-4 py-2 text-center font-medium tabular-nums">
                    {r.total}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted dark:text-stone-400">
                    {r.last_published_at
                      ? dayjs(r.last_published_at).format('MMM D, HH:mm')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}