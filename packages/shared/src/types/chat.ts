export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  userId: string;
  role: ChatRole;
  content: string;
  contextSnapshot: Record<string, unknown> | null;
  createdAt: string;
  sessionId?: string | null;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  isSummarized: boolean;
  archivedAt: string | null;
}

export interface UserMemory {
  id: string;
  userId: string;
  sourceSessionId: string | null;
  fact: string;
  category: 'goal' | 'preference' | 'situation' | 'concern' | 'fact' | null;
  importance: number;
  createdAt: string;
}

export interface ChatStreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  error?: string;
  sessionId?: string;
}
