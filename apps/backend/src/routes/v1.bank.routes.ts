import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { requireBankApiKey, requireApiScope } from '../middleware/bank-api-key';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';

/**
 * Public, programmatic API for banks.
 *
 *   Authentication: `X-API-Key: klaro_live_…` (NOT a Supabase JWT).
 *   Authorization:  Each key is bound to a single bank_id; routes only ever
 *                   read data scoped to that bank. There is no path that can
 *                   reach another bank's data, even with a guessed UUID.
 *
 * Mounted at `/api/v1/bank` so the URL space is stable as we evolve the
 * dashboard-internal `/api/bank/*` endpoints.
 */
export const v1BankRouter = Router();

v1BankRouter.use(requireBankApiKey);

// ---------------------------------------------------------------------------
// GET /api/v1/bank/me — caller bank profile (echo of which bank the key is
// scoped to). Useful for clients to verify their key works.
// ---------------------------------------------------------------------------
v1BankRouter.get('/me', async (req, res) => {
  const bankId = req.bankApi!.bankId;

  const { data, error } = await supabaseAdmin
    .from('banks')
    .select('id, slug, name, logo_url, country')
    .eq('id', bankId)
    .single();

  if (error || !data) {
    logger.error({ err: error, bankId }, 'v1 /bank/me lookup failed');
    return res.status(404).json({ error: 'bank_not_found' });
  }

  return res.json({
    id: data.id,
    slug: data.slug,
    name: data.name,
    logoUrl: data.logo_url,
    country: data.country,
    scopes: req.bankApi!.scopes,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/bank/clients — list users that have granted consent to THIS bank
// ---------------------------------------------------------------------------
const clientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

v1BankRouter.get(
  '/clients',
  requireApiScope('read:clients'),
  validate(clientsQuerySchema, 'query'),
  async (req, res) => {
    const bankId = req.bankApi!.bankId;
    const { page, limit } = req.query as unknown as z.infer<typeof clientsQuerySchema>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any).rpc('get_bank_clients', {
      p_bank_id: bankId,
    });

    if (error) {
      logger.error({ err: error, bankId }, 'v1 get_bank_clients failed');
      return res.status(500).json({ error: 'internal_error' });
    }

    const rows = (data ?? []) as Array<{
      user_id: string;
      full_name: string;
      kyc_status: string;
      score: number | null;
      score_band: string | null;
      consent_scope: string[];
      granted_at: string | null;
    }>;

    const total = rows.length;
    const start = (page - 1) * limit;
    const paged = rows.slice(start, start + limit);

    return res.json({
      data: paged.map((r) => ({
        id: r.user_id,
        name: r.full_name,
        kycStatus: r.kyc_status,
        score: r.score,
        scoreBand: r.score_band,
        consentScope: r.consent_scope,
        grantedAt: r.granted_at,
      })),
      page,
      limit,
      total,
    });
  },
);

// ---------------------------------------------------------------------------
// Helper: assert a client has granted consent to the caller bank.
// Returns the consent metadata or null. Centralizes the cross-bank firewall.
// ---------------------------------------------------------------------------
async function assertConsent(bankId: string, clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('bank_consents')
    .select('consent_scope, granted_at')
    .eq('bank_id', bankId)
    .eq('user_id', clientId)
    .eq('consent_granted', true)
    .is('revoked_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// ---------------------------------------------------------------------------
// GET /api/v1/bank/clients/:id — profile + consent metadata
// ---------------------------------------------------------------------------
v1BankRouter.get(
  '/clients/:id',
  requireApiScope('read:clients'),
  async (req, res) => {
    const bankId = req.bankApi!.bankId;
    const clientId = req.params.id as string;

    const consent = await assertConsent(bankId, clientId);
    if (!consent) {
      return res.status(403).json({ error: 'no_consent' });
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
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/bank/clients/:id/score — latest credit score
// ---------------------------------------------------------------------------
v1BankRouter.get(
  '/clients/:id/score',
  requireApiScope('read:scores'),
  async (req, res) => {
    const bankId = req.bankApi!.bankId;
    const clientId = req.params.id as string;

    const consent = await assertConsent(bankId, clientId);
    if (!consent) return res.status(403).json({ error: 'no_consent' });

    const { data, error } = await supabaseAdmin
      .from('credit_scores')
      .select('score, score_band, risk_category, confidence, breakdown, flags, created_at')
      .eq('user_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'internal_error' });
    if (!data) return res.status(404).json({ error: 'no_score_yet' });

    return res.json({
      score: data.score,
      scoreBand: data.score_band,
      riskCategory: data.risk_category,
      confidence: data.confidence,
      breakdown: data.breakdown,
      flags: data.flags,
      createdAt: data.created_at,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/bank/clients/:id/transactions
// ---------------------------------------------------------------------------
const txQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

v1BankRouter.get(
  '/clients/:id/transactions',
  requireApiScope('read:transactions'),
  validate(txQuerySchema, 'query'),
  async (req, res) => {
    const bankId = req.bankApi!.bankId;
    const clientId = req.params.id as string;
    const { from, to, limit } = req.query as unknown as z.infer<typeof txQuerySchema>;

    const consent = await assertConsent(bankId, clientId);
    if (!consent) return res.status(403).json({ error: 'no_consent' });

    let q = supabaseAdmin
      .from('transactions')
      .select('id, transaction_date, amount, currency, transaction_type, category, description')
      .eq('user_id', clientId)
      .eq('bank_id', bankId)
      .order('transaction_date', { ascending: false })
      .limit(limit);

    if (from) q = q.gte('transaction_date', from);
    if (to) q = q.lte('transaction_date', to);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: 'internal_error' });

    return res.json({
      data: (data ?? []).map((t) => ({
        id: t.id,
        date: t.transaction_date,
        amount: Number(t.amount),
        currency: t.currency,
        type: t.transaction_type,
        category: t.category,
        description: t.description,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/bank/clients/:id/statements
// ---------------------------------------------------------------------------
v1BankRouter.get(
  '/clients/:id/statements',
  requireApiScope('read:statements'),
  async (req, res) => {
    const bankId = req.bankApi!.bankId;
    const clientId = req.params.id as string;

    const consent = await assertConsent(bankId, clientId);
    if (!consent) return res.status(403).json({ error: 'no_consent' });

    const { data, error } = await supabaseAdmin
      .from('bank_statements')
      .select('id, file_name, status, risk_score, extracted_count, coherence_score, created_at')
      .eq('user_id', clientId)
      .eq('bank_id', bankId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'internal_error' });

    return res.json({
      data: (data ?? []).map((s) => ({
        id: s.id,
        fileName: s.file_name,
        status: s.status,
        riskScore: s.risk_score,
        extractedCount: s.extracted_count,
        coherenceScore: s.coherence_score,
        createdAt: s.created_at,
      })),
    });
  },
);
