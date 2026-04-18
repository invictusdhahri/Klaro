import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function KycPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Identity verification</h1>
        <p className="text-sm text-muted-foreground">
          Verify your identity with your CIN or passport, plus a quick selfie. All processing
          happens on Klaro infrastructure.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Upload your ID</CardTitle>
          <CardDescription>CIN, passport, or driver license</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>Upload document</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2 — Take a selfie</CardTitle>
          <CardDescription>Live liveness check (blink + head rotation)</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled>
            Start camera
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Camera flow will be wired once the ML sidecar is connected.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
