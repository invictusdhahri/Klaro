export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  userId: string;
  role: ChatRole;
  content: string;
  contextSnapshot: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatStreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  error?: string;
}
