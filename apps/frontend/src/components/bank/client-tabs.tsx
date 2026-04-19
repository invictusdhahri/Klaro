'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';
import type {
  BankStatementSummary,
  BankTransactionRow,
  BankTimelineEntry,
} from '@klaro/shared';
import { ClientInsightsPanel } from './client-insights';

type Tab = 'insights' | 'statements' | 'transactions' | 'timeline';

interface Props {
  clientId: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'insights', label: 'Habits & Insights' },
  { id: 'statements', label: 'Statements' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'timeline', label: 'Timeline' },
];

export function ClientTabs({ clientId }: Props) {
  const [active, setActive] = useState<Tab>('insights');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'insights' && <ClientInsightsPanel clientId={clientId} />}
      {active === 'statements' && <StatementsPanel clientId={clientId} />}
      {active === 'transactions' && <TransactionsPanel clientId={clientId} />}
      {active === 'timeline' && <TimelinePanel clientId={clientId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatementsPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BankStatementSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    api
      .get<{ data: BankStatementSummary[] }>(API_ENDPOINTS.bank.clientStatements(clientId))
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message ?? 'Failed to load statements');
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  if (error) return <PanelMessage>{error}</PanelMessage>;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;
  if (data.length === 0) {
    return (
      <PanelMessage>No statements have been uploaded against your bank for this client yet.</PanelMessage>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">File</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium">Risk</th>
            <th className="pb-2 font-medium">Tx count</th>
            <th className="pb-2 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((s) => (
            <tr key={s.id}>
              <td className="py-2 truncate max-w-xs" title={s.fileName}>
                {s.fileName}
              </td>
              <td className="py-2 capitalize text-muted-foreground">{s.status.replace('_', ' ')}</td>
              <td className="py-2 tabular-nums">
                {s.riskScore != null ? s.riskScore.toFixed(2) : '—'}
              </td>
              <td className="py-2 tabular-nums">{s.extractedCount}</td>
              <td className="py-2 text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TransactionsPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BankTransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    api
      .get<{ data: BankTransactionRow[] }>(API_ENDPOINTS.bank.clientTransactions(clientId))
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message ?? 'Failed to load transactions');
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  if (error) return <PanelMessage>{error}</PanelMessage>;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;
  if (data.length === 0) {
    return <PanelMessage>No transactions stamped to your bank for this client yet.</PanelMessage>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Description</th>
            <th className="pb-2 font-medium">Category</th>
            <th className="pb-2 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((t) => (
            <tr key={t.id}>
              <td className="py-2 whitespace-nowrap text-muted-foreground">{t.date}</td>
              <td className="py-2 truncate max-w-md" title={t.description ?? ''}>
                {t.description ?? '—'}
              </td>
              <td className="py-2 text-muted-foreground capitalize">{t.category ?? '—'}</td>
              <td
                className={`py-2 text-right tabular-nums font-medium ${
                  t.type === 'credit' ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {t.type === 'debit' ? '-' : '+'}
                {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {t.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TimelinePanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BankTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    api
      .get<{ data: BankTimelineEntry[] }>(API_ENDPOINTS.bank.clientTimeline(clientId))
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message ?? 'Failed to load timeline');
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  if (error) return <PanelMessage>{error}</PanelMessage>;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;
  if (data.length === 0) {
    return <PanelMessage>No activity yet for this client.</PanelMessage>;
  }

  return (
    <ol className="relative ml-3 space-y-4 border-l border-border pl-5">
      {data.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {e.kind} · {new Date(e.at).toLocaleString()}
          </div>
          <div className="text-sm">{describePayload(e)}</div>
        </li>
      ))}
    </ol>
  );
}

function describePayload(entry: BankTimelineEntry): string {
  const p = entry.payload as Record<string, unknown>;
  if (entry.kind === 'statement') {
    return `${(p.fileName as string) ?? 'Statement'} — ${(p.status as string) ?? 'unknown'}`;
  }
  if (entry.kind === 'score') {
    return `Score ${p.score ?? '—'} (${(p.scoreBand as string) ?? '—'})`;
  }
  if (entry.kind === 'anomaly') {
    return `${(p.severity as string)?.toUpperCase() ?? '?'}: ${(p.description as string) ?? p.flagType}`;
  }
  return JSON.stringify(p);
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
