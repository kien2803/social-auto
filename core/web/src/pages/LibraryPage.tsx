import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, fetchVideoThumbnail, type VideoWire } from '../lib/api.js';
import { useToast } from '../components/ui/Toast.js';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Modal } from '../components/ui/Modal.js';

function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Thumb({ video }: { video: VideoWire }) {
  const [src, setSrc] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  if (!tried && video.has_thumbnail) {
    setTried(true);
    void fetchVideoThumbnail(video.id).then(setSrc);
  }
  return src ? (
    <img src={src} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-ink-subtle dark:text-stone-500">
      {video.mime.split('/')[1]?.toUpperCase() ?? 'VIDEO'}
    </div>
  );
}

export function LibraryPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [gridView, setGridView] = useState(true);
  const [preview, setPreview] = useState<VideoWire | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);

  const videos = useQuery({ queryKey: ['videos'], queryFn: () => api.listVideos() });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteVideo(id),
    onSuccess: () => { toast.push({ tone: 'success', title: 'Video deleted' }); void qc.invalidateQueries({ queryKey: ['videos'] }); },
    onError: (e) => toast.push({ tone: 'error', title: 'Delete failed', description: e instanceof Error ? e.message : 'unknown_error' }),
  });

  const items = useMemo(() => {
    const all = videos.data?.videos ?? [];
    if (!q.trim()) return all;
    const needle = q.trim().toLowerCase();
    return all.filter((v) => v.filename.toLowerCase().includes(needle));
  }, [videos.data, q]);

  const doUpload = (file: File) => {
    setUploading(0);
    void api.uploadVideo(file, (n) => setUploading(n))
      .then(() => { toast.push({ tone: 'success', title: 'Video uploaded' }); void qc.invalidateQueries({ queryKey: ['videos'] }); })
      .catch((e) => toast.push({ tone: 'error', title: 'Upload failed', description: e instanceof Error ? e.message : 'unknown_error' }))
      .finally(() => setUploading(null));
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-ink-subtle dark:text-stone-500">media</p>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-stone-100">Content Library</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search videos…"
            aria-label="Search videos"
            className="w-48 rounded-sm border border-stone-300 bg-surface px-3 py-1.5 text-sm placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none dark:border-stone-700 dark:bg-[#211d18] dark:text-stone-100 dark:placeholder:text-stone-500"
          />
          <div className="flex rounded-sm border border-stone-300 dark:border-stone-700" role="group" aria-label="View">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setGridView(v === 'grid')}
                className={`px-2.5 py-1.5 text-xs font-medium capitalize ${((v === 'grid') === gridView) ? 'bg-brand-600 text-white' : 'text-ink-muted dark:text-stone-400'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" loading={uploading !== null} onClick={() => fileInput.current?.click()}>
            {uploading !== null ? `Uploading ${fmtSize(uploading)}…` : 'Upload video'}
          </Button>
          <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''; }} />
        </div>
      </header>

      {videos.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : videos.isError ? (
        <EmptyState title="Couldn't load videos" description={videos.error instanceof Error ? videos.error.message : 'unknown_error'} action={<Button size="sm" onClick={() => void videos.refetch()}>Retry</Button>} />
      ) : items.length === 0 ? (
        <EmptyState
          title={q ? 'No videos match' : 'No videos yet'}
          description={q ? 'Try a different search term.' : 'Upload your first video to start publishing.'}
          action={!q ? <Button size="sm" onClick={() => fileInput.current?.click()}>Upload video</Button> : undefined}
        />
      ) : gridView ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((v) => (
            <article key={v.id} className="group border border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]">
              <button type="button" onClick={() => setPreview(v)} className="block aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-800/60">
                <Thumb video={v} />
              </button>
              <div className="space-y-1 p-2.5">
                <p className="truncate text-[13px] font-medium text-ink dark:text-stone-100" title={v.filename}>{v.filename}</p>
                <p className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">
                  {fmtDuration(v.duration_sec)} · {fmtSize(v.size_bytes)} · {dayjs(v.created_at).format('MMM D')}
                </p>
                <div className="flex gap-1.5 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/posts/new?video=${v.id}`)}>Create Post</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(v)}>Preview</Button>
                  <Button size="sm" variant="ghost" loading={del.isPending} onClick={() => { if (window.confirm(`Delete ${v.filename}?`)) del.mutate(v.id); }}>Delete</Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="border border-stone-200 dark:border-stone-800">
          {items.map((v) => (
            <div key={v.id} className="flex items-center gap-3 border-b border-stone-200 px-3 py-2 last:border-b-0 hover:bg-surface-muted/50 dark:border-stone-800 dark:hover:bg-stone-800/40">
              <button type="button" onClick={() => setPreview(v)} className="h-10 w-16 shrink-0 overflow-hidden bg-stone-100 dark:bg-stone-800/60">
                <Thumb video={v} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink dark:text-stone-100">{v.filename}</p>
                <p className="font-mono text-[10px] text-ink-subtle dark:text-stone-500">{fmtDuration(v.duration_sec)} · {fmtSize(v.size_bytes)} · {dayjs(v.created_at).format('MMM D, YYYY')}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/posts/new?video=${v.id}`)}>Create Post</Button>
                <Button size="sm" variant="ghost" loading={del.isPending} onClick={() => { if (window.confirm(`Delete ${v.filename}?`)) del.mutate(v.id); }}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.filename} size="lg">
          <dl className="space-y-2 text-sm">
            <div className="aspect-video overflow-hidden bg-stone-100 dark:bg-stone-800/60"><Thumb video={preview} /></div>
            <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Duration</dt><dd className="font-mono">{fmtDuration(preview.duration_sec)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Size</dt><dd className="font-mono">{fmtSize(preview.size_bytes)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Format</dt><dd className="font-mono">{preview.mime}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-subtle dark:text-stone-500">Uploaded</dt><dd>{dayjs(preview.created_at).format('MMM D, YYYY HH:mm')}</dd></div>
            <Button onClick={() => { setPreview(null); navigate(`/posts/new?video=${preview.id}`); }}>Create Post with this video</Button>
          </dl>
        </Modal>
      )}
    </div>
  );
}
