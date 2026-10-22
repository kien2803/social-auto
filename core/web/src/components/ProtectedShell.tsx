import { Outlet } from 'react-router-dom';
import { Layout } from './Layout.js';
import { ProtectedRoute } from './ProtectedRoute.js';

/**
 * Wraps every authenticated page: auth gate first (redirects to /login
 * when signed out), then the app shell (sidebar + topbar), with the
 * matched child route rendered via <Outlet/>. Mounting Layout here —
 * instead of around the whole <Routes> — keeps public pages (landing,
 * login, register) free of the app chrome and preserves sidebar state
 * across in-app navigation.
 */
export function ProtectedShell() {
  return (
    <ProtectedRoute>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  );
}
