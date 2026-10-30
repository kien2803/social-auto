import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar.js';
import { Topbar } from './Topbar.js';
import { Drawer } from './Drawer.js';
import { Dock } from './Dock.js';
import { Skeleton } from './ui/Skeleton.js';

function detectEnv(): { label: string; tone: 'mock' | 'live' } {
  // Default to live until the API tells us otherwise. Workers / API have no
  // public /config endpoint yet; keep it optimistic and let the user see a
  // generic "live" badge until we add one.
  return { label: 'live', tone: 'live' };
}

export function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const env = detectEnv();

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-surface-muted text-ink dark:bg-[#1c1917] dark:text-stone-100">
      <div className="flex min-h-screen">
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <Sidebar collapsed={false} onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onMenuToggle={() => setDrawerOpen(true)}
            envLabel={env.label}
            envTone={env.tone}
          />
          {/* pb-24 keeps content clear of the fixed bottom dock */}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-8">
            <Suspense fallback={<PageFallback />}>{children}</Suspense>
          </main>
        </div>
      </div>
      <Dock />
    </div>
  );
}