/**
 * AI model routing — keep in sync between web, api, and ml.
 * Source of truth: internal_docs/06_Updated_Architecture_TechStack.md
 */

export type AITask =
  | 'transaction_categorize'
  | 'ocr_extract'
  | 'input_filter'
  | 'financial_chat'
  | 'fraud_analysis'
  | 'score_coaching';

export const CLAUDE_HAIKU = 'claude-haiku-4-5-20251001' as const;
export const CLAUDE_SONNET = 'claude-sonnet-4-6' as const;

export const AI_MODEL_MAP: Record<AITask, string> = {
  transaction_categorize: CLAUDE_HAIKU,
  ocr_extract: CLAUDE_HAIKU,
  input_filter: CLAUDE_HAIKU,
  financial_chat: CLAUDE_SONNET,
  fraud_analysis: CLAUDE_SONNET,
  score_coaching: CLAUDE_SONNET,
};

export function getModelForTask(task: AITask): string {
  return AI_MODEL_MAP[task];
}
