import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const profile = useMutation({
    mutationFn: () => authApi.updateProfile(name.trim()),
    onSuccess: () => setMsg({ kind: 'ok', text: 'Profile updated' }),
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const password = useMutation({
    mutationFn: () => authApi.changePassword(curPw, newPw),
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Password changed' });
      setCurPw(''); setNewPw(''); setConfirmPw('');
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  const del = useMutation({
    mutationFn: () => authApi.deleteAccount(),
    onSuccess: () => {
      logout();
      navigate('/login', { replace: true });
    },
    onError: (e: Error) => setMsg({ kind: 'err', text: e.message }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-ink dark:text-slate-100">Settings</h1>

      {msg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            msg.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Profile */}
      <section className="card space-y-4 p-5">
        <h2 className="text-lg font-medium text-ink dark:text-slate-100">Profile</h2>
        <div>
          <label className="mb-1 block text-sm text-ink-subtle dark:text-slate-400">Email</label>
          <input className="input w-full opacity-60" value={user?.email ?? ''} disabled />
        </div>
        <div>
          <label className="mb-1 block text-sm text-ink-subtle dark:text-slate-400">Name</label>
          <input
            className="input w-full"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          disabled={profile.isPending || !name.trim() || name.trim() === user?.name}
          onClick={() => profile.mutate()}
        >
          Save profile
        </button>
      </section>

      {/* Change password */}
      <section className="card space-y-4 p-5">
        <h2 className="text-lg font-medium text-ink dark:text-slate-100">Change password</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newPw !== confirmPw) {
              setMsg({ kind: 'err', text: 'New passwords do not match' });
              return;
            }
            password.mutate();
          }}
          className="space-y-4"
        >
          <input
            className="input w-full"
            type="password"
            placeholder="Current password"
            value={curPw}
            onChange={(e) => setCurPw(e.target.value)}
            autoComplete="current-password"
          />
          <input
            className="input w-full"
            type="password"
            placeholder="New password (min 6 chars)"
            value={newPw}
            minLength={6}
            onChange={(e) => setNewPw(e.target.value)}
            autoComplete="new-password"
          />
          <input
            className="input w-full"
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            autoComplete="new-password"
          />
          <button
            className="btn-primary"
            type="submit"
            disabled={password.isPending || !curPw || newPw.length < 6 || newPw !== confirmPw}
          >
            Change password
          </button>
        </form>
      </section>

      {/* Danger zone */}
      <section className="card space-y-4 border-red-200 p-5 dark:border-red-900">
        <h2 className="text-lg font-medium text-red-600 dark:text-red-400">Delete account</h2>
        <p className="text-sm text-ink-subtle dark:text-slate-400">
          Permanently deletes your account, connected social accounts, videos, and scheduled posts.
          This cannot be undone. Type <strong>DELETE</strong> to confirm.
        </p>
        <input
          className="input w-full"
          placeholder="Type DELETE to confirm"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
        />
        <button
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          disabled={del.isPending || deleteConfirm !== 'DELETE'}
          onClick={() => del.mutate()}
        >
          Delete my account
        </button>
      </section>
    </div>
  );
}
