import { cn } from '@klaro/ui/cn';
import type { ScoreBreakdown, ScoreActionCategory } from '@klaro/shared';

interface Props {
  breakdown: ScoreBreakdown;
  hoveredCategory?: ScoreActionCategory | null;
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

// Maps ScoreActionCategory → breakdown key so we know which bar to highlight
const ACTION_CATEGORY_TO_BREAKDOWN: Record<ScoreActionCategory, string> = {
  income: 'income',
  payments: 'paymentBehavior',
  debt: 'debtSignals',
  documents: 'documentConsistency',
  behavior: 'behavioralPatterns',
};

export function ScoreBreakdown({ breakdown, hoveredCategory }: Props) {
  const entries = Object.entries(breakdown).filter(
    ([k, v]) => LABELS[k] && typeof v === 'number',
  ) as [string, number][];

  const highlightedKey = hoveredCategory
    ? ACTION_CATEGORY_TO_BREAKDOWN[hoveredCategory]
    : null;

  return (
    <ul className="space-y-3">
      {entries.map(([key, value]) => {
        const pct = Math.round(value * 100);
        const isHighlighted = highlightedKey === key;
        return (
          <li key={key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span
                className={cn(
                  'transition-colors duration-200',
                  isHighlighted ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {LABELS[key]}
              </span>
              <span className="font-medium tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  isHighlighted
                    ? 'bg-primary shadow-[0_0_6px_2px_hsl(var(--primary)/0.35)] animate-pulse'
                    : 'bg-primary',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
