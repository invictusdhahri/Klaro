'use client';

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { ScoreBreakdown } from '@klaro/shared';

interface ScoreRadarProps {
  breakdown: ScoreBreakdown;
}

const DIMENSION_LABELS: Record<string, string> = {
  income: 'Income',
  paymentBehavior: 'Payments',
  debtSignals: 'Debt',
  documentConsistency: 'Documents',
  behavioralPatterns: 'Behavior',
  identity: 'Identity',
  spending: 'Spending',
};

export function ScoreRadar({ breakdown }: ScoreRadarProps) {
  const data = Object.entries(breakdown)
    .filter(([k, v]) => DIMENSION_LABELS[k] && typeof v === 'number')
    .map(([key, value]) => ({
      subject: DIMENSION_LABELS[key],
      value: Math.round((value as number) * 100),
      fullMark: 100,
    }));

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No breakdown data available.</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        <Radar
          name="Score"
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <Tooltip
          formatter={(v: number) => [`${v}%`, 'Score']}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
