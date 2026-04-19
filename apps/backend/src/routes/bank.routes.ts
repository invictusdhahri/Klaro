import { Router } from 'express';
import { z } from 'zod';
import { bankApiKeyCreateSchema, type Json, type BankApiKey, type BankApiKeyCreated } from '@klaro/shared';
import { requireAuth, requireBank } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';
import { generateApiKey } from '../middleware/bank-api-key';

export const bankRouter = Router();

bankRouter.use(requireAuth, requireBank);

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
  actorAuthId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
) {
  supabaseAdmin
    .from('audit_logs')
    .insert({
      actor_type: 'bank',
      actor_id: actorAuthId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata: (metadata ?? null) as Json | null,
    })
    .then(({ error }) => {
      if (error) logger.warn({ err: error, actorAuthId, action }, 'audit_log insert failed');
    });
}

// ---------------------------------------------------------------------------
// GET /api/bank/me — bank profile (slug, name, logo) for the dashboard header
// ---------------------------------------------------------------------------

bankRouter.get('/me', async (req, res) => {
  const bankId = req.user!.bankId!;

  const { data: bank, error } = await supabaseAdmin
    .from('banks')
    .select('id, slug, name, logo_url, country')
    .eq('id', bankId)
    .single();

  if (error || !bank) {
    logger.error({ err: error, bankId }, '/api/bank/me lookup failed');
    return res.status(404).json({ error: 'Bank organisation not found' });
  }

  return res.json({
    id: bank.id,
    slug: bank.slug,
    name: bank.name,
    logoUrl: bank.logo_url,
    country: bank.country,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/bank/me — update mutable bank profile fields (name, logo)
// ---------------------------------------------------------------------------

const bankProfileUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  logoUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
});

bankRouter.patch('/me', validate(bankProfileUpdateSchema), async (req, res) => {
  const bankId = req.user!.bankId!;
  const body = req.body as z.infer<typeof bankProfileUpdateSchema>;

  type BankPatch = { name?: string; logo_url?: string | null };
  const patch: BankPatch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.logoUrl !== undefined) {
    patch.logo_url = body.logoUrl && body.logoUrl.length > 0 ? body.logoUrl : null;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_changes', message: 'Nothing to update' });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('banks')
    .update(patch)
    .eq('id', bankId)
    .select('id, slug, name, logo_url, country')
    .single();

  if (error || !updated) {
    logger.error({ err: error, bankId }, 'PATCH /api/bank/me update failed');
    return res.status(500).json({ error: 'internal_error' });
  }

  auditLog(req.user!.id, 'bank_profile_updated', 'bank', bankId, patch);

  return res.json({
    id: updated.id,
    slug: updated.slug,
    name: updated.name,
    logoUrl: updated.logo_url,
    country: updated.country,
  });
});

// ---------------------------------------------------------------------------
// GET /api/bank/dashboard/stats — aggregated dashboard payload
// ---------------------------------------------------------------------------

bankRouter.get('/dashboard/stats', async (req, res) => {
  const bankId = req.user!.bankId!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc('get_bank_dashboard_stats', {
    p_bank_id: bankId,
  });

  if (error) {
    logger.error({ err: error, bankId }, 'get_bank_dashboard_stats RPC failed');
    return res.status(500).json({ error: 'Failed to load dashboard stats' });
  }

  auditLog(req.user!.id, 'view_dashboard', 'bank', bankId);

  return res.json(data ?? {});
});

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
  const bankId = req.user!.bankId!;
  const { page, limit, sortBy, order } = req.query as unknown as z.infer<typeof clientsQuerySchema>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc('get_bank_clients', {
    p_bank_id: bankId,
  });

  if (error) {
    logger.error({ err: error, bankId }, 'get_bank_clients RPC failed');
    return res.status(500).json({ error: 'Failed to fetch clients' });
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
  const bankId = req.user!.bankId!;
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
  const bankId = req.user!.bankId!;
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

  auditLog(req.user!.id, 'view_score', 'credit_scores', clientId, {
    score: score?.score ?? null,
    score_band: score?.score_band ?? null,
  });

  if (!score) {
    return res.status(404).json({ reason: 'no_score_yet' });
  }

  return res.json(score);
});

// ---------------------------------------------------------------------------
// GET /api/bank/clients/:id/statements
// Only statements stamped with this bank's id (Phase 3 ingestion).
// ---------------------------------------------------------------------------

bankRouter.get('/clients/:id/statements', async (req, res) => {
  const bankId = req.user!.bankId!;
  const clientId = req.params.id;

  const consent = await assertConsent(bankId, clientId);
  if (!consent) {
    return res.status(403).json({ error: 'Client has not granted consent' });
  }

  const { data, error } = await supabaseAdmin
    .from('bank_statements')
    .select('id, file_name, status, risk_score, extracted_count, coherence_score, income_assessment, created_at')
    .eq('user_id', clientId)
    .eq('bank_id', bankId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error, bankId, clientId }, 'list bank statements failed');
    return res.status(500).json({ error: 'Failed to fetch statements' });
  }

  auditLog(req.user!.id, 'view_statements', 'profiles', clientId, {
    count: data?.length ?? 0,
  });

  return res.json({
    data: (data ?? []).map((s) => ({
      id: s.id,
      fileName: s.file_name,
      status: s.status,
      riskScore: s.risk_score,
      extractedCount: s.extracted_count,
      coherenceScore: s.coherence_score,
      incomeAssessment: s.income_assessment,
      createdAt: s.created_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/bank/clients/:id/transactions
// ---------------------------------------------------------------------------

const txQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  category: z.string().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

bankRouter.get(
  '/clients/:id/transactions',
  validate(txQuerySchema, 'query'),
  async (req, res) => {
    const bankId = req.user!.bankId!;
    // Cast: when a router stage uses `validate(...)`, Express's typed Request
    // overloads collapse to a generic shape and `req.params.id` shows up as
    // `string | string[] | undefined`. The route definition guarantees it's
    // always a single string at runtime.
    const clientId = req.params.id as string;
    const { from, to, category, limit } = req.query as unknown as z.infer<
      typeof txQuerySchema
    >;

    const consent = await assertConsent(bankId, clientId);
    if (!consent) {
      return res.status(403).json({ error: 'Client has not granted consent' });
    }

    let q = supabaseAdmin
      .from('transactions')
      .select(
        'id, transaction_date, amount, currency, transaction_type, category, description, source',
      )
      .eq('user_id', clientId)
      .eq('bank_id', bankId)
      .order('transaction_date', { ascending: false })
      .limit(limit);

    if (from) q = q.gte('transaction_date', from);
    if (to) q = q.lte('transaction_date', to);
    if (category) q = q.eq('category', category);

    const { data, error } = await q;

    if (error) {
      logger.error({ err: error, bankId, clientId }, 'list bank transactions failed');
      return res.status(500).json({ error: 'Failed to fetch transactions' });
    }

    auditLog(req.user!.id, 'view_transactions', 'profiles', clientId, {
      count: data?.length ?? 0,
      from: from ?? null,
      to: to ?? null,
    });

    return res.json({
      data: (data ?? []).map((t) => ({
        id: t.id,
        date: t.transaction_date,
        amount: Number(t.amount),
        currency: t.currency,
        type: t.transaction_type,
        category: t.category,
        description: t.description,
        source: t.source,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/bank/clients/:id/insights
// Behavioural profile derived from transactions + income_assessment.
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

bankRouter.get('/clients/:id/insights', async (req, res) => {
  const bankId = req.user!.bankId!;
  const clientId = req.params.id;

  const consent = await assertConsent(bankId, clientId);
  if (!consent) return res.status(403).json({ error: 'Client has not granted consent' });

  // Fetch up to 2 000 transactions (enough for ~5 years of monthly data)
  const [txRes, stmtRes] = await Promise.all([
    supabaseAdmin
      .from('transactions')
      .select('transaction_date, amount, currency, transaction_type, category, counterparty, description')
      .eq('user_id', clientId)
      .eq('bank_id', bankId)
      .order('transaction_date', { ascending: false })
      .limit(2000),
    supabaseAdmin
      .from('bank_statements')
      .select('income_assessment')
      .eq('user_id', clientId)
      .eq('bank_id', bankId)
      .eq('status', 'processed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (txRes.error) {
    logger.error({ err: txRes.error, bankId, clientId }, 'insights: tx fetch failed');
    return res.status(500).json({ error: 'internal_error' });
  }

  const txs = txRes.data ?? [];

  if (txs.length === 0) {
    return res.json({
      currency: 'TND',
      totalTransactions: 0,
      totalCredit: 0,
      totalDebit: 0,
      avgMonthlyIncome: null,
      avgMonthlyExpense: null,
      savingsRate: null,
      categoryBreakdown: [],
      monthlyTrend: [],
      topPayees: [],
      avgTransactionAmount: 0,
      largestExpense: null,
      estimatedRecurring: 0,
      mostActiveDay: null,
      creditDebitRatio: null,
      incomeAssessment: null,
      periodFrom: null,
      periodTo: null,
    });
  }

  // ---- Basic sums --------------------------------------------------------
  const currency = txs[0]!.currency ?? 'TND';
  let totalCredit = 0;
  let totalDebit = 0;
  let largestExpense = 0;

  // ---- Category aggregation (debit only) ---------------------------------
  const catMap = new Map<string, { amount: number; count: number }>();

  // ---- Payee aggregation (debit only) ------------------------------------
  const payeeMap = new Map<string, { amount: number; count: number }>();

  // ---- Monthly aggregation -----------------------------------------------
  const monthMap = new Map<string, { income: number; expenses: number }>();

  // ---- Day-of-week frequency ---------------------------------------------
  const dayCount = new Array<number>(7).fill(0);

  // ---- Recurring detection (payees appearing ≥2 months) ------------------
  // Maps payee → set of months they appear in
  const payeeMonths = new Map<string, Set<string>>();

  for (const tx of txs) {
    const amount = Number(tx.amount);
    const isDebit = tx.transaction_type === 'debit';
    const month = tx.transaction_date.slice(0, 7); // "YYYY-MM"

    if (isDebit) {
      totalDebit += amount;
      if (amount > largestExpense) largestExpense = amount;

      const cat = tx.category ?? 'Other';
      const c = catMap.get(cat) ?? { amount: 0, count: 0 };
      c.amount += amount;
      c.count++;
      catMap.set(cat, c);

      const payee = tx.counterparty ?? tx.description ?? 'Unknown';
      const p = payeeMap.get(payee) ?? { amount: 0, count: 0 };
      p.amount += amount;
      p.count++;
      payeeMap.set(payee, p);

      const pm = payeeMonths.get(payee) ?? new Set();
      pm.add(month);
      payeeMonths.set(payee, pm);
    } else {
      totalCredit += amount;
    }

    // Monthly trend
    const m = monthMap.get(month) ?? { income: 0, expenses: 0 };
    if (isDebit) m.expenses += amount;
    else m.income += amount;
    monthMap.set(month, m);

    // Day of week
    const d = new Date(tx.transaction_date).getDay();
    if (!Number.isNaN(d) && d >= 0 && d < 7) dayCount[d] = (dayCount[d] ?? 0) + 1;
  }

  // Category breakdown sorted by amount
  const categoryBreakdown = [...catMap.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([category, { amount, count }]) => ({
      category,
      totalAmount: Math.round(amount * 100) / 100,
      transactionCount: count,
      percentage: totalDebit > 0 ? Math.round((amount / totalDebit) * 1000) / 10 : 0,
    }));

  // Top payees (debit)
  const topPayees = [...payeeMap.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10)
    .map(([name, { amount, count }]) => ({
      name,
      totalAmount: Math.round(amount * 100) / 100,
      count,
    }));

  // Monthly trend — last 6 months sorted ascending
  const monthlyTrend = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, { income, expenses }]) => ({
      month,
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      net: Math.round((income - expenses) * 100) / 100,
    }));

  // Monthly averages
  const trendMonths = monthlyTrend.length || 1;
  const avgMonthlyIncome = monthlyTrend.length
    ? Math.round((monthlyTrend.reduce((s, m) => s + m.income, 0) / trendMonths) * 100) / 100
    : null;
  const avgMonthlyExpense = monthlyTrend.length
    ? Math.round((monthlyTrend.reduce((s, m) => s + m.expenses, 0) / trendMonths) * 100) / 100
    : null;
  const savingsRate =
    avgMonthlyIncome && avgMonthlyIncome > 0
      ? Math.round(((avgMonthlyIncome - (avgMonthlyExpense ?? 0)) / avgMonthlyIncome) * 1000) / 10
      : null;

  // Most active day
  const maxDayIdx = dayCount.indexOf(Math.max(...dayCount));
  const mostActiveDay = dayCount[maxDayIdx]! > 0 ? DAYS[maxDayIdx] ?? null : null;

  // Estimated recurring: payees seen in ≥2 distinct months
  let estimatedRecurring = 0;
  for (const [payee, months] of payeeMonths) {
    if (months.size >= 2) {
      const avg = (payeeMap.get(payee)?.amount ?? 0) / months.size;
      estimatedRecurring += avg;
    }
  }
  estimatedRecurring = Math.round(estimatedRecurring * 100) / 100;

  const creditDebitRatio =
    totalDebit > 0 ? Math.round((totalCredit / totalDebit) * 100) / 100 : null;

  const periodTo = txs[0]?.transaction_date ?? null;
  const periodFrom = txs[txs.length - 1]?.transaction_date ?? null;

  auditLog(req.user!.id, 'view_insights', 'profiles', clientId);

  return res.json({
    currency,
    totalTransactions: txs.length,
    totalCredit: Math.round(totalCredit * 100) / 100,
    totalDebit: Math.round(totalDebit * 100) / 100,
    avgMonthlyIncome,
    avgMonthlyExpense,
    savingsRate,
    categoryBreakdown,
    monthlyTrend,
    topPayees,
    avgTransactionAmount: txs.length
      ? Math.round(((totalCredit + totalDebit) / txs.length) * 100) / 100
      : 0,
    largestExpense: largestExpense > 0 ? Math.round(largestExpense * 100) / 100 : null,
    estimatedRecurring,
    mostActiveDay,
    creditDebitRatio,
    incomeAssessment: (stmtRes.data?.income_assessment as Record<string, unknown> | null) ?? null,
    periodFrom,
    periodTo,
  });
});

// ---------------------------------------------------------------------------
// GET /api/bank/clients/:id/timeline
// Merged feed: statement uploads + score history + anomaly_flags.
// ---------------------------------------------------------------------------

bankRouter.get('/clients/:id/timeline', async (req, res) => {
  const bankId = req.user!.bankId!;
  const clientId = req.params.id;

  const consent = await assertConsent(bankId, clientId);
  if (!consent) {
    return res.status(403).json({ error: 'Client has not granted consent' });
  }

  const [statementsRes, scoresRes, anomaliesRes] = await Promise.all([
    supabaseAdmin
      .from('bank_statements')
      .select('id, file_name, status, risk_score, created_at')
      .eq('user_id', clientId)
      .eq('bank_id', bankId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('credit_scores')
      .select('id, score, score_band, created_at')
      .eq('user_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('anomaly_flags')
      .select('id, flag_type, severity, description, created_at')
      .eq('user_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  type Entry = { kind: 'statement' | 'score' | 'anomaly'; at: string; payload: unknown };

  const entries: Entry[] = [
    ...(statementsRes.data ?? []).map<Entry>((s) => ({
      kind: 'statement',
      at: s.created_at as string,
      payload: {
        id: s.id,
        fileName: s.file_name,
        status: s.status,
        riskScore: s.risk_score,
      },
    })),
    ...(scoresRes.data ?? []).map<Entry>((s) => ({
      kind: 'score',
      at: s.created_at as string,
      payload: { id: s.id, score: s.score, scoreBand: s.score_band },
    })),
    ...(anomaliesRes.data ?? []).map<Entry>((a) => ({
      kind: 'anomaly',
      at: a.created_at as string,
      payload: {
        id: a.id,
        flagType: a.flag_type,
        severity: a.severity,
        description: a.description,
      },
    })),
  ];

  entries.sort((a, b) => b.at.localeCompare(a.at));

  return res.json({ data: entries });
});

// ---------------------------------------------------------------------------
// POST /api/bank/clients/:id/request-consent
// ---------------------------------------------------------------------------

bankRouter.post('/clients/:id/request-consent', async (req, res) => {
  const bankId = req.user!.bankId!;
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

  auditLog(req.user!.id, 'request_consent', 'profiles', targetUserId);

  return res.json({ sent: true, targetUserId });
});

// ===========================================================================
// Bank API key management (programmatic access for the bank's own systems)
// ---------------------------------------------------------------------------
// These endpoints are reached from the dashboard (Supabase JWT auth, role=bank)
// and let an admin mint, list, and revoke long-lived API keys. The keys
// themselves are consumed at /api/v1/bank/* via the X-API-Key header.
// ===========================================================================

interface BankApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
}

function rowToApiKey(row: BankApiKeyRow): BankApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes as BankApiKey['scopes'],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
  };
}

// GET /api/bank/api-keys — list keys for the caller's bank
bankRouter.get('/api-keys', async (req, res) => {
  const bankId = req.user!.bankId!;

  const { data, error } = await supabaseAdmin
    .from('bank_api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at, created_by')
    .eq('bank_id', bankId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error, bankId }, 'list bank_api_keys failed');
    return res.status(500).json({ error: 'internal_error' });
  }

  return res.json({ data: (data ?? []).map(rowToApiKey) });
});

// POST /api/bank/api-keys — create a new key (returns plaintext ONCE)
bankRouter.post('/api-keys', validate(bankApiKeyCreateSchema), async (req, res) => {
  const bankId = req.user!.bankId!;
  const { name, scopes } = req.body as z.infer<typeof bankApiKeyCreateSchema>;

  const { plaintextKey, keyPrefix, keyHash } = generateApiKey();

  const { data, error } = await supabaseAdmin
    .from('bank_api_keys')
    .insert({
      bank_id: bankId,
      name,
      scopes,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      created_by: req.user!.id,
    })
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at, created_by')
    .single();

  if (error || !data) {
    logger.error({ err: error, bankId }, 'create bank_api_key failed');
    return res.status(500).json({ error: 'internal_error' });
  }

  auditLog(req.user!.id, 'api_key_created', 'bank_api_keys', data.id, {
    name,
    scopes: scopes as Json,
  });

  const payload: BankApiKeyCreated = {
    ...rowToApiKey(data),
    plaintextKey,
  };
  return res.status(201).json(payload);
});

// DELETE /api/bank/api-keys/:id — revoke (soft delete) a key
bankRouter.delete('/api-keys/:id', async (req, res) => {
  const bankId = req.user!.bankId!;
  const keyId = req.params.id;

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('bank_api_keys')
    .select('id, bank_id, revoked_at')
    .eq('id', keyId)
    .maybeSingle();

  if (lookupError) {
    logger.error({ err: lookupError, bankId, keyId }, 'api_key lookup failed');
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!existing || existing.bank_id !== bankId) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (existing.revoked_at) {
    return res.json({ revoked: true, alreadyRevoked: true });
  }

  const { error: updateError } = await supabaseAdmin
    .from('bank_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId);

  if (updateError) {
    logger.error({ err: updateError, bankId, keyId }, 'api_key revoke failed');
    return res.status(500).json({ error: 'internal_error' });
  }

  auditLog(req.user!.id, 'api_key_revoked', 'bank_api_keys', keyId);

  return res.json({ revoked: true });
});
