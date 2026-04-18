'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IdUploadStep } from '@/components/kyc/id-upload-step';

export default function KycPage() {
  const [step1Done, setStep1Done] = React.useState(false);

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
          <IdUploadStep onSuccess={() => setStep1Done(true)} />
        </CardContent>
      </Card>

      <Card className={step1Done ? undefined : 'opacity-50'}>
        <CardHeader>
          <CardTitle>Step 2 — Take a selfie</CardTitle>
          <CardDescription>Live liveness check (blink + head rotation)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" disabled={!step1Done}>
            Start camera
          </Button>
          {!step1Done && (
            <p className="text-xs text-muted-foreground">
              Complete Step 1 first to unlock the liveness check.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
