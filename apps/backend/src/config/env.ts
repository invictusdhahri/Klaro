import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  ML_BASE_URL: z.string().url().default('http://127.0.0.1:8000'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CREDENTIAL_ENCRYPTION_PRIVATE_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);

export function corsOriginList(): string[] {
  return env.CORS_ORIGINS.split(',').map((s) => s.trim());
}
