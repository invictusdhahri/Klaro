'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScoreGauge } from '@/components/score/score-gauge';
import { ScoreBreakdown } from '@/components/score/score-breakdown';
import { api } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import type { ScoreBreakdown as ScoreBreakdownType } from '@klaro/shared';
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

export function ScoreDashboardClient({ initialScore, userId }: Props) {
  const [scoreRow, setScoreRow] = useState<RawScoreRow | null>(initialScore);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Realtime subscription — listens for score_updated broadcast.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`score:${userId}`)
      .on('broadcast', { event: 'score_updated' }, () => {
        // Re-fetch the full latest score row when notified.
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

  const handleCalculate = useCallback(async () => {
    setCalculating(true);
    setError(null);
    try {
      const result = await api.post<RawScoreRow>(API_ENDPOINTS.score.calculate);
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
            <Button onClick={handleCalculate} disabled={calculating}>
              {calculating ? 'Calculating…' : 'Generate my Klaro score'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const breakdown = mapBreakdown(scoreRow.breakdown);
  const tips = (scoreRow.recommendations ?? []) as string[];

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
            <ScoreBreakdown breakdown={breakdown} />
          </CardContent>
        </Card>
      </div>

      {tips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>Personalized actions to improve your score</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {tips.map((tip, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-0.5 text-primary">→</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
