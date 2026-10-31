import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, type VideoWire } from '../lib/api.js';
import { useAccounts, type AccountInfo } from '../lib/accounts.js';
import { useToast } from '../components/ui/Toast.js';
import { Button } from '../components/ui/Button.js';
import { Field, Select, TextArea } from '../components/ui/Field.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { IconYouTube, IconTikTok, IconInstagram, IconFacebook } from '../components/icons.js';
import type { ComponentType, SVGProps } from 'react';

const PLATFORM_ICON: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  youtube: IconYouTube,
  tiktok: IconTikTok,
  instagram: IconInstagram,
  facebook: IconFacebook,
};

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]">
      <header className="flex items-center gap-2.5 border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-mono text-[10px] font-semibold text-white">{n}</span>
        <h2 className="text-sm font-semibold text-ink dark:text-stone-100">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ComposePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);

  const videos = useQuery({ queryKey: ['videos'], queryFn: () => api.listVideos() });
  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? [];

  const [videoId, setVideoId] = useState(params.get('video') ?? '');
  const [accountIds, setAccountIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('omnicast.lastAccounts') ?? '[]'); } catch { return []; }
  });
  const [caption, setCaption] = useState('');
  const [perPlatform, setPerPlatform] = useState(false);
  const [perCaptions, setPerCaptions] = useState<Record<string, string>>({});
  const [time, setTime] = useState(dayjs().add(1, 'hour').minute(0).format('YYYY-MM-DDTHH:mm'));
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('private');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState<number | null>(null);

  const video: VideoWire | undefined = videos.data?.videos.find((v) => v.id === videoId);
  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const byPlatform = useMemo(() => {
    const m = new Map<string, AccountInfo[]>();
    for (const a of accounts) { const l = m.get(a.platform) ?? []; l.push(a); m.set(a.platform, l); }
    return m;
  }, [accounts]);
  const selectedAccounts = accounts.filter((a) => accountIds.includes(a.id));

  const toggleAccount = (id: string) =>
    setAccountIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const errors: string[] = [];
  if (!videoId) errors.push('Select a video');
  if (!accountIds.length) errors.push('Select at least one account');
  if (!caption.trim()) errors.push('Caption is required');

  const submit = useMutation({
    mutationFn: (draft: boolean) =>
      api.createSchedule({
        video_id: videoId,
        account_ids: accountIds,
        caption,
        per_platform_caption: perPlatform ? perCaptions : undefined,
        scheduled_at: new Date(time).getTime(),
        visibility,
        draft,
        notes: notes || undefined,
      }),
    onSuccess: (_d, draft) => {
      localStorage.setItem('omnicast.lastAccounts', JSON.stringify(accountIds));
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.push({ tone: 'success', title: draft ? 'Draft saved' : 'Post scheduled' });
      navigate(draft ? '/posts/pipeline' : '/posts/calendar');
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Failed', description: e instanceof Error ? e.message : 'unknown_error' }),
  });

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="font-mono text-[11px] text-ink-subtle dark:text-stone-500">composer</p>
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-stone-100">Create Post</h1>
      </header>

      {/* 1 — media */}
      <Section n={1} title="Media">
        {video ? (
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-24 items-center justify-center overflow-hidden bg-stone-100 font-mono text-[10px] text-ink-subtle dark:bg-stone-800/60 dark:text-stone-500">
              {video.filename.split('.').pop()?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink dark:text-stone-100">{video.filename}</p>
              <p className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">{video.mime}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setVideoId('')}>Replace</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {videos.isLoading ? <Skeleton className="h-20" /> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(videos.data?.videos ?? []).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVideoId(v.id)}
                    className={`border p-2 text-left text-xs transition-colors ${videoId === v.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30' : 'border-stone-200 hover:border-stone-400 dark:border-stone-700 dark:hover:border-stone-500'}`}
                  >
                    <span className="block truncate font-medium text-ink dark:text-stone-100">{v.filename}</span>
                    <span className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">{v.mime.split('/')[1]}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
              <Button size="sm" variant="secondary" loading={uploading !== null} onClick={() => fileInput.current?.click()}>
                {uploading !== null ? 'Uploading…' : 'Upload new video'}
              </Button>
              <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setUploading(0);
                    void api.uploadVideo(f, (n) => setUploading(n))
                      .then((r) => {
                        toast.push({ tone: 'success', title: 'Uploaded' });
                        void qc.invalidateQueries({ queryKey: ['videos'] });
                        const vid = (r as { video?: { id: string } }).video?.id;
                        if (vid) setVideoId(vid);
                      })
                      .catch((err) => toast.push({ tone: 'error', title: 'Upload failed', description: err instanceof Error ? err.message : 'unknown_error' }))
                      .finally(() => setUploading(null));
                  }
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
      </Section>

      {/* 2 — accounts */}
      <Section n={2} title="Accounts">
        <div className="mb-2 flex justify-end">
          <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-100"
            onClick={() => setAccountIds(activeAccounts.map((a) => a.id))}>
            Select all active
          </button>
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted dark:text-stone-400">No accounts connected. <a href="/accounts" className="text-brand-600 underline dark:text-brand-100">Connect one first</a>.</p>
        ) : (
          <div className="space-y-3">
            {[...byPlatform.entries()].map(([platform, list]) => {
              const PIcon = PLATFORM_ICON[platform];
              return (
                <div key={platform}>
                  <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase text-ink-subtle dark:text-stone-500">
                    {PIcon && <PIcon className="h-3.5 w-3.5" />} {platform}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((a) => {
                      const sel = accountIds.includes(a.id);
                      const disabled = a.status !== 'active';
                      return (
                        <button
                          key={a.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleAccount(a.id)}
                          title={disabled ? `Status: ${a.status} — reconnect first` : undefined}
                          className={`rounded-sm border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            sel ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-100'
                                : 'border-stone-200 text-ink-muted hover:border-stone-400 dark:border-stone-700 dark:text-stone-400'
                          }`}
                        >
                          {a.display_name}{disabled ? ` (${a.status})` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 3 — caption */}
      <Section n={3} title="Caption">
        <Field label={perPlatform ? 'Shared caption (fallback)' : 'Caption'} required hint={`${caption.length}/5000`}>
          <TextArea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} maxLength={5000} placeholder="Write your caption…" />
        </Field>
        <button type="button" className="mt-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-100"
          onClick={() => setPerPlatform((v) => !v)}>
          {perPlatform ? '− Hide per-platform captions' : '+ Customize per platform'}
        </button>
        {perPlatform && selectedAccounts.length > 0 && (
          <div className="mt-3 space-y-3 border-t border-stone-200 pt-3 dark:border-stone-800">
            {selectedAccounts.map((a) => (
              <Field key={a.id} label={`${a.display_name} (${a.platform})`}>
                <TextArea
                  value={perCaptions[a.id] ?? ''}
                  onChange={(e) => setPerCaptions((p) => ({ ...p, [a.id]: e.target.value }))}
                  rows={2}
                  maxLength={5000}
                  placeholder={caption || 'Platform-specific caption…'}
                />
              </Field>
            ))}
          </div>
        )}
      </Section>

      {/* 4 — options */}
      <Section n={4} title="Publishing options">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Publish at (${tz})`} required>
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
          </Field>
          <Field label="Visibility">
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </Select>
          </Field>
        </div>
        <Field label="Internal notes (optional)">
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. product launch v2" className="input" />
        </Field>
      </Section>

      {/* 5 — review */}
      <Section n={5} title="Review">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Video</dt><dd className="truncate font-medium text-ink dark:text-stone-100">{video?.filename ?? '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Accounts</dt><dd className="text-ink dark:text-stone-100">{selectedAccounts.map((a) => a.display_name).join(', ') || '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Time</dt><dd className="font-mono text-ink dark:text-stone-100">{dayjs(time).format('MMM D, HH:mm')} ({tz})</dd></div>
          <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Visibility</dt><dd className="capitalize text-ink dark:text-stone-100">{visibility}</dd></div>
          <div><dt className="text-ink-subtle dark:text-stone-500">Caption</dt><dd className="mt-0.5 whitespace-pre-wrap rounded-sm bg-surface-muted p-2 text-[13px] text-ink dark:bg-stone-800/50 dark:text-stone-200">{caption || '—'}</dd></div>
        </dl>
        {errors.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-xs text-red-600 dark:text-red-400" role="alert">
            {errors.map((e) => <li key={e}>• {e}</li>)}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Button loading={submit.isPending} disabled={errors.length > 0} onClick={() => submit.mutate(false)}>
            Schedule post
          </Button>
          <Button variant="secondary" loading={submit.isPending} disabled={errors.length > 0} onClick={() => submit.mutate(true)}>
            Save as draft
          </Button>
        </div>
      </Section>
    </div>
  );
}
