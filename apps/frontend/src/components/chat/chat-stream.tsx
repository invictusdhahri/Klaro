'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUp,
  Paperclip,
  TrendingDown,
  Activity,
  Sparkles,
  Target,
  X,
  FileText,
  UploadCloud,
  Square,
} from 'lucide-react';
import { MessageBubble } from '@/components/chat/message-bubble';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { cn } from '@klaro/ui/cn';
import { API_ENDPOINTS } from '@klaro/shared';
import type { ChatRole } from '@klaro/shared';

type ChatMode = 'spending_analysis' | 'habit_insights' | 'score_tips' | 'general';

export interface MessageAttachment {
  name: string;
  mimeType: string;
  previewUrl?: string;
}

interface UiMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
  attachment?: MessageAttachment;
}

interface SuggestionCard {
  id: ChatMode;
  title: string;
  prompt: string;
  blurb: string;
  Icon: typeof TrendingDown;
  iconWrap: string;
  ring: string;
}

interface UserContext {
  firstName: string | null;
  score: number | null;
  scoreBand: string | null;
  topCategory: string | null;
  occupation: string | null;
  governorate: string | null;
}

const CHAT_ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
const MAX_FILE_MB = 10;

const CHAT_ACCEPTED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

function validateFile(file: File): string | null {
  if (!CHAT_ACCEPTED_MIMES.has(file.type)) {
    return `Unsupported file type (${file.type || 'unknown'}). Use images or PDF.`;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return `File too large. Maximum is ${MAX_FILE_MB} MB.`;
  }
  return null;
}

const MODE_LABELS: Record<ChatMode, string> = {
  general: 'Ask anything',
  spending_analysis: 'Spending',
  habit_insights: 'Habits',
  score_tips: 'Score tips',
};

function buildFollowUpChips(
  lastMode: ChatMode,
  ctx: UserContext,
): { prompt: string; mode: ChatMode }[] {
  const score = ctx.score !== null ? ctx.score : '—';
  const cat = ctx.topCategory ?? 'your top category';
  const band = ctx.scoreBand ?? 'your current band';

  const pools: Record<ChatMode, { prompt: string; mode: ChatMode }[]> = {
    spending_analysis: [
      { prompt: `How does my ${cat} spending compare to my income?`, mode: 'spending_analysis' },
      { prompt: 'Show me where I can cut expenses this month.', mode: 'spending_analysis' },
      { prompt: `Can I reduce my ${cat} bill by 20%?`, mode: 'general' },
      { prompt: 'What were my biggest one-off expenses recently?', mode: 'spending_analysis' },
    ],
    habit_insights: [
      { prompt: 'Do I pay my bills on time?', mode: 'habit_insights' },
      { prompt: 'What does my spending look like on weekends?', mode: 'habit_insights' },
      { prompt: 'Am I spending more this month than last month?', mode: 'spending_analysis' },
      { prompt: 'What pattern should I fix first?', mode: 'habit_insights' },
    ],
    score_tips: [
      {
        prompt: `My score is ${score} — what's the fastest way to gain 50 points?`,
        mode: 'score_tips',
      },
      { prompt: `What does ${band} mean for a loan application?`, mode: 'score_tips' },
      { prompt: 'Which score dimension hurts me most right now?', mode: 'score_tips' },
      { prompt: 'How long will it take to reach 700?', mode: 'score_tips' },
    ],
    general: [
      { prompt: 'How much should I save each month to build an emergency fund?', mode: 'general' },
      { prompt: 'Can I afford a personal loan right now?', mode: 'general' },
      { prompt: "What's the best way to improve my financial health?", mode: 'score_tips' },
      { prompt: 'Give me a 3-month savings plan.', mode: 'general' },
    ],
  };

  const primary = pools[lastMode].slice(0, 3);
  const extras = lastMode === 'general' ? pools.score_tips : pools.general;
  const extra = extras.find((c) => !primary.some((p) => p.prompt === c.prompt));
  const result: { prompt: string; mode: ChatMode }[] = [...primary];
  if (extra) result.push(extra);
  return result;
}

function buildSuggestionCards(ctx: UserContext): SuggestionCard[] {
  const firstName = ctx.firstName ? `, ${ctx.firstName}` : '';
  const score = ctx.score !== null ? ctx.score : null;
  const cat = ctx.topCategory ?? null;

  return [
    {
      id: 'spending_analysis',
      title: 'Spending',
      prompt: cat
        ? `Break down my ${cat} spending this month.`
        : "What's my weekly spending breakdown?",
      blurb: cat
        ? `You've been spending most on ${cat} — let's dig in.`
        : 'See exactly where your money went.',
      Icon: TrendingDown,
      iconWrap: 'bg-rose-500/10 text-rose-500',
      ring: 'hover:border-rose-500/40',
    },
    {
      id: 'habit_insights',
      title: 'Habits',
      prompt: 'What financial habits should I work on?',
      blurb: 'Uncover patterns hiding in your transactions.',
      Icon: Activity,
      iconWrap: 'bg-violet-500/10 text-violet-500',
      ring: 'hover:border-violet-500/40',
    },
    {
      id: 'score_tips',
      title: 'Score',
      prompt:
        score !== null
          ? `My score is ${score} — how do I reach 700?`
          : 'How can I improve my Klaro score?',
      blurb:
        score !== null
          ? `You're at ${score}/1000. Let's close the gap.`
          : 'Get a concrete plan to boost your score.',
      Icon: Sparkles,
      iconWrap: 'bg-amber-500/10 text-amber-500',
      ring: 'hover:border-amber-500/40',
    },
    {
      id: 'general',
      title: 'Goals',
      prompt: `Can I afford to buy a car this year${firstName}?`,
      blurb: 'Plan a big purchase or long-term savings goal.',
      Icon: Target,
      iconWrap: 'bg-emerald-500/10 text-emerald-500',
      ring: 'hover:border-emerald-500/40',
    },
  ];
}

function buildQuickChips(ctx: UserContext): { prompt: string; mode: ChatMode }[] {
  const score = ctx.score !== null ? ctx.score : null;
  const cat = ctx.topCategory ?? null;

  return [
    {
      prompt: cat ? `How can I reduce my ${cat} spending?` : 'How can I save 200 TND each month?',
      mode: 'spending_analysis',
    },
    { prompt: 'Show me my top spending categories.', mode: 'spending_analysis' },
    {
      prompt:
        score !== null
          ? `Why is my score ${score} and not higher?`
          : 'Why is my Klaro score where it is?',
      mode: 'score_tips',
    },
    { prompt: 'When do I usually overspend?', mode: 'habit_insights' },
  ];
}

/** Read SSE stream and call handlers. Resolves with sessionId from done event if present. */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onError: (msg: string) => void,
  onDone: (sessionId?: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let done = false;
  while (!done) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) {
      done = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const eventStr of events) {
      const dataLine = eventStr.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const chunk = JSON.parse(dataLine.slice(6)) as {
          type: string;
          content?: string;
          error?: string;
          sessionId?: string;
        };
        if (chunk.type === 'delta' && chunk.content) {
          onDelta(chunk.content);
        } else if (chunk.type === 'error') {
          onError(chunk.error ?? 'Something went wrong.');
        } else if (chunk.type === 'done') {
          onDone(chunk.sessionId);
        }
      } catch {
        // ignore malformed
      }
    }
  }
}

interface HistoryMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface ChatStreamProps {
  sessionId?: string;
}

export function ChatStream({ sessionId }: ChatStreamProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>('general');
  const [modeLocked, setModeLocked] = useState(false);
  const [lastMode, setLastMode] = useState<ChatMode>('general');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const [userCtx, setUserCtx] = useState<UserContext>({
    firstName: null,
    score: null,
    scoreBand: null,
    topCategory: null,
    occupation: null,
    governorate: null,
  });

  // Message queue: holds messages typed while a response is streaming.
  interface QueuedMessage { text: string; mode: ChatMode; file: File | null }
  const messageQueueRef = useRef<QueuedMessage[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNew = !sessionId || sessionId === 'new';

  // Hydrate chat history for the given session.
  useEffect(() => {
    if (isNew) {
      setMessages([]);
      setHistoryLoaded(true);
      return;
    }

    let cancelled = false;
    async function loadHistory() {
      try {
        const data = await api.get<HistoryMessage[]>(API_ENDPOINTS.chat.sessionMessages(sessionId!));
        if (cancelled) return;
        setMessages(
          data.map((m) => ({
            id: m.id,
            role: m.role as ChatRole,
            content: m.content,
          })),
        );
      } catch {
        // Silently ignore — user just sees empty chat.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [sessionId, isNew]);

  // Fetch user profile for personalised prompts.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const [meResult, scoreResult, txResult] = await Promise.allSettled([
          api.get<{ user: { id: string; email: string; user_metadata?: { full_name?: string } } }>(
            API_ENDPOINTS.auth.me,
          ),
          api.get<{ score: number; score_band: string; risk_category: string }>(
            API_ENDPOINTS.score.current,
          ),
          supabase
            .from('transactions')
            .select('amount, category, transaction_type')
            .eq('user_id', session.user.id)
            .eq('transaction_type', 'debit')
            .order('transaction_date', { ascending: false })
            .limit(30),
        ]);

        if (cancelled) return;

        const firstName =
          meResult.status === 'fulfilled'
            ? (meResult.value.user.user_metadata?.full_name?.split(' ')[0] ?? null)
            : null;
        const score =
          scoreResult.status === 'fulfilled' ? (scoreResult.value.score ?? null) : null;
        const scoreBand =
          scoreResult.status === 'fulfilled' ? (scoreResult.value.score_band ?? null) : null;

        let topCategory: string | null = null;
        if (txResult.status === 'fulfilled' && txResult.value.data) {
          const cats: Record<string, number> = {};
          for (const t of txResult.value.data as { category: string | null; amount: number }[]) {
            const c = t.category ?? 'other';
            cats[c] = (cats[c] ?? 0) + Number(t.amount);
          }
          const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
          topCategory = top ? top[0] : null;
        }

        setUserCtx({ firstName, score, scoreBand, topCategory, occupation: null, governorate: null });
      } catch {
        // best-effort
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 6 * 24;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    };
  }, [pendingPreviewUrl]);

  const clearPendingFile = useCallback(() => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  }, [pendingPreviewUrl]);

  const stageFile = useCallback((file: File) => {
    const err = validateFile(file);
    if (err) { alert(err); return; }
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setPendingFile(file);
    setPendingPreviewUrl(previewUrl);
    textareaRef.current?.focus();
  }, [pendingPreviewUrl]);

  const onFileChosen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) stageFile(file);
    e.target.value = '';
  }, [stageFile]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) stageFile(file);
  }, [stageFile]);

  const runSend = useCallback(
    async (text: string, sendMode: ChatMode, file?: File | null) => {
      const hasText = text.trim().length > 0;
      const hasFile = Boolean(file);
      if (!hasText && !hasFile) return;
      if (busy) return;

      setBusy(true);
      setStreaming(true);
      setLastMode(sendMode);

      const attachment: MessageAttachment | undefined = file
        ? {
            name: file.name,
            mimeType: file.type,
            previewUrl: file.type.startsWith('image/')
              ? (pendingPreviewUrl ?? undefined)
              : undefined,
          }
        : undefined;

      setPendingFile(null);
      setPendingPreviewUrl(null);
      if (fileRef.current) fileRef.current.value = '';

      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      setMessages((m) => [
        ...m,
        { id: userMsgId, role: 'user', content: text, attachment },
        { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
      ]);

      let stopped = false;

      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        if (!token) {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: 'Please log in to use the advisor.', streaming: false }
                : msg,
            ),
          );
          return;
        }

        abortRef.current = new AbortController();
        let res: Response;

        if (file) {
          const fd = new FormData();
          if (text) fd.append('message', text);
          fd.append('mode', sendMode);
          fd.append('file', file);
          if (sessionId && sessionId !== 'new') fd.append('sessionId', sessionId);

          res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/api/chat/stream-file`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
            signal: abortRef.current.signal,
          });
        } else {
          const params = new URLSearchParams({ message: text, mode: sendMode });
          if (sessionId && sessionId !== 'new') params.set('sessionId', sessionId);

          res = await fetch(
            `${env.NEXT_PUBLIC_API_BASE_URL}/api/chat/stream?${params.toString()}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: abortRef.current.signal,
            },
          );
        }

        if (!res.ok || !res.body) {
          throw new Error(`Stream error ${res.status}`);
        }

        let fullContent = '';

        await readSseStream(
          res.body,
          (delta) => {
            fullContent += delta;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, content: fullContent } : msg,
              ),
            );
          },
          (errMsg) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantMsgId
                  ? { ...msg, content: errMsg, streaming: false }
                  : msg,
              ),
            );
          },
          (returnedSessionId) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, streaming: false } : msg,
              ),
            );
            if (returnedSessionId && (isNew || returnedSessionId !== sessionId)) {
              router.replace(`/chat/${returnedSessionId}`);
            }
          },
        );

        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, streaming: false } : msg,
          ),
        );
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'AbortError') {
          stopped = true;
          // Mark the truncated response as done (not an error).
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, streaming: false }
                : msg,
            ),
          );
        } else {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: 'Failed to get a response. Please try again.', streaming: false }
                : msg,
            ),
          );
        }
      } finally {
        setBusy(false);
        setStreaming(false);

        // Drain one message from the queue (unless the user hit Stop).
        if (!stopped) {
          const next = messageQueueRef.current.shift();
          if (next) {
            // Small delay so React can flush the current state update.
            setTimeout(() => void runSend(next.text, next.mode, next.file), 50);
          }
        } else {
          // Discard queue on manual stop.
          messageQueueRef.current = [];
        }
      }
    },
    [busy, pendingPreviewUrl, sessionId, isNew, router],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    messageQueueRef.current = [];
  }, []);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text && !pendingFile) return;
      setInput('');

      if (busy) {
        // Queue the message — it will be sent after the current response finishes.
        messageQueueRef.current.push({ text, mode, file: pendingFile });
        // Clear the staged file from the preview strip (it will send later).
        if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
        setPendingFile(null);
        setPendingPreviewUrl(null);
        if (fileRef.current) fileRef.current.value = '';
        return;
      }

      void runSend(text, mode, pendingFile);
    },
    [input, mode, pendingFile, pendingPreviewUrl, busy, runSend],
  );

  const sendQuickPrompt = useCallback(
    (prompt: string, nextMode: ChatMode) => {
      if (busy) {
        messageQueueRef.current.push({ text: prompt, mode: nextMode, file: null });
        return;
      }
      setMode(nextMode);
      setModeLocked(true);
      void runSend(prompt, nextMode, null);
    },
    [busy, runSend],
  );

  const showEmptyState = historyLoaded && messages.length === 0;

  const lastMsg = messages[messages.length - 1];
  const showFollowUps =
    !showEmptyState && lastMsg?.role === 'assistant' && !lastMsg.streaming && !busy;

  const followUpChips = showFollowUps ? buildFollowUpChips(lastMode, userCtx) : [];
  const suggestionCards = buildSuggestionCards(userCtx);
  const quickChips = buildQuickChips(userCtx);

  // Allow sending while busy — the message will be queued.
  const canSend = input.trim().length > 0 || Boolean(pendingFile);
  const queueLength = messageQueueRef.current.length;

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-primary/60 bg-background/90 backdrop-blur-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UploadCloud className="h-8 w-8" strokeWidth={1.5} />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-semibold text-foreground">Drop to attach</p>
            <p className="text-xs text-muted-foreground">Images (JPEG, PNG, WebP, GIF) or PDF · max 10 MB</p>
          </div>
        </div>
      )}

      {/* Conversation area */}
      <div className="flex-1 overflow-y-auto pb-2 pr-1">
        {/* History loading skeleton */}
        {!historyLoaded && (
          <div className="space-y-4 pt-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={cn('flex gap-3', i % 2 === 0 && 'justify-end')}>
                <div
                  className={cn(
                    'h-12 rounded-2xl bg-muted/40 animate-pulse',
                    i % 2 === 0 ? 'w-48' : 'w-64',
                  )}
                />
              </div>
            ))}
          </div>
        )}

        {historyLoaded && showEmptyState ? (
          <EmptyState
            cards={suggestionCards}
            chips={quickChips}
            onCardClick={(card) => sendQuickPrompt(card.prompt, card.id)}
            onChipClick={(chip) => sendQuickPrompt(chip.prompt, chip.mode)}
            userCtx={userCtx}
          />
        ) : historyLoaded ? (
          <div className="space-y-4 pt-2">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                streaming={m.streaming}
                attachment={m.attachment}
              />
            ))}

            {/* Follow-up chips after each assistant reply */}
            {showFollowUps && (
              <div className="pl-11">
                <p className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  You might also ask
                </p>
                <div className="flex flex-wrap gap-2">
                  {followUpChips.map((chip) => (
                    <button
                      key={chip.prompt}
                      type="button"
                      onClick={() => sendQuickPrompt(chip.prompt, chip.mode)}
                      className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
                    >
                      {chip.prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 mt-2 bg-gradient-to-t from-background via-background to-background/0 pt-3">
        {/* Queue indicator */}
        {queueLength > 0 && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{queueLength}</span> message{queueLength > 1 ? 's' : ''} queued
            </span>
            <button
              type="button"
              onClick={() => { messageQueueRef.current = []; }}
              className="text-xs text-muted-foreground hover:text-destructive transition"
            >
              Clear queue
            </button>
          </div>
        )}
        {modeLocked && (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Mode: {MODE_LABELS[mode]}
              <button
                type="button"
                onClick={() => {
                  setMode('general');
                  setModeLocked(false);
                }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                aria-label="Clear mode"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className={cn(
            'rounded-2xl border border-border/60 bg-background/80 shadow-sm backdrop-blur transition',
            'focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20',
          )}
        >
          {/* File preview strip */}
          {pendingFile && (
            <div className="flex items-center gap-2 border-b border-border/40 px-3 pt-2.5 pb-2">
              {pendingPreviewUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pendingPreviewUrl}
                    alt={pendingFile.name}
                    className="h-14 w-14 rounded-lg object-cover ring-1 ring-border/40"
                  />
                  <button
                    type="button"
                    onClick={clearPendingFile}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background shadow"
                    aria-label="Remove attachment"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-xs">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="max-w-[180px] truncate text-foreground/80">
                    {pendingFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={clearPendingFile}
                    className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-2 p-2">
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={CHAT_ACCEPTED}
              onChange={onFileChosen}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition',
                pendingFile
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              aria-label="Attach file"
              title="Attach image or PDF (max 10 MB)"
            >
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={1}
              placeholder={
                busy
                  ? 'Type to queue next message…'
                  : pendingFile
                  ? 'Add a message or send the file…'
                  : 'Ask Klaro about your money…'
              }
              className="max-h-36 min-h-[2.25rem] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none"
            />

            {/* Stop button — visible while streaming */}
            {streaming && (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive transition hover:bg-destructive/20"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square className="h-[14px] w-[14px]" fill="currentColor" strokeWidth={0} />
              </button>
            )}

            {/* Send / queue button */}
            <div className="relative shrink-0">
              <button
                type="submit"
                disabled={!canSend}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl transition',
                  canSend && busy
                    ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                    : canSend
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'bg-muted text-muted-foreground',
                )}
                aria-label={busy ? 'Queue message' : 'Send message'}
                title={busy ? 'Add to queue — will send after current response' : 'Send message'}
              >
                <ArrowUp
                  className={cn('h-[18px] w-[18px]', streaming && 'opacity-50')}
                  strokeWidth={2.5}
                />
              </button>
              {/* Queue badge */}
              {queueLength > 0 && (
                <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                  {queueLength}
                </span>
              )}
            </div>
          </div>
        </form>

        <p className="mt-2 text-center text-[10.5px] text-muted-foreground/70">
          Klaro can make mistakes. Verify key amounts before acting on them.
        </p>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  cards: SuggestionCard[];
  chips: { prompt: string; mode: ChatMode }[];
  onCardClick: (card: SuggestionCard) => void;
  onChipClick: (chip: { prompt: string; mode: ChatMode }) => void;
  userCtx: UserContext;
}

function EmptyState({ cards, chips, onCardClick, onChipClick, userCtx }: EmptyStateProps) {
  const greeting = userCtx.firstName ? `Hi ${userCtx.firstName}, I'm Klaro.` : "Hi, I'm Klaro.";
  const subline =
    userCtx.score !== null
      ? `Your score is ${userCtx.score}/1000. Ask me anything about your finances.`
      : 'Your personal finance copilot. Ask about your spending, habits, score, or a goal.';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 py-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-semibold text-white shadow-lg shadow-violet-500/20 ring-1 ring-white/10">
            K
          </div>
          <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{greeting}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{subline}</p>
        </div>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onCardClick(card)}
            className={cn(
              'group flex flex-col gap-2 rounded-xl border border-border/60 bg-background/60 p-4 text-left transition hover:bg-muted/40 hover:shadow-sm',
              card.ring,
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg',
                  card.iconWrap,
                )}
              >
                <card.Icon className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="text-sm font-semibold text-foreground">{card.title}</span>
            </div>
            <p className="text-sm font-medium text-foreground/90">{card.prompt}</p>
            <p className="text-xs text-muted-foreground">{card.blurb}</p>
          </button>
        ))}
      </div>

      <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.prompt}
            type="button"
            onClick={() => onChipClick(chip)}
            className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
          >
            {chip.prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
