import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import {  BrowserRouter, Routes, Route , Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { PageFallback } from './components/Layout.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastProvider } from './components/ui/Toast.js';
import { AuthProvider } from './contexts/AuthContext.js';
import { ProtectedShell } from './components/ProtectedShell.js';
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
const CalendarPage = lazy(() =>
  import('./pages/CalendarPage.js').then((m) => ({ default: m.CalendarPage })),
);
const PipelinePage = lazy(() =>
  import('./pages/PipelinePage.js').then((m) => ({ default: m.PipelinePage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage.js').then((m) => ({ default: m.HistoryPage })),
);
const LibraryPage = lazy(() =>
  import('./pages/LibraryPage.js').then((m) => ({ default: m.LibraryPage })),
);
const ComposePage = lazy(() =>
  import('./pages/ComposePage.js').then((m) => ({ default: m.ComposePage })),
);
const AccountsPage = lazy(() =>
  import('./pages/AccountsPage.js').then((m) => ({ default: m.AccountsPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage.js').then((m) => ({ default: m.AnalyticsPage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage.js').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage.js').then((m) => ({ default: m.RegisterPage })),
);
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage.js').then((m) => ({ default: m.PrivacyPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
);
const LandingPage = lazy(() =>
  import('./pages/LandingPage.js').then((m) => ({ default: m.LandingPage })),
);

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter future={routerFuture}>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route element={<ProtectedShell />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/library" element={<LibraryPage />} />
                    <Route path="/posts" element={<Navigate to="/posts/calendar" replace />} />
                    <Route path="/posts/new" element={<ComposePage />} />
                    <Route path="/posts/calendar" element={<CalendarPage />} />
                    <Route path="/posts/pipeline" element={<PipelinePage />} />
                    <Route path="/posts/history" element={<HistoryPage />} />
                    {/* legacy redirects */}
                    <Route path="/upload" element={<Navigate to="/posts/new" replace />} />
                    <Route path="/schedule" element={<Navigate to="/posts/calendar" replace />} />
                    <Route path="/calendar" element={<Navigate to="/posts/calendar" replace />} />
                    <Route path="/pipeline" element={<Navigate to="/posts/pipeline" replace />} />
                    <Route path="/history" element={<Navigate to="/posts/history" replace />} />
                    <Route path="/accounts" element={<AccountsPage />} />
                    <Route path="/analytics" element={<AnalyticsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);