import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import {
  chatHistoryQuerySchema,
  chatSendRequestSchema,
  chatStreamQuerySchema,
  chatSessionRenameSchema,
  CLAUDE_HAIKU,
  CLAUDE_SONNET,
} from '@klaro/shared';
import type { ChatMode, ChatHistoryQuery, ChatSendInput, Json, UserMemory } from '@klaro/shared';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { supabaseAdmin } from '../services/supabase';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export const chatRouter = Router();

chatRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Multer for chat file attachments (images + PDF, max 10 MB)
// ---------------------------------------------------------------------------
const CHAT_ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (CHAT_ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

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
Always respond in English. Be warm, specific, and always reference the user's actual data when available. Quote amounts in TND.`;

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
// Session helpers
// ---------------------------------------------------------------------------
interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count: number;
  is_summarized: boolean;
  archived_at: string | null;
}

async function getOrCreateActiveSession(userId: string, sessionId?: string): Promise<ChatSession> {
  // If a specific session is requested, verify ownership and return it.
  if (sessionId) {
    const { data } = await supabaseAdmin
      .from('chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('archived_at', null)
      .single();
    if (data) return data as ChatSession;
  }

  // Return the most recently used non-archived session.
  const { data: recent } = await supabaseAdmin
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) return recent as ChatSession;

  // Create a brand-new session.
  const { data: created, error } = await supabaseAdmin
    .from('chat_sessions')
    .insert({ user_id: userId, title: 'New chat' })
    .select('*')
    .single();

  if (error || !created) {
    throw new Error(`Failed to create chat session: ${error?.message ?? 'unknown'}`);
  }
  return created as ChatSession;
}

async function bumpSessionDirect(sessionId: string, count: number): Promise<void> {
  // Fetch current count, then update — acceptable for our low-concurrency use case.
  const { data } = await supabaseAdmin
    .from('chat_sessions')
    .select('message_count')
    .eq('id', sessionId)
    .single();

  await supabaseAdmin
    .from('chat_sessions')
    .update({
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      message_count: ((data?.message_count as number | null) ?? 0) + count,
    })
    .eq('id', sessionId);
}

async function maybeGenerateTitle(
  anthropic: Anthropic,
  session: ChatSession,
  firstUserMessage: string,
): Promise<void> {
  if (session.title !== 'New chat' || session.message_count > 0) return;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_HAIKU,
      max_tokens: 30,
      system: `Generate a 3-5 word title for a financial advisor chat session based on the user's first message.
Return ONLY the title, no quotes, no punctuation at the end. Always write the title in English.`,
      messages: [{ role: 'user', content: firstUserMessage.slice(0, 200) }],
    });
    const title =
      response.content[0]?.type === 'text'
        ? response.content[0].text.trim().slice(0, 120)
        : null;

    if (title) {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ title })
        .eq('id', session.id)
        .eq('title', 'New chat'); // only if still "New chat" (race guard)
    }
  } catch (err) {
    logger.warn({ err, sessionId: session.id }, 'maybeGenerateTitle failed');
  }
}

async function summarizeSessionIfStale(
  anthropic: Anthropic,
  userId: string,
  currentSessionId: string,
): Promise<void> {
  try {
    // Summarize any previous session that still has unsummarized messages.
    // We exclude only the *current* session (which the user is actively in).
    // No idle-time gate is needed — if the user has moved on to a new session,
    // the old one is ready to be distilled into memories immediately.
    const { data: staleSessions } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('user_id', userId)
      .neq('id', currentSessionId)
      .eq('is_summarized', false)
      .gt('message_count', 1)
      .order('last_message_at', { ascending: true }) // oldest first
      .limit(3); // process up to 3 backlogged sessions per call

    if (!staleSessions?.length) return;

    const staleSession = staleSessions[0];
    if (!staleSession) return;

    // Process all returned sessions sequentially (up to the limit).
    for (const staleSession of staleSessions) {
      if (!staleSession) continue;

    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', staleSession.id)
      .order('created_at', { ascending: true });

    if (!messages?.length) {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ is_summarized: true })
        .eq('id', staleSession.id as string);
        continue;
    }

    const transcript = messages
      .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const response = await anthropic.messages.create({
      model: CLAUDE_HAIKU,
      max_tokens: 400,
      system: `You are extracting long-term memory facts from a financial advisor conversation.
Extract 2-5 short, factual sentences in English (regardless of conversation language) that would help a financial advisor remember important things about this user in future sessions.
Rules:
- Only include facts that are genuinely useful for future advice
- No PII duplication of what's already in their profile (name, email, etc.)
- Keep each fact under 20 words
- Return ONLY valid JSON: {"facts": [{"fact": "...", "category": "goal|preference|situation|concern|fact", "importance": 1-5}]}`,
      messages: [{ role: 'user', content: `Conversation transcript:\n${transcript}` }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
      let parsed: { facts: Array<{ fact: string; category: string; importance: number }> } | null = null;
      try {
        parsed = JSON.parse(text) as { facts: Array<{ fact: string; category: string; importance: number }> };
      } catch {
        // If JSON parse fails, still mark as summarized so we don't retry forever.
      }

    if (parsed?.facts?.length) {
      await supabaseAdmin.from('user_memories').insert(
        parsed.facts.map((f) => ({
          user_id: userId,
          source_session_id: staleSession.id as string,
          fact: f.fact,
          category: f.category,
          importance: Math.min(5, Math.max(1, f.importance)),
        })),
      );
    }

    await supabaseAdmin
      .from('chat_sessions')
      .update({ is_summarized: true })
        .eq('id', staleSession.id as string);
    }
  } catch (err) {
    logger.warn({ err, userId }, 'summarizeSessionIfStale failed (non-fatal)');
  }
}

async function loadUserMemories(userId: string, limit = 15): Promise<UserMemory[]> {
  const { data } = await supabaseAdmin
    .from('user_memories')
    .select('id, user_id, source_session_id, fact, category, importance, created_at')
    .eq('user_id', userId)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((m) => ({
    id: m.id as string,
    userId: m.user_id as string,
    sourceSessionId: m.source_session_id as string | null,
    fact: m.fact as string,
    category: m.category as UserMemory['category'],
    importance: m.importance as number,
    createdAt: m.created_at as string,
  }));
}

function buildMemoryBlock(memories: UserMemory[]): string {
  if (!memories.length) return '';
  return (
    '\n\n--- LONG-TERM MEMORY (things you remember about this user from past sessions) ---\n' +
    memories.map((m) => `- ${m.fact}`).join('\n') +
    '\n--- END MEMORY ---'
  );
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
// Haiku: generate contextual follow-up suggestions from the response
// ---------------------------------------------------------------------------
async function generateFollowUps(
  userMessage: string,
  assistantResponse: string,
  anthropic: Anthropic,
): Promise<string[]> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_HAIKU,
      max_tokens: 200,
      system: `You are a follow-up question generator for a financial advisor chatbot focused on Tunisia.
Given the user's question and the advisor's response, generate exactly 4 short follow-up questions the user might naturally want to ask next.
Rules:
- Questions must be directly related to topics mentioned in the response
- Each question must be under 12 words
- Match the language of the user's message (English only for now)
- Return ONLY a JSON array of 4 strings, no other text
Example: ["How much can I save per month?", "What is my biggest expense?", "Can I afford a car?", "How do I improve my score?"]`,
      messages: [
        {
          role: 'user',
          content: `User asked: "${userMessage}"\n\nAdvisor responded: "${assistantResponse.slice(0, 800)}"`,
        },
      ],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]';
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return (parsed as string[]).slice(0, 4);
    }
    return [];
  } catch {
    return [];
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
  sessionId?: string,
) {
  await supabaseAdmin.from('chat_messages').insert({
    user_id: userId,
    role,
    content,
    context_snapshot: (contextSnapshot ?? null) as Json | null,
    session_id: sessionId ?? null,
  });
}

// ---------------------------------------------------------------------------
// POST /send — non-streaming, returns full response
// ---------------------------------------------------------------------------
chatRouter.post('/send', validate(chatSendRequestSchema), async (req, res) => {
  const userId = req.user!.id;
  const { content, mode, sessionId: reqSessionId } = req.body as ChatSendInput & { sessionId?: string };

  const anthropic = getAnthropic();

  if (!anthropic) {
    const session = await getOrCreateActiveSession(userId, reqSessionId);
    await persistMessage(userId, 'user', content, {}, session.id);
    const fallback =
      'The AI advisor is not configured yet (missing ANTHROPIC_API_KEY). Your message has been saved.';
    await persistMessage(userId, 'assistant', fallback, {}, session.id);
    await bumpSessionDirect(session.id, 2);
    return res.json({ role: 'assistant', content: fallback, mode, sessionId: session.id });
  }

  try {
    const session = await getOrCreateActiveSession(userId, reqSessionId);
    const wasNew = session.message_count === 0;

    // Summarize old sessions first, then load the freshest memories.
    await summarizeSessionIfStale(anthropic, userId, session.id).catch(() => {});
    const memories = await loadUserMemories(userId);

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
    const memoryBlock = buildMemoryBlock(memories);

    const response = await anthropic.messages.create({
      model: CLAUDE_SONNET,
      max_tokens: 1024,
      system: `${MODE_PROMPTS[effectiveMode]}${memoryBlock}\n\n${context}`,
      messages: [{ role: 'user', content }],
    });

    const assistantContent =
      response.content[0]?.type === 'text' ? response.content[0].text : 'Sorry, I could not generate a response.';

    await Promise.all([
      persistMessage(userId, 'user', content, {}, session.id),
      persistMessage(userId, 'assistant', assistantContent, { mode: effectiveMode }, session.id),
    ]);
    await bumpSessionDirect(session.id, 2);

    // Fire-and-forget post-send jobs
    if (wasNew) {
      maybeGenerateTitle(anthropic, session, content).catch(() => {});
    }
    summarizeSessionIfStale(anthropic, userId, session.id).catch(() => {});

    return res.json({ role: 'assistant', content: assistantContent, mode: effectiveMode, sessionId: session.id });
  } catch (err) {
    logger.error({ err, userId }, 'chat send failed');
    return res.status(500).json({ error: 'Failed to get advisor response. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /stream — SSE streaming via Claude Sonnet
// Accepts: ?message=...&mode=...&sessionId=...
// ---------------------------------------------------------------------------
chatRouter.get('/stream', validate(chatStreamQuerySchema, 'query'), async (req, res) => {
  const userId = req.user!.id;
  const { message, mode, sessionId: reqSessionId } = req.query as {
    message: string;
    mode: ChatMode;
    sessionId?: string;
  };

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
    const session = await getOrCreateActiveSession(userId, reqSessionId);
    const wasNew = session.message_count === 0;

    // Summarize old sessions first so memories include everything from past chats.
    await summarizeSessionIfStale(anthropic, userId, session.id).catch(() => {});
    const memories = await loadUserMemories(userId);

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
    const memoryBlock = buildMemoryBlock(memories);
    let fullContent = '';
    let streamErrored = false;

    const stream = anthropic.messages.stream({
      model: CLAUDE_SONNET,
      max_tokens: 1024,
      system: `${MODE_PROMPTS[effectiveMode]}${memoryBlock}\n\n${context}`,
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
      const suggestions = await generateFollowUps(message, fullContent, anthropic).catch(() => []);

      sendEvent({ type: 'done', mode: effectiveMode, suggestions, sessionId: session.id });
      res.end();

      Promise.all([
        persistMessage(userId, 'user', message, {}, session.id),
        persistMessage(userId, 'assistant', fullContent, { mode: effectiveMode, streamed: true }, session.id),
      ])
        .then(() => bumpSessionDirect(session.id, 2))
        .then(() => {
          if (wasNew) maybeGenerateTitle(anthropic, session, message).catch(() => {});
          summarizeSessionIfStale(anthropic, userId, session.id).catch(() => {});
        })
        .catch((err) => logger.warn({ err, userId }, 'chat persist after stream failed'));
    }
  } catch (err) {
    logger.error({ err, userId }, 'chat stream setup failed');
    sendEvent({ type: 'error', error: 'Failed to reach the AI advisor. Please try again.' });
    sendEvent({ type: 'done' });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /stream-file — SSE streaming with optional file attachment.
// ---------------------------------------------------------------------------

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

// DocumentBlockParam is not exported in SDK 0.32.x; define it locally.
interface DocumentBlockParam {
  type: 'document';
  source: { type: 'base64'; media_type: 'application/pdf'; data: string };
}

type UserContentBlock =
  | Anthropic.ImageBlockParam
  | Anthropic.TextBlockParam
  | DocumentBlockParam;

chatRouter.post('/stream-file', chatUpload.single('file'), async (req, res) => {
  const userId = req.user!.id;
  const message = ((req.body?.message as string | undefined) ?? '').trim();
  const rawMode = (req.body?.mode as string | undefined) ?? 'general';
  const reqSessionId = (req.body?.sessionId as string | undefined) || undefined;
  const validModes: ChatMode[] = ['spending_analysis', 'habit_insights', 'score_tips', 'general'];
  const mode: ChatMode = validModes.includes(rawMode as ChatMode) ? (rawMode as ChatMode) : 'general';
  const file = req.file;

  if (!message && !file) {
    return res.status(400).json({ error: 'message or file is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent2 = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const anthropic = getAnthropic();

  if (!anthropic) {
    sendEvent2({ type: 'delta', content: 'AI advisor not configured (ANTHROPIC_API_KEY missing).' });
    sendEvent2({ type: 'done' });
    res.end();
    return;
  }

  try {
    const session = await getOrCreateActiveSession(userId, reqSessionId);
    const wasNew = session.message_count === 0;

    // Summarize old sessions first so memories include everything from past chats.
    await summarizeSessionIfStale(anthropic, userId, session.id).catch(() => {});
    const memories = await loadUserMemories(userId);

    const classifyText =
      message ||
      (file
        ? `User sent a ${file.mimetype.startsWith('image/') ? 'image' : 'document'} file: ${file.originalname}`
        : '');

    const [context, { safe, mode: detectedMode }] = await Promise.all([
      buildFinancialContext(userId),
      classifyIntent(classifyText, anthropic),
    ]);

    if (!safe) {
      sendEvent2({
        type: 'error',
        error: 'Please keep questions focused on your personal finances and financial health.',
      });
      sendEvent2({ type: 'done' });
      res.end();
      return;
    }

    const effectiveMode = mode !== 'general' ? mode : detectedMode;
    const memoryBlock = buildMemoryBlock(memories);

    const userContent: UserContentBlock[] = [];

    if (file) {
      const base64 = file.buffer.toString('base64');
      if (file.mimetype === 'application/pdf') {
        userContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        });
      } else {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.mimetype as ImageMediaType,
            data: base64,
          },
        });
      }
    }

    if (message) {
      userContent.push({ type: 'text', text: message });
    } else {
      const autoPrompt =
        file?.mimetype === 'application/pdf'
          ? 'Please analyse this document in the context of my finances and provide relevant insights.'
          : 'Please look at this image and share any relevant financial insights or observations.';
      userContent.push({ type: 'text', text: autoPrompt });
    }

    let fullContent = '';
    let streamErrored = false;

    const stream = anthropic.messages.stream({
      model: CLAUDE_SONNET,
      max_tokens: 1024,
      system: `${MODE_PROMPTS[effectiveMode]}${memoryBlock}\n\n${context}`,
      messages: [{ role: 'user', content: userContent as Anthropic.MessageParam['content'] }],
    });

    stream.on('text', (text) => {
      fullContent += text;
      sendEvent2({ type: 'delta', content: text });
    });

    stream.on('error', (err) => {
      streamErrored = true;
      logger.error({ err, userId }, 'chat stream-file error');
      sendEvent2({
        type: 'error',
        error: 'Something went wrong while generating a response. Please try again.',
      });
      sendEvent2({ type: 'done' });
      res.end();
    });

    await stream.finalMessage();

    if (!streamErrored) {
      sendEvent2({ type: 'done', mode: effectiveMode, sessionId: session.id });
      res.end();

      const persistText = message || `[Attached: ${file?.originalname ?? 'file'}]`;
      Promise.all([
        persistMessage(userId, 'user', persistText, {}, session.id),
        persistMessage(
          userId,
          'assistant',
          fullContent,
          { mode: effectiveMode, streamed: true, hasAttachment: Boolean(file), attachmentMime: file?.mimetype ?? null },
          session.id,
        ),
      ])
        .then(() => bumpSessionDirect(session.id, 2))
        .then(() => {
          if (wasNew) maybeGenerateTitle(anthropic, session, persistText).catch(() => {});
          summarizeSessionIfStale(anthropic, userId, session.id).catch(() => {});
        })
        .catch((err) => logger.warn({ err, userId }, 'chat persist after stream-file failed'));
    }
  } catch (err) {
    logger.error({ err, userId }, 'chat stream-file setup failed');
    sendEvent2({ type: 'error', error: 'Failed to reach the AI advisor. Please try again.' });
    sendEvent2({ type: 'done' });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// GET /history — paginated chat history from DB (backwards-compatible)
// ---------------------------------------------------------------------------
chatRouter.get('/history', validate(chatHistoryQuerySchema, 'query'), async (req, res) => {
  const userId = req.user!.id;
  const q = req.query as unknown as ChatHistoryQuery;

  let query = supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, created_at, session_id')
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

// ---------------------------------------------------------------------------
// GET /sessions — list user's active sessions
// ---------------------------------------------------------------------------
chatRouter.get('/sessions', async (req, res) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, title, created_at, updated_at, last_message_at, message_count')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }

  return res.json(
    (data ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      lastMessageAt: s.last_message_at,
      messageCount: s.message_count,
    })),
  );
});

// ---------------------------------------------------------------------------
// POST /sessions — explicitly create a new empty session
// ---------------------------------------------------------------------------
chatRouter.post('/sessions', async (req, res) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .insert({ user_id: userId, title: 'New chat' })
    .select('id, title, created_at, updated_at, last_message_at, message_count')
    .single();

  if (error || !data) {
    return res.status(500).json({ error: 'Failed to create session' });
  }

  // Await summarization of old sessions so memories are ready before the
  // user sends their first message in this new session.
  const anthropic = getAnthropic();
  if (anthropic) {
    await summarizeSessionIfStale(anthropic, userId, data.id as string).catch(() => {});
  }

  return res.status(201).json({
    id: data.id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    lastMessageAt: data.last_message_at,
    messageCount: data.message_count,
  });
});

// ---------------------------------------------------------------------------
// PATCH /sessions/:id — rename a session
// ---------------------------------------------------------------------------
chatRouter.patch('/sessions/:id', validate(chatSessionRenameSchema), async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;
  const { title } = req.body as { title: string };

  const { error } = await supabaseAdmin
    .from('chat_sessions')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return res.status(500).json({ error: 'Failed to rename session' });
  }

  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:id — hard-delete a session (memories survive via set null)
// ---------------------------------------------------------------------------
chatRouter.delete('/sessions/:id', async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('chat_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete session' });
  }

  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id/messages — paginated messages for a single session
// ---------------------------------------------------------------------------
chatRouter.get('/sessions/:id/messages', async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const before = req.query.before as string | undefined;

  // Verify ownership
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  let query = supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, created_at, context_snapshot, session_id')
    .eq('session_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }

  // Await summarization of previous sessions before returning messages.
  // This ensures memories are already written when the client renders and
  // the user sends their first message — no more "I don't know your dream car".
  const anthropic = getAnthropic();
  if (anthropic) {
    await summarizeSessionIfStale(anthropic, userId, id).catch(() => {});
  }

  return res.json((data ?? []).reverse());
});

// ---------------------------------------------------------------------------
// GET /memories — list user's long-term memories (read-only inspection)
// ---------------------------------------------------------------------------
chatRouter.get('/memories', async (req, res) => {
  const userId = req.user!.id;
  const memories = await loadUserMemories(userId, 50);
  return res.json(memories);
});

// ---------------------------------------------------------------------------
// DELETE /memories/:id — delete a single memory
// ---------------------------------------------------------------------------
chatRouter.delete('/memories/:id', async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('user_memories')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete memory' });
  }

  return res.json({ ok: true });
});
