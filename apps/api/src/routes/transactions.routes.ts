import { Router } from 'express';
import { transactionListQuerySchema } from '@klaro/shared';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.get('/', validate(transactionListQuerySchema, 'query'), (req, res) => {
  res.json({ userId: req.user!.id, transactions: [] });
});
