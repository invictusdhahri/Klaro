import crypto from 'node:crypto';
import type { Json } from '@klaro/shared';
import { supabaseAdmin } from './supabase';
import { ml, type StatementProcessResult, type UserContext } from './ml.client';
import { logger } from '../lib/logger';

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

/**
 * Full profile + KYC context for the ML statement pipeline (must match documents /answer).
 */
export async function buildUserContext(userId: string, statementId: string): Promise<UserContext> {
  const [profileRes, kycRes, priorStatementsRes] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select(
        'full_name, occupation, occupation_category, education_level, date_of_birth, kyc_status, location_governorate, location_country, profile_context',
      )
      .eq('id', userId)
      .single(),
    supabaseAdmin.from('kyc_documents').select('document_type, verification_status').eq('user_id', userId),
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

async function persistStatementPipelineResult(
  userId: string,
  statementId: string,
  result: StatementProcessResult,
): Promise<void> {
  const { extraction, verification, anomalies, reasoning } = result;
  const verdict = reasoning?.verdict ?? (verification.passed ? 'approved' : 'rejected');

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
    verification_report: { ...verification, extraction } as unknown as Json,
    anomaly_report: anomalies as unknown as Json,
    reasoning: reasoning as unknown as Json,
    clarification_questions: (reasoning?.questions ?? []) as unknown as Json,
    risk_score: reasoning?.risk_score ?? null,
    income_assessment: (verification.layers.income_plausibility ?? {}) as unknown as Json,
  };

  if (verdict === 'approved') {
    if (extraction.transactions.length > 0) {
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

/**
 * Upload a bank statement buffer, store it in Supabase, and kick off the
 * 3-layer verification + OCR pipeline. Returns the new statement id.
 *
 * Used both by the HTTP documents route and the UBCI Playwright adapter.
 */
export async function uploadAndProcessStatement(
  userId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<{ id: string; status: 'processing' | 'duplicate' }> {
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const { data: existing } = await supabaseAdmin
    .from('bank_statements')
    .select('id')
    .eq('user_id', userId)
    .eq('file_hash', fileHash)
    .maybeSingle();

  if (existing) {
    logger.info({ userId, statementId: existing.id }, 'statement already uploaded, skipping');
    return { id: existing.id, status: 'duplicate' };
  }

  const ext = mimeToExt(mimeType);
  const storageKey = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: storageErr } = await supabaseAdmin.storage
    .from('bank-statements')
    .upload(storageKey, fileBuffer, { contentType: mimeType, upsert: false });

  if (storageErr) throw new Error(`Storage upload failed: ${storageErr.message}`);

  const { data: row, error: insertErr } = await supabaseAdmin
    .from('bank_statements')
    .insert({
      user_id: userId,
      file_name: fileName,
      mime_type: mimeType,
      storage_path: storageKey,
      file_hash: fileHash,
      status: 'processing',
    })
    .select('id')
    .single();

  if (insertErr || !row) throw new Error(`DB insert failed: ${insertErr?.message}`);

  void runPipeline(userId, row.id, storageKey, mimeType, fileBuffer);

  return { id: row.id, status: 'processing' };
}

export async function runPipeline(
  userId: string,
  statementId: string,
  storagePath: string,
  mimeType: string,
  fileBuffer: Buffer,
): Promise<void> {
  try {
    const userContext = await buildUserContext(userId, statementId);
    const result = await ml.statementProcess(storagePath, mimeType, userContext, fileBuffer);
    await persistStatementPipelineResult(userId, statementId, result);
  } catch (err) {
    logger.error({ err, userId, statementId }, 'statement pipeline failed');
    await supabaseAdmin
      .from('bank_statements')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Unexpected error' })
      .eq('id', statementId);
  }
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
