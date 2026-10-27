import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, fetchVideoStream, fetchVideoThumbnail, type VideoWire } from '../lib/api.js';
import { useAccounts } from '../lib/accounts.js';
import { useToast } from '../components/ui/Toast.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Field, Select, TextArea } from '../components/ui/Field.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';

const formSchema = z.object({
  video_id: z.string().min(1, 'Upload a video first'),
  caption: z
    .string()
    .min(1, 'Caption required')
    .max(5000, 'Max 5000 chars'),
  scheduled_at: z.string().min(1, 'Pick a time'),
  visibility: z.enum(['public', 'unlisted', 'private']),
  account_ids: z.array(z.string()).min(1, 'Select at least one account'),
});

type FormValues = z.infer<typeof formSchema>;

interface UploadResult {
  video_id: string;
  deduped: boolean;
}

const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.qt'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatProgress(progress: number, total?: number): string {
  if (!total) return formatBytes(progress);
  const pct = Math.min(100, Math.round((progress / total) * 100));
  return `${formatBytes(progress)} / ${formatBytes(total)} · ${pct}%`;
}

export function UploadPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const uploadIdRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [perAccountCaption, setPerAccountCaption] = useState<Record<string, string>>({});
  const accounts = useAccounts();

  const uploadedVideo = useQuery({
    queryKey: ['videos'],
    queryFn: () => api.listVideos(),
    staleTime: 30_000,
  });

  const uploadMut = useMutation<UploadResult, Error, File>({
    mutationFn: async (file: File) => {
      setUploading(true);
      setProgress(0);
      setProgressTotal(file.size);
      const uploadId = crypto.randomUUID();
      uploadIdRef.current = uploadId;
      try {
        return (await api.uploadVideo(file, (sent) => setProgress(sent), uploadId)) as UploadResult;
      } finally {
        setUploading(false);
      }
    },
    onSuccess: (data) => {
      form.setValue('video_id', data.video_id);
      qc.invalidateQueries({ queryKey: ['videos'] });
      toast.push({
        tone: 'success',
        title: data.deduped ? 'Reused existing upload' : 'Upload complete',
        description: data.deduped
          ? 'Identical file already on disk.'
          : 'Now schedule a time and accounts.',
      });
    },
    onError: (err) => {
      toast.push({ tone: 'error', title: 'Upload failed', description: err.message });
    },
  });

  const cancelUploadMut = useMutation({
    mutationFn: async (videoId: string) => {
      await api.deleteVideo(videoId);
    },
    onSuccess: () => {
      setUploading(false);
      setProgress(0);
      setProgressTotal(0);
      uploadMut.reset();
      qc.invalidateQueries({ queryKey: ['videos'] });
      toast.push({
        tone: 'success',
        title: 'Upload cancelled',
        description: 'The upload has been cancelled and files cleaned up.',
      });
    },
    onError: (err) => {
      toast.push({ tone: 'error', title: 'Cancel failed', description: err.message });
    },
  });

  const scheduleMut = useMutation({
    mutationFn: (values: FormValues) =>
      api.createSchedule({
        video_id: values.video_id,
        caption: values.caption,
        scheduled_at: new Date(values.scheduled_at).getTime(),
        visibility: values.visibility,
        account_ids: values.account_ids,
      }),
    onSuccess: (res) => {
      toast.push({
        tone: 'success',
        title: `Scheduled ${res.posts.length} post${res.posts.length === 1 ? '' : 's'}`,
      });
      navigate('/schedule');
    },
    onError: (err) => {
      toast.push({ tone: 'error', title: 'Schedule failed', description: err.message });
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { visibility: 'private', account_ids: [] },
    mode: 'onChange',
  });

  // Group accounts by platform for a clearer picker when many accounts are
  // connected (e.g. 3 YouTube channels + 1 TikTok). Stable insertion order
  // matches the /accounts ORDER BY created_at ASC in the repo.
  const accountsByPlatform: Record<string, NonNullable<typeof accounts.data>> = {};
  for (const a of accounts.data ?? []) {
    (accountsByPlatform[a.platform] ??= []).push(a);
  }

  const selectedAccounts = (accounts.data ?? []).filter((a) =>
    form.watch('account_ids').includes(a.id),
  );

  function handlePickFile(file: File) {
    // Check file size
    if (file.size > MAX_SIZE_BYTES) {
      toast.push({
        tone: 'error',
        title: 'File too large',
        description: `Maximum file size is 2GB. Your file is ${formatBytes(file.size)}.`,
      });
      return;
    }
    
    // Check file size is not zero
    if (file.size === 0) {
      toast.push({
        tone: 'error',
        title: 'Empty file',
        description: 'The selected file is empty. Please choose a valid video file.',
      });
      return;
    }
    
    // Check MIME type
    if (!ACCEPTED.includes(file.type)) {
      // Also check file extension as fallback
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(extension)) {
        toast.push({
          tone: 'error',
          title: 'Unsupported file type',
          description: `Please upload a video file in MP4, MOV, or WebM format. Got: ${file.type || 'unknown type'} (${extension || 'no extension'}).`,
        });
        return;
      }
    }
    
    uploadMut.mutate(file);
  }

  const onSubmit = form.handleSubmit((values) => {
    // Send per-account captions only if user customized any.
    const payload = {
      ...values,
      per_platform_caption:
        Object.keys(perAccountCaption).length > 0 ? perAccountCaption : undefined,
    };
    scheduleMut.mutate(payload);
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader
          title="Upload video"
          description="Drag & drop a video, or pick from disk. Hash-deduped on the server."
        />
        <CardBody>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handlePickFile(f);
            }}
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                : 'border-slate-300 bg-surface-muted dark:border-slate-700 dark:bg-[#211d18]'
            }`}
          >
            <div className="mb-3 text-3xl">↑</div>
            <p className="text-sm font-medium text-ink dark:text-slate-200">
              Drop your video here
            </p>
            <p className="mt-1 text-xs text-ink-muted dark:text-slate-400">
              mp4, mov, or webm · max 2GB
            </p>
            <div className="mt-4">
              <label className="btn-primary cursor-pointer">
                <input
                  type="file"
                  accept={ACCEPTED.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePickFile(f);
                  }}
                />
                Choose file
              </label>
            </div>
          </div>
          {(uploading || uploadMut.isPending) && (
            <div className="mt-4 space-y-3">
              <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full bg-brand-600 transition-all"
                  style={{
                    width: `${progressTotal ? Math.min(100, (progress / progressTotal) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-muted dark:text-slate-400">
                  {formatProgress(progress, progressTotal)}
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    if (uploadMut.data?.video_id) {
                      cancelUploadMut.mutate(uploadMut.data.video_id);
                    } else if (uploadIdRef.current) {
                      // In-flight upload — abort server-side stream too
                      api.cancelUpload(uploadIdRef.current).catch(() => {});
                      uploadIdRef.current = null;
                      setUploading(false);
                      setProgress(0);
                      setProgressTotal(0);
                      uploadMut.reset();
                    } else {
                      setUploading(false);
                      setProgress(0);
                      setProgressTotal(0);
                      uploadMut.reset();
                    }
                  }}
                  disabled={cancelUploadMut.isPending}
                >
                  {cancelUploadMut.isPending ? 'Cancelling...' : 'Cancel'}
                </Button>
              </div>
            </div>
          )}
          {uploadMut.data && (
            <p className="mt-3 text-sm text-success-700 dark:text-emerald-300">
              ✓ Uploaded {uploadMut.data.video_id.slice(0, 8)}{' '}
              {uploadMut.data.deduped ? '(deduped)' : ''}
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Schedule"
          description="Pick a time, choose accounts, then preview before confirming."
        />
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field
              label="Video"
              error={form.formState.errors.video_id?.message}
              required
            >
              <Select
                {...form.register('video_id')}
                disabled={(uploadedVideo.data?.videos ?? []).length === 0}
              >
                <option value="">— pick an uploaded video —</option>
                {(uploadedVideo.data?.videos ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.filename || v.id.slice(0, 8)} ({Math.round((v.size_bytes ?? 0) / 1024 / 1024)} MB
                    {v.duration_sec ? `, ${v.duration_sec}s` : ''})
                  </option>
                ))}
              </Select>
            </Field>

            <VideoThumbPreview videoId={form.watch('video_id')} videos={uploadedVideo.data?.videos ?? []} />

            <Field
              label="Caption"
              hint="First line = title. Rest = description. Use #tags anywhere."
              error={form.formState.errors.caption?.message}
              required
            >
              <TextArea
                {...form.register('caption')}
                rows={6}
                placeholder={'My title\nDescription goes here.\n#hashtags'}
              />
              <p className="mt-1 text-right text-xs text-ink-muted dark:text-slate-400">
                {form.watch('caption')?.length ?? 0} / 5000
              </p>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Scheduled at"
                error={form.formState.errors.scheduled_at?.message}
                required
              >
                <input
                  type="datetime-local"
                  {...form.register('scheduled_at')}
                  min={dayjs().add(1, 'minute').format('YYYY-MM-DDTHH:mm')}
                  className="input"
                />
              </Field>
              <Field label="Visibility">
                <Select {...form.register('visibility')}>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </Select>
              </Field>
            </div>

            <Field
              label="Accounts"
              error={form.formState.errors.account_ids?.message}
              hint="Pick one or more — same platform allowed (multi-account)."
              required
            >
              <div className="space-y-3">
                {Object.entries(accountsByPlatform).map(([platform, list]) => (
                  <div
                    key={platform}
                    className="rounded-md border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted dark:text-slate-400">
                        {platform}
                      </span>
                      <span className="text-xs text-ink-subtle dark:text-slate-500">
                        {list.length} account{list.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {list.map((a) => {
                        return (
                          <label
                            key={a.id}
                            className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                              a.status !== 'active' ? 'opacity-60' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              value={a.id}
                              {...form.register('account_ids')}
                              disabled={a.status !== 'active'}
                              className="rounded"
                            />
                            <span className="flex-1 truncate text-ink dark:text-slate-200">
                              {a.display_name}
                            </span>
                            <Badge
                              tone={
                                a.status === 'active'
                                  ? 'success'
                                  : a.status === 'expired'
                                    ? 'warn'
                                    : 'danger'
                              }
                            >
                              {a.status}
                            </Badge>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {accounts.data?.length === 0 && (
                  <p className="text-xs text-ink-muted dark:text-slate-400">
                    No accounts yet.{' '}
                    <a href="/accounts" className="text-brand-600 underline dark:text-brand-100">
                      Connect one
                    </a>
                    .
                  </p>
                )}
              </div>
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPreviewOpen(true)}
                disabled={selectedAccounts.length === 0 || !form.watch('caption')}
              >
                Preview
              </Button>
              <Button
                type="submit"
                loading={scheduleMut.isPending}
                disabled={accounts.isLoading || selectedAccounts.length === 0}
              >
                Schedule {selectedAccounts.length > 0 ? `${selectedAccounts.length} ` : ''}post
                {selectedAccounts.length === 1 ? '' : 's'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview before schedule"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
              Back to edit
            </Button>
            <Button onClick={() => onSubmit()}>Schedule now</Button>
          </>
        }
      >
        <div className="space-y-3">
          {selectedAccounts.map((acc) => {
            const cap = perAccountCaption[acc.id] ?? form.watch('caption') ?? '';
            const title = cap.split('\n', 1)[0] ?? cap;
            const desc = cap.split('\n').slice(1).join('\n').trim();
            return (
              <div
                key={acc.id}
                className="rounded-md border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-ink dark:text-slate-100">
                    {acc.platform} — {acc.display_name}
                  </div>
                </div>
                <p className="mb-1 text-xs text-ink-muted dark:text-slate-400">Title</p>
                <p className="mb-2 text-sm">{title || '—'}</p>
                <p className="mb-1 text-xs text-ink-muted dark:text-slate-400">
                  Description preview
                </p>
                <p className="text-sm text-ink dark:text-slate-200">{desc || '—'}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-brand-600 dark:text-brand-100">
                    Override caption for this account
                  </summary>
                  <TextArea
                    rows={3}
                    className="mt-2"
                    value={cap}
                    onChange={(e) =>
                      setPerAccountCaption((m) => ({ ...m, [acc.id]: e.target.value }))
                    }
                  />
                </details>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
/** Small thumbnail shown next to the video picker. The image lives behind
 * Bearer auth so it is fetched as a blob and rendered via an object URL. */
function VideoThumbPreview({ videoId, videos }: { videoId: string; videos: VideoWire[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const hasThumb = videos.find((v) => v.id === videoId)?.has_thumbnail ?? false;
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (videoId && hasThumb) {
      void fetchVideoThumbnail(videoId).then((u) => {
        if (!cancelled && u) {
          objectUrl = u;
          setUrl(u);
        }
      });
    } else {
      setUrl(null);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [videoId, hasThumb]);
  const [playing, setPlaying] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    if (playing) {
      void fetchVideoStream(videoId).then((u) => {
        obj = u;
        setVideoUrl(u);
      });
    }
    return () => {
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [playing, videoId]);
  if (playing && videoUrl) {
    return <video src={videoUrl} controls autoPlay className="h-40 rounded" />;
  }
  if (!url) return null;
  return (
    <button type="button" onClick={() => setPlaying(true)} title="Preview video">
      <img
        src={url}
        alt="Video thumbnail"
        className="h-24 rounded border border-slate-200 object-cover dark:border-slate-700"
      />
    </button>
  );
}
