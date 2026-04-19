import { z } from 'zod';

export const chatRoleSchema = z.enum(['user', 'assistant', 'system']);

export const chatModeSchema = z
  .enum(['spending_analysis', 'habit_insights', 'score_tips', 'general'])
  .default('general');

export const chatSendRequestSchema = z.object({
  content: z.string().min(1).max(4000),
  mode: chatModeSchema,
  sessionId: z.string().uuid().optional(),
});

export const chatStreamQuerySchema = z.object({
  message: z.string().min(1).max(4000),
  mode: chatModeSchema,
  sessionId: z.string().uuid().optional(),
});

export const chatHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});

export const chatSessionCreateSchema = z.object({
  title: z.string().max(120).optional(),
});

export const chatSessionRenameSchema = z.object({
  title: z.string().min(1).max(120),
});

export type ChatMode = z.infer<typeof chatModeSchema>;
export type ChatSendInput = z.infer<typeof chatSendRequestSchema>;
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;
export type ChatSessionCreate = z.infer<typeof chatSessionCreateSchema>;
export type ChatSessionRename = z.infer<typeof chatSessionRenameSchema>;
