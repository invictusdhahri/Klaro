'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScoreGauge } from '@/components/score/score-gauge';
import { ScoreBreakdown } from '@/components/score/score-breakdown';
import { ScoreActions } from '@/components/score/score-actions';
import { api } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import type { ScoreBreakdown as ScoreBreakdownType, ScoreAction, ScoreActionCategory } from '@klaro/shared';
import { API_ENDPOINTS } from '@klaro/shared';

interface RawScoreRow {
  score: number;
  score_band: string;
  risk_category: string;
  confidence: number;
  breakdown: Record<string, unknown>;
  flags: string[];
  recommendations: string[];
  created_at: string;
}

interface Props {
  initialScore: RawScoreRow | null;
  userId: string;
}

function mapBreakdown(raw: Record<string, unknown>): ScoreBreakdownType {
  return {
    income: raw.income_stability as number | undefined,
    paymentBehavior: raw.payment_behavior as number | undefined,
    debtSignals: raw.debt_signals as number | undefined,
    documentConsistency: raw.document_consistency as number | undefined,
    behavioralPatterns: raw.behavioral_patterns as number | undefined,
  };
}

function mapActions(raw: Record<string, unknown>): ScoreAction[] {
  const rawActions = raw.actions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rawActions)) return [];
  return rawActions.map((a) => ({
    id: (a.id as string) ?? '',
    title: (a.title as string) ?? '',
    rationale: (a.rationale as string) ?? '',
    category: (a.category as ScoreActionCategory) ?? 'behavior',
    expectedImpactPoints: (a.expected_impact_points as number) ?? 0,
    impactConfidence: (a.impact_confidence as number) ?? 0.5,
  }));
}

function scoreCalculationPhase(pct: number): string {
  if (pct < 22) return 'Preparing your data…';
  if (pct < 50) return 'Analyzing transactions and documents…';
  if (pct < 78) return 'Running risk and consistency checks…';
  if (pct < 97) return 'Generating your personalized score…';
  return 'Finishing up…';
}

function ScoreCalculationProgress({
  progress,
  className,
}: {
  progress: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, progress));
  const label = scoreCalculationPhase(clamped);

  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular-nums text-muted-foreground/80">{Math.round(clamped)}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label="Score calculation progress"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground/90">
        This usually takes 10–40 seconds. You can stay on this page.
      </p>
    </div>
  );
}

export function ScoreDashboardClient({ initialScore, userId }: Props) {
  const [scoreRow, setScoreRow] = useState<RawScoreRow | null>(initialScore);
  const [calculating, setCalculating] = useState(false);
  const [calcProgress, setCalcProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<ScoreActionCategory | null>(null);

  // Realtime subscription — listens for score_updated broadcast.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`score:${userId}`)
      .on('broadcast', { event: 'score_updated' }, () => {
        api
          .get<RawScoreRow>(API_ENDPOINTS.score.current)
          .then((row) => setScoreRow(row))
          .catch(() => null);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!calculating) {
      setCalcProgress(0);
      return;
    }

    let raf = 0;
    let cancelled = false;
    const start = performance.now();

    const loop = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const asymptotic = 8 + 84 * (1 - Math.exp(-elapsed / 11000));
      setCalcProgress(Math.min(92, asymptotic));
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [calculating]);

  const handleCalculate = useCallback(async () => {
    setCalculating(true);
    setError(null);
    try {
      const result = await api.post<RawScoreRow>(API_ENDPOINTS.score.calculate);
      setCalcProgress(100);
      await new Promise((r) => setTimeout(r, 280));
      setScoreRow(result);
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string; reason?: string } }).body;
      setError(body?.error ?? body?.reason ?? 'Failed to calculate score. Please try again.');
    } finally {
      setCalculating(false);
    }
  }, []);

  if (!scoreRow) {
    const needsBankData =
      error?.toLowerCase().includes('bank') || error?.toLowerCase().includes('statement');

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>No score yet</CardTitle>
            <CardDescription>
              Complete KYC verification and connect a bank account or upload your statements to
              generate your first Klaro score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p>{error}</p>
                {needsBankData && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href="/documents">
                      <Button size="sm" variant="outline">
                        Upload statements
                      </Button>
                    </Link>
                    <Link href="/connect-bank">
                      <Button size="sm" variant="outline">
                        Connect a bank
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )}
            {calculating && <ScoreCalculationProgress progress={calcProgress} />}
            <Button onClick={handleCalculate} disabled={calculating}>
              {calculating ? 'Calculating…' : 'Generate my Klaro score'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const breakdown = mapBreakdown(scoreRow.breakdown);
  const actions = mapActions(scoreRow.breakdown);

  // Sum of expected impacts, capped at headroom
  const headroom = 1000 - scoreRow.score;
  const totalImpact = Math.min(
    headroom,
    actions.reduce((s, a) => s + a.expectedImpactPoints, 0),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Score</CardTitle>
            <CardDescription>0 – 1000 scale · {scoreRow.score_band}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ScoreGauge score={scoreRow.score} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Breakdown</CardTitle>
            <CardDescription>What is helping and hurting your score</CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreBreakdown breakdown={breakdown} hoveredCategory={hoveredCategory} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Next steps</CardTitle>
              <CardDescription>Personalized actions to improve your score</CardDescription>
            </div>
            {totalImpact > 0 && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                Up to +{totalImpact} pts available
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ScoreActions
            actions={actions}
            onHoverCategory={setHoveredCategory}
          />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {calculating && <ScoreCalculationProgress progress={calcProgress} />}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Last updated: {new Date(scoreRow.created_at).toLocaleString()}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCalculate}
            disabled={calculating}
          >
            {calculating ? 'Recalculating…' : 'Recalculate'}
          </Button>
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
