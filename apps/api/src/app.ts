import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { errorHandler } from '@/middleware/error';
import { generalLimiter } from '@/middleware/rate-limit';

import { authRouter } from '@/routes/auth.routes';
import { kycRouter } from '@/routes/kyc.routes';
import { scrapeRouter } from '@/routes/scrape.routes';
import { scoreRouter } from '@/routes/score.routes';
import { chatRouter } from '@/routes/chat.routes';
import { documentsRouter } from '@/routes/documents.routes';
import { bankRouter } from '@/routes/bank.routes';
import { transactionsRouter } from '@/routes/transactions.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          cb(null, true);
        } else {
          cb(new Error(`CORS: origin not allowed: ${origin}`));
        }
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(pinoHttp({ logger }));
  app.use(generalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'klaro-api', uptime: process.uptime() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/scrape', scrapeRouter);
  app.use('/api/score', scoreRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/bank', bankRouter);
  app.use('/api/transactions', transactionsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(errorHandler);

  return app;
}
