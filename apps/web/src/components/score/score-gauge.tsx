import { getScoreBand, SCORE_BANDS } from '@klaro/shared';
import { cn } from '@klaro/ui/cn';

interface ScoreGaugeProps {
  score: number;
  className?: string;
}

const BAND_COLORS: Record<string, string> = {
  POOR: 'text-score-poor',
  FAIR: 'text-score-fair',
  GOOD: 'text-score-good',
  VERY_GOOD: 'text-score-veryGood',
  EXCELLENT: 'text-score-excellent',
};

export function ScoreGauge({ score, className }: ScoreGaugeProps) {
  const band = getScoreBand(score);
  const meta = SCORE_BANDS.find((b) => b.band === band)!;
  const pct = Math.max(0, Math.min(1, score / 1000));
  const circumference = 2 * Math.PI * 90;
  const offset = circumference * (1 - pct);

  return (
    <div className={cn('relative flex flex-col items-center justify-center', className)}>
      <svg width="220" height="220" viewBox="0 0 220 220" className="-rotate-90">
        <circle cx="110" cy="110" r="90" stroke="hsl(var(--muted))" strokeWidth="14" fill="none" />
        <circle
          cx="110"
          cy="110"
          r="90"
          stroke="currentColor"
          strokeWidth="14"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('transition-all duration-700', BAND_COLORS[band])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-5xl font-bold tabular-nums', BAND_COLORS[band])}>{score}</span>
        <span className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
          {meta.labelEn}
        </span>
      </div>
    </div>
  );
}
