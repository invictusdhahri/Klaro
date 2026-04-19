import { supabaseAdmin } from './supabase';
import { logger } from '../lib/logger';

/**
 * Resolves the canonical `banks.id` for a given user / slug / hint.
 *
 * Priority order:
 *   1. Explicit slug passed in (matches `banks.slug` exactly).
 *   2. The user's most recent `bank_connections.bank_id` (already stamped).
 *   3. A coarse keyword match against the file name (e.g. "ubci-2024.pdf" -> ubci).
 *
 * Always returns `null` rather than throwing — the caller decides whether
 * an unknown bank is a hard error (it isn't today: we leave `bank_id` null
 * and surface those rows for admin review).
 */
const BANK_KEYWORDS: Array<{ slug: string; needles: string[] }> = [
  { slug: 'ubci',     needles: ['ubci'] },
  { slug: 'attijari', needles: ['attijari'] },
  { slug: 'stb',      needles: ['stb', 'societe tunisienne'] },
  { slug: 'biat',     needles: ['biat'] },
  { slug: 'bna',      needles: ['bna', 'banque nationale agricole'] },
  { slug: 'bh',       needles: ['banque de l\'habitat', 'bh-'] },
  { slug: 'amen',     needles: ['amen'] },
  { slug: 'uib',      needles: ['uib'] },
];

const slugToIdCache = new Map<string, string>();

/** Look up `banks.id` for a slug, with a small in-memory cache. */
export async function bankIdForSlug(slug: string | null | undefined): Promise<string | null> {
  if (!slug) return null;
  const normalised = slug.trim().toLowerCase();
  if (!normalised) return null;

  const cached = slugToIdCache.get(normalised);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('banks')
    .select('id')
    .eq('slug', normalised)
    .maybeSingle();

  if (error) {
    logger.warn({ err: error, slug: normalised }, 'bankIdForSlug lookup failed');
    return null;
  }
  if (!data?.id) return null;

  slugToIdCache.set(normalised, data.id);
  return data.id;
}

/**
 * Best-effort: pull the most recent `bank_connections.bank_id` for a user.
 * Returns null if the user has none, or if all rows have a null bank_id.
 */
export async function userPrimaryBankId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('bank_connections')
    .select('bank_id, created_at')
    .eq('user_id', userId)
    .not('bank_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.bank_id as string | null) ?? null;
}

/** Coarse keyword match against a filename. Returns the matching slug or null. */
function guessSlugFromFilename(fileName: string): string | null {
  const haystack = fileName.toLowerCase();
  for (const { slug, needles } of BANK_KEYWORDS) {
    if (needles.some((n) => haystack.includes(n))) return slug;
  }
  return null;
}

/**
 * High-level resolver used at statement upload time.
 *
 * Tries, in order: explicit slug → user's existing bank_connections → filename guess.
 * Returns the `banks.id` (uuid) or null if nothing resolved.
 */
export async function resolveBankIdForUpload(
  userId: string,
  opts: { slug?: string | null; fileName?: string | null } = {},
): Promise<string | null> {
  const explicit = await bankIdForSlug(opts.slug ?? null);
  if (explicit) return explicit;

  const fromConnection = await userPrimaryBankId(userId);
  if (fromConnection) return fromConnection;

  const guessed = guessSlugFromFilename(opts.fileName ?? '');
  if (guessed) return bankIdForSlug(guessed);

  return null;
}
