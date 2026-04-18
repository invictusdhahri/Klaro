import { Router } from 'express';
import { bankConnectionStartSchema } from '@klaro/shared';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { scrapeLimiter } from '@/middleware/rate-limit';
import { isBankSupported } from '@/services/scraping/orchestrator';
import { HttpError } from '@/middleware/error';

export const scrapeRouter = Router();

scrapeRouter.use(requireAuth);

scrapeRouter.post(
  '/start',
  scrapeLimiter,
  validate(bankConnectionStartSchema),
  (req, res) => {
    const { bankName } = req.body as { bankName: string };
    if (!isBankSupported(bankName)) {
      throw new HttpError(400, 'unsupported_bank', `Bank not supported: ${bankName}`);
    }
    // TODO: enqueue isolated worker job; return jobId
    res.status(202).json({ jobId: crypto.randomUUID(), status: 'queued' });
  },
);

scrapeRouter.get('/status/:jobId', (req, res) => {
  res.json({ jobId: req.params.jobId, status: 'queued' });
});

scrapeRouter.post('/cancel/:jobId', (req, res) => {
  res.json({ jobId: req.params.jobId, status: 'cancelled' });
});
