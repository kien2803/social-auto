import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import {
  IconCheck,
  IconFacebook,
  IconInstagram,
  IconTikTok,
  IconUpload,
  IconYouTube,
} from '../components/icons.js';

const STATIONS = [
  { name: 'YouTube', freq: 'CH-01', scope: 'upload + read', Icon: IconYouTube },
  { name: 'TikTok', freq: 'CH-02', scope: 'video.publish', Icon: IconTikTok },
  { name: 'Instagram', freq: 'CH-03', scope: 'content_publish', Icon: IconInstagram },
  { name: 'Facebook', freq: 'CH-04', scope: 'pages_manage_posts', Icon: IconFacebook },
] as const;

const SIGNAL = [
  { time: '09:00', event: 'video received — 148 MB, checksummed, deduplicated' },
  { time: '09:00', event: 'thumbnail rendered, duration probed' },
  { time: '18:30', event: 'broadcast opens — CH-01 YouTube, CH-03 Instagram' },
  { time: '18:31', event: 'published · CH-01 OK, CH-03 retry queued (rate limit)' },
  { time: '18:46', event: 'retry succeeds · CH-03 OK — broadcast complete' },
] as const;

const STEPS = [
  { n: '01', title: 'Upload once', body: 'Drop the video in — it’s stored, checksummed and thumbnailed once, not per platform.' },
  { n: '02', title: 'Set the airtime', body: 'Pick the channels and the exact minute each one goes live. Per-platform captions and visibility.' },
  { n: '03', title: 'Station transmits', body: 'The relay publishes on schedule, retries transient failures and logs every transmission.' },
] as const;

// Uneven cadence on purpose — manual uploads don't happen on a metronome.
const MANUAL_TEMPO = [0, 1.85, 4.1, 6.3] as const;

// The fan-out scene: SVG paths (viewBox 320x200) from the upload node at
// (160,182) up to each platform receiver. x/y are the endpoints in %, where
// the HTML nodes sit — they stay aligned since the svg stretches with them.
const FANOUT = [
  { d: 'M160 182 C 95 140 55 95 40 44', x: 12.5, y: 22, name: 'YouTube', Icon: IconYouTube },
  { d: 'M160 182 C 132 122 120 72 120 30', x: 37.5, y: 15, name: 'TikTok', Icon: IconTikTok },
  { d: 'M160 182 C 188 122 200 72 200 30', x: 62.5, y: 15, name: 'Instagram', Icon: IconInstagram },
  { d: 'M160 182 C 225 140 265 95 280 44', x: 87.5, y: 22, name: 'Facebook', Icon: IconFacebook },
] as const;

function Eq({ className = '', bars = 3, delay = 0 }: { className?: string; bars?: number; delay?: number }) {
  return (
    <span className={`flex items-end gap-[2px] ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, b) => (
        <span
          key={b}
          className="h-full w-[2px] origin-bottom animate-eq rounded-sm bg-current"
          style={{ animationDelay: `${delay + b * 0.17}s` }}
        />
      ))}
    </span>
  );
}

function LiveDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-1.5 w-1.5 ${className}`} aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-brand-500 opacity-75" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-brand-500" />
    </span>
  );
}

const CAPABILITIES = [
  ['Encrypted channel auth', 'OAuth per platform, tokens sealed at rest, many channels per account.'],
  ['Upload once', 'Stream to storage, sha-256 dedup, thumbnail generated on ingest.'],
  ['Transmission schedule', 'Exact-time publishing, per-platform captions and visibility.'],
  ['Self-healing send', 'Backoff retries on transient failure; dead letters get flagged, not dropped.'],
  ['Quota governor', 'Per-platform daily budgets tracked so a burst never burns your API limit.'],
  ['Broadcast log', 'Full publish history, channel stats and per-platform analytics.'],
] as const;

type RevealVariant = 'up' | 'left' | 'pop';

const HIDDEN: Record<RevealVariant, string> = {
  up: 'translate-y-6 opacity-0 blur-[3px]',
  left: '-translate-x-6 opacity-0 blur-[2px]',
  pop: 'scale-90 opacity-0 blur-[2px]',
};

const EASE: Record<RevealVariant, string> = {
  up: 'cubic-bezier(0.22, 1, 0.36, 1)',
  left: 'cubic-bezier(0.22, 1, 0.36, 1)',
  pop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

function Reveal({
  children,
  delay = 0,
  variant = 'up',
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  variant?: RevealVariant;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms`, transitionTimingFunction: EASE[variant] }}
      className={`${className} transition-all duration-[900ms] ${
        seen ? 'translate-x-0 translate-y-0 scale-100 opacity-100 blur-0' : HIDDEN[variant]
      }`}
    >
      {children}
    </div>
  );
}

// Storyboard coordinates for the hero broadcast scene — each beat owns
// the stage alone. lx/ly = line-endpoint % (scene 3, viewBox 360x300,
// source node at 180,174); rx = row slot % (scene 5); tint = skin accent.
const SCENE = [
  { name: 'YouTube', Icon: IconYouTube, tint: '#ff0033', lx: '12%', ly: '30%', rx: '14%', d: 'M180 174 C 110 150 60 120 43 90' },
  { name: 'TikTok', Icon: IconTikTok, tint: '#fe2c55', lx: '38%', ly: '22%', rx: '38%', d: 'M180 174 C 150 140 140 100 137 66' },
  { name: 'Instagram', Icon: IconInstagram, tint: '#e1306c', lx: '62%', ly: '22%', rx: '62%', d: 'M180 174 C 210 140 220 100 223 66' },
  { name: 'Facebook', Icon: IconFacebook, tint: '#1877f2', lx: '88%', ly: '30%', rx: '86%', d: 'M180 174 C 250 150 300 120 317 90' },
] as const;

function ClipCard({ className = '' }: { className?: string }) {
  return (
    <span
      className={`flex w-16 items-center gap-1.5 rounded-sm border border-stone-200 bg-surface px-2 py-1.5 shadow-lift dark:border-stone-600 dark:bg-[#2a251f] ${className}`}
    >
      <span className="flex h-4 w-6 shrink-0 items-center justify-center rounded-[2px] bg-ink/90 dark:bg-black/60">
        <svg viewBox="0 0 6 8" className="h-1.5 w-1.5 fill-stone-200" aria-hidden="true">
          <path d="M0 0 L6 4 L0 8 Z" />
        </svg>
      </span>
      <span className="truncate font-mono text-[8px] text-ink-muted dark:text-stone-400">clip.mp4</span>
    </span>
  );
}

/** The one clip thumbnail shared by every platform card. */
function Thumb({ i, className = '' }: { i: number; className?: string }) {
  return (
    <span className={`relative block bg-ink/90 dark:bg-black/60 ${className}`}>
      <svg viewBox="0 0 6 8" className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 fill-stone-200" aria-hidden="true">
        <path d="M0 0 L6 4 L0 8 Z" />
      </svg>
      <Eq className="absolute bottom-0.5 right-0.5 h-1.5 text-brand-400" bars={3} delay={i * 0.3} />
      <span className="absolute bottom-0.5 left-0.5 rounded-[2px] bg-black/70 px-0.5 font-mono text-[6px] text-stone-300">
        01:42
      </span>
    </span>
  );
}

function MiniHeart({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function MiniComment({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 01-9 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.2a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 019-8.5 8.38 8.38 0 019 8z" />
    </svg>
  );
}

function MiniShare({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" />
    </svg>
  );
}

/** Each platform keeps its own frame around the same clip —
 *  YouTube is a 16:9 watch card; TikTok, Instagram and Facebook are
 *  9:16 reels, each with its own chrome (action rail, follow chip,
 *  reels badge). */
function PlatformCard({ name, i }: { name: string; i: number }) {
  if (name === 'YouTube') {
    return (
      <span className="block w-[96px] overflow-hidden rounded-md border border-stone-200 bg-surface shadow-lift dark:border-stone-600 dark:bg-[#2a251f]">
        <span className="relative block">
          <Thumb i={i} className="h-[54px]" />
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-stone-400/40">
            <span className="block h-full w-2/3 bg-[#ff0033]" />
          </span>
        </span>
        <span className="block px-1.5 py-1.5">
          <span className="block h-1 w-4/5 rounded-sm bg-ink/50 dark:bg-stone-500" />
          <span className="mt-1 block h-1 w-1/2 rounded-sm bg-ink/25 dark:bg-stone-600" />
          <span className="mt-1 block font-mono text-[6.5px] text-ink-subtle dark:text-stone-500">
            1.2K views · just now
          </span>
        </span>
      </span>
    );
  }
  if (name === 'TikTok') {
    return (
      <span className="relative block h-[92px] w-[52px] overflow-hidden rounded-md border border-stone-700 bg-[#171315] shadow-lift">
        <Thumb i={i} className="h-full" />
        <span className="absolute bottom-5 right-1 flex flex-col items-center gap-2 text-stone-200">
          <MiniHeart className="h-2.5 w-2.5" />
          <MiniComment className="h-2.5 w-2.5" />
          <MiniShare className="h-2.5 w-2.5" />
        </span>
        <span className="absolute inset-x-1.5 bottom-1 truncate font-mono text-[6px] text-stone-300">
          @studio · clip.mp4
        </span>
      </span>
    );
  }
  if (name === 'Instagram') {
    return (
      <span className="relative block h-[92px] w-[52px] overflow-hidden rounded-md border border-stone-600 bg-[#211d18] shadow-lift">
        <Thumb i={i} className="h-full" />
        <span className="absolute right-1 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-stone-200">
          <MiniHeart className="h-2 w-2" />
          <MiniComment className="h-2 w-2" />
          <MiniShare className="h-2 w-2" />
        </span>
        <span className="absolute inset-x-1 bottom-1 flex flex-col gap-0.5">
          <span className="flex items-center gap-0.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)' }}
            />
            <span className="font-mono text-[6px] text-stone-200">studio</span>
            <span className="rounded-[2px] border border-stone-400/60 px-0.5 font-mono text-[5.5px] text-stone-200">
              Follow
            </span>
          </span>
          <span className="truncate font-mono text-[5.5px] text-stone-400">♪ original audio</span>
        </span>
      </span>
    );
  }
  // Facebook reels
  return (
    <span className="relative block h-[92px] w-[52px] overflow-hidden rounded-md border border-stone-600 bg-[#1a1e24] shadow-lift">
      <Thumb i={i} className="h-full" />
      <span className="absolute left-1 top-1 rounded-[2px] bg-black/60 px-1 font-mono text-[6px] uppercase tracking-wider text-stone-200">
        Reels
      </span>
      <span className="absolute bottom-6 right-1 flex flex-col items-center gap-1.5 text-stone-200">
        <MiniHeart className="h-2.5 w-2.5" />
        <MiniComment className="h-2.5 w-2.5" />
        <MiniShare className="h-2.5 w-2.5" />
      </span>
      <span className="absolute inset-x-1 bottom-1 flex items-center gap-0.5">
        <span className="flex h-2 w-2 items-center justify-center rounded-full bg-[#1877f2]">
          <IconFacebook className="h-1.5 w-1.5 text-white" />
        </span>
        <span className="font-mono text-[6px] text-stone-200">Studio</span>
        <span className="rounded-[2px] bg-[#1877f2] px-0.5 font-mono text-[5.5px] text-white">Follow</span>
      </span>
    </span>
  );
}

/** The card that sits at center and cycles all four platform skins while
 *  the same video keeps playing inside — scene 4 of the storyboard. */
function MorphCard() {
  return (
    <span className="relative block w-40 rounded-md border border-stone-200 bg-surface shadow-lift dark:border-stone-600 dark:bg-[#2a251f]">
      {/* tinted rings — one per platform skin */}
      {SCENE.map(({ name, tint }, i) => (
        <span
          key={name}
          className="bc-anim absolute -inset-px rounded-md border-2 opacity-0 animate-bc-skin"
          style={{ borderColor: tint, animationDelay: `${i * 0.65}s` }}
        />
      ))}
      {/* header chrome — swaps platform every ~0.65s */}
      <span className="relative flex h-7 items-center border-b border-stone-200 dark:border-stone-700">
        {SCENE.map(({ name, Icon, tint }, i) => (
          <span
            key={name}
            className="bc-anim absolute inset-0 flex items-center gap-1.5 rounded-t-md bg-surface px-2.5 opacity-0 animate-bc-skin dark:bg-[#2a251f]"
            style={{ animationDelay: `${i * 0.65}s` }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: tint }} />
            <span
              className="truncate font-mono text-[9px] uppercase tracking-wider"
              style={{ color: tint }}
            >
              {name}
            </span>
          </span>
        ))}
      </span>
      {/* the same clip, whichever skin is on */}
      <span className="relative m-2.5 flex h-20 items-center justify-center rounded-[2px] bg-ink/90 dark:bg-black/60">
        <svg viewBox="0 0 6 8" className="h-4 w-4 fill-stone-200" aria-hidden="true">
          <path d="M0 0 L6 4 L0 8 Z" />
        </svg>
        <Eq className="absolute bottom-1 right-1 h-2.5 text-brand-400" bars={3} />
      </span>
      <span className="block px-2.5 pb-2.5 font-mono text-[9px] text-ink-subtle dark:text-stone-500">
        clip.mp4 · 01:42
      </span>
    </span>
  );
}

/** Looped 15s storyboard in the hero — five scenes, each owning the whole
 *  stage alone: (1) cursor drags the clip in + clicks transmit, (3) lines
 *  ignite to the platforms, (4) one card cycles all platform skins with
 *  the same video, (5) it splits into four platform cards, (6) logo.
 *  Pure CSS/SVG; freezes on the logo scene under prefers-reduced-motion. */
function BroadcastScene() {
  return (
    <figure
      aria-hidden="true"
      className="relative aspect-[6/5] animate-hero-in select-none overflow-hidden rounded-md border border-stone-200 bg-ink/[0.03] shadow-inlay dark:border-stone-700 dark:bg-black/30"
      style={{
        animationDelay: '300ms',
        // faint monitor grid, like graph paper behind the feed
        backgroundImage:
          'linear-gradient(rgba(95,85,72,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(95,85,72,0.07) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
      }}
    >
      {/* monitor HUD — always on, like a camera feed overlay */}
      <span className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
        <span>tx-feed · cam-01</span>
        <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-500">
          <LiveDot /> rec
        </span>
      </span>
      {/* scene progress dots — each lights while its scene owns the stage */}
      <span className="absolute bottom-2.5 right-3 z-10 flex items-center gap-1.5">
        {['animate-bc-s1', 'animate-bc-s3', 'animate-bc-s4', 'animate-bc-s5', 'animate-bc-s6'].map((c, i) => (
          <span
            key={c}
            className={`bc-anim h-1.5 w-1.5 rounded-full bg-brand-500 ${i < 4 ? 'opacity-0' : ''} ${c}`}
          />
        ))}
      </span>

      {/* Scene 1 — drag the clip into the dropzone, click transmit (0–5s) */}
      <span className="bc-anim absolute inset-0 opacity-0 animate-bc-s1">
        <span className="bc-anim absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 animate-bc-dz">
          <span className="flex h-16 w-24 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-brand-400/80 bg-surface dark:bg-[#2a251f]">
            <IconUpload className="h-5 w-5 text-brand-600 dark:text-brand-500" />
            <span className="font-mono text-[8px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
              drop video
            </span>
          </span>
        </span>
        <span className="bc-anim absolute animate-bc-clip" style={{ left: '18%', top: '60%' }}>
          <ClipCard />
        </span>
        <span
          className="bc-anim absolute h-10 w-20 rounded-sm border-2 border-dashed border-brand-400/80 animate-bc-track"
          style={{ left: '18%', top: '60%' }}
        />
        <span className="bc-anim absolute left-1/2 top-[64%] animate-bc-btn">
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-brand-500 px-4 py-2 font-display text-xs font-semibold text-white shadow-press">
            Transmit
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          className="bc-anim absolute h-4 w-4 -translate-x-[2px] -translate-y-[2px] animate-bc-cursor text-ink drop-shadow-md dark:text-stone-100"
          style={{ left: '12%', top: '72%' }}
        >
          <path d="M1 0 L1 12 L4.5 9.5 L7 14 L9 13 L6.5 8.5 L11 8 Z" fill="currentColor" stroke="white" strokeWidth="0.8" />
        </svg>
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          ingest
        </span>
      </span>

      {/* Scene 3 — lines ignite, sparks ride them to the platforms (5–7s) */}
      <span className="bc-anim absolute inset-0 opacity-0 animate-bc-s3">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 360 300" preserveAspectRatio="none" fill="none">
          {SCENE.map(({ name, d }, i) => (
            <g key={name}>
              <path d={d} pathLength={100} stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" className="text-stone-300 dark:text-stone-600" opacity="0.6" />
              <path
                d={d}
                pathLength={100}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="100"
                className="bc-anim animate-bc-line text-brand-500"
                style={{ animationDelay: `${i * -0.15}s`, filter: 'drop-shadow(0 0 4px rgba(224,78,20,0.55))' }}
              />
              <path
                d={d}
                pathLength={100}
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 96"
                className="bc-anim animate-bc-spark text-brand-300"
                style={{ animationDelay: `${i * -0.25}s` }}
              />
            </g>
          ))}
        </svg>
        <span className="absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2">
          <span className="flex h-12 w-12 items-center justify-center rounded-md border border-stone-200 bg-surface shadow-lift dark:border-stone-600 dark:bg-[#2a251f]">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
          </span>
        </span>
        {SCENE.map(({ name, Icon, lx, ly, tint }) => (
          <span
            key={`recv-${name}`}
            className="bc-anim absolute -translate-x-1/2 -translate-y-1/2 animate-bc-recv"
            style={{ left: lx, top: ly }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-surface shadow-soft dark:border-stone-600 dark:bg-[#2a251f]">
              <Icon className="h-4 w-4" style={{ color: tint }} />
            </span>
          </span>
        ))}
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          relay
        </span>
      </span>

      {/* Scene 4 — one card cycles every platform skin, same video (7–10s) */}
      <span className="bc-anim absolute inset-0 flex items-center justify-center opacity-0 animate-bc-s4">
        <MorphCard />
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          preview
        </span>
      </span>

      {/* Scene 5 — the card splits into four platform cards (10–14s) */}
      <span className="bc-anim absolute inset-0 opacity-0 animate-bc-s5">
        {SCENE.map(({ name, Icon, rx }, i) => (
          <span
            key={`copy-${name}`}
            className="bc-anim absolute animate-bc-copy"
            style={{ left: rx, top: '48%', '--fx': rx, '--fy': '48%' } as React.CSSProperties}
          >
            <PlatformCard name={name} i={i} />
            <span className="bc-anim absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 animate-bc-check items-center justify-center rounded-full bg-success-500 text-white">
              <IconCheck className="h-2 w-2" />
            </span>
          </span>
        ))}
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          fan-out
        </span>
      </span>

      {/* Scene 6 — sign-off (14–15s) */}
      <span className="bc-anim absolute inset-0 flex items-center justify-center animate-bc-s6">
        <span className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute inset-0 animate-ring rounded-full border border-brand-500/40 dark:border-brand-500/30" />
          <span className="absolute inset-0 animate-ring rounded-full border border-brand-500/40 [animation-delay:1.4s] dark:border-brand-500/30" />
          <span className="absolute inset-0 animate-ring rounded-full border border-brand-500/40 [animation-delay:2.8s] dark:border-brand-500/30" />
        </span>
        <span className="relative flex flex-col items-center gap-2.5">
          <img src="/logo.svg" alt="" className="h-14 w-14" />
          <span className="font-display text-base font-semibold tracking-tight">Omnicast</span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
            one upload · every channel
          </span>
        </span>
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          sign-off
        </span>
      </span>
    </figure>
  );
}

export function LandingPage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-surface-muted font-sans text-ink dark:bg-[#1c1917] dark:text-stone-100">
      {/* Station header */}
      <header className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Omnicast" className="h-8 w-8" />
            <span className="font-display text-lg font-semibold tracking-tight">Omnicast</span>
          </Link>
          <nav className="flex items-center gap-2">
            {isAuthenticated ? (
              <Link to="/dashboard" className="btn-primary">Open Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">Sign in</Link>
                <Link to="/register" className="btn-primary">Get started</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Act I — masthead + a live relay console */}
      <section className="relative overflow-hidden border-b border-stone-200 dark:border-stone-800">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {/* drifting carrier waves — each layer also bobs, so the drift
              never reads as a straight conveyor belt */}
          <div className="absolute bottom-8 left-0 h-14 w-full animate-bob-a">
            <svg
              className="h-full w-[200%] min-w-[1600px] animate-wave-a text-stone-300/80 dark:text-stone-700/70"
              viewBox="0 0 2400 64"
              preserveAspectRatio="none"
              fill="none"
            >
              <path
                d="M0 32 Q150 8 300 32 T600 32 T900 32 T1200 32 T1500 32 T1800 32 T2100 32 T2400 32"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="absolute bottom-14 left-0 h-14 w-full animate-bob-b">
            <svg
              className="h-full w-[200%] min-w-[1600px] animate-wave-b text-brand-500/25 dark:text-brand-500/20"
              viewBox="0 0 2400 64"
              preserveAspectRatio="none"
              fill="none"
            >
              <path
                d="M0 38 Q150 58 300 38 T600 38 T900 38 T1200 38 T1500 38 T1800 38 T2100 38 T2400 38"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          {/* tuner sweeps — two hairlines scanning the band, out of phase */}
          <div className="absolute inset-y-0 w-px animate-sweep bg-stone-400/40 dark:bg-stone-500/30" />
          <div className="absolute inset-y-0 w-px animate-sweep bg-stone-300/50 [animation-delay:-6.5s] dark:bg-stone-600/40" />
        </div>

        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 pb-14 pt-12 md:grid-cols-[1.15fr_1fr] md:items-center md:gap-14 md:pt-20">
          <div>
            <p className="flex animate-hero-in items-center gap-2 font-mono text-xs text-brand-600 dark:text-brand-500">
              <LiveDot />
              on air · multi-platform video scheduler
            </p>
            <h1
              className="mt-4 max-w-2xl animate-hero-in font-display text-4xl font-semibold leading-[1.06] tracking-tight md:text-6xl"
              style={{ animationDelay: '120ms' }}
            >
              One upload. Every channel, on schedule.
            </h1>
            <p
              className="mt-6 max-w-xl animate-hero-in text-base leading-relaxed text-ink-muted dark:text-stone-400"
              style={{ animationDelay: '240ms' }}
            >
              Omnicast takes a single video and transmits it to YouTube, TikTok,
              Instagram and Facebook at the times you set — retries, quotas and
              history handled by the station, not by you.
            </p>
            <div
              className="mt-8 flex animate-hero-in flex-wrap items-center gap-3"
              style={{ animationDelay: '360ms' }}
            >
              {isAuthenticated ? (
                <Link to="/dashboard" className="btn-primary px-6 py-3 text-base">Open Dashboard</Link>
              ) : (
                <>
                  <Link to="/register" className="btn-primary px-6 py-3 text-base">Create free account</Link>
                  <Link to="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>
                </>
              )}
            </div>
            <p
              className="mt-6 animate-hero-in font-mono text-[11px] uppercase tracking-widest text-ink-subtle dark:text-stone-500"
              style={{ animationDelay: '460ms' }}
            >
              4 platforms · exact-time scheduling · retries built in
            </p>
          </div>
          <BroadcastScene />
        </div>
      </section>

      {/* Act II — the channels this station is tuned to */}
      <div className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 px-6 sm:grid-cols-4 sm:gap-x-0">
          {STATIONS.map(({ name, freq, scope, Icon }, i) => (
            <Reveal
              key={name}
              variant="pop"
              delay={i * 90}
              className="group flex items-center gap-3.5 border-stone-200 py-6 transition-colors hover:bg-surface sm:-mx-3 sm:border-l sm:pl-9 sm:pr-3 sm:first:border-l-0 sm:first:pl-3 dark:border-stone-800 dark:hover:bg-[#221e19]"
            >
              <Icon className="h-6 w-6 shrink-0 text-ink-subtle transition-all duration-300 group-hover:-translate-y-0.5 group-hover:text-brand-600 dark:text-stone-500 dark:group-hover:text-brand-500" />
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
                  {freq} · {scope}
                </span>
                <span className="truncate font-display text-sm font-medium">{name}</span>
              </span>
              <Eq className="ml-auto h-3.5 text-ink-subtle/70 dark:text-stone-600" delay={i * 0.45} />
            </Reveal>
          ))}
        </div>
      </div>

      {/* How a broadcast gets on air — three steps */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <Reveal>
            <p className="font-mono text-xs text-brand-600 dark:text-brand-500">how it works</p>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Three steps to air
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 sm:grid-cols-3 dark:border-stone-800 dark:bg-stone-800">
            {STEPS.map((s, i) => (
              <Reveal
                key={s.n}
                delay={i * 110}
                className="bg-surface-muted px-6 py-6 dark:bg-[#1c1917]"
              >
                <p className="font-mono text-xs text-brand-600 dark:text-brand-500">{s.n}</p>
                <h3 className="mt-2 font-display text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted dark:text-stone-400">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Act III — the relay vs. the transmission */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <Reveal>
            <p className="font-mono text-xs text-brand-600 dark:text-brand-500">
              the relay → the broadcast
            </p>
            <h2 className="mt-3 max-w-2xl font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Same video, four uploads — or one click.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-muted dark:text-stone-400">
              Cross-posting by hand means signing in and uploading to every
              platform, one account at a time. Omnicast turns it into a single
              transmission: upload once and the station relays it to every
              channel at once.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-10 sm:grid-cols-2 sm:gap-8">
            {/* before — one upload per platform, one at a time */}
            <Reveal variant="left" delay={120}>
              <figure>
                <figcaption className="flex items-baseline justify-between border-b border-stone-200 pb-3 font-mono text-[11px] uppercase tracking-widest text-ink-subtle dark:border-stone-800 dark:text-stone-500">
                  <span>by hand</span>
                  <span>4 uploads · serial</span>
                </figcaption>
                <div className="mt-6 space-y-3">
                  {STATIONS.map(({ name, Icon }, i) => (
                    <div
                      key={name}
                      className="rounded-sm border border-stone-200 bg-surface px-3 py-2.5 shadow-soft dark:border-stone-700 dark:bg-[#262019]"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-ink-subtle dark:text-stone-500" />
                        <span className="font-mono text-[10px] text-ink-muted dark:text-stone-400">
                          {name} · uploading…
                        </span>
                        <span
                          className="ml-auto animate-done-pop font-mono text-[9px] uppercase tracking-widest text-success-500"
                          style={{ animationDelay: `${MANUAL_TEMPO[i]}s` }}
                        >
                          done
                        </span>
                      </div>
                      <div className="relative mt-2 h-1 rounded-sm bg-stone-200 dark:bg-stone-700">
                        <div
                          className="absolute inset-y-0 left-0 w-0 animate-sig-bar rounded-sm bg-brand-500"
                          style={{ animationDelay: `${MANUAL_TEMPO[i]}s` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-6 font-mono text-[11px] text-ink-subtle dark:text-stone-500">
                  elapsed — one channel at a time
                </p>
              </figure>
            </Reveal>

            {/* after — one upload, relayed everywhere at once */}
            <Reveal delay={240}>
              <figure>
                <figcaption className="flex items-baseline justify-between border-b border-stone-200 pb-3 font-mono text-[11px] uppercase tracking-widest text-ink-subtle dark:border-stone-800 dark:text-stone-500">
                  <span>on omnicast</span>
                  <span>1 upload · parallel</span>
                </figcaption>
                {/* transmission map — packets ride the curves to every
                    platform at once; receivers flash as each packet lands */}
                <div className="relative mt-6 h-60" role="img" aria-label="One upload relayed to YouTube, TikTok, Instagram and Facebook at the same time">
                  <svg
                    className="absolute inset-0 h-full w-full text-stone-300 dark:text-stone-600"
                    viewBox="0 0 320 200"
                    preserveAspectRatio="none"
                    fill="none"
                    aria-hidden="true"
                  >
                    {FANOUT.map(({ d }) => (
                      <path key={d} d={d} stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" />
                    ))}
                    {FANOUT.flatMap(({ d }, i) =>
                      [0, 1.3].map((off) => (
                        <circle key={`${i}-${off}`} r="3" className="motion-hide fill-brand-500">
                          <animateMotion dur="2.6s" begin={`${i * 0.4 + off}s`} repeatCount="indefinite" path={d} />
                        </circle>
                      )),
                    )}
                  </svg>
                  {FANOUT.map(({ x, y, name, Icon }, i) => (
                    <span
                      key={name}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${x}%`, top: `${y}%` }}
                    >
                      <span
                        className="flex animate-node-pop flex-col items-center gap-1"
                        style={{ animationDelay: `${i * 0.4}s` }}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-stone-200 bg-surface shadow-soft dark:border-stone-700 dark:bg-[#262019]">
                          <Icon className="h-4 w-4 text-ink dark:text-stone-200" />
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
                          {name}
                        </span>
                      </span>
                    </span>
                  ))}
                  <span className="absolute left-1/2 top-[91%] flex h-14 w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-sm border border-stone-200 bg-surface shadow-soft dark:border-stone-700 dark:bg-[#262019]">
                    <span className="absolute inset-0 animate-ring rounded-sm border border-brand-500/50" />
                    <IconUpload className="h-4 w-4 text-brand-600 dark:text-brand-500" />
                    <span className="font-mono text-[9px] text-ink-subtle dark:text-stone-500">clip.mp4</span>
                  </span>
                </div>
                <p className="mt-6 font-mono text-[11px] text-ink-subtle dark:text-stone-500">
                  queued — every channel at once
                </p>
              </figure>
            </Reveal>
          </div>
        </div>
      </section>

      {/* The proof — a broadcast day, logged */}
      <section className="border-b border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <Reveal>
            <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold">
              A broadcast day
              <LiveDot />
            </h2>
          </Reveal>
          <div className="mt-4 border-t border-stone-200 font-mono text-sm dark:border-stone-800">
            {SIGNAL.map((e, i) => (
              <Reveal
                key={i}
                variant="left"
                delay={i * 90}
                className="grid grid-cols-[64px_1fr] gap-4 border-b border-stone-200 py-3.5 dark:border-stone-800"
              >
                <span className="text-ink-subtle dark:text-stone-500">{e.time}</span>
                <span className="text-ink-muted dark:text-stone-300">{e.event}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Act IV — what the station handles for you */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <Reveal>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Inside the station</h2>
              <Eq className="h-5 text-brand-500/80" bars={5} />
            </div>
          </Reveal>
          <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-stone-800 dark:bg-stone-800">
            {CAPABILITIES.map(([title, body], i) => (
              <Reveal
                key={title}
                delay={i * 60}
                className="group bg-surface-muted px-5 py-5 transition-colors hover:bg-surface dark:bg-[#1c1917] dark:hover:bg-[#221e19]"
              >
                <h3 className="font-display text-sm font-semibold transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-500">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted dark:text-stone-400">{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Sign off */}
      {!isAuthenticated && (
        <section className="relative overflow-hidden border-b border-stone-200 dark:border-stone-800">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute bottom-6 left-0 h-14 w-full">
              <svg
                className="h-full w-[200%] min-w-[1600px] animate-wave-a text-brand-500/15 dark:text-brand-500/10"
                viewBox="0 0 2400 64"
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  d="M0 32 Q150 8 300 32 T600 32 T900 32 T1200 32 T1500 32 T1800 32 T2100 32 T2400 32"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            <div className="absolute right-10 top-1/2 hidden h-28 w-28 -translate-y-1/2 md:block">
              <span className="absolute inset-0 animate-ring rounded-full border border-brand-500/50 dark:border-brand-500/40" />
              <span className="absolute inset-0 animate-ring rounded-full border border-brand-500/50 [animation-delay:1.4s] dark:border-brand-500/40" />
              <span className="absolute inset-0 animate-ring rounded-full border border-brand-500/50 [animation-delay:2.8s] dark:border-brand-500/40" />
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full bg-brand-500" />
            </div>
          </div>
          <div className="relative mx-auto max-w-6xl px-6 py-16 md:py-20">
            <Reveal>
              <p className="font-mono text-xs text-brand-600 dark:text-brand-500">sign off</p>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">Go on air</h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted dark:text-stone-400">
                Create an account, connect a channel, and schedule your first
                broadcast in minutes.
              </p>
              <Link to="/register" className="btn-primary mt-7 inline-flex px-6 py-3 text-base">
                Get started
              </Link>
            </Reveal>
          </div>
        </section>
      )}

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-xs text-ink-subtle dark:text-stone-500">
        <span>Omnicast — video scheduling for YouTube, TikTok, Instagram &amp; Facebook</span>
        <span className="flex items-center gap-4">
          <Link to="/terms" className="underline underline-offset-2 hover:text-ink dark:hover:text-stone-300">Terms</Link>
          <Link to="/privacy" className="underline underline-offset-2 hover:text-ink dark:hover:text-stone-300">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}
