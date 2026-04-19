import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';

/**
 * /api/banks — public bank catalog endpoints (authenticated users only).
 *
 * These are consumed by the user-side consent management UI so end users can
 * discover registered bank organisations and grant/revoke consent.
 */
export const banksRouter = Router();

banksRouter.use(requireAuth);

/**
 * GET /api/banks
 * Returns all banks in the catalog. Authenticated users only — prevents
 * unauthenticated scraping of the bank list while keeping it open to any
 * logged-in role (user, bank, admin).
 */
banksRouter.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('banks')
    .select('id, slug, name, logo_url, country')
    .order('name');

  if (error) {
    logger.error({ err: error }, 'GET /api/banks failed');
    return res.status(500).json({ error: 'internal_error' });
  }

  return res.json({
    data: (data ?? []).map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      logoUrl: b.logo_url,
      country: b.country,
    })),
  });
});
