import { Router } from 'express';
import multer from 'multer';
import { kycVerifyRequestSchema } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ml } from '../services/ml.client';
import { HttpError } from '../middleware/error';

export const kycRouter = Router();

kycRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new HttpError(400, 'invalid_file_type', 'Only image files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

const ALLOWED_DOC_TYPES = new Set(['cin', 'passport', 'driver_license']);

kycRouter.get('/status', (req, res) => {
  res.json({ userId: req.user!.id, status: 'pending' });
});

kycRouter.post('/upload', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new HttpError(400, 'missing_file', 'An image file is required.');
    }

    const documentType = (req.body as { document_type?: string }).document_type ?? 'cin';
    if (!ALLOWED_DOC_TYPES.has(documentType)) {
      throw new HttpError(400, 'invalid_document_type', `document_type must be one of: ${[...ALLOWED_DOC_TYPES].join(', ')}.`);
    }

    const result = await ml.ocrExtract(req.file.buffer, req.file.mimetype, documentType);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

kycRouter.post('/verify-liveness', async (req, res, next) => {
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
          blink_detected: !!client_signals.blink_detected,
          yaw_right_reached: !!client_signals.yaw_right_reached,
          yaw_left_reached: !!client_signals.yaw_left_reached,
          pitch_up_reached: !!client_signals.pitch_up_reached,
          max_yaw_deg: Number(client_signals.max_yaw_deg ?? 0),
        }
      : undefined;
    const result = await ml.verifyLiveness(frames, signals);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

kycRouter.post('/face-match', async (req, res, next) => {
  try {
    const { selfie_base64, doc_face_base64 } = req.body as {
      selfie_base64?: string;
      doc_face_base64?: string;
    };
    if (!selfie_base64 || !doc_face_base64) {
      throw new HttpError(400, 'missing_images', 'selfie_base64 and doc_face_base64 are required.');
    }
    const result = await ml.faceMatch(selfie_base64, doc_face_base64);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

kycRouter.post('/verify', validate(kycVerifyRequestSchema), (_req, res) => {
  res.status(202).json({ accepted: true });
});
