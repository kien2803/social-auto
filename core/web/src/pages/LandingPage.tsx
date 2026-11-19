import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { motion, useReducedMotion } from 'motion/react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { CustomEase } from 'gsap/CustomEase';
import {
  IconCheck,
  IconFacebook,
  IconInstagram,
  IconTikTok,
  IconUpload,
  IconYouTube,
} from '../components/icons.js';

gsap.registerPlugin(useGSAP, ScrollTrigger, MotionPathPlugin, CustomEase);

// One curve for the whole page (unslop motion token).
const SOFT = CustomEase.create('soft-out', '0.22, 1, 0.36, 1');

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

/** Word-by-word headline rise — each word clipped in an overflow mask,
 *  staggered ~55ms. Falls back to plain text under reduced-motion. */
function RevealWords({ text, className = '' }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;
  const words = text.split(' ');
  return (
    <span className={className} aria-hidden="true">
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className="inline-block will-change-transform"
            initial={{ y: '110%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 0.7, delay: 0.15 + i * 0.055, ease: [0.22, 1, 0.36, 1] }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

type RevealVariant = 'up' | 'left' | 'pop';

const REVEAL_FROM: Record<RevealVariant, gsap.TweenVars> = {
  up: { y: 12 },
  left: { x: -12 },
  pop: { scale: 0.96 },
};

/** Scroll-driven entrance — one fade+rise, transform/opacity only. */
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

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          el,
          { autoAlpha: 0, ...REVEAL_FROM[variant] },
          {
            autoAlpha: 1,
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.55,
            delay: delay / 1000,
            ease: SOFT,
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          },
        );
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
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
          <span className="truncate font-mono text-[5.5px] text-stone-400">original audio</span>
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
 *  the same video keeps playing inside — scene 4 of the storyboard. The
 *  timeline flips it edge-on (rotationY) and swaps ring + header mid-flip. */
function MorphCard() {
  return (
    <span
      data-morph
      className="relative block w-40 rounded-md border border-stone-200 bg-surface shadow-lift dark:border-stone-600 dark:bg-[#2a251f]"
    >
      {/* tinted rings — one per platform skin, the timeline picks one */}
      {SCENE.map(({ name, tint }) => (
        <span
          key={name}
          data-ring
          className="absolute -inset-px rounded-md border-2 opacity-0"
          style={{ borderColor: tint }}
        />
      ))}
      {/* header chrome — swaps platform at each flip */}
      <span className="relative flex h-7 items-center border-b border-stone-200 dark:border-stone-700">
        {SCENE.map(({ name, Icon, tint }) => (
          <span
            key={name}
            data-head
            className="absolute inset-0 flex items-center gap-1.5 rounded-t-md bg-surface px-2.5 opacity-0 dark:bg-[#2a251f]"
          >
            <Icon className="h-3.5 w-3.5" style={{ color: tint }} />
            <span className="truncate font-mono text-[9px] uppercase tracking-wider" style={{ color: tint }}>
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

/** Looped 15s storyboard in the hero — a GSAP master timeline. Five scene
 *  layers each own the stage alone: (1) cursor drags the clip in + clicks
 *  transmit, (3) lines ignite to the platforms, (4) one card cycles all
 *  platform skins with the same video, (5) it splits into four platform
 *  cards, (6) logo sign-off. Positions are %-anchored in CSS; every motion
 *  is a transform measured in px from the live stage size, so the cursor
 *  tip lands exactly under each element's edge. Reduced-motion shows the
 *  static sign-off frame. */
function BroadcastScene() {
  const stage = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const el = stage.current;
      if (!el) return;
      const q = gsap.utils.selector(el);
      // %-of-stage → px, re-evaluated whenever the timeline invalidates.
      const pxX = (pct: number) => () => (pct / 100) * el.clientWidth;
      const pxY = (pct: number) => () => (pct / 100) * el.clientHeight;
      // world point → transform target for an element anchored at (ax, ay)%
      const at = (x: number, y: number, ax: number, ay: number) => ({
        x: pxX(x - ax),
        y: pxY(y - ay),
      });
      // MotionPath needs concrete points — bake px from the live stage size
      // (cursor-tip world points; cursor svg anchored at 12%,72%)
      const cp = (x: number, y: number) => ({
        x: ((x - 12) / 100) * el.clientWidth,
        y: ((y - 72) / 100) * el.clientHeight,
      });
      // clip/tracker centers — both anchored at 18%,60%
      const lp = (x: number, y: number) => ({
        x: ((x - 18) / 100) * el.clientWidth,
        y: ((y - 60) / 100) * el.clientHeight,
      });

      // GSAP owns every transform on these; they were centered with CSS
      // translate before, which GSAP would overwrite.
      gsap.set(q('[data-center]'), { xPercent: -50, yPercent: -50 });
      gsap.set(q('[data-morph]'), { transformPerspective: 600 });

      let master: gsap.core.Timeline | undefined;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(q('[data-scene="s6"]'), { autoAlpha: 1 });
      });
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const cursor = q('[data-cursor]');
        const clip = q('[data-clip]');
        const track = q('[data-track]');
        const dz = q('[data-dz]');
        const btn = q('[data-btn]');
        const node = q('[data-node]');
        const lines = q('[data-line]');
        const sparks = q('[data-spark]');
        const recvs = q('[data-recv]');
        const morph = q('[data-morph]');
        const rings = q('[data-ring]');
        const heads = q('[data-head]');
        const copies = q('[data-copy]');
        const checks = q('[data-check]');
        const burst = q('[data-burst]');
        const dots = q('[data-dot]');
        const sign = q('[data-sign]');
        const s6rings = q('[data-s6ring]');

        const tl = gsap.timeline({ repeat: -1, defaults: { ease: SOFT } });
        master = tl;

        // scene layers — each beat owns the stage alone -------------------
        const bounds: [string, number, number][] = [
          ['s1', 0, 4.7],
          ['s3', 5.0, 6.8],
          ['s4', 7.0, 9.75],
          ['s5', 10.0, 13.75],
          ['s6', 13.9, 14.78],
        ];
        bounds.forEach(([n, tIn, tOut], i) => {
          tl.fromTo(
            q(`[data-scene="${n}"]`),
            { autoAlpha: 0, scale: 0.97 },
            { autoAlpha: 1, scale: 1, duration: 0.4, immediateRender: false },
            tIn,
          ).to(q(`[data-scene="${n}"]`), { autoAlpha: 0, scale: 0.97, duration: 0.35 }, tOut);
          if (dots[i]) tl.set(dots[i], { autoAlpha: 1 }, tIn).set(dots[i], { autoAlpha: 0 }, tOut);
        });

        // scene 1 — grab the clip, drag it in, click transmit (0–5s)
        // resets first: on loops 2+ elements keep their end-of-loop state
        // until their tween runs, so each beat restores its start state.
        tl.set(cursor, { x: 0, y: 0, scale: 1, autoAlpha: 0 }, 0)
          .set(clip, { x: 0, y: 0, scale: 1, rotation: -5, autoAlpha: 1 }, 0)
          .set(track, { x: 0, y: 0, scale: 1.15, autoAlpha: 0 }, 0)
          .set(dz, { scale: 1 }, 0);

        tl.fromTo(cursor, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, immediateRender: false }, 0.3)
          .to(cursor, { ...at(18, 66, 12, 72), duration: 0.6, ease: 'power2.out' }, 0.5)
          .to(
            cursor,
            {
              motionPath: { path: [cp(30, 56), cp(42, 50), cp(50, 48)], curviness: 1.3 },
              duration: 1.5,
              ease: 'power1.inOut',
            },
            1.05,
          )
          .to(cursor, { scale: 0.8, duration: 0.12 }, 2.5)
          .to(cursor, { scale: 1, duration: 0.14 }, 2.68)
          .to(cursor, { ...at(44, 69, 12, 72), duration: 0.65, ease: 'power2.inOut' }, 3.15)
          .to(cursor, { scale: 0.78, duration: 0.12 }, 4.1)
          .to(cursor, { scale: 1, duration: 0.16 }, 4.28)
          .to(cursor, { autoAlpha: 0, duration: 0.25 }, 4.55);

        tl.to(
            clip,
            {
              motionPath: { path: [lp(30, 48), lp(42, 40), lp(50, 38)], curviness: 1.3 },
              duration: 1.5,
              ease: 'power1.inOut',
            },
            1.05,
          )
          .to(clip, { rotation: 3, duration: 1.5, ease: 'power1.inOut' }, 1.05)
          .to(clip, { scale: 0.12, autoAlpha: 0, rotation: 0, duration: 0.3, ease: 'power2.in' }, 2.55);

        tl.to(track, { autoAlpha: 1, duration: 0.3 }, 0.9)
          .to(
            track,
            {
              motionPath: { path: [lp(30, 48), lp(42, 40), lp(50, 38)], curviness: 1.3 },
              duration: 1.5,
              ease: 'power1.inOut',
            },
            1.05,
          )
          .to(track, { scale: 0.3, autoAlpha: 0, duration: 0.25, ease: 'power2.in' }, 2.5);

        tl.to(dz, { scale: 1.06, duration: 0.14 }, 2.55)
          .to(dz, { scale: 1, duration: 0.22 }, 2.72)
          .to(dz, { scale: 0.95, duration: 0.1 }, 4.15)
          .to(dz, { scale: 1, duration: 0.22 }, 4.3);

        tl.fromTo(btn, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.35, immediateRender: false }, 3.0)
          .to(btn, { scale: 0.86, duration: 0.1 }, 4.1)
          .to(btn, { scale: 1, duration: 0.18 }, 4.28)
          .to(btn, { autoAlpha: 0, duration: 0.2 }, 4.55);

        // scene 3 — conductors ignite, sparks ride to the platforms (5–7s)
        tl.set(lines, { autoAlpha: 0, strokeDashoffset: 100 }, 5.01)
          .set(sparks, { autoAlpha: 0, strokeDashoffset: 100 }, 5.01)
          .set(recvs, { autoAlpha: 0, scale: 0.8 }, 5.01)
          .fromTo(node, { scale: 0.85 }, { scale: 1, duration: 0.5, immediateRender: false }, 5.1)
          .fromTo(
            lines,
            { strokeDashoffset: 100, autoAlpha: 0 },
            { strokeDashoffset: 0, autoAlpha: 1, duration: 1.0, stagger: 0.12, ease: 'power2.inOut', immediateRender: false },
            5.25,
          )
          .fromTo(
            sparks,
            { strokeDashoffset: 100, autoAlpha: 0 },
            { strokeDashoffset: 0, autoAlpha: 1, duration: 0.8, stagger: 0.12, ease: 'power1.in', immediateRender: false },
            5.8,
          )
          .fromTo(
            recvs,
            { autoAlpha: 0, scale: 0.8 },
            { autoAlpha: 1, scale: 1, duration: 0.4, stagger: 0.12, immediateRender: false },
            6.05,
          );

        // scene 4 — one card flips through every platform skin (7–10s)
        SCENE.forEach((_, i) => tl.set([rings[i], heads[i]], { autoAlpha: i === 0 ? 1 : 0 }, 7.05));
        SCENE.slice(1).forEach((_, k) => {
          const i = k + 1;
          const t = 7.1 + i * 0.68;
          tl.to(morph, { rotationY: 90, duration: 0.2, ease: 'power1.in' }, t)
            .set([rings[k], heads[k]], { autoAlpha: 0 }, t + 0.2)
            .set([rings[i], heads[i]], { autoAlpha: 1 }, t + 0.2)
            .set(morph, { rotationY: -90 }, t + 0.2)
            .to(morph, { rotationY: 0, duration: 0.2, ease: 'power1.out' }, t + 0.2);
        });

        // scene 5 — the card splits into four platform cards (10–14s)
        tl.set(copies, { autoAlpha: 0 }, 10.02)
          .set(checks, { autoAlpha: 0 }, 10.02)
          .fromTo(
          burst,
          { autoAlpha: 0.6, scale: 0.2 },
          { autoAlpha: 0, scale: 2.4, duration: 0.7, ease: 'power2.out', immediateRender: false },
          10.05,
        );
        copies.forEach((copy, i) => {
          const rx = parseFloat((copy as HTMLElement).dataset.rx ?? '50');
          tl.fromTo(
            copy,
            { x: pxX(50 - rx), y: pxY(-2), scale: 1.1, rotation: (i - 1.5) * 7, autoAlpha: 0 },
            { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.85, immediateRender: false },
            10.1 + i * 0.16,
          );
        });
        tl.fromTo(
          checks,
          { autoAlpha: 0, scale: 0.4 },
          { autoAlpha: 1, scale: 1, duration: 0.3, stagger: 0.16, immediateRender: false },
          11.15,
        );

        // scene 6 — sign-off (14–15s)
        tl.set(sign, { autoAlpha: 0 }, 13.9)
          .set(s6rings, { autoAlpha: 0 }, 13.9)
          .fromTo(
          sign,
          { autoAlpha: 0, y: 12, scale: 0.9 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, immediateRender: false },
          13.95,
        ).fromTo(
          s6rings,
          { autoAlpha: 0.5, scale: 0.5 },
          { autoAlpha: 0, scale: 1.5, duration: 0.9, stagger: 0.12, ease: 'power2.out', immediateRender: false },
          14.0,
        );
      });

      // Stage is %-positioned; re-derive px targets if it ever resizes.
      const ro = new ResizeObserver(() => master?.invalidate());
      ro.observe(el);
      return () => ro.disconnect();
    },
    { scope: stage },
  );

  return (
    <figure
      ref={stage}
      aria-hidden="true"
      data-ui
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
      {/* scene progress dots — the timeline lights each while its scene owns the stage */}
      <span className="absolute bottom-2.5 right-3 z-10 flex items-center gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} data-dot className="h-1.5 w-1.5 rounded-full bg-brand-500 opacity-0" />
        ))}
      </span>

      {/* Scene 1 — drag the clip into the dropzone, click transmit (0–5s) */}
      <span data-scene="s1" className="absolute inset-0 opacity-0">
        <span data-dz className="absolute left-1/2 top-[38%]">
          <span className="flex h-16 w-24 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-brand-400/80 bg-surface dark:bg-[#2a251f]">
            <IconUpload className="h-5 w-5 text-brand-600 dark:text-brand-500" />
            <span className="font-mono text-[8px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
              drop video
            </span>
          </span>
        </span>
        <span data-clip data-center className="absolute" style={{ left: '18%', top: '60%' }}>
          <ClipCard />
        </span>
        <span
          data-track
          data-center
          className="absolute h-10 w-20 rounded-sm border-2 border-dashed border-brand-400/80 opacity-0"
          style={{ left: '18%', top: '60%' }}
        />
        <span data-btn data-center className="absolute left-1/2 top-[64%] opacity-0">
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-brand-500 px-4 py-2 font-display text-xs font-semibold text-white shadow-press">
            Transmit
          </span>
        </span>
        <svg
          data-cursor
          viewBox="0 0 16 16"
          className="absolute h-4 w-4 text-ink opacity-0 drop-shadow-md dark:text-stone-100"
          style={{ left: '12%', top: '72%' }}
        >
          <path d="M1 0 L1 12 L4.5 9.5 L7 14 L9 13 L6.5 8.5 L11 8 Z" fill="currentColor" stroke="white" strokeWidth="0.8" />
        </svg>
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          ingest
        </span>
      </span>

      {/* Scene 3 — lines ignite, sparks ride them to the platforms (5–7s) */}
      <span data-scene="s3" className="absolute inset-0 opacity-0">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 360 300" preserveAspectRatio="none" fill="none">
          {SCENE.map(({ name, d }) => (
            <g key={name}>
              <path d={d} pathLength={100} stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" className="text-stone-300 dark:text-stone-600" opacity="0.6" />
              <path
                data-line
                d={d}
                pathLength={100}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="100"
                className="text-brand-500 opacity-0"
                style={{ filter: 'drop-shadow(0 0 3px rgba(224,78,20,0.4))' }}
              />
              <path
                data-spark
                d={d}
                pathLength={100}
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 96"
                className="text-brand-300 opacity-0"
              />
            </g>
          ))}
        </svg>
        <span data-node data-center className="absolute left-1/2 top-[58%]">
          <span className="flex h-12 w-12 items-center justify-center rounded-md border border-stone-200 bg-surface shadow-lift dark:border-stone-600 dark:bg-[#2a251f]">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
          </span>
        </span>
        {SCENE.map(({ name, Icon, lx, ly, tint }) => (
          <span key={`recv-${name}`} data-recv data-center className="absolute opacity-0" style={{ left: lx, top: ly }}>
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
      <span data-scene="s4" className="absolute inset-0 flex items-center justify-center opacity-0">
        <MorphCard />
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          preview
        </span>
      </span>

      {/* Scene 5 — the card splits into four platform cards (10–14s) */}
      <span data-scene="s5" className="absolute inset-0 opacity-0">
        <span
          data-burst
          data-center
          className="absolute left-1/2 top-[46%] h-24 w-24 rounded-full border-2 border-brand-400/70 opacity-0"
        />
        {SCENE.map(({ name, rx }, i) => (
          <span
            key={`copy-${name}`}
            data-copy
            data-center
            data-rx={parseFloat(rx)}
            className="absolute opacity-0"
            style={{ left: rx, top: '48%' }}
          >
            <PlatformCard name={name} i={i} />
            <span data-check className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success-500 text-white opacity-0">
              <IconCheck className="h-2 w-2" />
            </span>
          </span>
        ))}
        <span className="absolute bottom-2.5 left-3 font-mono text-[9px] uppercase tracking-widest text-ink-subtle dark:text-stone-500">
          fan-out
        </span>
      </span>

      {/* Scene 6 — sign-off (14–15s); also the reduced-motion resting frame */}
      <span data-scene="s6" className="absolute inset-0 flex items-center justify-center opacity-0">
        <span className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2">
          {[0, 1, 2].map((i) => (
            <span key={i} data-s6ring className="absolute inset-0 rounded-full border border-brand-500/40 opacity-0 dark:border-brand-500/30" />
          ))}
        </span>
        <span data-sign className="relative flex flex-col items-center gap-2.5">
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
    <div className="min-h-svh bg-surface-muted font-sans text-ink dark:bg-[#1c1917] dark:text-stone-100">
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
                <Link to="/login" className="btn-ghost whitespace-nowrap">Sign in</Link>
                <Link to="/register" className="btn-primary whitespace-nowrap">Start broadcasting</Link>
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

        <div className="relative mx-auto grid max-w-6xl gap-x-14 gap-y-10 px-6 pb-16 pt-12 md:grid-cols-[1.15fr_1fr] md:items-center md:pt-20">
          <h1
            className="max-w-5xl font-display font-semibold leading-[1.02] tracking-tight text-[clamp(2.15rem,6.6vw,6rem)] md:col-span-2"
            aria-label="One upload. Every channel, on schedule"
          >
            <RevealWords text="One upload. Every channel, on schedule" />
          </h1>
          <div>
            <p
              className="max-w-xl animate-hero-in text-lg leading-relaxed text-ink-muted dark:text-stone-400"
              style={{ animationDelay: '240ms' }}
            >
              Omnicast takes a single video and transmits it to YouTube, TikTok,
              Instagram and Facebook at the times you set. Retries, quotas and
              history are handled by the station, not by you.
            </p>
            <div
              className="mt-8 flex animate-hero-in flex-wrap items-center gap-3"
              style={{ animationDelay: '360ms' }}
            >
              {isAuthenticated ? (
                <Link to="/dashboard" className="btn-primary px-6 py-3 text-base">Open Dashboard</Link>
              ) : (
                <>
                  <Link to="/register" className="btn-primary px-6 py-3 text-base">Start broadcasting</Link>
                  <Link to="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>
                </>
              )}
            </div>
            <p
              className="mt-7 flex animate-hero-in items-center gap-2 text-sm text-ink-muted dark:text-stone-400"
              style={{ animationDelay: '460ms' }}
            >
              <LiveDot />
              on air — 4 platforms, exact-time scheduling, retries built in
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
              <Icon className="h-6 w-6 shrink-0 text-ink-subtle transition-[transform,color] duration-300 group-hover:-translate-y-0.5 group-hover:text-brand-600 dark:text-stone-500 dark:group-hover:text-brand-500" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[10px] uppercase tracking-widest text-ink-muted dark:text-stone-400">
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
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
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
                <h3 className="font-display text-base font-semibold">{s.title}</h3>
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
            <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Same video, four uploads — or one click
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted dark:text-stone-400">
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
                <figcaption className="flex items-baseline justify-between border-b border-stone-200 pb-3 font-mono text-[11px] uppercase tracking-widest text-ink-muted dark:border-stone-800 dark:text-stone-500">
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
                <p className="mt-6 font-mono text-[11px] text-ink-muted dark:text-stone-500">
                  elapsed — one channel at a time
                </p>
              </figure>
            </Reveal>

            {/* after — one upload, relayed everywhere at once */}
            <Reveal delay={240}>
              <figure>
                <figcaption className="flex items-baseline justify-between border-b border-stone-200 pb-3 font-mono text-[11px] uppercase tracking-widest text-ink-muted dark:border-stone-800 dark:text-stone-500">
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
                <p className="mt-6 font-mono text-[11px] text-ink-muted dark:text-stone-500">
                  queued — every channel at once
                </p>
              </figure>
            </Reveal>
          </div>
        </div>
      </section>

      {/* The proof — a broadcast day, logged */}
      <section className="border-b border-stone-200 bg-surface dark:border-stone-800 dark:bg-[#211d18]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr] md:items-start">
          <div>
            <Reveal>
              <h2 className="flex items-center gap-2.5 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                A broadcast day
                <LiveDot />
              </h2>
            </Reveal>
            <div className="mt-6 border-t border-stone-200 font-mono text-sm dark:border-stone-800" data-ui>
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
          {/* console summary — the same day as the control center sees it */}
          <Reveal delay={200}>
            <figure data-ui className="rounded-md border border-stone-200 bg-surface-muted dark:border-stone-700 dark:bg-[#1c1917]">
              <figcaption className="flex items-center justify-between border-b border-stone-200 px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-ink-muted dark:border-stone-700 dark:text-stone-400">
                <span>day summary</span>
                <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-500"><LiveDot /> live</span>
              </figcaption>
              <div className="divide-y divide-stone-200 px-4 font-mono text-xs dark:divide-stone-700">
                {[
                  ['videos ingested', '1', 'text-ink dark:text-stone-200'],
                  ['channels reached', '4 / 4', 'text-ink dark:text-stone-200'],
                  ['transient retries', '1', 'text-warn-500'],
                  ['manual interventions', '0', 'text-success-500'],
                ].map(([k, v, cls]) => (
                  <div key={k} className="flex items-center justify-between py-3">
                    <span className="text-ink-muted dark:text-stone-400">{k}</span>
                    <span className={`font-semibold ${cls}`}>{v}</span>
                  </div>
                ))}
              </div>
            </figure>
          </Reveal>
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
          {/* zigzag rhythm — 4+2 / 2+4 / 3+3 instead of six equal cells */}
          <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 sm:grid-cols-2 lg:grid-cols-6 dark:border-stone-800 dark:bg-stone-800">
            {CAPABILITIES.map(([title, body], i) => (
              <Reveal
                key={title}
                delay={i * 60}
                className={`group bg-surface-muted px-5 py-5 transition-colors hover:bg-surface dark:bg-[#1c1917] dark:hover:bg-[#221e19] ${
                  ['lg:col-span-4', 'lg:col-span-2', 'lg:col-span-2', 'lg:col-span-4', 'lg:col-span-3', 'lg:col-span-3'][i]
                }`}
              >
                <h3 className="font-display text-sm font-semibold transition-colors group-hover:text-brand-600 dark:group-hover:text-brand-500">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted dark:text-stone-400">{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* The console, as shipped — real interface, not a mock */}
      <section className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              One video, every platform, one console
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted dark:text-stone-400">
              The control center tracks each broadcast per channel: what went
              out, what failed and why, and which retries are already queued.
            </p>
          </Reveal>
          <Reveal delay={140}>
            <figure
              data-ui
              className="mt-10 overflow-hidden rounded-md border border-stone-200 bg-surface dark:border-stone-700 dark:bg-[#262019]"
            >
              <figcaption className="flex items-center gap-2 border-b border-stone-200 px-4 py-2.5 dark:border-stone-700">
                <span className="h-2.5 w-2.5 rounded-full bg-stone-300 dark:bg-stone-600" />
                <span className="h-2.5 w-2.5 rounded-full bg-stone-300 dark:bg-stone-600" />
                <span className="h-2.5 w-2.5 rounded-full bg-brand-400" />
                <span className="ml-3 font-mono text-[11px] text-ink-subtle dark:text-stone-500">
                  omnicast · /posts/control
                </span>
              </figcaption>
              <img
                src="/assets/console.png"
                alt="OmniCast control center showing product-demo.mp4 published to YouTube and Instagram, Facebook rate-limited, and TikTok flagged for reconnect"
                className="block w-full"
                loading="lazy"
              />
            </figure>
          </Reveal>
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
              <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Go on air</h2>
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
