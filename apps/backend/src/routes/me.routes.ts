import { Router } from 'express';
import { bankConsentUpdateSchema } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';

/**
 * /api/me/* — endpoints scoped to the currently-authenticated end user
 * (role=user). These used to live under /api/bank/* but conceptually they
 * are user-side actions (e.g. granting consent to a bank organisation).
 */
export const meRouter = Router();

meRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/me/bank-consent — user grants/revokes consent for a bank org.
// `bankId` here is `banks.id` (the catalog row), not an auth user id.
// ---------------------------------------------------------------------------

meRouter.post('/bank-consent', validate(bankConsentUpdateSchema), async (req, res) => {
  const { bankId, consentGranted, consentScope } = req.body as {
    bankId: string;
    consentGranted: boolean;
    consentScope: string[];
  };
  const userId = req.user!.id;

  // Reject obviously invalid bank ids early so we return a clean 404.
  const { data: bankRow } = await supabaseAdmin
    .from('banks')
    .select('id')
    .eq('id', bankId)
    .maybeSingle();
  if (!bankRow) {
    return res.status(404).json({ error: 'Unknown bank organisation' });
  }

  const { error } = await supabaseAdmin.from('bank_consents').upsert(
    {
      user_id: userId,
      bank_id: bankId,
      consent_granted: consentGranted,
      consent_scope: consentScope,
      granted_at: consentGranted ? new Date().toISOString() : null,
      revoked_at: consentGranted ? null : new Date().toISOString(),
    },
    { onConflict: 'user_id, bank_id' },
  );

  if (error) {
    logger.error({ err: error, userId, bankId }, 'consent update failed');
    return res.status(500).json({ error: 'Failed to update consent' });
  }

  return res.json({ updated: true, consentGranted });
});

// ---------------------------------------------------------------------------
// GET /api/me/bank-consent — list this user's consents (for their UI).
// ---------------------------------------------------------------------------

meRouter.get('/bank-consent', async (req, res) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from('bank_consents')
    .select(
      'id, bank_id, consent_granted, consent_scope, granted_at, revoked_at, banks!inner(slug, name, logo_url)',
    )
    .eq('user_id', userId);

  if (error) {
    logger.error({ err: error, userId }, 'bank consent list failed');
    return res.status(500).json({ error: 'Failed to load consents' });
  }

  return res.json({ data: data ?? [] });
});
