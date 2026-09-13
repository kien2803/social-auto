import { QueryClient } from '@tanstack/react-query';
import { classifyHttpError, reportError, track } from './telemetry.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Global tracking for every query / mutation
// ────────────────────────────────────────────────────────────────────────────
//
// Every fetch that lands here is reported once. The mutation handlers in
// the pages still call `track()` so the user sees an info-level log for
// the action they initiated; this handler covers the failure side and the
// passive refetches that happen in the background (TanStack Query polling,
// window-focus refetch, retry attempts).
//
// Console target is ERROR only — info-level tracking of routine fetches
// would flood the console on the dashboard's 10s refetch interval.

function isApiError(err: unknown): err is { status: number; message: string; name: string } {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated') return;
  const query = event.query;
  if (query.state.status !== 'error') return;
  // Skip queries the user didn't ask for (background polling noise).
  // We still log once, just without alarming the user.
  const err = query.state.error;
  const status = isApiError(err) ? err.status : null;
  const kind = classifyHttpError(status);
  const queryKey = Array.isArray(query.queryKey)
    ? query.queryKey.join('/')
    : String(query.queryKey);
  reportError(kind, `query:${queryKey}`, err, {
    query_key: queryKey,
    status,
  });
});

queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== 'updated') return;
  const mutation = event.mutation;
  if (mutation.state.status !== 'error') return;
  const err = mutation.state.error;
  const status = isApiError(err) ? err.status : null;
  const kind = classifyHttpError(status);
  // Mutation variables tell us what the user was trying to do — log them
  // redacted (just keys) so the user can correlate with their click.
  const variableKeys = mutation.options.mutationKey
    ? Array.isArray(mutation.options.mutationKey)
      ? mutation.options.mutationKey.join('/')
      : String(mutation.options.mutationKey)
    : 'unnamed';
  // Track the failure once with the mutation name + kind. The action's
  // success path is already covered by `track()` calls in the page.
  track('mutation failed', {
    mutation: variableKeys,
    kind,
    status,
  });
  reportError(kind, `mutation:${variableKeys}`, err, {
    mutation: variableKeys,
    status,
  });
});
