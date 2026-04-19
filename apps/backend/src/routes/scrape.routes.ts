import { Router } from 'express';
import { bankConnectionStartSchema, otpSubmitSchema } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { scrapeLimiter } from '../middleware/rate-limit';
import { isBankSupported, startScrapeJob, getJob, submitJobOtp } from '../services/scraping/orchestrator';
import { HttpError } from '../middleware/error';

export const scrapeRouter = Router();

scrapeRouter.use(requireAuth);

scrapeRouter.post(
  '/start',
  scrapeLimiter,
  validate(bankConnectionStartSchema),
  (req, res) => {
    const { bankName, encryptedCredentials } = req.body as {
      bankName: string;
      encryptedCredentials?: string;
    };

    // bankName from frontend is the bank id (lowercase)
    const bankId = bankName.toLowerCase();
    if (!isBankSupported(bankId)) {
      throw new HttpError(400, 'unsupported_bank', `Bank not supported: ${bankName}`);
    }

    let credentials = { username: '', password: '' };
    if (encryptedCredentials) {
      try {
        credentials = JSON.parse(encryptedCredentials) as { username: string; password: string };
      } catch {
        throw new HttpError(400, 'invalid_credentials', 'Could not parse credentials');
      }
    }

    const userId = req.user!.id;
    const jobId = startScrapeJob(userId, bankId, credentials);

    res.status(202).json({ jobId, status: 'queued' });
  },
);

scrapeRouter.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.json({ jobId: req.params.jobId, status: 'queued' });
    return;
  }
  res.json({
    jobId: job.jobId,
    status: job.status,
    ...(job.error ? { error: job.error } : {}),
  });
});

scrapeRouter.post('/otp/:jobId', validate(otpSubmitSchema), (req, res) => {
  const { otp } = req.body as { otp: string };
  const jobId = req.params.jobId as string;
  const resolved = submitJobOtp(jobId, otp);
  if (!resolved) {
    throw new HttpError(400, 'otp_not_expected', 'No OTP is pending for this job');
  }
  res.json({ jobId, status: 'running' });
});

scrapeRouter.post('/cancel/:jobId', (req, res) => {
  res.json({ jobId: req.params.jobId, status: 'cancelled' });
});
