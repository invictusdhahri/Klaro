'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';

interface Client {
  id: string;
  name: string;
  kycStatus: string;
  score: number | null;
  scoreBand: string | null;
  consentScope: string[];
  grantedAt: string | null;
}

interface ClientsResponse {
  data: Client[];
  total: number;
  page: number;
  limit: number;
}

const SCORE_BANDS = ['POOR', 'FAIR', 'GOOD', 'VERY_GOOD', 'EXCELLENT'] as const;
const KYC_STATUSES = ['pending', 'verified', 'flagged', 'rejected'] as const;
const CONSENT_SCOPES = ['score', 'breakdown', 'transactions', 'full_profile'] as const;

const BAND_CLASSES: Record<string, string> = {
  EXCELLENT: 'text-green-600',
  VERY_GOOD: 'text-teal-600',
  GOOD: 'text-blue-600',
  FAIR: 'text-yellow-600',
  POOR: 'text-red-600',
};

const KYC_CLASSES: Record<string, string> = {
  verified: 'text-green-600',
  pending: 'text-yellow-600',
  flagged: 'text-orange-600',
  rejected: 'text-red-600',
};

const PAGE_SIZE = 20;

export default function BankClientsPage() {
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [kycFilter, setKycFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'granted_at'>('granted_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ClientsResponse>(API_ENDPOINTS.bank.clients, {
        query: { page, limit: PAGE_SIZE, sortBy, order: sortOrder },
      });
      setAllClients(result.data);
      setTotal(result.total);
    } catch {
      setError('Failed to load clients. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder]);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const filtered = allClients.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (bandFilter && c.scoreBand !== bandFilter) return false;
    if (kycFilter && c.kycStatus !== kycFilter) return false;
    if (scopeFilter && !c.consentScope.includes(scopeFilter)) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Users who have granted your institution score visibility.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />

        <select
          value={bandFilter}
          onChange={(e) => setBandFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All bands</option>
          {SCORE_BANDS.map((b) => (
            <option key={b} value={b}>
              {b.replace('_', ' ')}
            </option>
          ))}
        </select>

        <select
          value={kycFilter}
          onChange={(e) => setKycFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All KYC statuses</option>
          {KYC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All consent scopes</option>
          {CONSENT_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>

        <select
          value={`${sortBy}:${sortOrder}`}
          onChange={(e) => {
            const [by, ord] = e.target.value.split(':') as [typeof sortBy, typeof sortOrder];
            setSortBy(by);
            setSortOrder(ord);
            setPage(1);
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="granted_at:desc">Newest consent first</option>
          <option value="granted_at:asc">Oldest consent first</option>
          <option value="score:desc">Score (high → low)</option>
          <option value="score:asc">Score (low → high)</option>
          <option value="name:asc">Name (A → Z)</option>
          <option value="name:desc">Name (Z → A)</option>
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {loading
              ? 'Loading…'
              : total === 0
                ? 'No clients have granted you access yet'
                : `${total} consented user${total === 1 ? '' : 's'}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {!loading && filtered.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              {total === 0
                ? 'No clients have granted you access yet. Use "Request consent" from a client detail page to invite users.'
                : 'No clients match the current filters.'}
            </p>
          )}

          {filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Score</th>
                    <th className="pb-2 font-medium">Band</th>
                    <th className="pb-2 font-medium">KYC Status</th>
                    <th className="pb-2 font-medium">Consent since</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="py-3 font-medium">{c.name}</td>
                      <td className="py-3 tabular-nums">
                        {c.score !== null ? (
                          c.score
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td
                        className={`py-3 font-medium ${BAND_CLASSES[c.scoreBand ?? ''] ?? 'text-muted-foreground'}`}
                      >
                        {c.scoreBand ? c.scoreBand.replace('_', ' ') : '—'}
                      </td>
                      <td
                        className={`py-3 capitalize ${KYC_CLASSES[c.kycStatus] ?? 'text-muted-foreground'}`}
                      >
                        {c.kycStatus}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {c.grantedAt ? new Date(c.grantedAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/bank/clients/${c.id}`}
                          className="text-primary hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
