import { Router } from 'express';
import { z } from 'zod';
import { bankConsentUpdateSchema } from '@klaro/shared';
import type { Json } from '@klaro/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';

export const bankRouter = Router();

bankRouter.use(requireAuth, requireRole('bank'));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Verify that the authenticated bank has active consent for a given user. */
async function assertConsent(
  bankId: string,
  clientId: string,
): Promise<{ consent_scope: string[]; granted_at: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('bank_consents')
    .select('consent_scope, granted_at')
    .eq('bank_id', bankId)
    .eq('user_id', clientId)
    .eq('consent_granted', true)
    .is('revoked_at', null)
    .single();

  if (error || !data) return null;
  return data;
}

/** Write a bank action to audit_logs (fire-and-forget). */
function auditLog(
  bankId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
) {
  supabaseAdmin
    .from('audit_logs')
    .insert({
      actor_type: 'bank',
      actor_id: bankId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata: (metadata ?? null) as Json | null,
    })
    .then(({ error }) => {
      if (error) logger.warn({ err: error, bankId, action }, 'audit_log insert failed');
    });
}

// ---------------------------------------------------------------------------
// GET /api/bank/clients
// Calls get_bank_clients(bank_id) SECURITY DEFINER Postgres function.
// Supports: page, limit, sortBy (score | name | granted_at)
// ---------------------------------------------------------------------------

const clientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['score', 'name', 'granted_at']).default('granted_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

bankRouter.get('/clients', validate(clientsQuerySchema, 'query'), async (req, res) => {
  const bankId = req.user!.id;
  const { page, limit, sortBy, order } = req.query as unknown as z.infer<typeof clientsQuerySchema>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc('get_bank_clients', {
    p_bank_id: bankId,
  });

  if (error) {
    logger.error({ err: error, bankId }, 'get_bank_clients RPC failed');
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let rows = (data ?? []) as Array<{
    user_id: string;
    full_name: string;
    kyc_status: string;
    score: number | null;
    score_band: string | null;
    consent_scope: string[];
    granted_at: string | null;
  }>;

  rows.sort((a, b) => {
    let diff = 0;
    if (sortBy === 'score') {
      diff = (a.score ?? -1) - (b.score ?? -1);
    } else if (sortBy === 'name') {
      diff = a.full_name.localeCompare(b.full_name);
    } else {
      diff = (a.granted_at ?? '').localeCompare(b.granted_at ?? '');
    }
    return order === 'asc' ? diff : -diff;
  });

  const total = rows.length;
  const start = (page - 1) * limit;
  const paged = rows.slice(start, start + limit);

  const clients = paged.map((r) => ({
    id: r.user_id,
    name: r.full_name,
    kycStatus: r.kyc_status,
    score: r.score,
    scoreBand: r.score_band,
    consentScope: r.consent_scope,
    grantedAt: r.granted_at,
  }));

  return res.json({ data: clients, total, page, limit });
});

// ---------------------------------------------------------------------------
// GET /api/bank/clients/:id
// Returns profile + consent metadata only — score is on the /score sub-route.
// ---------------------------------------------------------------------------

bankRouter.get('/clients/:id', async (req, res) => {
  const bankId = req.user!.id;
  const clientId = req.params.id;

  const consent = await assertConsent(bankId, clientId);
  if (!consent) {
    return res.status(403).json({ error: 'Client has not granted consent' });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, occupation_category, kyc_status')
    .eq('id', clientId)
    .single();

  return res.json({
    id: clientId,
    profile: profile ?? null,
    consentScope: consent.consent_scope,
    grantedAt: consent.granted_at,
  });
});

// ---------------------------------------------------------------------------
// GET /api/bank/clients/:id/score
// ---------------------------------------------------------------------------

bankRouter.get('/clients/:id/score', async (req, res) => {
  const bankId = req.user!.id;
  const clientId = req.params.id;

  const consent = await assertConsent(bankId, clientId);
  if (!consent) {
    return res.status(403).json({ error: 'Client has not granted consent' });
  }

  const { data: score, error } = await supabaseAdmin
    .from('credit_scores')
    .select('score, score_band, risk_category, confidence, breakdown, flags, created_at')
    .eq('user_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch score' });
  }

  auditLog(bankId, 'view_score', 'credit_scores', clientId, {
    score: score?.score ?? null,
    score_band: score?.score_band ?? null,
  });

  if (!score) {
    return res.status(404).json({ reason: 'no_score_yet' });
  }

  return res.json(score);
});

// ---------------------------------------------------------------------------
// POST /api/bank/clients/:id/request-consent
// ---------------------------------------------------------------------------

bankRouter.post('/clients/:id/request-consent', async (req, res) => {
  const bankId = req.user!.id;
  const targetUserId = req.params.id;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('id', targetUserId)
    .single();

  if (!profile) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    await supabaseAdmin.channel(`consent_requests:${targetUserId}`).send({
      type: 'broadcast',
      event: 'consent_requested',
      payload: {
        bankId,
        targetUserId,
        requestedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn({ err, bankId, targetUserId }, 'consent_requested realtime broadcast failed');
  }

  auditLog(bankId, 'request_consent', 'profiles', targetUserId);

  return res.json({ sent: true, targetUserId });
});

// ---------------------------------------------------------------------------
// POST /api/bank/consent  (called by the user side, not the bank side)
// ---------------------------------------------------------------------------

bankRouter.post('/consent', validate(bankConsentUpdateSchema), async (req, res) => {
  const { bankId, consentGranted, consentScope } = req.body as {
    bankId: string;
    consentGranted: boolean;
    consentScope: string[];
  };
  const userId = req.user!.id;

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
