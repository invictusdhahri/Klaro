'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IdUploadStep } from '@/components/kyc/id-upload-step';

const KYC_FACE_CROP_KEY = 'klaro.kyc.face_crop';

export default function KycPage() {
  const router = useRouter();
  const [step1Done, setStep1Done] = React.useState(false);

  const handleStep1Success = React.useCallback(
    (result: { face_crop_base64: string }) => {
      sessionStorage.setItem(KYC_FACE_CROP_KEY, result.face_crop_base64);
      setStep1Done(true);
    },
    [],
  );

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
          <IdUploadStep onSuccess={handleStep1Success} />
        </CardContent>
      </Card>

      <Card className={step1Done ? undefined : 'opacity-50 pointer-events-none'}>
        <CardHeader>
          <CardTitle>Step 2 — Liveness check</CardTitle>
          <CardDescription>Live blink + head rotation — takes about 5 seconds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            disabled={!step1Done}
            onClick={() => router.push('/kyc/liveness')}
          >
            Start liveness check
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
