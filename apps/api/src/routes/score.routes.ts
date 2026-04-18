import { Router } from 'express';
import { scoreComputeRequestSchema } from '@klaro/shared';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';

export const scoreRouter = Router();

scoreRouter.use(requireAuth);

scoreRouter.get('/current', (req, res) => {
  // TODO: select latest credit_scores row for req.user!.id
  res.json({ userId: req.user!.id, score: null });
});

scoreRouter.get('/history', (req, res) => {
  res.json({ userId: req.user!.id, history: [] });
});

scoreRouter.post('/compute', validate(scoreComputeRequestSchema), (_req, res) => {
  // TODO: gather features -> ML /score -> persist credit_scores row
  res.status(202).json({ accepted: true });
});
