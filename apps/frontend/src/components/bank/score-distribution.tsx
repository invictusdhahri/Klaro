import type { DashboardScoreBand } from '@klaro/shared';

interface Props {
  distribution: Partial<Record<DashboardScoreBand, number>>;
  labels: Record<DashboardScoreBand, string>;
}

const ORDER: DashboardScoreBand[] = ['EXCELLENT', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR', 'UNSCORED'];

const BAR_CLASS: Record<DashboardScoreBand, string> = {
  EXCELLENT: 'bg-green-500',
  VERY_GOOD: 'bg-teal-500',
  GOOD: 'bg-blue-500',
  FAIR: 'bg-yellow-500',
  POOR: 'bg-red-500',
  UNSCORED: 'bg-muted-foreground/40',
};

/**
 * Lightweight horizontal bar chart for the score-band distribution.
 * Avoids pulling in a chart library — this view is dashboard-grade
 * (4-6 bars, tiny dataset).
 */
export function ScoreDistribution({ distribution, labels }: Props) {
  const total = ORDER.reduce((sum, b) => sum + (distribution[b] ?? 0), 0);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No scores yet across your consented clients.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {ORDER.map((band) => {
        const count = distribution[band] ?? 0;
        const pct = total > 0 ? (count / total) * 100 : 0;

        return (
          <li key={band} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">{labels[band]}</span>
              <span className="text-muted-foreground tabular-nums">
                {count} <span className="opacity-60">({pct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${BAR_CLASS[band]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
