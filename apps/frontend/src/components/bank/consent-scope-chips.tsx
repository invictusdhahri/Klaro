type ConsentScope = 'score' | 'breakdown' | 'transactions' | 'full_profile';

interface ConsentScopeChipsProps {
  granted: string[];
}

const ALL_SCOPES: { id: ConsentScope; label: string }[] = [
  { id: 'score', label: 'Score' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'full_profile', label: 'Full profile' },
];

export function ConsentScopeChips({ granted }: ConsentScopeChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ALL_SCOPES.map(({ id, label }) => {
        const isGranted = granted.includes(id);
        return (
          <span
            key={id}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isGranted
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-muted/40 text-muted-foreground line-through opacity-50'
            }`}
            title={isGranted ? `${label} access granted` : `${label} access not granted`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
