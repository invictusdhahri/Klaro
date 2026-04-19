interface RiskBadgeProps {
  risk: string;
  className?: string;
}

const RISK_CONFIG: Record<string, { label: string; classes: string }> = {
  low: {
    label: 'LOW',
    classes: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400',
  },
  medium: {
    label: 'MEDIUM',
    classes: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  high: {
    label: 'HIGH',
    classes: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400',
  },
  very_high: {
    label: 'VERY HIGH',
    classes: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400',
  },
};

export function RiskBadge({ risk, className }: RiskBadgeProps) {
  const config = RISK_CONFIG[risk.toLowerCase()] ?? {
    label: risk.toUpperCase(),
    classes: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${config.classes} ${className ?? ''}`}
    >
      {config.label}
    </span>
  );
}
