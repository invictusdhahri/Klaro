import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreGauge } from '@/components/score/score-gauge';
import { ScoreBreakdown } from '@/components/score/score-breakdown';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function BankClientDetailPage({ params }: Props) {
  const { id } = await params;

  // TODO: fetch via API with bank-role JWT.
  const score = 712;
  const breakdown = {
    income: 0.74,
    spending: 0.62,
    paymentBehavior: 0.81,
    debtSignals: 0.66,
    documentConsistency: 0.9,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Client {id.slice(0, 8)}</h1>
        <p className="text-sm text-muted-foreground">
          You see only what the user has consented to share.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Score</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ScoreGauge score={score} />
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
    </div>
  );
}
