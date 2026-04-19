import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { Json } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';
import { ml } from '../services/ml.client';
import { logger } from '../lib/logger';

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
      'id, file_name, mime_type, status, extracted_count, coherence_score, verification_report, anomaly_report, error_message, created_at',
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

  // sha-256 fingerprint for dedup
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  // Check for duplicate
  const { data: existing } = await supabaseAdmin
    .from('bank_statements')
    .select('id')
    .eq('user_id', userId)
    .eq('file_hash', fileHash)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'This file has already been uploaded', id: existing.id });
  }

  // Derive extension from MIME
  const ext = mimeToExt(mimetype);
  const storageKey = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: storageErr } = await supabaseAdmin.storage
    .from('bank-statements')
    .upload(storageKey, buffer, { contentType: mimetype, upsert: false });

  if (storageErr) {
    logger.error({ err: storageErr, userId }, 'statement storage upload failed');
    return res.status(500).json({ error: 'Storage upload failed' });
  }

  // Insert DB row
  const { data: row, error: insertErr } = await supabaseAdmin
    .from('bank_statements')
    .insert({
      user_id: userId,
      file_name: originalname,
      mime_type: mimetype,
      storage_path: storageKey,
      file_hash: fileHash,
      status: 'processing',
    })
    .select('id')
    .single();

  if (insertErr || !row) {
    logger.error({ err: insertErr, userId }, 'bank_statements insert failed');
    return res.status(500).json({ error: 'Failed to create document record' });
  }

  // Respond immediately — processing is async
  res.status(202).json({ id: row.id, status: 'processing' });

  // Background: run pipeline (pass buffer so the ML service skips storage download)
  void runPipeline(userId, row.id, storageKey, mimetype, buffer);
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

async function runPipeline(
  userId: string,
  statementId: string,
  storagePath: string,
  mimeType: string,
  fileBuffer: Buffer,
): Promise<void> {
  try {
    // Fetch user context for the ML service
    const [profileRes, kycRes, priorStatementsRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('full_name, occupation_category, kyc_status, location_governorate')
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

    const userContext = {
      fullName: profileRes.data?.full_name ?? '',
      occupationCategory: profileRes.data?.occupation_category ?? null,
      kycStatus: profileRes.data?.kyc_status ?? 'pending',
      locationGovernorate: profileRes.data?.location_governorate ?? null,
      kycDocuments: (kycRes.data ?? []).map((d) => ({
        type: d.document_type,
        status: d.verification_status,
      })),
      priorStatements: (priorStatementsRes.data ?? []).map((s) => ({
        fileName: s.file_name,
        uploadedAt: s.created_at,
      })),
    };

    // Call ML service — full 3-layer pipeline (file bytes sent directly, no storage re-download)
    const result = await ml.statementProcess(storagePath, mimeType, userContext, fileBuffer);

    const { extraction, verification, anomalies } = result;
    const passed = verification.passed;

    // Write anomaly flags for both pass and fail scenarios
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
      // Insert extracted transactions
      if (extraction.transactions.length > 0) {
        await supabaseAdmin.from('transactions').insert(
          extraction.transactions.map(
            (tx: {
              date: string;
              description: string;
              amount: number;
              type: 'credit' | 'debit';
              category?: string;
            }) => ({
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
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unexpected error',
      })
      .eq('id', statementId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
