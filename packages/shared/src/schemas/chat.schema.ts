import { z } from 'zod';

export const chatRoleSchema = z.enum(['user', 'assistant', 'system']);

export const chatSendRequestSchema = z.object({
  content: z.string().min(1).max(4000),
  stream: z.boolean().default(true),
});

export const chatHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});

export type ChatSendInput = z.infer<typeof chatSendRequestSchema>;
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;
