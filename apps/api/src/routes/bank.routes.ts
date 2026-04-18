import { Router } from 'express';
import { bankConsentUpdateSchema } from '@klaro/shared';
import { requireAuth, requireRole } from '@/middleware/auth';
import { validate } from '@/middleware/validate';

export const bankRouter = Router();

bankRouter.use(requireAuth, requireRole('bank'));

bankRouter.get('/clients', (req, res) => {
  res.json({ bankId: req.user!.id, clients: [] });
});

bankRouter.get('/clients/:id', (req, res) => {
  res.json({ clientId: req.params.id, score: null });
});

bankRouter.post('/consent', validate(bankConsentUpdateSchema), (_req, res) => {
  res.status(202).json({ accepted: true });
});
