import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultStep } from '@/components/kyc/result-step';

export default function ResultPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Identity verification</h1>
        <p className="text-sm text-muted-foreground">Step 3 of 3 — Face match</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 3 — Verification result</CardTitle>
          <CardDescription>Comparing your selfie with the ID photo on file.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResultStep />
        </CardContent>
      </Card>
    </div>
  );
}
