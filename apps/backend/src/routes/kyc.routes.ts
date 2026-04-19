import { Router } from 'express';
import multer from 'multer';
import { kycVerifyRequestSchema } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ml } from '../services/ml.client';
import { saveKycDocument, completeKyc } from '../services/kyc.service';
import type { OcrExtractedFields } from '../services/kyc.service';
import { audit } from '../services/audit.service';
import { HttpError } from '../middleware/error';

export const kycRouter = Router();

kycRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new HttpError(400, 'invalid_file_type', 'Only image files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'image_verso', maxCount: 1 },
]);

const ALLOWED_DOC_TYPES = new Set(['cin', 'passport', 'driver_license']);

/** Best-effort client IP — handles proxied / direct connections. */
function clientIp(req: Parameters<typeof audit>[0] extends never ? never : import('express').Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
  return req.socket.remoteAddress ?? undefined;
}

kycRouter.get('/status', async (req, res, next) => {
  const userId = req.user!.id;
  try {
    const { supabaseAdmin } = await import('../services/supabase');
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('kyc_status')
      .eq('id', userId)
      .single();
    res.json({ userId, status: (data as { kyc_status?: string } | null)?.kyc_status ?? 'pending' });
  } catch (err) {
    next(err);
  }
});

// ── POST /upload ──────────────────────────────────────────────────────────────

kycRouter.post('/upload', uploadFields, async (req, res, next) => {
  const userId = req.user!.id;
  const ip     = clientIp(req as import('express').Request);

  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const recto = files?.['image']?.[0];
    const verso = files?.['image_verso']?.[0];

    if (!recto) {
      throw new HttpError(400, 'missing_file', 'An image file is required.');
    }

    const documentType = (req.body as { document_type?: string }).document_type ?? 'cin';
    if (!ALLOWED_DOC_TYPES.has(documentType)) {
      throw new HttpError(400, 'invalid_document_type', `document_type must be one of: ${[...ALLOWED_DOC_TYPES].join(', ')}.`);
    }

    // ── Audit: upload attempt ─────────────────────────────────────────────────
    void audit({
      actor_type:    'user',
      actor_id:      userId,
      action:        'kyc.document.upload_attempt',
      resource_type: 'kyc_document',
      ip_address:    ip,
      metadata: {
        document_type: documentType,
        has_verso:     !!verso,
        recto_size_kb: Math.round(recto.buffer.length / 1024),
      },
    });

    const result = await ml.ocrExtract(
      recto.buffer,
      recto.mimetype,
      documentType,
      verso ? { buffer: verso.buffer, mimeType: verso.mimetype } : undefined,
    );

    if (!result.success) {
      // ── Audit: OCR failure (quality / no face) ────────────────────────────
      void audit({
        actor_type:    'user',
        actor_id:      userId,
        action:        'kyc.document.upload_failed',
        resource_type: 'kyc_document',
        ip_address:    ip,
        metadata: { reason: result.reason, document_type: documentType },
      });
      res.json(result);
      return;
    }

    // ── CIN completeness gate ─────────────────────────────────────────────────
    // For CIN we require all five critical fields. If any are missing the image
    // is too poor to be useful — return a specific reason so the user knows
    // to retake the photo. Passport and driver_license skip this check for now.
    if (documentType === 'cin') {
      const required: (keyof OcrExtractedFields)[] = [
        'cin_number',
        'full_name_latin',
        'date_of_birth',
        'expiry_date',
        'gender',
      ];
      const missing = required.filter(
        (f) => !result.extracted[f as keyof typeof result.extracted],
      );

      if (missing.length > 0) {
        void audit({
          actor_type:    'user',
          actor_id:      userId,
          action:        'kyc.document.upload_failed',
          resource_type: 'kyc_document',
          ip_address:    ip,
          metadata: {
            reason:          'incomplete_extraction',
            document_type:   documentType,
            missing_fields:  missing,
            quality_score:   result.quality_score,
            confidence:      result.confidence,
          },
        });
        res.json({ success: false, reason: 'incomplete_extraction', missing_fields: missing });
        return;
      }
    }

    // Persist the document + OCR data and return the row id.
    const docId = await saveKycDocument(
      userId,
      documentType,
      recto.buffer,
      result.extracted as OcrExtractedFields,
      result.quality_score,
      result.confidence,
    );

    // ── Audit: document successfully extracted + saved ────────────────────────
    void audit({
      actor_type:    'user',
      actor_id:      userId,
      action:        'kyc.document.uploaded',
      resource_type: 'kyc_document',
      resource_id:   docId,
      ip_address:    ip,
      metadata: {
        document_type:  documentType,
        quality_score:  result.quality_score,
        confidence:     result.confidence,
        has_verso:      !!verso,
        // Log which fields were extracted (not their values — PII-safe)
        extracted_fields: Object.entries(result.extracted)
          .filter(([, v]) => v !== null)
          .map(([k]) => k),
      },
    });

    res.json({ ...result, doc_id: docId });
  } catch (err) {
    void audit({
      actor_type: 'user',
      actor_id:   userId,
      action:     'kyc.document.upload_error',
      ip_address: ip,
      metadata:   { error: err instanceof Error ? err.message : String(err) },
    });
    next(err);
  }
});

// ── POST /verify-liveness ─────────────────────────────────────────────────────

kycRouter.post('/verify-liveness', async (req, res, next) => {
  const userId = req.user!.id;
  const ip     = clientIp(req as import('express').Request);

  try {
    const { frames, client_signals } = req.body as {
      frames?: string[];
      client_signals?: {
        blink_detected?: boolean;
        yaw_right_reached?: boolean;
        yaw_left_reached?: boolean;
        pitch_up_reached?: boolean;
        max_yaw_deg?: number;
      };
    };
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new HttpError(400, 'missing_frames', 'frames must be a non-empty array of base64 strings.');
    }

    const signals = client_signals
      ? {
          blink_detected:    !!client_signals.blink_detected,
          yaw_right_reached: !!client_signals.yaw_right_reached,
          yaw_left_reached:  !!client_signals.yaw_left_reached,
          pitch_up_reached:  !!client_signals.pitch_up_reached,
          max_yaw_deg:       Number(client_signals.max_yaw_deg ?? 0),
        }
      : undefined;

    const result = await ml.verifyLiveness(frames, signals);

    // ── Audit: liveness result ────────────────────────────────────────────────
    void audit({
      actor_type:    'user',
      actor_id:      userId,
      action:        result.passed ? 'kyc.liveness.passed' : 'kyc.liveness.failed',
      resource_type: 'liveness_check',
      ip_address:    ip,
      metadata: {
        passed:        result.passed,
        confidence:    result.confidence,
        blink:         result.blink,
        head_rotation: result.head_rotation,
        frame_count:   frames.length,
        client_signals: signals ?? null,
      },
    });

    res.json(result);
  } catch (err) {
    void audit({
      actor_type: 'user',
      actor_id:   userId,
      action:     'kyc.liveness.error',
      ip_address: ip,
      metadata:   { error: err instanceof Error ? err.message : String(err) },
    });
    next(err);
  }
});

// ── POST /face-match ──────────────────────────────────────────────────────────

kycRouter.post('/face-match', async (req, res, next) => {
  const userId = req.user!.id;
  const ip     = clientIp(req as import('express').Request);

  try {
    const { selfie_base64, doc_face_base64, doc_id } = req.body as {
      selfie_base64?: string;
      doc_face_base64?: string;
      doc_id?: string;
    };
    if (!selfie_base64 || !doc_face_base64) {
      throw new HttpError(400, 'missing_images', 'selfie_base64 and doc_face_base64 are required.');
    }

    // ── Audit: face match attempt ─────────────────────────────────────────────
    void audit({
      actor_type:    'user',
      actor_id:      userId,
      action:        'kyc.face_match.attempt',
      resource_type: 'kyc_document',
      resource_id:   doc_id,
      ip_address:    ip,
    });

    const result = await ml.faceMatch(selfie_base64, doc_face_base64);

    // ── Audit: face match result ──────────────────────────────────────────────
    void audit({
      actor_type:    'user',
      actor_id:      userId,
      action:        result.match ? 'kyc.face_match.passed' : 'kyc.face_match.failed',
      resource_type: 'kyc_document',
      resource_id:   doc_id,
      ip_address:    ip,
      metadata: {
        match:      result.match,
        similarity: result.similarity,
        threshold:  result.threshold,
      },
    });

    // On a successful face match, complete the KYC flow.
    if (result.match && doc_id) {
      try {
        const { supabaseAdmin } = await import('../services/supabase');
        const { data: docRow } = await supabaseAdmin
          .from('kyc_documents')
          .select('ocr_data')
          .eq('id', doc_id)
          .eq('user_id', userId)
          .single();

        const ocrData = ((docRow as Record<string, unknown> | null)?.['ocr_data'] ?? {}) as OcrExtractedFields;
        await completeKyc(userId, doc_id, ocrData, result.similarity);

        // ── Audit: KYC fully completed ────────────────────────────────────────
        void audit({
          actor_type:    'user',
          actor_id:      userId,
          action:        'kyc.completed',
          resource_type: 'kyc_document',
          resource_id:   doc_id,
          ip_address:    ip,
          metadata: {
            similarity:  result.similarity,
            // Log which profile fields were populated (not values)
            profile_fields_updated: Object.entries(ocrData)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k]) => k),
          },
        });
      } catch (kycErr) {
        console.error('completeKyc error (non-fatal):', kycErr);
        void audit({
          actor_type: 'system',
          actor_id:   userId,
          action:     'kyc.completion_error',
          resource_type: 'kyc_document',
          resource_id: doc_id,
          ip_address:  ip,
          metadata:    { error: kycErr instanceof Error ? kycErr.message : String(kycErr) },
        });
      }
    }

    res.json(result);
  } catch (err) {
    void audit({
      actor_type: 'user',
      actor_id:   userId,
      action:     'kyc.face_match.error',
      resource_type: 'kyc_document',
      ip_address: ip,
      metadata:   { error: err instanceof Error ? err.message : String(err) },
    });
    next(err);
  }
});

kycRouter.post('/verify', validate(kycVerifyRequestSchema), (_req, res) => {
  res.status(202).json({ accepted: true });
});
