'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { API_ENDPOINTS } from '@klaro/shared';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@klaro/ui/cn';

// ---------------------------------------------------------------------------
// Types — mirror apps/backend/src/services/ml.client.ts
// ---------------------------------------------------------------------------

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface ForensicSignal {
  type: string;
  severity: Severity;
  detail: string;
  evidence?: Record<string, unknown>;
  source?: string;
}

interface CoherenceFlag {
  type: string;
  severity: Severity;
  detail: string;
  evidence?: Record<string, unknown>;
}

interface AnomalySignal {
  type: string;
  severity: Severity;
  detail: string;
  evidence?: Record<string, unknown>;
}

interface IncomeBand {
  p25: number;
  p50: number;
  p75: number;
  currency: string;
  source: string;
}

interface IncomeFlag {
  type: string;
  severity: Severity;
  detail: string;
  evidence?: Record<string, unknown>;
}

interface IncomeAssessment {
  passed?: boolean;
  implied_monthly_income?: number;
  local_band?: IncomeBand;
  remote_band?: IncomeBand;
  gap_local_pct?: number;
  gap_remote_pct?: number;
  primary_band?: 'local' | 'remote';
  foreign_currency_share?: number;
  flags?: IncomeFlag[];
  reasoning?: string;
}

interface VerificationLayer {
  passed: boolean;
  confidence?: number;
  score?: number;
  risk_score?: number;
  coherence_score?: number;
  signals?: ForensicSignal[] | string[];
  failed_rules?: string[];
  flags?: CoherenceFlag[] | IncomeFlag[];
  reasoning?: string;
}

interface ClarificationQuestion {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'free_text' | 'amount';
  prompt: string;
  options: string[];
  linked_flag?: string;
}

interface ClarificationAnswer {
  question_id: string;
  value: unknown;
}

interface PerFlagExplanation {
  flag_type: string;
  why_it_matters: string;
  what_would_clear_it: string;
}

interface Reasoning {
  risk_score?: number;
  rubric_risk_score?: number;
  rubric_breakdown?: Record<string, number>;
  verdict?: 'approved' | 'needs_review' | 'rejected';
  reasoning_summary?: string;
  per_flag_explanations?: PerFlagExplanation[];
  questions?: ClarificationQuestion[];
}

type StatementStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'needs_review'
  | 'verification_failed'
  | 'failed';

interface BankStatement {
  id: string;
  file_name: string;
  mime_type: string;
  status: StatementStatus;
  extracted_count: number;
  coherence_score: number | null;
  risk_score: number | null;
  verification_report: {
    passed?: boolean;
    verdict?: string;
    failed_layer?: string | null;
    layers?: {
      deepfake?: VerificationLayer;
      authenticity?: VerificationLayer;
      consistency?: VerificationLayer;
      income_plausibility?: VerificationLayer & IncomeAssessment;
    };
  };
  anomaly_report: {
    anomaly_score?: number;
    flagged?: boolean;
    signals?: AnomalySignal[];
  };
  reasoning: Reasoning | null;
  clarification_questions: ClarificationQuestion[] | null;
  clarification_answers: ClarificationAnswer[] | null;
  income_assessment: IncomeAssessment | null;
  error_message: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/tiff',
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

// Card background tint per severity — no side-stripe
const SEVERITY_CARD: Record<Severity, string> = {
  critical: 'bg-red-950/40 border-red-500/25',
  high:     'bg-orange-950/35 border-orange-500/25',
  medium:   'bg-yellow-950/25 border-yellow-600/20',
  low:      'bg-slate-800/50 border-blue-500/20',
};

const SEVERITY_ICON_BG: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-400',
  high:     'bg-orange-500/15 text-orange-400',
  medium:   'bg-yellow-500/15 text-yellow-400',
  low:      'bg-blue-500/15 text-blue-400',
};

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-300 ring-red-500/20',
  high:     'bg-orange-500/15 text-orange-300 ring-orange-500/20',
  medium:   'bg-yellow-500/15 text-yellow-300 ring-yellow-500/20',
  low:      'bg-blue-500/15 text-blue-300 ring-blue-500/20',
};

const SEVERITY_ICON: Record<Severity, string> = {
  critical: '🚨',
  high:     '⚠️',
  medium:   '⚡',
  low:      'ℹ️',
};

const SOURCE_LABEL: Record<string, { label: string; cls: string }> = {
  pdf_structure:      { label: 'PDF Structure',   cls: 'bg-violet-500/15 text-violet-300' },
  image_forensics:    { label: 'Image Forensics', cls: 'bg-violet-500/15 text-violet-300' },
  vision_ensemble:    { label: 'Vision',          cls: 'bg-violet-500/15 text-violet-300' },
  consistency:        { label: 'Consistency',     cls: 'bg-sky-500/15 text-sky-300' },
  income_plausibility:{ label: 'Income',          cls: 'bg-teal-500/15 text-teal-300' },
  anomaly:            { label: 'Anomaly',         cls: 'bg-amber-500/15 text-amber-300' },
  orchestrator:       { label: 'System',          cls: 'bg-muted text-muted-foreground' },
};

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/csv': 'CSV',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/tiff': 'TIFF',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function CoherenceBar({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? 'bg-green-500' : score >= 0.5 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-20 shrink-0">Coherence</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function RiskMeter({ risk }: { risk: number | null }) {
  if (risk === null || risk === undefined) return null;
  const pct = Math.round(risk * 100);
  // Lower = safer; meter fills with severity-coloured gradient.
  const color =
    risk >= 0.6 ? 'bg-red-500' : risk >= 0.25 ? 'bg-yellow-500' : 'bg-green-500';
  const label = risk >= 0.6 ? 'High risk' : risk >= 0.25 ? 'Some risk' : 'Low risk';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-20 shrink-0">Risk</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-muted-foreground w-24 text-right">
        {pct}% · {label}
      </span>
    </div>
  );
}

function LayerChip({
  label,
  layer,
  reasoning,
}: {
  label: string;
  layer?: VerificationLayer;
  reasoning?: string;
}) {
  if (!layer) return null;
  const passed = layer.passed;
  const failed_rules = layer.failed_rules ?? [];
  const signals = (layer.signals ?? []) as Array<ForensicSignal | string>;
  const flags = (layer.flags ?? []) as Array<CoherenceFlag | IncomeFlag>;

  const issuesCount = failed_rules.length + signals.length + flags.length;
  const cls = passed
    ? issuesCount > 0
      ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
      : 'border-green-300 bg-green-50 text-green-700'
    : 'border-red-300 bg-red-50 text-red-700';

  const tooltip = reasoning ?? (passed ? `${label}: passed` : `${label}: failed`);
  const icon = !passed ? '✗' : issuesCount > 0 ? '!' : '✓';

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <span>{icon}</span>
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: StatementStatus }) {
  const map: Record<StatementStatus, { label: string; cls: string }> = {
    pending:              { label: 'Pending',          cls: 'bg-muted text-muted-foreground' },
    processing:           { label: 'Processing…',      cls: 'bg-blue-100 text-blue-800' },
    processed:            { label: 'Processed',        cls: 'bg-green-100 text-green-800' },
    needs_review:         { label: 'Needs your input', cls: 'bg-amber-100 text-amber-900' },
    verification_failed:  { label: 'Failed Checks',    cls: 'bg-red-100 text-red-800' },
    failed:               { label: 'Error',            cls: 'bg-orange-100 text-orange-800' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

// ---------------------------------------------------------------------------
// ProcessingTracker — animated layer-by-layer progress during processing
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = [
  { key: 'deepfake',          label: 'Deepfake scan',      duration: 8000  },
  { key: 'authenticity',      label: 'Authenticity check', duration: 5000  },
  { key: 'consistency',       label: 'Cross-consistency',  duration: 6000  },
  { key: 'income',            label: 'Income plausibility',duration: 7000  },
  { key: 'reasoning',         label: 'Critical reasoning', duration: 5000  },
];

// Total estimated time = sum of all durations
const TOTAL_DURATION = PIPELINE_STEPS.reduce((a, s) => a + s.duration, 0);

function ProcessingTracker({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const origin = new Date(startedAt).getTime();
    const tick = () => setElapsed(Date.now() - origin);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  // Which step are we on?
  let cursor = 0;
  let activeStep = 0;
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const step = PIPELINE_STEPS[i];
    if (!step) break;
    if (elapsed >= cursor && elapsed < cursor + step.duration) {
      activeStep = i;
      break;
    }
    cursor += step.duration;
    activeStep = i; // clamp at last step if over-time
  }

  // Global progress percentage (capped at 95 % until actually done)
  const rawPct = Math.min((elapsed / TOTAL_DURATION) * 100, 95);

  return (
    <div className="space-y-2.5 py-1">
      {/* Global bar */}
      <div className="space-y-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
            style={{ width: `${rawPct}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Analysing… {Math.round(rawPct)}%
        </p>
      </div>

      {/* Step indicators */}
      <ol className="flex items-center gap-0">
        {PIPELINE_STEPS.map((step, i) => {
          const done = i < activeStep || (i === activeStep && rawPct >= 94);
          const active = i === activeStep && !done;
          return (
            <li key={step.key} className="flex flex-1 flex-col items-center gap-1">
              {/* Connector + node row */}
              <div className="flex w-full items-center">
                {/* Left connector */}
                <div
                  className={`h-px flex-1 transition-colors duration-500 ${
                    i === 0 ? 'bg-transparent' : done || active ? 'bg-blue-400' : 'bg-muted'
                  }`}
                />
                {/* Node */}
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-all duration-500 ${
                    done
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : active
                      ? 'border-blue-400 bg-blue-50 text-blue-600 shadow-[0_0_0_3px_rgba(59,130,246,0.2)]'
                      : 'border-muted-foreground/30 bg-background text-muted-foreground/40'
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 5l2.5 2.5L8 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active ? (
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  ) : (
                    <span className="text-[9px]">{i + 1}</span>
                  )}
                </div>
                {/* Right connector */}
                <div
                  className={`h-px flex-1 transition-colors duration-500 ${
                    i === PIPELINE_STEPS.length - 1 ? 'bg-transparent' : done ? 'bg-blue-400' : 'bg-muted'
                  }`}
                />
              </div>
              {/* Label */}
              <span
                className={`text-center text-[9px] leading-tight transition-colors duration-300 ${
                  done
                    ? 'text-blue-600 font-medium'
                    : active
                    ? 'text-blue-500 font-semibold'
                    : 'text-muted-foreground/50'
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review panel — renders inline questions, posts answers, triggers reload
// ---------------------------------------------------------------------------

function ReviewPanel({
  statementId,
  questions,
  onAnswered,
}: {
  statementId: string;
  questions: ClarificationQuestion[];
  onAnswered: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (id: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [id]: v }));

  const allAnswered = questions.every((q) => {
    const v = values[q.id];
    if (q.type === 'multi_choice') return Array.isArray(v) && v.length > 0;
    if (q.type === 'free_text') return typeof v === 'string' && v.trim().length > 0;
    if (q.type === 'amount') return typeof v === 'number' && !Number.isNaN(v);
    return v !== undefined && v !== null && v !== '';
  });

  async function submit() {
    setSubmitting(true);
    setError(null);
    const token = await getToken();
    if (!token) {
      setError('Not authenticated');
      setSubmitting(false);
      return;
    }
    const answers: ClarificationAnswer[] = questions.map((q) => ({
      question_id: q.id,
      value: values[q.id],
    }));
    try {
      const res = await fetch(
        `${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.answer(statementId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ answers }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Submit failed (${res.status})`);
      } else {
        onAnswered();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-950/15 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-amber-500/15 px-4 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-400/80">
          Context needed
        </span>
      </div>

      <div className="px-4 py-4 space-y-5">
        {questions.map((q) => (
          <div key={q.id} className="space-y-2.5">
            <p className="text-sm font-medium leading-snug text-foreground/90">{q.prompt}</p>

            {q.type === 'single_choice' && (
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const selected = values[q.id] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setValue(q.id, opt)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-left transition-all duration-150',
                        selected
                          ? 'bg-amber-500/15 text-amber-100 ring-1 ring-inset ring-amber-500/30'
                          : 'bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                          selected ? 'border-amber-400' : 'border-muted-foreground/30',
                        )}
                      >
                        {selected && <span className="h-2 w-2 rounded-full bg-amber-400" />}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === 'multi_choice' && (
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const arr = (values[q.id] as string[] | undefined) ?? [];
                  const selected = arr.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() =>
                        setValue(
                          q.id,
                          selected ? arr.filter((x) => x !== opt) : [...arr, opt],
                        )
                      }
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-left transition-all duration-150',
                        selected
                          ? 'bg-amber-500/15 text-amber-100 ring-1 ring-inset ring-amber-500/30'
                          : 'bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors',
                          selected
                            ? 'border-amber-400 bg-amber-500/20'
                            : 'border-muted-foreground/30',
                        )}
                      >
                        {selected && (
                          <svg
                            className="h-2.5 w-2.5 text-amber-300"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M2 5l2.5 2.5L8 3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === 'amount' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={(values[q.id] as number | undefined) ?? ''}
                  onChange={(e) =>
                    setValue(q.id, e.target.value === '' ? undefined : Number(e.target.value))
                  }
                  className="w-32 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                />
                <span className="text-xs text-muted-foreground">TND</span>
              </div>
            )}

            {q.type === 'free_text' && (
              <textarea
                value={(values[q.id] as string | undefined) ?? ''}
                onChange={(e) => setValue(q.id, e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                placeholder="Type your answer…"
              />
            )}
          </div>
        ))}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={submitting || !allAnswered}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FlagCard — individual flag row with rich design
// ---------------------------------------------------------------------------

function FlagCard({
  flag,
  explanation,
}: {
  flag: { type: string; severity: Severity; detail: string; source?: string };
  explanation?: PerFlagExplanation;
}) {
  const [open, setOpen] = useState(false);
  const sev = flag.severity;
  const src = flag.source ?? '';
  const srcInfo = SOURCE_LABEL[src] ?? { label: src.replace(/_/g, ' '), cls: 'bg-muted text-muted-foreground' };

  return (
    <li className={`rounded-lg border ${SEVERITY_CARD[sev] ?? 'bg-muted/30 border-border'} overflow-hidden`}>
      {/* Main row */}
      <div className="flex items-start gap-3 px-3 py-3">
        {/* Icon bubble */}
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs ${SEVERITY_ICON_BG[sev]}`}
        >
          {SEVERITY_ICON[sev]}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Severity badge */}
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${SEVERITY_BADGE[sev]}`}
            >
              {sev}
            </span>
            {/* Flag type */}
            <span className="text-xs font-medium text-foreground">
              {flag.type.replace(/_/g, ' ')}
            </span>
            {/* Source chip */}
            {src && (
              <span
                className={`ml-auto shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium ${srcInfo.cls}`}
              >
                {srcInfo.label}
              </span>
            )}
          </div>
          {/* Detail */}
          <p className="text-xs text-muted-foreground leading-relaxed">{flag.detail}</p>
        </div>
      </div>

      {/* Expanded: why it matters + what would clear it */}
      {explanation && (
        <div className="border-t border-border/50">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <svg
              viewBox="0 0 10 10"
              className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 3.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {open ? 'Collapse' : 'Why it matters'}
          </button>

          {open && (
            <div className="space-y-2 px-3 pb-3 pt-1">
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Why it matters
                </p>
                <p className="text-xs leading-relaxed text-foreground/80">{explanation.why_it_matters}</p>
              </div>
              <div className="rounded-md bg-green-50 px-3 py-2">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
                  What would clear it
                </p>
                <p className="text-xs leading-relaxed text-green-800/90">{explanation.what_would_clear_it}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Statement card
// ---------------------------------------------------------------------------

function StatementCard({
  stmt,
  onDelete,
  onReupload,
  onReload,
}: {
  stmt: BankStatement;
  onDelete: (id: string) => void;
  onReupload: () => void;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const layers = stmt.verification_report?.layers;
  const reasoning = stmt.reasoning ?? null;

  const consistencyFlags = (layers?.consistency?.flags ?? []) as CoherenceFlag[];
  const incomeFlags = (layers?.income_plausibility?.flags ?? []) as IncomeFlag[];
  const deepfakeSignals = (layers?.deepfake?.signals ?? []) as ForensicSignal[];
  const anomalySignals = stmt.anomaly_report?.signals ?? [];

  // Normalise everything into one display list with consistent shape
  type DisplayFlag = CoherenceFlag & { source?: string };
  const allFlags: DisplayFlag[] = [
    ...deepfakeSignals
      .filter((s): s is ForensicSignal => typeof s === 'object' && s !== null && 'severity' in s)
      .map((s) => ({ ...s, source: s.source ?? 'deepfake' })),
    ...consistencyFlags.map((f) => ({ ...f, source: 'consistency' })),
    ...incomeFlags.map((f) => ({ ...f, source: 'income_plausibility' })),
    ...anomalySignals.map((s) => ({ ...s, source: 'anomaly' })),
  ];

  // Index per-flag explanations from the reasoner by type
  const explanations = new Map<string, PerFlagExplanation>(
    (reasoning?.per_flag_explanations ?? []).map((e) => [e.flag_type, e]),
  );

  const questions = (stmt.clarification_questions ?? []) as ClarificationQuestion[];

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-medium">
            {MIME_LABELS[stmt.mime_type] ?? 'FILE'}
          </span>
          <span className="truncate text-sm font-medium">{stmt.file_name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={stmt.status} />
          <span className="text-xs text-muted-foreground">
            {new Date(stmt.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Processing tracker */}
      {(stmt.status === 'processing' || stmt.status === 'pending') && (
        <ProcessingTracker startedAt={stmt.created_at} />
      )}

      {/* Reasoning summary */}
      {reasoning?.reasoning_summary && (
        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Reasoning
          </p>
          <p className="text-sm leading-relaxed text-foreground/90">
            {reasoning.reasoning_summary}
          </p>
        </div>
      )}

      {/* Verification layer chips */}
      {layers && (
        <div className="flex flex-wrap gap-1.5">
          <LayerChip
            label="Deepfake"
            layer={layers.deepfake}
            reasoning={layers.deepfake?.reasoning}
          />
          <LayerChip label="Authenticity" layer={layers.authenticity} />
          <LayerChip label="Consistency" layer={layers.consistency} />
          {layers.income_plausibility && (
            <LayerChip
              label="Income"
              layer={layers.income_plausibility}
              reasoning={layers.income_plausibility.reasoning}
            />
          )}
        </div>
      )}

      {/* Score bars */}
      <div className="space-y-1.5">
        <RiskMeter risk={stmt.risk_score} />
      </div>

      {/* Income summary (when present) */}
      {layers?.income_plausibility?.implied_monthly_income !== undefined && (
        <div className="text-xs text-muted-foreground">
          Implied income:{' '}
          <span className="font-medium text-foreground">
            {Math.round(layers.income_plausibility.implied_monthly_income).toLocaleString()} TND/mo
          </span>
          {' · '}local p50:{' '}
          {Math.round(layers.income_plausibility.local_band?.p50 ?? 0).toLocaleString()} TND
          {' · '}remote p50:{' '}
          {Math.round(layers.income_plausibility.remote_band?.p50 ?? 0).toLocaleString()} TND
        </div>
      )}

      {/* Extracted count */}
      {stmt.status === 'processed' && (
        <p className="text-xs text-muted-foreground">
          {stmt.extracted_count} transaction{stmt.extracted_count !== 1 ? 's' : ''} extracted
        </p>
      )}

      {/* Error message */}
      {stmt.error_message && (
        <p className="text-xs text-red-600">
          {stmt.status === 'verification_failed' ? 'Verification rejected' : stmt.error_message}
        </p>
      )}

      {/* Anomaly report summary */}
      {stmt.status === 'processed' && stmt.anomaly_report?.flagged && (
        <div className="rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-800">
          Anomaly score: {Math.round((stmt.anomaly_report.anomaly_score ?? 0) * 100)}% — flagged for review
        </div>
      )}

      {/* Clarification panel */}
      {stmt.status === 'needs_review' && questions.length > 0 && (
        <ReviewPanel
          statementId={stmt.id}
          questions={questions}
          onAnswered={onReload}
        />
      )}

      {/* Expandable flags with per-flag explanations */}
      {allFlags.length > 0 && (
        <div className="space-y-1.5">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((sev) => {
                const n = allFlags.filter((f) => f.severity === sev).length;
                if (!n) return null;
                const dot: Record<Severity, string> = {
                  critical: 'bg-red-400',
                  high:     'bg-orange-400',
                  medium:   'bg-yellow-400',
                  low:      'bg-blue-400',
                };
                return (
                  <span key={sev} className="flex items-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${dot[sev]}`} />
                    <span>{n} {sev}</span>
                  </span>
                );
              })}
            </span>
            <span className="font-medium text-primary">
              {expanded ? '↑ Hide flags' : '↓ Show flags'}
            </span>
          </button>

          {expanded && (
            <ul className="space-y-2 pt-0.5">
              {allFlags.map((f, i) => {
                const exp = explanations.get(f.type);
                return (
                  <FlagCard
                    key={`${f.type}-${i}`}
                    flag={f}
                    explanation={exp}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="flex gap-2 pt-1">
        {stmt.status === 'verification_failed' && (
          <Button size="sm" variant="outline" onClick={onReupload}>
            Re-upload
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(stmt.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DocumentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fromOnboarding = searchParams.get('from') === 'onboarding';

  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatements = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.list}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json() as { data: BankStatement[] };
      setStatements(json.data ?? []);
    } catch {
      // silently ignore polling errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatements();
  }, [fetchStatements]);

  // Poll while any row is processing OR we have a pending review re-analysis.
  useEffect(() => {
    const hasProcessing = statements.some(
      (s) => s.status === 'processing' || s.status === 'pending',
    );
    if (hasProcessing && !pollingRef.current) {
      pollingRef.current = setInterval(() => void fetchStatements(), 3000);
    } else if (!hasProcessing && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [statements, fetchStatements]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    setUploadProgress(0);

    const token = await getToken();
    if (!token) {
      setUploadError('Not authenticated');
      setUploading(false);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.upload}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        setUploading(false);
        setUploadProgress(0);
        if (xhr.status === 202) {
          void fetchStatements();
          setJustUploaded(true);
        } else if (xhr.status === 409) {
          setUploadError('This file has already been uploaded.');
        } else {
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            setUploadError(body.error ?? 'Upload failed');
          } catch {
            setUploadError('Upload failed');
          }
        }
        resolve();
      };

      xhr.onerror = () => {
        setUploading(false);
        setUploadError('Network error during upload');
        resolve();
      };

      xhr.send(formData);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (id: string) => {
    const token = await getToken();
    if (!token) return;
    try {
      await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.delete(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatements((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* Onboarding context banner */}
      {fromOnboarding && (
        <div className="glass-card-strong p-4 flex items-center gap-3 border border-indigo-500/25">
          <span className="text-2xl shrink-0">📄</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm">Upload a document to unlock your score</p>
            <p className="text-xs text-white/45">Bank statements, payslips, or income proof</p>
          </div>
        </div>
      )}

      {/* Post-upload continue CTA — shown when coming from onboarding and just uploaded */}
      {fromOnboarding && justUploaded && (
        <div className="glass-card-strong p-4 flex items-center gap-3 border border-green-500/25">
          <span className="text-2xl shrink-0">✅</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm">Document uploaded! Ready to see your score?</p>
            <p className="text-xs text-white/45">Processing in the background — you can continue</p>
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white btn-glow transition-all"
          >
            Continue →
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Documents 📄</h1>
        <p className="text-sm text-white/45 mt-0.5">
          Upload bank statements, payslips, or transaction exports.
          Every file goes through multi-layer verification 🔍
        </p>
      </div>

      {/* Upload zone */}
      <Card>
        <CardHeader>
          <CardTitle>Upload a statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
            } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="text-center space-y-2">
              <div className="text-3xl">📄</div>
              <p className="text-sm font-medium">
                {uploading ? `Uploading… ${uploadProgress}%` : 'Drop your file here or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground">
                PDF · Image (JPG PNG WEBP TIFF) · CSV · Excel — max 20 MB
              </p>
            </div>

            {uploading && (
              <div className="mt-4 w-full max-w-xs">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {uploadError && (
            <p className="mt-3 text-sm text-destructive">{uploadError}</p>
          )}

          {/* Format legend */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>L1 · Forensic deepfake detection</span>
            <span>L2 · Document authenticity</span>
            <span>L3 · Cross-consistency + web checks</span>
            <span>L3.5 · Income plausibility vs your profile</span>
            <span>L4 · Critical-thinking review</span>
          </div>
        </CardContent>
      </Card>

      {/* Statements list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : statements.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No statements uploaded yet. Upload a PDF, image, or CSV to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {statements.length} statement{statements.length !== 1 ? 's' : ''}
          </h2>
          {statements.map((s) => (
            <StatementCard
              key={s.id}
              stmt={s}
              onDelete={handleDelete}
              onReupload={() => fileInputRef.current?.click()}
              onReload={() => void fetchStatements()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
