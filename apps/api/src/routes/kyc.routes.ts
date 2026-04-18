import { Router } from 'express';
import { kycUploadRequestSchema, kycVerifyRequestSchema } from '@klaro/shared';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';

export const kycRouter = Router();

kycRouter.use(requireAuth);

kycRouter.get('/status', (req, res) => {
  res.json({ userId: req.user!.id, status: 'pending' });
});

kycRouter.post('/upload', validate(kycUploadRequestSchema), (_req, res) => {
  // TODO: persist kyc_documents row + trigger ML OCR
  res.status(202).json({ accepted: true });
});

kycRouter.post('/verify', validate(kycVerifyRequestSchema), (_req, res) => {
  // TODO: call ML /kyc/verify (face match + liveness)
  res.status(202).json({ accepted: true });
});
