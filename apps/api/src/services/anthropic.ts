import Anthropic from '@anthropic-ai/sdk';
import { type AITask, getModelForTask } from '@klaro/shared';
import { env } from '@/config/env';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  _client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export interface ClaudeCallOptions {
  task: AITask;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}

export async function claudeCall(opts: ClaudeCallOptions): Promise<string> {
  const client = getAnthropic();
  const model = getModelForTask(opts.task);
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  });
  const part = res.content[0];
  if (part?.type === 'text') return part.text;
  return '';
}
