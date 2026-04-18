import { createApiClient } from '@klaro/shared';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side API client (RSC, route handlers, server actions).
 * Pulls Supabase JWT from cookies.
 */
export async function getServerApi() {
  const supabase = await createClient();
  return createApiClient({
    baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    async getAccessToken() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    },
  });
}
