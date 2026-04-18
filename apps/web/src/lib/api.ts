import { createApiClient } from '@klaro/shared';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';

/**
 * Browser-side API client. Pulls Supabase JWT from the browser session.
 */
export const api = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  async getAccessToken() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  },
});
