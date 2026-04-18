import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@klaro/shared';
import { env } from '@/config/env';

/**
 * Service-role Supabase client. Bypasses RLS — never expose to the browser.
 * Use only in trusted server contexts after authenticating the caller.
 */
export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

/**
 * Build a per-request client that runs queries as the calling user (RLS-enforced).
 */
export function supabaseForUser(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
