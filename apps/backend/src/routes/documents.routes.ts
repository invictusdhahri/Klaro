import { Router } from 'express';
import multer from 'multer';
import type { Json } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';
import {
  ml,
  type ClarificationAnswer,
  type StatementProcessResult,
  type UserContext,
} from '../services/ml.client';
import { uploadAndProcessStatement } from '../services/statement.service';
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
// POST /api/documents/upload — upload + trigger 3-layer verification pipeline
// ---------------------------------------------------------------------------

documentsRouter.post('/upload', upload.single('file'), async (req, res) => {
  const userId = req.user!.id;

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { buffer, originalname, mimetype } = req.file;

  try {
    const { id, status } = await uploadAndProcessStatement(userId, buffer, originalname, mimetype);
    if (status === 'duplicate') {
      return res.status(409).json({ error: 'This file has already been uploaded', id });
    }
    return res.status(202).json({ id, status: 'processing' });
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
// Background pipeline runner
// ---------------------------------------------------------------------------

async function buildUserContext(userId: string, statementId: string): Promise<UserContext> {
  const [profileRes, kycRes, priorStatementsRes] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('full_name, occupation, occupation_category, education_level, date_of_birth, kyc_status, location_governorate, location_country, profile_context')
      .eq('id', userId)
      .single(),
    supabaseAdmin
      .from('kyc_documents')
      .select('document_type, verification_status')
      .eq('user_id', userId),
    supabaseAdmin
      .from('bank_statements')
      .select('file_name, created_at')
      .eq('user_id', userId)
      .eq('status', 'processed')
      .neq('id', statementId),
  ]);

  const profile = profileRes.data as Record<string, unknown> | null;
  const dob = (profile?.date_of_birth as string | null | undefined) ?? null;
  const age = dob ? computeAge(dob) : null;

  return {
    fullName: (profile?.full_name as string | undefined) ?? '',
    occupation: (profile?.occupation as string | null | undefined) ?? null,
    occupationCategory: (profile?.occupation_category as string | null | undefined) ?? null,
    educationLevel: (profile?.education_level as string | null | undefined) ?? null,
    age,
    kycStatus: (profile?.kyc_status as string | undefined) ?? 'pending',
    locationGovernorate: (profile?.location_governorate as string | null | undefined) ?? null,
    locationCountry: (profile?.location_country as string | null | undefined) ?? 'TN',
    kycDocuments: (kycRes.data ?? []).map((d) => ({
      type: d.document_type,
      status: d.verification_status,
    })),
    priorStatements: (priorStatementsRes.data ?? []).map((s) => ({
      fileName: s.file_name,
      uploadedAt: s.created_at,
    })),
    profileContext: (profile?.profile_context as Record<string, unknown>) ?? {},
  };
}

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

async function persistResult(
  userId: string,
  statementId: string,
  result: StatementProcessResult,
): Promise<void> {
  const { extraction, verification, anomalies, reasoning } = result;
  const verdict = reasoning?.verdict ?? (verification.passed ? 'approved' : 'rejected');

  // Persist all flags into the user-level anomaly_flags table for audit
  const allFlags = [
    ...(verification.layers.consistency?.flags ?? []),
    ...(verification.layers.income_plausibility?.flags ?? []),
    ...(anomalies.signals ?? []),
  ];

  if (allFlags.length > 0) {
    await supabaseAdmin.from('anomaly_flags').insert(
      allFlags.map((flag: { type: string; severity: string; detail: string; evidence?: unknown }) => ({
        user_id: userId,
        flag_type: flag.type,
        severity: flag.severity,
        description: flag.detail,
        evidence: (flag.evidence ?? null) as Json | null,
      })),
    );
  }

  const baseUpdate = {
    coherence_score: verification.layers.consistency?.coherence_score ?? null,
    // Persist `extraction` inside the verification report so /answer can
    // re-run the income + reasoner layers without re-downloading the file.
    verification_report: { ...verification, extraction } as unknown as Json,
    anomaly_report: anomalies as unknown as Json,
    reasoning: reasoning as unknown as Json,
    clarification_questions: (reasoning?.questions ?? []) as unknown as Json,
    risk_score: reasoning?.risk_score ?? null,
    income_assessment: (verification.layers.income_plausibility ?? {}) as unknown as Json,
  };

  if (verdict === 'approved') {
    if (extraction.transactions.length > 0) {
      // Guard: skip insert if transactions for this statement already exist
      // (can happen if persistResult is called twice for the same statement).
      const { count: existing } = await supabaseAdmin
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('statement_id', statementId);

      if (!existing || existing === 0) {
        await supabaseAdmin.from('transactions').insert(
          extraction.transactions.map((tx) => ({
            user_id: userId,
            statement_id: statementId,
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
        error_message: `Verification rejected at layer: ${verification.failed_layer ?? 'reasoner'}`,
      })
      .eq('id', statementId);
  }
}

async function runPipeline(
  userId: string,
  statementId: string,
  storagePath: string,
  mimeType: string,
  fileBuffer: Buffer,
): Promise<void> {
  try {
    const userContext = await buildUserContext(userId, statementId);
    const result = await ml.statementProcess(storagePath, mimeType, userContext, fileBuffer);
    await persistResult(userId, statementId, result);
  } catch (err) {
    logger.error({ err, userId, statementId }, 'statement pipeline failed');
    await supabaseAdmin
      .from('bank_statements')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unexpected error',
      })
      .eq('id', statementId);
  }
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
      'id, status, verification_report, clarification_answers, clarification_questions',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeAge(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
    age -= 1;
  }
  return age;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/tiff': 'tiff',
    'application/pdf': 'pdf',
    'text/csv': 'csv',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mime] ?? 'bin';
}
