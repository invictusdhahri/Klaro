import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';

/**
 * Bank API key authentication.
 *
 * Wire format
 * -----------
 *   Plaintext key:  klaro_live_<22-char base64url random>
 *   Header:         X-API-Key: klaro_live_xxxxxxxxxxxxxxxxxxxxxx
 *
 * Storage
 * -------
 *   Server stores SHA-256(plaintext) in `bank_api_keys.key_hash` (hex). Lookup
 *   is O(1) via the unique index. Plaintext is never written anywhere — not in
 *   logs, not in audit, not back to the client (except once at creation).
 *
 * Scoping
 * -------
 *   Each key is bound to exactly one `bank_id`. The bank id surfaced on
 *   `req.bankApi.bankId` is the ONLY bank the request can read — there is no
 *   way to query data for a different bank, even by guessing UUIDs.
 */

const KEY_PREFIX = 'klaro_live_';
const RANDOM_BYTES = 24; // → 32 base64url chars
const PREFIX_DISPLAY_CHARS = 4; // bytes shown after the prefix in `key_prefix`

export interface BankApiContext {
  /** Internal id of the api_key row. */
  apiKeyId: string;
  bankId: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      bankApi?: BankApiContext;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (used by management routes too)
// ---------------------------------------------------------------------------

/** Generate a fresh plaintext key + the values we persist. */
export function generateApiKey(): {
  plaintextKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const random = randomBytes(RANDOM_BYTES).toString('base64url');
  const plaintextKey = `${KEY_PREFIX}${random}`;
  const keyPrefix = `${KEY_PREFIX}${random.slice(0, PREFIX_DISPLAY_CHARS)}`;
  const keyHash = sha256Hex(plaintextKey);
  return { plaintextKey, keyPrefix, keyHash };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string compare (used defensively even though we lookup by hash). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function requireBankApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  const headerRaw = req.headers['x-api-key'];
  const headerValue = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

  if (!headerValue || typeof headerValue !== 'string') {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing X-API-Key header',
    });
    return;
  }

  const presented = headerValue.trim();
  if (!presented.startsWith(KEY_PREFIX)) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid API key format' });
    return;
  }

  const hash = sha256Hex(presented);

  const { data, error } = await supabaseAdmin
    .from('bank_api_keys')
    .select('id, bank_id, scopes, revoked_at, key_hash')
    .eq('key_hash', hash)
    .maybeSingle();

  if (error) {
    logger.error({ err: error }, 'bank_api_keys lookup failed');
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  if (!data || !safeEqual(data.key_hash, hash) || data.revoked_at !== null) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or revoked API key' });
    return;
  }

  req.bankApi = {
    apiKeyId: data.id,
    bankId: data.bank_id,
    scopes: data.scopes ?? [],
  };

  // Best-effort touch — don't await, don't block the request.
  void supabaseAdmin
    .from('bank_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: touchErr }) => {
      if (touchErr) {
        logger.warn({ err: touchErr, apiKeyId: data.id }, 'failed to bump last_used_at');
      }
    });

  next();
}

/** Require a specific scope on the api key. */
export function requireApiScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.bankApi) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!req.bankApi.scopes.includes(scope)) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: `API key is missing the "${scope}" scope`,
        required: scope,
      });
      return;
    }
    next();
  };
}
