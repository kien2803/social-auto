import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Layout, PageFallback } from './components/Layout.js';
import { ToastProvider } from './components/ui/Toast.js';
import { queryClient } from './lib/queryClient.js';
import { installWindowErrorHandlers, track } from './lib/telemetry.js';
import './index.css';

// Capture anything React Query + the page handlers don't see: uncaught
// exceptions, promise rejections, render-time throws. Report them under
// a single tag so the user can grep `[ui]` in DevTools.
installWindowErrorHandlers();
track('app boot', { path: typeof window !== 'undefined' ? window.location.pathname : 'n/a' });
// Code-split each page so the initial bundle only contains the shell
// + the route the user first lands on. Each chunk is fetched on first
// navigation. The <Suspense> boundary shows the existing PageFallback
// while the chunk loads.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })),
);
const UploadPage = lazy(() =>
  import('./pages/UploadPage.js').then((m) => ({ default: m.UploadPage })),
);
const SchedulePage = lazy(() =>
  import('./pages/SchedulePage.js').then((m) => ({ default: m.SchedulePage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage.js').then((m) => ({ default: m.HistoryPage })),
);
const AccountsPage = lazy(() =>
  import('./pages/AccountsPage.js').then((m) => ({ default: m.AccountsPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage.js').then((m) => ({ default: m.AnalyticsPage })),
);

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter future={routerFuture}>
          <Layout>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/schedule" element={<SchedulePage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
              </Routes>
            </Suspense>
          </Layout>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
