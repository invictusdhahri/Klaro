'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';
import type { ClientInsights } from '@klaro/shared';

interface Props {
  clientId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  food: 'bg-orange-500',
  transport: 'bg-blue-500',
  utilities: 'bg-violet-500',
  healthcare: 'bg-rose-500',
  entertainment: 'bg-pink-500',
  shopping: 'bg-amber-500',
  education: 'bg-teal-500',
  savings: 'bg-green-500',
  rent: 'bg-red-500',
  insurance: 'bg-cyan-500',
  groceries: 'bg-lime-500',
  restaurants: 'bg-yellow-500',
  subscriptions: 'bg-indigo-500',
  fees: 'bg-zinc-500',
  other: 'bg-slate-400',
};

function categoryColor(cat: string): string {
  const key = cat.toLowerCase().replace(/[^a-z]/g, '');
  return CATEGORY_COLORS[key] ?? 'bg-primary/60';
}

function fmt(amount: number, currency: string) {
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function pct(value: number | null | undefined, suffix = '%') {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${color ?? ''}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function HorizontalBar({
  label,
  amount,
  count,
  pct,
  color,
  currency,
}: {
  label: string;
  amount: number;
  count: number;
  pct: number;
  color: string;
  currency: string;
}) {
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium capitalize truncate max-w-[180px]">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {fmt(amount, currency)}{' '}
          <span className="opacity-60">({pct.toFixed(0)}% · {count} tx)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function MonthlyTrendRow({
  month,
  income,
  expenses,
  net,
  currency,
  maxVal,
}: {
  month: string;
  income: number;
  expenses: number;
  net: number;
  currency: string;
  maxVal: number;
}) {
  const incomeW = maxVal > 0 ? (income / maxVal) * 100 : 0;
  const expenseW = maxVal > 0 ? (expenses / maxVal) * 100 : 0;
  const label = new Date(`${month}-01`).toLocaleString('default', { month: 'short', year: '2-digit' });

  return (
    <div className="grid grid-cols-[56px_1fr_90px] items-center gap-3">
      <span className="text-xs text-muted-foreground text-right">{label}</span>
      <div className="space-y-0.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-green-500" style={{ width: `${incomeW}%` }} />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-red-500" style={{ width: `${expenseW}%` }} />
        </div>
      </div>
      <span className={`text-right text-xs tabular-nums font-medium ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
        {net >= 0 ? '+' : ''}{net.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClientInsightsPanel({ clientId }: Props) {
  const [data, setData] = useState<ClientInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    api
      .get<ClientInsights>(API_ENDPOINTS.bank.clientInsights(clientId))
      .then((r) => { if (active) setData(r); })
      .catch((err: Error) => { if (active) setError(err.message ?? 'Failed to load insights'); });
    return () => { active = false; };
  }, [clientId]);

  if (error) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{error}</p>;
  }
  if (!data) {
    return <p className="py-6 text-center text-sm text-muted-foreground animate-pulse">Loading insights…</p>;
  }
  if (data.totalTransactions === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No transactions stamped to your bank for this client yet.
      </p>
    );
  }

  const maxMonthVal = Math.max(
    ...data.monthlyTrend.map((m) => Math.max(m.income, m.expenses)),
    1,
  );

  const savingsColor =
    data.savingsRate == null
      ? ''
      : data.savingsRate >= 20
        ? 'text-green-600'
        : data.savingsRate >= 0
          ? 'text-yellow-600'
          : 'text-red-600';

  return (
    <div className="space-y-8">

      {/* ── Period badge ─────────────────────────────────────────────── */}
      {data.periodFrom && (
        <p className="text-xs text-muted-foreground">
          Analysis covers{' '}
          <strong>{new Date(data.periodFrom).toLocaleDateString()}</strong>
          {' '}&rarr;{' '}
          <strong>{new Date(data.periodTo!).toLocaleDateString()}</strong>
          {' '}({data.totalTransactions} transactions)
        </p>
      )}

      {/* ── Key metrics ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Financial summary
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label="Avg monthly income"
            value={data.avgMonthlyIncome != null ? fmt(data.avgMonthlyIncome, data.currency) : '—'}
          />
          <MetricCard
            label="Avg monthly spend"
            value={data.avgMonthlyExpense != null ? fmt(data.avgMonthlyExpense, data.currency) : '—'}
          />
          <MetricCard
            label="Savings rate"
            value={data.savingsRate != null ? `${data.savingsRate.toFixed(1)}%` : '—'}
            sub="income minus expenses"
            color={savingsColor}
          />
          <MetricCard
            label="Credit / Debit ratio"
            value={data.creditDebitRatio != null ? data.creditDebitRatio.toFixed(2) : '—'}
            sub={data.creditDebitRatio != null && data.creditDebitRatio >= 1 ? 'Earning ≥ spending' : 'Spending > earning'}
          />
          <MetricCard
            label="Largest single expense"
            value={data.largestExpense != null ? fmt(data.largestExpense, data.currency) : '—'}
          />
          <MetricCard
            label="Est. monthly recurring"
            value={fmt(data.estimatedRecurring, data.currency)}
            sub="bills, subscriptions, rent"
          />
          <MetricCard
            label="Most active day"
            value={data.mostActiveDay ?? '—'}
            sub="by transaction count"
          />
          <MetricCard
            label="Avg transaction"
            value={fmt(data.avgTransactionAmount, data.currency)}
          />
        </div>
      </section>

      {/* ── Spending by category ─────────────────────────────────────── */}
      {data.categoryBreakdown.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Spending by category
          </h3>
          <ul className="space-y-2.5">
            {data.categoryBreakdown.slice(0, 10).map((c) => (
              <HorizontalBar
                key={c.category}
                label={c.category}
                amount={c.totalAmount}
                count={c.transactionCount}
                pct={c.percentage}
                color={categoryColor(c.category)}
                currency={data.currency}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Monthly income vs expenses ───────────────────────────────── */}
      {data.monthlyTrend.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Monthly trend
            </h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" /> Income
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" /> Expenses
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {data.monthlyTrend.map((m) => (
              <MonthlyTrendRow
                key={m.month}
                month={m.month}
                income={m.income}
                expenses={m.expenses}
                net={m.net}
                currency={data.currency}
                maxVal={maxMonthVal}
              />
            ))}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-4 py-3 text-xs">
            <div>
              <p className="text-muted-foreground">Total in</p>
              <p className="font-semibold text-green-600">{fmt(data.totalCredit, data.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total out</p>
              <p className="font-semibold text-red-600">{fmt(data.totalDebit, data.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Net</p>
              <p className={`font-semibold ${data.totalCredit - data.totalDebit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {pct(
                  ((data.totalCredit - data.totalDebit) / (data.totalCredit || 1)) * 100,
                  '%',
                )}{' '}
                ({fmt(Math.abs(data.totalCredit - data.totalDebit), data.currency)})
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ── Top payees ───────────────────────────────────────────────── */}
      {data.topPayees.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Top payees
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Payee / merchant</th>
                  <th className="pb-2 font-medium text-right">Transactions</th>
                  <th className="pb-2 font-medium text-right">Total spent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.topPayees.map((p, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="py-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 font-medium truncate max-w-xs">{p.name}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{p.count}</td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {fmt(p.totalAmount, data.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── ML income assessment ─────────────────────────────────────── */}
      {data.incomeAssessment && Object.keys(data.incomeAssessment).length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Income assessment (ML)
          </h3>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-3">
            {Object.entries(data.incomeAssessment).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</dt>
                <dd className="font-medium">{typeof v === 'number' ? v.toLocaleString() : String(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
