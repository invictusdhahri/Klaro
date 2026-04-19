import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { chatHistoryQuerySchema, chatSendRequestSchema, chatStreamQuerySchema, CLAUDE_HAIKU, CLAUDE_SONNET } from '@klaro/shared';
import type { ChatMode, ChatHistoryQuery, ChatSendInput, Json } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { supabaseAdmin } from '../services/supabase';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export const chatRouter = Router();

chatRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Anthropic client (lazy — only constructed when API key is present)
// ---------------------------------------------------------------------------
function getAnthropic(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// ---------------------------------------------------------------------------
// Mode-aware system prompts
// ---------------------------------------------------------------------------
const SYSTEM_BASE = `You are Klaro, an AI financial advisor for Tunisia. You help users understand their financial health, Klaro credit score, and how to build better financial habits.
Always respond in the same language as the user's message (French, Arabic, or English). Be warm, specific, and always reference the user's actual data when available. Quote amounts in TND.`;

const MODE_PROMPTS: Record<ChatMode, string> = {
  spending_analysis: `${SYSTEM_BASE}

Your current task: SPENDING ANALYSIS.
Analyze the user's spending data in detail. Identify:
1. The top 3-5 spending categories by total amount this period.
2. Any category that consumes more than 30% of their income — flag it.
3. Unusual or one-off large transactions worth discussing.
4. Whether their expense-to-income ratio is healthy (below 70% is ideal).
Be specific with TND amounts. Conclude with one concrete action they can take today.`,

  habit_insights: `${SYSTEM_BASE}

Your current task: HABIT INSIGHTS.
Reveal behavioral patterns from the user's transaction history:
1. When they tend to pay bills (early vs. late in the month — signals financial discipline).
2. Weekend vs. weekday spending differences.
3. Round-number transactions (e.g., multiples of 50 or 100 TND) — these often indicate informal or cash-based payments.
4. Income arrival day and whether spending spikes right after.
5. Any pattern that reveals something interesting about their financial habits.
Be insightful but non-judgmental. Explain what each pattern means for their financial health.`,

  score_tips: `${SYSTEM_BASE}

Your current task: SCORE IMPROVEMENT TIPS.
Based on the user's current Klaro score, breakdown, and coaching tips, give a concrete improvement plan:
1. Identify the 2-3 breakdown dimensions with the most room for improvement.
2. For each dimension, give one specific, actionable step.
3. Estimate a realistic score gain (e.g., "+30 to +60 points in 3 months") if they follow through.
4. Prioritize by impact — list the highest-impact action first.
Be encouraging and set realistic expectations. If no score exists yet, guide them on how to get their first score.`,

  general: `${SYSTEM_BASE}

Answer the user's question using their financial data. You can cover:
- Their spending patterns and what they reveal
- Their Klaro credit score and what each factor means
- How to improve specific score dimensions
- General financial advice tailored to the Tunisian context (TND, Tunisian banking system, local cost of living)
- Encouragement and next steps
If the question is entirely unrelated to personal finance, gently redirect to financial topics.`,
};

// ---------------------------------------------------------------------------
// Context builder — fetches Supabase data and formats it for the LLM prompt
// ---------------------------------------------------------------------------
async function buildFinancialContext(userId: string): Promise<string> {
  const [scoreResult, txResult, profileResult] = await Promise.all([
    supabaseAdmin
      .from('credit_scores')
      .select('score, score_band, risk_category, confidence, breakdown, flags, recommendations')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('transactions')
      .select('transaction_date, amount, transaction_type, category, counterparty, description')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .limit(30),
    supabaseAdmin
      .from('profiles')
      .select('occupation_category, kyc_status, location_governorate')
      .eq('id', userId)
      .single(),
  ]);

  const parts: string[] = ['--- USER FINANCIAL CONTEXT ---'];

  const profile = profileResult.data;
  if (profile) {
    parts.push(
      `Profile: occupation=${profile.occupation_category ?? 'unknown'}, KYC=${profile.kyc_status}, region=${profile.location_governorate ?? 'unknown'}`,
    );
  }

  const score = scoreResult.data;
  if (score) {
    parts.push(
      `Klaro Score: ${score.score}/1000 (${score.score_band}), risk=${score.risk_category}, confidence=${Math.round((Number(score.confidence) || 0) * 100)}%`,
    );
    const tips = (score.recommendations as string[] | null) ?? [];
    if (tips.length) parts.push(`Coaching tips from last scoring: ${tips.join('; ')}`);
    const flags = (score.flags as string[] | null) ?? [];
    if (flags.length) parts.push(`Risk flags: ${flags.join(', ')}`);
  } else {
    parts.push('Klaro Score: not yet generated');
  }

  const txs = txResult.data ?? [];
  if (txs.length) {
    const income = txs.filter((t) => t.transaction_type === 'credit').reduce((a, t) => a + Number(t.amount), 0);
    const expense = txs.filter((t) => t.transaction_type === 'debit').reduce((a, t) => a + Number(t.amount), 0);
    parts.push(
      `Last ${txs.length} transactions: income ${income.toFixed(2)} TND, expenses ${expense.toFixed(2)} TND, ratio ${income > 0 ? ((expense / income) * 100).toFixed(0) : 'N/A'}%`,
    );

    // Category breakdown for debits
    const cats: Record<string, number> = {};
    for (const t of txs.filter((tx) => tx.transaction_type === 'debit')) {
      const cat = t.category ?? 'other';
      cats[cat] = (cats[cat] ?? 0) + Number(t.amount);
    }
    const top = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${v.toFixed(2)} TND`);
    if (top.length) parts.push(`Top spending categories: ${top.join(', ')}`);

    // Recent sample
    const sample = txs.slice(0, 8).map(
      (t) =>
        `${t.transaction_date} | ${t.transaction_type === 'credit' ? '+' : '-'}${Number(t.amount).toFixed(2)} TND | ${t.category ?? 'uncategorized'} | ${t.counterparty ?? t.description ?? 'unknown'}`,
    );
    parts.push(`Recent transactions:\n${sample.join('\n')}`);
  } else {
    parts.push('No transaction history available yet.');
  }

  parts.push('--- END CONTEXT ---');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Haiku: safety check + intent classification
// ---------------------------------------------------------------------------
async function classifyIntent(
  message: string,
  anthropic: Anthropic,
): Promise<{ safe: boolean; mode: ChatMode }> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_HAIKU,
      max_tokens: 80,
      system: `Classify the user message for a financial advisor chatbot. Return ONLY valid JSON:
{"safe": <boolean>, "mode": "<spending_analysis|habit_insights|score_tips|general>"}
- safe=false: harmful, abusive, or completely off-topic (unrelated to personal finance)
- mode: best advisor mode for this message`,
      messages: [{ role: 'user', content: message }],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const parsed = JSON.parse(text) as { safe: boolean; mode: string };
    const validModes: ChatMode[] = ['spending_analysis', 'habit_insights', 'score_tips', 'general'];
    return {
      safe: Boolean(parsed.safe),
      mode: validModes.includes(parsed.mode as ChatMode) ? (parsed.mode as ChatMode) : 'general',
    };
  } catch {
    return { safe: true, mode: 'general' };
  }
}

// ---------------------------------------------------------------------------
// Persist a chat message to the DB
// ---------------------------------------------------------------------------
async function persistMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  contextSnapshot?: Record<string, unknown>,
) {
  await supabaseAdmin.from('chat_messages').insert({
    user_id: userId,
    role,
    content,
    context_snapshot: (contextSnapshot ?? null) as Json | null,
  });
}

// ---------------------------------------------------------------------------
// POST /send — non-streaming, returns full response
// ---------------------------------------------------------------------------
chatRouter.post('/send', validate(chatSendRequestSchema), async (req, res) => {
  const userId = req.user!.id;
  const { content, mode } = req.body as ChatSendInput;

  const anthropic = getAnthropic();

  if (!anthropic) {
    await persistMessage(userId, 'user', content);
    const fallback =
      'The AI advisor is not configured yet (missing ANTHROPIC_API_KEY). Your message has been saved.';
    await persistMessage(userId, 'assistant', fallback);
    return res.json({ role: 'assistant', content: fallback, mode });
  }

  try {
    const [context, { safe, mode: detectedMode }] = await Promise.all([
      buildFinancialContext(userId),
      classifyIntent(content, anthropic),
    ]);

    if (!safe) {
      return res.status(400).json({
        error: 'Message flagged',
        reason: 'Please keep questions focused on your personal finances and financial health.',
      });
    }

    const effectiveMode = mode !== 'general' ? mode : detectedMode;

    const response = await anthropic.messages.create({
      model: CLAUDE_SONNET,
      max_tokens: 1024,
      system: `${MODE_PROMPTS[effectiveMode]}\n\n${context}`,
      messages: [{ role: 'user', content }],
    });

    const assistantContent =
      response.content[0]?.type === 'text' ? response.content[0].text : 'Sorry, I could not generate a response.';

    await Promise.all([
      persistMessage(userId, 'user', content),
      persistMessage(userId, 'assistant', assistantContent, { mode: effectiveMode }),
    ]);

    return res.json({ role: 'assistant', content: assistantContent, mode: effectiveMode });
  } catch (err) {
    logger.error({ err, userId }, 'chat send failed');
    return res.status(500).json({ error: 'Failed to get advisor response. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /stream — SSE streaming via Claude Sonnet
// Accepts: ?message=...&mode=...
// ---------------------------------------------------------------------------
chatRouter.get('/stream', validate(chatStreamQuerySchema, 'query'), async (req, res) => {
  const userId = req.user!.id;
  const { message, mode } = req.query as { message: string; mode: ChatMode };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const anthropic = getAnthropic();

  if (!anthropic) {
    sendEvent({ type: 'delta', content: 'AI advisor not configured (ANTHROPIC_API_KEY missing).' });
    sendEvent({ type: 'done' });
    res.end();
    return;
  }

  try {
    const [context, { safe, mode: detectedMode }] = await Promise.all([
      buildFinancialContext(userId),
      classifyIntent(message, anthropic),
    ]);

    if (!safe) {
      sendEvent({
        type: 'error',
        error: 'Please keep questions focused on your personal finances and financial health.',
      });
      sendEvent({ type: 'done' });
      res.end();
      return;
    }

    const effectiveMode = mode !== 'general' ? mode : detectedMode;
    let fullContent = '';

    let streamErrored = false;

    const stream = anthropic.messages.stream({
      model: CLAUDE_SONNET,
      max_tokens: 1024,
      system: `${MODE_PROMPTS[effectiveMode]}\n\n${context}`,
      messages: [{ role: 'user', content: message }],
    });

    stream.on('text', (text) => {
      fullContent += text;
      sendEvent({ type: 'delta', content: text });
    });

    stream.on('error', (err) => {
      streamErrored = true;
      logger.error({ err, userId }, 'chat stream error');
      sendEvent({ type: 'error', error: 'Something went wrong while generating a response. Please try again.' });
      sendEvent({ type: 'done' });
      res.end();
    });

    await stream.finalMessage();

    if (!streamErrored) {
      sendEvent({ type: 'done', mode: effectiveMode });
      res.end();

      // Persist after stream completes — non-blocking.
      Promise.all([
        persistMessage(userId, 'user', message),
        persistMessage(userId, 'assistant', fullContent, { mode: effectiveMode, streamed: true }),
      ]).catch((err) => logger.warn({ err, userId }, 'chat persist after stream failed'));
    }
  } catch (err) {
    logger.error({ err, userId }, 'chat stream setup failed');
    sendEvent({ type: 'error', error: 'Failed to reach the AI advisor. Please try again.' });
    sendEvent({ type: 'done' });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// GET /history — paginated chat history from DB
// ---------------------------------------------------------------------------
chatRouter.get('/history', validate(chatHistoryQuerySchema, 'query'), async (req, res) => {
  const userId = req.user!.id;
  const q = req.query as unknown as ChatHistoryQuery;

  let query = supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(q.limit ?? 50);

  if (q.before) {
    query = query.lt('created_at', q.before);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch chat history' });
  }

  return res.json((data ?? []).reverse());
});
