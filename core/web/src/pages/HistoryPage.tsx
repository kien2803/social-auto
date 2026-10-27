import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../lib/api.js';
import { useAccounts } from '../lib/accounts.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Badge, statusToTone } from '../components/ui/Badge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { SkeletonRow } from '../components/ui/Skeleton.js';
import { Field, Select } from '../components/ui/Field.js';

const PLATFORMS = ['', 'youtube', 'tiktok', 'instagram', 'facebook'] as const;
const STATUSES = ['', 'pending', 'uploading', 'published', 'failed', 'dead'] as const;

export function HistoryPage() {
  const [platform, setPlatform] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const accounts = useAccounts();

  const history = useQuery({
    // All five filters belong in the queryKey so the cache invalidates
    // when any of them changes (dateFrom + account_id were missing
    // before, so the cache returned stale rows after the user picked
    // a different start date or account).
    queryKey: ['history', platform, status, accountId, dateFrom],
    queryFn: () =>
      api.listHistory({
        platform: platform || undefined,
        status: status || undefined,
        account_id: accountId || undefined,
        date_from: dateFrom || undefined,
      }),
    refetchInterval: 60_000,
    retry: 1,
  });

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );

  const posts = (history.data?.posts ?? [])
    .filter((p) => (accountId ? p.account_id === accountId : true))
    .filter((p) => {
      if (!dateFrom) return true;
      return p.scheduled_at >= new Date(dateFrom).getTime();
    })
    .sort((a, b) => b.scheduled_at - a.scheduled_at);

  const hasFilters = !!(platform || status || accountId || dateFrom);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-slate-100">History</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-slate-400">
            All scheduled and published posts.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader title="Filters" />
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Platform">
              <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p || 'All platforms'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s || 'All statuses'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">All accounts</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} — {a.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input"
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {history.isLoading ? (
        <SkeletonRow count={6} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<span>⌛</span>}
          title={hasFilters ? 'No posts match these filters' : 'No posts yet'}
          description={
            hasFilters
              ? 'Try widening the filters above.'
              : 'Schedule your first post to see it here.'
          }
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-muted dark:bg-[#211d18] dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Scheduled</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Caption</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">External ID</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const acc = accountById.get(p.account_id);
                  const accountLabel = acc
                    ? `${acc.platform} — ${acc.display_name}`
                    : p.account_id.slice(0, 8);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-ink dark:text-slate-200">
                        {dayjs(p.scheduled_at).format('YYYY-MM-DD HH:mm')}
                      </td>
                      <td className="px-4 py-2 text-ink-muted dark:text-slate-400">
                        {accountLabel}
                      </td>
                      <td className="max-w-md truncate px-4 py-2 text-ink dark:text-slate-200">
                        {p.caption.split('\n')[0] || '(no caption)'}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={statusToTone(p.status)}>{p.status}</Badge>
                        {p.last_error && (
                          <p className="mt-1 max-w-xs truncate text-xs text-red-600 dark:text-red-400">
                            {p.last_error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-subtle dark:text-slate-500">
                        {p.external_post_id ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}