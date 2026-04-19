import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getServerApi } from '@/lib/api.server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { API_ENDPOINTS } from '@klaro/shared';
import type { BankDashboardStats, DashboardScoreBand } from '@klaro/shared';
import { ScoreDistribution } from '@/components/bank/score-distribution';

const BAND_LABELS: Record<DashboardScoreBand, string> = {
  EXCELLENT: 'Excellent',
  VERY_GOOD: 'Very good',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
  UNSCORED: 'Unscored',
};

const STATUS_BADGE: Record<string, string> = {
  processed: 'bg-green-500/10 text-green-700 dark:text-green-400',
  processing: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  needs_review: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-500',
  verification_failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  pending: 'bg-muted text-muted-foreground',
};

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function formatScore(n: number | null | undefined): string {
  if (n == null) return '—';
  return Math.round(n).toString();
}

export default async function BankDashboardPage() {
  await requireRole('bank');
  const api = await getServerApi();

  let stats: BankDashboardStats | null = null;
  let loadError: string | null = null;
  try {
    stats = await api.get<BankDashboardStats>(API_ENDPOINTS.bank.dashboardStats);
  } catch (err: unknown) {
    loadError = (err as Error).message ?? 'Failed to load dashboard';
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your bank&apos;s clients.</p>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {loadError ?? 'No data available yet.'}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live snapshot of your consented clients and their statement pipeline.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Consented clients"
          value={formatNumber(stats.totalClients)}
          hint="Users granting your bank access"
        />
        <StatCard
          label="Average score"
          value={formatScore(stats.avgScore)}
          hint="Latest score across consented clients"
        />
        <StatCard
          label="KYC pass rate"
          value={formatPercent(stats.kycPassRate)}
          hint="Verified vs. all consented"
        />
        <StatCard
          label="Anomalies (30d)"
          value={formatNumber(stats.anomalyCount30d)}
          hint="Flags raised in the last 30 days"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Score distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreDistribution distribution={stats.scoreDistribution} labels={BAND_LABELS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statement pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4 text-center">
              <PipelineCell label="Processing" value={stats.statementsProcessing} status="processing" />
              <PipelineCell label="Needs review" value={stats.statementsNeedsReview} status="needs_review" />
              <PipelineCell label="Processed" value={stats.statementsProcessed} status="processed" />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent uploads</CardTitle>
          <Link href="/bank/clients" className="text-xs text-primary hover:underline">
            View all clients
          </Link>
        </CardHeader>
        <CardContent>
          {stats.recentUploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No uploads yet from your consented clients.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Client</th>
                    <th className="pb-2 font-medium">File</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stats.recentUploads.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="py-2 font-medium">
                        <Link className="hover:underline" href={`/bank/clients/${u.user_id}`}>
                          {u.full_name}
                        </Link>
                      </td>
                      <td className="py-2 text-muted-foreground truncate max-w-xs" title={u.file_name}>
                        {u.file_name}
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            STATUS_BADGE[u.status] ?? 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {u.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(u.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function PipelineCell({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status: keyof typeof STATUS_BADGE;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mx-auto w-fit rounded-full px-3 py-1 text-base font-semibold tabular-nums ${
          STATUS_BADGE[status] ?? 'bg-muted'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
