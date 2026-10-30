import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  api,
  stageOAuthTokenCookie,
  type AccountListResponse,
  type AccountRow,
  type UpdateAccountInput,
} from '../lib/api.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Field, TextInput } from '../components/ui/Field.js';
import { Badge } from '../components/ui/Badge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Modal } from '../components/ui/Modal.js';
import { useToast } from '../components/ui/Toast.js';
import { track, warnValidation } from '../lib/telemetry.js';
import { extractOAuthResultFromMessage } from '../lib/oAuthPopup.js';
import { safeHref } from '../lib/safeHref.js';
import type { Platform } from '@social-auto/shared';

/**
 * Connect a platform via OAuth. We deliberately use full-tab navigation
 * (not popup-mode) because popup-mode requires the parent tab to keep a
 * `message` listener alive through a third-party redirect chain that
 * crosses at least one boundary (Google -> SPA -> opener postMessage)
 * — every boundary is a chance to lose the result, and Zen Browser's
 * default third-party cookie policy plus popup blockers make it worse.
 *
 * Same-tab navigation has only three steps: navigate to Google, Google
 * returns to /auth/callback, API redirects to /accounts?connected=...
 * which the query-string useEffect consumes. The SPA reloads on the
 * way back, which clears the filter input — an acceptable trade for
 * actually being able to log in.
 *
 * The popup-mode helper (`openOAuthPopup`) remains available for a
 * future "Connect without leaving this page" feature; it just isn't
 * the default anymore.
 */
function startConnect(platform: Platform): void {
  track('click Connect', { platform, surface: 'header' });
  stageOAuthTokenCookie();
  window.location.assign(`/api/auth/${encodeURIComponent(platform)}/start`);
}
/** "UC_2K2J...xyz" — truncate opaque platform channel ids for display. */
function shortChannelId(externalId: string): string {
  if (!externalId) return '—';
  if (externalId.length <= 14) return externalId;
  return `${externalId.slice(0, 6)}…${externalId.slice(-4)}`;
}

function formatBigNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function PlatformAvatar({
  platform,
  avatarUrl,
}: {
  platform: string;
  avatarUrl?: string;
}) {
  // Use the real avatar when the account has been synced against the
  // platform API (avatarUrl populated). safeHref rejects non-http(s) URLs
  // so a poisoned value can't slip through. Falls back to a coloured
  // monogram when the avatar is missing or unsafe.
  const safe = avatarUrl ? safeHref(avatarUrl) : undefined;
  const letter = platform.charAt(0).toUpperCase() || '?';
  const color =
    platform === 'youtube'
      ? 'bg-red-500 text-white'
      : platform === 'tiktok'
        ? 'bg-stone-900 text-pink-300'
        : platform === 'instagram'
          ? 'bg-gradient-to-br from-pink-500 to-purple-600 text-white'
          : platform === 'facebook'
            ? 'bg-blue-700 text-white'
            : 'bg-blue-600 text-white';
  if (safe) {
    return (
      <img
        src={safe}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-10 w-10 shrink-0 rounded-full border border-stone-200 object-cover dark:border-stone-700"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${color}`}
    >
      {letter}
    </div>
  );
}

function StatusBadge({ status }: { status: AccountRow['status'] }) {
  const tone =
    status === 'active'
      ? 'success'
      : status === 'expired'
        ? 'warn'
        : status === 'revoked'
          ? 'danger'
          : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

// ────────────────────────────────────────────────────────────────────────────
// Edit modal — display name only. Never accepts OAuth tokens or passwords.
// ────────────────────────────────────────────────────────────────────────────

function EditAccountModal({
  account,
  onClose,
}: {
  account: AccountRow;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(account.display_name);
  const [touched, setTouched] = useState(false);

  const trimmedName = displayName.trim();
  const nameError =
    !trimmedName
      ? 'Display name is required.'
      : trimmedName.length > 100
        ? 'Display name must be 100 characters or fewer.'
        : '';
  const hasError = Boolean(nameError);

  const update = useMutation({
    mutationFn: (patch: UpdateAccountInput) => api.updateAccount(account.id, patch),
    onSuccess: (row) => {
      track('edit account', { account_id: account.id, platform: account.platform });
      toast.push({ tone: 'success', title: 'Account updated', description: row.display_name });
      // Both the flat consumer cache and the filtered list cache must refresh.
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['accounts-list'] });
      onClose();
    },
    onError: (err) =>
      toast.push({
        tone: 'error',
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'unknown_error',
      }),
  });
  const save = (): void => {
    if (hasError) {
      warnValidation('edit account blocked', {
        account_id: account.id,
        reason: nameError,
      });
      setTouched(true);
      return;
    }
    update.mutate({ display_name: trimmedName });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${account.display_name}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            loading={update.isPending}
            disabled={hasError}
            aria-disabled={hasError}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Display name" required error={touched ? nameError : undefined}>
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            autoFocus
            aria-invalid={Boolean(nameError)}
          />
        </Field>
        <p className="rounded border border-stone-200 bg-surface-muted px-3 py-2 text-xs text-ink-muted dark:border-stone-700 dark:bg-[#211d18] dark:text-stone-400">
          Credentials (OAuth tokens, passwords, API keys) are never edited here and cannot be
          changed through the UI.
        </p>
      </form>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Account card (default density)
// ────────────────────────────────────────────────────────────────────────────

function AccountCard({
  account,
  onChanged,
  onEdit,
  onReconnect,
}: {
  account: AccountRow;
  onChanged: () => void;
  onEdit: (a: AccountRow) => void;
  onReconnect: (platform: Platform) => void;
}) {
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const del = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: () => {
      track('disconnect account', { account_id: account.id, platform: account.platform });
      setConfirmDelete(false);
      onChanged();
      toast.push({ tone: 'success', title: 'Disconnected', description: account.display_name });
    },
    onError: (err) =>
      toast.push({
        tone: 'error',
        title: 'Disconnect failed',
        description: err instanceof Error ? err.message : 'unknown_error',
      }),
  });

  return (
    <Card data-account-id={account.id}>
      <CardBody className="flex items-start gap-4">
        <PlatformAvatar platform={account.platform} avatarUrl={account.channel.avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink dark:text-stone-100">
              {account.display_name}
            </h3>
            <StatusBadge status={account.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted dark:text-stone-400">
            <span className="flex items-center gap-1.5 capitalize">
              <img src={`/icons/${account.platform}.svg`} alt="" className="h-3.5 w-3.5" />
              {account.platform}
            </span>
            <span aria-hidden="true">·</span>
            <code
              className="font-mono text-[11px]"
              title={`Channel ID: ${account.external_id}`}
            >
              {shortChannelId(account.external_id)}
            </code>
            {account.channel.channel_handle && (
              <>
                <span aria-hidden="true">·</span>
                <span>{account.channel.channel_handle}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => onEdit(account)}>
            Edit
          </Button>
          {account.status === 'expired' && (
            <Button size="sm" variant="secondary" onClick={() => onReconnect(account.platform)}>
              Reconnect
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
            Disconnect
          </Button>
        </div>
      </CardBody>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Disconnect account?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted dark:text-stone-400">
          Disconnecting <strong>{account.display_name}</strong> removes the encrypted token
          from this machine. Re-connect any time to schedule new posts.
        </p>
      </Modal>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Table row (compact density)
// ────────────────────────────────────────────────────────────────────────────

function AccountTable({
  accounts,
  onEdit,
  onChanged,
}: {
  accounts: AccountRow[];
  onEdit: (a: AccountRow) => void;
  onChanged: () => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
      <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-800">
        <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide text-ink-subtle dark:bg-[#211d18] dark:text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Platform</th>
            <th className="px-3 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Subs</th>
            <th className="px-3 py-2 font-medium text-right">Videos</th>
            <th className="px-3 py-2 font-medium">Last sync</th>
            <th className="px-3 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
          {accounts.map((a) => (
            <tr key={a.id} data-account-id={a.id} className="bg-surface hover:bg-surface-muted/60 dark:bg-[#262019]">
              <td className="max-w-[16rem] truncate px-3 py-2">
                <div className="flex items-center gap-2">
                  <PlatformAvatar platform={a.platform} avatarUrl={a.channel.avatar_url} />
                  <span className="truncate font-medium text-ink dark:text-stone-100">
                    {a.display_name}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 capitalize text-ink-muted dark:text-stone-400">
                {a.platform}
              </td>
              <td
                className="px-3 py-2 font-mono text-[11px] text-ink-muted dark:text-stone-400"
                title={a.external_id}
              >
                {shortChannelId(a.external_id)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={a.status} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatBigNumber(a.channel.subscribers)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatBigNumber(a.channel.video_count)}
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted dark:text-stone-400">
                {a.channel.snapshot_at ? dayjs(a.channel.snapshot_at).format('MMM D, HH:mm') : '—'}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => onEdit(a)}>
                    Edit
                  </Button>
                  <RowDisconnect account={a} onChanged={onChanged} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowDisconnect({
  account,
  onChanged,
}: {
  account: AccountRow;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: () => {
      track('disconnect account', { account_id: account.id, platform: account.platform, view: 'table' });
      setOpen(false);
      onChanged();
      toast.push({ tone: 'success', title: 'Disconnected', description: account.display_name });
    },
    onError: (err) =>
      toast.push({
        tone: 'error',
        title: 'Disconnect failed',
        description: err instanceof Error ? err.message : 'unknown_error',
      }),
  });
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Disconnect
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Disconnect account?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted dark:text-stone-400">
          Disconnecting <strong>{account.display_name}</strong> removes the encrypted token.
        </p>
      </Modal>
    </>
  );
}

// Page
// ────────────────────────────────────────────────────────────────────────────

type ViewMode = 'cards' | 'table';

function usePersistedViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const stored = window.localStorage?.getItem('accounts:view');
      return stored === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const persist = (v: ViewMode): void => {
    setView(v);
    try {
      window.localStorage.setItem('accounts:view', v);
    } catch {
      // localStorage unavailable — fall back silently.
    }
  };
  return [view, persist];
}

// Each option exposes its own label so the user sees "Add YouTube account"
// rather than "Connect YouTube" — multi-account per platform is supported
// and each OAuth round-trip appends a new row. `mockOnly` platforms fall
// back to a deterministic code-based mock, so the (N) count there is for
// informational use only; the mock flow always rewrites the same row.
const CONNECT_OPTIONS: ReadonlyArray<{ platform: Platform; label: string; mockOnly: boolean }> = [
  { platform: 'youtube', label: 'Add YouTube account', mockOnly: false },
  { platform: 'tiktok', label: 'Add TikTok account', mockOnly: true },
  { platform: 'instagram', label: 'Add Instagram account', mockOnly: true },
  { platform: 'facebook', label: 'Add Facebook account', mockOnly: true },
];

function ConnectMenu({
  onSelect,
  counts,
}: {
  onSelect: (platform: Platform) => void;
  counts: Partial<Record<Platform, number>>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        leftIcon={<span>+</span>}
      >
        Add account
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[16rem] rounded-md border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
        >
          {CONNECT_OPTIONS.map((opt) => {
            const count = counts[opt.platform] ?? 0;
            return (
              <button
                key={opt.platform}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSelect(opt.platform);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700"
              >
                <span className="flex items-center gap-2">
                  <PlatformAvatar platform={opt.platform} />
                  <span>{opt.label}</span>
                </span>
                <span className="flex items-center gap-1">
                  {count > 0 && (
                    <span className="rounded-full bg-stone-200 px-2 text-[11px] font-semibold text-stone-700 dark:bg-stone-700 dark:text-stone-200">
                      {count}
                    </span>
                  )}
                  {opt.mockOnly && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      mock
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}



export function AccountsPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const [view, setView] = usePersistedViewMode();
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const accountsQuery: UseQueryResult<AccountListResponse> = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => api.listAccounts(),
    refetchInterval: 60_000,
    retry: 1,
  });

  // Apply an OAuth connect result to the UI: toast, invalidate cache,
  // scroll the new row into view. Shared by the legacy query-string
  // path (useEffect below) and the popup-mode postMessage listener.
  const applyConnectResult = useCallback(
    (result: { connected?: string; account_id?: string; account_ids?: string[]; error?: string }): void => {
      const accountIds = result.account_ids ?? (result.account_id ? [result.account_id] : []);
      const platform = result.connected;
      if (platform) {
        toast.push({
          tone: 'success',
          title: `Connected ${platform}`,
          description: accountIds.length > 0 ? 'Account added.' : '',
        });
        const firstId = accountIds[0];
        if (firstId) {
          // Auto-sync channel stats so the row shows subscribers / videos
          // without a separate click. Skip silently for non-YouTube —
          // the sync endpoint returns 400 sync_only_youtube for those.
          if (platform === 'youtube') {
            void (async (): Promise<void> => {
              try {
                await api.syncAccount(firstId);
                void qc.invalidateQueries({ queryKey: ['accounts'] });
                void qc.invalidateQueries({ queryKey: ['accounts-list'] });
              } catch {
                // Sync failures are non-fatal: the account is connected,
                // channel stats can refresh later from a manual click on
                // the row (when we add that back) or the next list refetch.
              }
            })();
          }
          // Wait one tick so the new row is mounted before we scroll to it.
          // Bounded retry so a missing row never throws.
          const scrollTo = (attempt: number): void => {
            const el = document.querySelector(`[data-account-id="${firstId}"]`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (attempt < 8) {
              setTimeout(() => scrollTo(attempt + 1), 150);
            }
          };
          setTimeout(() => scrollTo(0), 50);
        }
      } else if (result.error) {
        toast.push({
          tone: 'error',
          title: 'Connection failed',
          description: result.error,
        });
      }
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['accounts-list'] });
    },
    [qc, toast],
  );

  // Popup-mode OAuth: the popup-close page postMessages its result back
  // to this tab. Validate the origin + type, then hand off to the same
  // apply helper that the legacy query-string effect uses. We listen
  // for the whole session — at most a handful of events in the
  // account's lifetime — and skip the postMessage if it isn't ours.
  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>): void {
      const payload = extractOAuthResultFromMessage(event);
      if (!payload) return;
      applyConnectResult(payload);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyConnectResult]);
  // /accounts?connected=… (popup blocked, OAuth path that bypasses the
  // popup-close shim, etc.), still surface the result. Strips the
  // query string so a refresh doesn't re-fire the toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const accountId = params.get('account');
    const accountsCsv = params.get('accounts');
    const error = params.get('error');
    if (!connected && !error) return;
    applyConnectResult({
      connected: connected ?? undefined,
      account_id: accountId ?? undefined,
      account_ids: accountsCsv ? accountsCsv.split(',').filter(Boolean) : undefined,
      error: error ?? undefined,
    });
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
  }, [applyConnectResult]);

  // Wrap startConnect so the keyboard shortcut effect can reference a
  // stable reference without re-binding on every render.
  const handleConnect = useCallback(
    (platform: Platform): void => startConnect(platform),
    [],
  );
  // Keyboard shortcut: "n" triggers connect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (inField) return;
      if (e.key === 'n') {
        e.preventDefault();
        handleConnect('youtube');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleConnect]);

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['accounts'] });
    void qc.invalidateQueries({ queryKey: ['accounts-list'] });
  };


  const list = accountsQuery.data?.accounts ?? [];
  const total = accountsQuery.data?.total ?? list.length;
  // Single pass over the list — avoids two intermediate arrays.
  const { active, expired, counts } = useMemo(() => {
    let a = 0;
    let e = 0;
    const c: Partial<Record<Platform, number>> = {};
    for (const acct of list) {
      if (acct.status === 'active') a += 1;
      else if (acct.status === 'expired') e += 1;
      c[acct.platform] = (c[acct.platform] ?? 0) + 1;
    }
    return { active: a, expired: e, counts: c };
  }, [list]);

  const subtitle =
    list.length === 0
      ? 'Add a YouTube account to start posting. You can connect multiple channels on the same platform.'
      : `${total} total · ${active} active · ${expired} expired`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-stone-100">Accounts</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-stone-400">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectMenu onSelect={handleConnect} counts={counts} />
        </div>
      </header>

      <div className="flex justify-end">
        <div
          role="group"
          aria-label="View density"
          className="inline-flex rounded border border-stone-300 dark:border-stone-700"
        >
          <button
            type="button"
            className={`px-2.5 py-1.5 text-xs font-medium ${
              view === 'cards'
                ? 'bg-brand-600 text-white'
                : 'bg-surface text-ink-muted hover:bg-surface-muted dark:bg-[#211d18] dark:text-stone-400'
            }`}
            aria-pressed={view === 'cards'}
            onClick={() => setView('cards')}
          >
            Cards
          </button>
          <button
            type="button"
            className={`border-l border-stone-300 px-2.5 py-1.5 text-xs font-medium dark:border-stone-700 ${
              view === 'table'
                ? 'bg-brand-600 text-white'
                : 'bg-surface text-ink-muted hover:bg-surface-muted dark:bg-[#211d18] dark:text-stone-400'
            }`}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            Table
          </button>
        </div>
      </div>

      {accountsQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : accountsQuery.isError ? (
        <EmptyState
          icon={<span>!</span>}
          title="Couldn't load accounts"
          description={
            accountsQuery.error instanceof Error
              ? accountsQuery.error.message
              : 'unknown_error'
          }
          action={
            <Button size="sm" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<span>◉</span>}
          title="No accounts connected yet"
          description="Click Add account above and pick a platform to walk through OAuth. You can connect more than one YouTube channel — each one becomes its own row."
          action={
            <Button size="sm" onClick={() => handleConnect('youtube')}>
              Add YouTube account
            </Button>
          }
        />
      ) : view === 'cards' ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              onChanged={refresh}
              onEdit={setEditing}
              onReconnect={handleConnect}
            />
          ))}
        </div>
      ) : (
        <AccountTable
          accounts={list}
          onChanged={refresh}
          onEdit={setEditing}
        />
      )}

      {accountsQuery.dataUpdatedAt > 0 && (
        <p className="text-right text-xs text-ink-subtle dark:text-stone-500">
          Last refreshed {dayjs(accountsQuery.dataUpdatedAt).format('HH:mm:ss')}
        </p>
      )}

      {editing && <EditAccountModal account={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
