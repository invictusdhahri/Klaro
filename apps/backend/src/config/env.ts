import { config } from 'dotenv';
import { z } from 'zod';

config();

/** Same value as the frontend; `SUPABASE_URL` is accepted as an alias (common in server-only env files). */
function supabaseProjectUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  // Render (and other hosts) may set this to "klaro-ml:10000" (host:port) without a
  // scheme; `fetch` then throws "unknown scheme" because "klaro-ml" is parsed as
  // the URL scheme. Prepend http:// when missing.
  ML_BASE_URL: z.preprocess(
    (val) => {
      const v =
        val === undefined || val === null || String(val).trim() === ''
          ? 'http://localhost:8000'
          : String(val).trim();
      const t = v.replace(/\/+$/, '');
      if (/^https?:\/\//i.test(t)) {
        return t;
      }
      return `http://${t}`;
    },
    z.string().url(),
  ),

  CREDENTIAL_ENCRYPTION_PUBLIC_KEY: z.string().optional(),
  CREDENTIAL_ENCRYPTION_PRIVATE_KEY: z.string().optional(),
});

const raw = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: supabaseProjectUrl(),
};

const parsed = envSchema.safeParse(raw);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(
    "\n[klaro-backend] Invalid or missing environment variables. For production (e.g. Render), set in the Web Service → Environment:\n" +
      "  • NEXT_PUBLIC_SUPABASE_URL — Supabase Project URL (https://…supabase.co), or set SUPABASE_URL to the same value\n" +
      "  • SUPABASE_SERVICE_ROLE_KEY — from Supabase → Project Settings → API → service_role (secret; never expose to the browser)\n",
  );
  throw parsed.error;
}

export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;
