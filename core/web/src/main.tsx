import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Layout, PageFallback } from './components/Layout.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastProvider } from './components/ui/Toast.js';
import { AuthProvider } from './contexts/AuthContext.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
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
const LoginPage = lazy(() =>
  import('./pages/LoginPage.js').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage.js').then((m) => ({ default: m.RegisterPage })),
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
              <Layout>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route
                      path="/"
                      element={
                        <ProtectedRoute>
                          <DashboardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/upload"
                      element={
                        <ProtectedRoute>
                          <UploadPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/schedule"
                      element={
                        <ProtectedRoute>
                          <SchedulePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/history"
                      element={
                        <ProtectedRoute>
                          <HistoryPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/accounts"
                      element={
                        <ProtectedRoute>
                          <AccountsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/analytics"
                      element={
                        <ProtectedRoute>
                          <AnalyticsPage />
                        </ProtectedRoute>
                      }
                    />
                  </Routes>
                </Suspense>
              </Layout>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);