import { Router } from 'express';
import { chatHistoryQuerySchema, chatSendRequestSchema } from '@klaro/shared';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';

export const chatRouter = Router();

chatRouter.use(requireAuth);

chatRouter.get('/history', validate(chatHistoryQuerySchema, 'query'), (req, res) => {
  res.json({ userId: req.user!.id, messages: [] });
});

chatRouter.post('/send', validate(chatSendRequestSchema), (_req, res) => {
  // TODO: input filter (Haiku) -> context build -> Sonnet -> store
  res.status(202).json({ accepted: true });
});

/**
 * SSE streaming endpoint. Wired as a placeholder so the web app can connect.
 * Real implementation will stream Claude Sonnet deltas.
 */
chatRouter.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'delta', content: 'Streaming not wired yet.' })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
});
