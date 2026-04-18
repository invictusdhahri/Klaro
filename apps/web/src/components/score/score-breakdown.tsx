import type { ScoreBreakdown } from '@klaro/shared';

interface Props {
  breakdown: ScoreBreakdown;
}

const LABELS: Record<string, string> = {
  identity: 'Identity',
  income: 'Income stability',
  spending: 'Spending behavior',
  paymentBehavior: 'Payment regularity',
  debtSignals: 'Debt signals',
  documentConsistency: 'Document consistency',
  behavioralPatterns: 'Behavioral patterns',
};

export function ScoreBreakdown({ breakdown }: Props) {
  const entries = Object.entries(breakdown).filter(
    ([k, v]) => LABELS[k] && typeof v === 'number',
  ) as [string, number][];

  return (
    <ul className="space-y-3">
      {entries.map(([key, value]) => {
        const pct = Math.round(value * 100);
        return (
          <li key={key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{LABELS[key]}</span>
              <span className="font-medium tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
