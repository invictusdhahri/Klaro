import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LivenessStep } from '@/components/kyc/liveness-step';

export default function LivenessPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Identity verification</h1>
        <p className="text-sm text-muted-foreground">
          Step 2 of 3 — Liveness check
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 2 — Liveness check</CardTitle>
          <CardDescription>
            Follow the on-screen prompts. The whole check takes about 5 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LivenessStep />
        </CardContent>
      </Card>
    </div>
  );
}
