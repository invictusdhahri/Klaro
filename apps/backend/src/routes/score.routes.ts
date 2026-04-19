import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin, supabaseForUser } from '../services/supabase';
import { MLError } from '../services/ml.client';
import { computeAndPersistScore } from '../services/score.service';
import { logger } from '../lib/logger';

export const scoreRouter = Router();

scoreRouter.use(requireAuth);

const RATE_LIMIT_MS = 60 * 60 * 1000;

scoreRouter.post('/calculate', async (req, res) => {
  const userId = req.user!.id;

  // Rate limit: check the last credit_scores row created_at instead of in-memory map
  // so the limit survives server restarts.
  const { data: lastScore } = await supabaseAdmin
    .from('credit_scores')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastScore) {
    const elapsed = Date.now() - new Date(lastScore.created_at).getTime();
    if (elapsed < RATE_LIMIT_MS) {
      return res.status(429).json({
        error: 'Score can only be recalculated once per hour',
        retryAfter: Math.ceil((RATE_LIMIT_MS - elapsed) / 1000),
      });
    }
  }

  const sb = supabaseForUser(req.user!.accessToken);

  // Guard: KYC must be verified
  const { data: profile } = await sb
    .from('profiles')
    .select('kyc_status')
    .eq('id', userId)
    .single();

  if (profile?.kyc_status !== 'verified') {
    return res.status(403).json({
      error: 'KYC verification is required before generating a Klaro credit score',
    });
  }

  // Guard: must have at least one bank connection OR a successfully processed bank statement
  const [{ data: connections }, { data: statements }] = await Promise.all([
    sb.from('bank_connections').select('id').eq('user_id', userId).limit(1),
    sb
      .from('bank_statements')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'processed')
      .limit(1),
  ]);

  if (!connections?.length && !statements?.length) {
    return res.status(422).json({
      error: 'Connect a bank account or upload bank statements before scoring',
      suggestions: [
        'Connect via Attijari, BIAT, STB, or BNA online banking',
        'Upload your last 3 months of bank statements as PDF',
      ],
    });
  }

  try {
    const result = await computeAndPersistScore(userId);
    return res.json(result);
  } catch (err) {
    if (err instanceof MLError) {
      // Forward INSUFFICIENT_DATA 422 from ML service directly to client.
      // The ML service wraps errors in { detail: { ... } } — normalise to { error, ... }.
      if (err.statusCode === 422) {
        try {
          const parsed = JSON.parse(err.body);
          const detail = parsed?.detail ?? parsed;
          return res.status(422).json({
            error: detail?.message ?? detail?.error ?? 'Not enough data to generate a score.',
            data_gaps: detail?.data_gaps,
            suggestions: detail?.suggestions,
          });
        } catch {
          return res.status(422).json({ error: err.body });
        }
      }
    }
    logger.error({ err, userId }, 'score calculation failed');
    return res.status(500).json({ error: 'Score calculation failed. Please try again.' });
  }
});

scoreRouter.get('/current', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('credit_scores')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch score' });
  }
  if (!data) {
    return res.status(404).json({ reason: 'no_score_yet' });
  }
  return res.json(data);
});

scoreRouter.get('/history', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('credit_scores')
    .select('score, score_band, confidence, created_at')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch score history' });
  }
  return res.json(data ?? []);
});
