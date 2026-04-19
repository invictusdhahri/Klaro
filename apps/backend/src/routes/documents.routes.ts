import { Router } from 'express';
import multer from 'multer';
import type { Json } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';
import { ml, type ClarificationAnswer, type StatementProcessResult } from '../services/ml.client';
import { buildUserContext, uploadAndProcessStatement } from '../services/statement.service';
import { logger } from '../lib/logger';
import { audit } from '../services/audit.service';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Multer — memory storage, 20 MB cap, allowed MIME types
// ---------------------------------------------------------------------------

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ---------------------------------------------------------------------------
// GET /api/documents — list uploaded bank statements
// ---------------------------------------------------------------------------

documentsRouter.get('/', async (req, res) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from('bank_statements')
    .select(
      'id, file_name, mime_type, status, extracted_count, coherence_score, ' +
      'verification_report, anomaly_report, reasoning, clarification_questions, ' +
      'clarification_answers, risk_score, income_assessment, error_message, created_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error, userId }, 'bank_statements list failed');
    return res.status(500).json({ error: 'Failed to fetch documents' });
  }

  return res.json({ data: data ?? [] });
});

// ---------------------------------------------------------------------------
// GET /api/documents/:id/file — short-lived signed URL to open the uploaded file
// ---------------------------------------------------------------------------

documentsRouter.get('/:id/file', async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: row, error } = await supabaseAdmin
    .from('bank_statements')
    .select('storage_path, mime_type, file_name')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !row) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('bank-statements')
    .createSignedUrl(row.storage_path, 3600);

  if (signErr || !signed?.signedUrl) {
    logger.error({ err: signErr, userId, id }, 'bank-statements signed URL failed');
    return res.status(500).json({ error: 'Could not generate file link' });
  }

  return res.json({
    url: signed.signedUrl,
    file_name: row.file_name,
    mime_type: row.mime_type,
    expires_in: 3600,
  });
});

// ---------------------------------------------------------------------------
// POST /api/documents/upload — upload + trigger 3-layer verification pipeline
// ---------------------------------------------------------------------------

documentsRouter.post('/upload', upload.single('file'), async (req, res) => {
  const userId = req.user!.id;

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { buffer, originalname, mimetype } = req.file;
  const bankSlugRaw = (req.body?.bankSlug ?? req.query?.bankSlug) as string | undefined;
  const bankSlug = typeof bankSlugRaw === 'string' && bankSlugRaw.trim() ? bankSlugRaw.trim() : null;

  try {
    const { id, status, bankId } = await uploadAndProcessStatement(
      userId,
      buffer,
      originalname,
      mimetype,
      { bankSlug },
    );
    if (status === 'duplicate') {
      return res.status(409).json({ error: 'This file has already been uploaded', id, bankId });
    }
    return res.status(202).json({ id, status: 'processing', bankId });
  } catch (err) {
    logger.error({ err, userId }, 'document upload failed');
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/documents/:id
// ---------------------------------------------------------------------------

documentsRouter.delete('/:id', async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { data: row } = await supabaseAdmin
    .from('bank_statements')
    .select('storage_path')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (!row) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Delete extracted transactions tied to this statement
  // (FK ON DELETE CASCADE handles it too, but explicit is safer for old rows)
  await supabaseAdmin
    .from('transactions')
    .delete()
    .eq('statement_id', id)
    .eq('user_id', userId);

  // Delete from storage (best-effort)
  await supabaseAdmin.storage.from('bank-statements').remove([row.storage_path]);

  const { error } = await supabaseAdmin
    .from('bank_statements')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete document' });
  }

  return res.json({ deleted: true, id });
});

// ---------------------------------------------------------------------------
// Profile enrichment — persist clarification answers as durable context
// ---------------------------------------------------------------------------

// Maps well-known question IDs to occupation_category values so the income
// plausibility layer can use them without re-asking on the next statement.
const INCOME_SOURCE_TO_CATEGORY: Record<string, string> = {
  'Freelance / remote work': 'freelance',
  'Part-time job':           'salaried',
  'Scholarship or grant':    'student',
};

async function enrichProfileFromAnswers(
  userId: string,
  answers: ClarificationAnswer[],
): Promise<void> {
  if (answers.length === 0) return;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('occupation_category, profile_context')
    .eq('id', userId)
    .single();

  const existing = (profile?.profile_context as Record<string, unknown>) ?? {};
  const contextUpdates: Record<string, unknown> = { ...existing };
  const profileFieldUpdates: Record<string, unknown> = {};

  for (const answer of answers) {
    const { question_id: qid, value } = answer;

    // Always store the raw answer keyed by question ID so future pipeline
    // runs can see what the user already explained.
    contextUpdates[qid] = value;

    // Map income source explanation → occupation_category (only when unset)
    if (qid === 'income_source_explanation' && typeof value === 'string') {
      contextUpdates.income_source = value;
      const mapped = INCOME_SOURCE_TO_CATEGORY[value];
      if (mapped && !profile?.occupation_category) {
        profileFieldUpdates.occupation_category = mapped;
      }
    }

    // Normalise remote work confirmation to a boolean for the rubric bonus
    if (qid === 'remote_work' && typeof value === 'string') {
      contextUpdates.confirmed_remote_work = value.trim().toLowerCase().startsWith('yes');
    }
  }

  await supabaseAdmin
    .from('profiles')
    .update({ profile_context: contextUpdates as import('@klaro/shared').Json, ...profileFieldUpdates })
    .eq('id', userId);
}

// ---------------------------------------------------------------------------
// POST /api/documents/:id/answer — submit clarification answers and re-analyse
// ---------------------------------------------------------------------------

documentsRouter.post('/:id/answer', async (req, res) => {
  const userId = req.user!.id;
  const statementId = req.params.id;
  const incoming = (req.body?.answers ?? []) as ClarificationAnswer[];

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: 'answers must be a non-empty array' });
  }

  const validAnswers: ClarificationAnswer[] = incoming
    .filter(
      (a): a is ClarificationAnswer =>
        Boolean(a) && typeof a.question_id === 'string' && a.question_id.length > 0,
    )
    .map((a) => ({ question_id: a.question_id, value: a.value }));

  if (validAnswers.length === 0) {
    return res.status(400).json({ error: 'No valid answers' });
  }

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('bank_statements')
    .select(
      'id, status, bank_id, verification_report, clarification_answers, clarification_questions',
    )
    .eq('id', statementId)
    .eq('user_id', userId)
    .maybeSingle();

  if (rowErr || !row) {
    return res.status(404).json({ error: 'Statement not found' });
  }

  if (row.status !== 'needs_review') {
    return res
      .status(409)
      .json({ error: `Statement is not in needs_review (current: ${row.status})` });
  }

  // Validate answers refer to questions we actually asked
  const questions = (row.clarification_questions ?? []) as Array<{ id: string }>;
  const questionIds = new Set(questions.map((q) => q.id));
  const filtered = validAnswers.filter((a) => questionIds.has(a.question_id));
  if (filtered.length === 0) {
    return res.status(400).json({ error: 'Submitted answers do not match any pending question' });
  }

  const verification = row.verification_report as unknown as StatementProcessResult['verification'];
  const previousAnswers = (row.clarification_answers ?? []) as unknown as ClarificationAnswer[];

  // Re-extract transactions from the verification report? They aren't stored
  // separately, but the L3 layer kept the per-tx list while running. Since we
  // only persisted the verification report, fetch the user's transactions
  // from the transactions table for this period — but those were only inserted
  // on approval. For needs_review we re-ask the ML service to re-run with the
  // same upload by passing the storage path.
  // Simpler: keep a copy of the extracted transactions in verification_report?
  // We extend the orchestrator response to include `extraction.transactions`,
  // and the persistence layer keeps it inside `verification_report.extraction`.
  const transactions =
    ((verification as unknown as Record<string, unknown>).extraction as
      | { transactions: StatementProcessResult['extraction']['transactions'] }
      | undefined)?.transactions ?? [];

  if (transactions.length === 0) {
    return res
      .status(409)
      .json({ error: 'Cannot reanalyze — no transactions in stored report. Please re-upload.' });
  }

  try {
    const userContext = await buildUserContext(userId, statementId);
    const result = await ml.statementReanalyze({
      userContext,
      transactions,
      layers: verification.layers,
      previousAnswers,
      newAnswers: filtered,
    });

    // Merge answers and persist
    const mergedAnswers = [...previousAnswers, ...filtered];
    const { extraction, verification: nextVerification, anomalies, reasoning } = result;
    const verdict = reasoning?.verdict ?? 'needs_review';

    const baseUpdate = {
      coherence_score: nextVerification.layers.consistency?.coherence_score ?? null,
      verification_report: {
        ...nextVerification,
        extraction,
      } as unknown as Json,
      anomaly_report: anomalies as unknown as Json,
      reasoning: reasoning as unknown as Json,
      clarification_questions: (reasoning?.questions ?? []) as unknown as Json,
      clarification_answers: mergedAnswers as unknown as Json,
      risk_score: reasoning?.risk_score ?? null,
      income_assessment: (nextVerification.layers.income_plausibility ?? {}) as unknown as Json,
    };

    if (verdict === 'approved') {
      if (extraction.transactions.length > 0) {
        // Guard: skip if we already inserted transactions for this statement
        const { count: existing } = await supabaseAdmin
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('statement_id', statementId);

        if (!existing || existing === 0) {
          await supabaseAdmin.from('transactions').insert(
            extraction.transactions.map((tx) => ({
              user_id: userId,
              statement_id: statementId,
              bank_id: (row.bank_id as string | null) ?? null,
              transaction_date: tx.date,
              amount: tx.amount,
              currency: 'TND',
              transaction_type: tx.type,
              category: tx.category ?? null,
              description: tx.description,
              source: 'ocr_extracted' as const,
            })),
          );
        }
      }
      await supabaseAdmin
        .from('bank_statements')
        .update({
          ...baseUpdate,
          status: 'processed',
          extracted_count: extraction.transactions.length,
          error_message: null,
        })
        .eq('id', statementId);
    } else if (verdict === 'needs_review') {
      await supabaseAdmin
        .from('bank_statements')
        .update({
          ...baseUpdate,
          status: 'needs_review',
          error_message: null,
        })
        .eq('id', statementId);
    } else {
      await supabaseAdmin
        .from('bank_statements')
        .update({
          ...baseUpdate,
          status: 'verification_failed',
          error_message: `Verification rejected on review: ${nextVerification.failed_layer ?? 'reasoner'}`,
        })
        .eq('id', statementId);
    }

    void audit({
      actor_type: 'user',
      actor_id: userId,
      action: 'statement.clarification.submitted',
      resource_type: 'bank_statement',
      resource_id: statementId,
      metadata: {
        answer_count: filtered.length,
        verdict,
        risk_score: reasoning?.risk_score,
      },
    });

    // Persist all answers as durable profile context so future pipeline runs
    // start with this knowledge already applied.
    void enrichProfileFromAnswers(userId, mergedAnswers);

    return res.json({
      id: statementId,
      verdict,
      risk_score: reasoning?.risk_score ?? null,
      remaining_questions: reasoning?.questions ?? [],
    });
  } catch (err) {
    logger.error({ err, userId, statementId }, 'statement reanalyze failed');
    return res.status(500).json({ error: 'Reanalyze failed' });
  }
});
