import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/error';
import { generalLimiter } from './middleware/rate-limit';

import { authRouter } from './routes/auth.routes';
import { kycRouter } from './routes/kyc.routes';
import { scrapeRouter } from './routes/scrape.routes';
import { scoreRouter } from './routes/score.routes';
import { chatRouter } from './routes/chat.routes';
import { documentsRouter } from './routes/documents.routes';
import { bankRouter } from './routes/bank.routes';
import { bankPublicRouter } from './routes/bank.public.routes';
import { banksRouter } from './routes/banks.routes';
import { v1BankRouter } from './routes/v1.bank.routes';
import { meRouter } from './routes/me.routes';
import { transactionsRouter } from './routes/transactions.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        const normalizedOrigin = origin?.replace(/\/$/, '');
        const allowed = env.CORS_ORIGINS.map((o) => o.replace(/\/$/, ''));
        if (!origin || allowed.includes(normalizedOrigin!)) {
          cb(null, true);
        } else {
          // Reject with (null, false) — not `new Error()`. Passing an Error is treated as
          // a middleware failure (500) and preflight OPTIONS never get CORS headers.
          logger.warn({ origin }, 'CORS: origin not in CORS_ORIGINS; add it in production (e.g. your Vercel URL)');
          cb(null, false);
        }
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(pinoHttp({ logger }));
  app.use(generalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'klaro-backend', uptime: process.uptime() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/scrape', scrapeRouter);
  app.use('/api/score', scoreRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/banks', banksRouter);
  app.use('/api/bank', bankPublicRouter);
  app.use('/api/bank', bankRouter);
  app.use('/api/v1/bank', v1BankRouter);
  app.use('/api/me', meRouter);
  app.use('/api/transactions', transactionsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(errorHandler);

  return app;
}
