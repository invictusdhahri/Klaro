import { getServerApi } from '@/lib/api.server';
import { requireRole } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreGauge } from '@/components/score/score-gauge';
import { ScoreBreakdown } from '@/components/score/score-breakdown';
import { ScoreRadar } from '@/components/score/score-radar';
import { RiskBadge } from '@/components/bank/risk-badge';
import { ConsentScopeChips } from '@/components/bank/consent-scope-chips';
import { RequestConsentButton } from '@/components/bank/request-consent-button';
import { ClientTabs } from '@/components/bank/client-tabs';
import { API_ENDPOINTS } from '@klaro/shared';
import type { ScoreBreakdown as ScoreBreakdownType } from '@klaro/shared';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ id: string }>;
}

interface ClientProfile {
  full_name: string;
  occupation_category: string | null;
  kyc_status: string;
}

interface ClientDetail {
  id: string;
  profile: ClientProfile | null;
  consentScope: string[];
  grantedAt: string | null;
}

interface ClientScore {
  score: number;
  score_band: string;
  risk_category: string;
  confidence: number;
  breakdown: Record<string, unknown>;
  flags: string[];
  created_at: string;
}

function mapBreakdown(raw: Record<string, unknown>): ScoreBreakdownType {
  return {
    income: raw.income_stability as number | undefined,
    paymentBehavior: raw.payment_behavior as number | undefined,
    debtSignals: raw.debt_signals as number | undefined,
    documentConsistency: raw.document_consistency as number | undefined,
    behavioralPatterns: raw.behavioral_patterns as number | undefined,
  };
}

export default async function BankClientDetailPage({ params }: Props) {
  await requireRole('bank');
  const { id } = await params;
  const api = await getServerApi();

  let client: ClientDetail;
  try {
    client = await api.get<ClientDetail>(API_ENDPOINTS.bank.client(id));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 403 || status === 404) notFound();
    throw err;
  }

  let scoreData: ClientScore | null = null;
  try {
    scoreData = await api.get<ClientScore>(API_ENDPOINTS.bank.clientScore(id));
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404 && status !== 403) throw err;
    scoreData = null;
  }

  const profile = client.profile;
  const breakdown = scoreData ? mapBreakdown(scoreData.breakdown) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile?.full_name ?? `Client ${id.slice(0, 8)}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            You see only what the user has consented to share.
            {client.grantedAt && (
              <> Consent granted {new Date(client.grantedAt).toLocaleDateString()}.</>
            )}
          </p>
        </div>
        {scoreData && <RiskBadge risk={scoreData.risk_category} />}
      </div>

      {profile && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {profile.occupation_category && (
            <span>
              Occupation:{' '}
              <span className="text-foreground capitalize">{profile.occupation_category}</span>
            </span>
          )}
          <span>
            KYC:{' '}
            <span
              className={`font-medium capitalize ${
                profile.kyc_status === 'verified'
                  ? 'text-green-600'
                  : profile.kyc_status === 'flagged'
                    ? 'text-orange-600'
                    : profile.kyc_status === 'rejected'
                      ? 'text-red-600'
                      : 'text-yellow-600'
              }`}
            >
              {profile.kyc_status}
            </span>
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Consent scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConsentScopeChips granted={client.consentScope} />
          <RequestConsentButton clientId={id} />
        </CardContent>
      </Card>

      {scoreData && breakdown ? (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Score</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-2">
                <ScoreGauge score={scoreData.score} />
                <p className="text-xs text-muted-foreground">
                  Confidence: {Math.round(scoreData.confidence * 100)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Last calculated: {new Date(scoreData.created_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ScoreBreakdown breakdown={breakdown} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Radar view</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreRadar breakdown={breakdown} />
            </CardContent>
          </Card>

          {scoreData.flags?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Risk flags</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {scoreData.flags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-400" />
                      <span className="text-muted-foreground">{flag}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ClientTabs clientId={id} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No score yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No score available yet. The client may not have calculated their credit score, or your
              consent scope does not include score access.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
