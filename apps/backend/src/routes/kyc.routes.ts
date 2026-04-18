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

kycRouter.post('/verify', validate(kycVerifyRequestSchema), (_req, res) => {
  // TODO: call ML /kyc/verify (face match + liveness)
  res.status(202).json({ accepted: true });
});
