import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScoreGauge } from '@/components/score/score-gauge';
import { ScoreBreakdown } from '@/components/score/score-breakdown';

export default function DashboardPage() {
  // TODO: fetch real score from API. Placeholder data for now.
  const placeholderScore = 642;
  const placeholderBreakdown = {
    identity: 0.95,
    income: 0.62,
    spending: 0.55,
    paymentBehavior: 0.78,
    debtSignals: 0.7,
    documentConsistency: 0.88,
    behavioralPatterns: 0.6,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your Klaro score</h1>
        <p className="text-sm text-muted-foreground">
          Updated continuously from your KYC, bank activity, and payment behavior.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Score</CardTitle>
            <CardDescription>0 – 1000 scale</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ScoreGauge score={placeholderScore} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Breakdown</CardTitle>
            <CardDescription>What is helping and hurting your score</CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreBreakdown breakdown={placeholderBreakdown} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
          <CardDescription>Improve your score with concrete actions</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connect a bank, complete KYC, and chat with the advisor to get personalized
          recommendations.
        </CardContent>
      </Card>
    </div>
  );
}
