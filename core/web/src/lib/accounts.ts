import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

/**
 * Compatibility re-export. The AccountsPage and the schedule form's account
 * picker both need a flat list of accounts. The shape matches `AccountRow`
 * returned by the backend (no credential fields are ever exposed).
 */
export interface AccountInfo {
  id: string;
  platform: string;
  display_name: string;
  status: string;
}

/**
 * Returns every connected account across platforms — used for the schedule
 * form's account picker, the accounts page, and several other consumers
 * (dashboard, analytics, history). The list endpoint has no filters
 * applied; callers that want filtering should call `api.listAccounts(filter)`
 * directly with their own query key.
 */
export function useAccounts() {
  return useQuery<AccountInfo[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const data = await api.listAccounts();
      const flat: AccountInfo[] = data.accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        display_name: a.display_name,
        status: a.status,
      }));
      return flat;
    },
  });
}
