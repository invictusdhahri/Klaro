import crypto from 'node:crypto';
import type { Json } from '@klaro/shared';
import { supabaseAdmin } from './supabase';
import { ml, type UserContext } from './ml.client';
import { logger } from '../lib/logger';

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

  // Dedup check
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

  // Fire-and-forget pipeline
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
    const [profileRes, kycRes, priorStatementsRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('full_name, kyc_status, location_governorate')
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

    const userContext: UserContext = {
      fullName: profileRes.data?.full_name ?? '',
      occupation: null,
      occupationCategory: null,
      educationLevel: null,
      age: null,
      kycStatus: profileRes.data?.kyc_status ?? 'pending',
      locationGovernorate: profileRes.data?.location_governorate ?? null,
      locationCountry: 'TN',
      profileContext: {},
      kycDocuments: (kycRes.data ?? []).map((d) => ({ type: d.document_type, status: d.verification_status })),
      priorStatements: (priorStatementsRes.data ?? []).map((s) => ({ fileName: s.file_name, uploadedAt: s.created_at })),
    };

    const result = await ml.statementProcess(storagePath, mimeType, userContext, fileBuffer);
    const { extraction, verification, anomalies } = result;
    const passed = verification.passed;

    const allFlags = [
      ...(verification.layers.consistency?.flags ?? []),
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

    if (passed) {
      if (extraction.transactions.length > 0) {
        await supabaseAdmin.from('transactions').insert(
          extraction.transactions.map(
            (tx: { date: string; description: string; amount: number; type: 'credit' | 'debit'; category?: string }) => ({
              user_id: userId,
              transaction_date: tx.date,
              amount: tx.amount,
              currency: 'TND',
              transaction_type: tx.type,
              category: tx.category ?? null,
              description: tx.description,
              source: 'ocr_extracted' as const,
            }),
          ),
        );
      }

      await supabaseAdmin
        .from('bank_statements')
        .update({
          status: 'processed',
          extracted_count: extraction.transactions.length,
          coherence_score: verification.layers.consistency?.coherence_score ?? null,
          verification_report: verification as unknown as Json,
          anomaly_report: anomalies as unknown as Json,
        })
        .eq('id', statementId);
    } else {
      await supabaseAdmin
        .from('bank_statements')
        .update({
          status: 'verification_failed',
          coherence_score: verification.layers.consistency?.coherence_score ?? null,
          verification_report: verification as unknown as Json,
          anomaly_report: anomalies as unknown as Json,
          error_message: `Verification failed at layer: ${verification.failed_layer ?? 'unknown'}`,
        })
        .eq('id', statementId);
    }
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
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tiff',
    'application/pdf': 'pdf', 'text/csv': 'csv',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mime] ?? 'bin';
}
