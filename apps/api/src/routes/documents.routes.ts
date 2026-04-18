import { Router } from 'express';
import { requireAuth } from '@/middleware/auth';

export const documentsRouter = Router();

documentsRouter.use(requireAuth);

documentsRouter.get('/', (req, res) => {
  res.json({ userId: req.user!.id, documents: [] });
});

documentsRouter.post('/upload', (_req, res) => {
  res.status(202).json({ accepted: true });
});

documentsRouter.delete('/:id', (req, res) => {
  res.json({ id: req.params.id, deleted: true });
});
