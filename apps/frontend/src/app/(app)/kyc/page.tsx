'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IdUploadStep } from '@/components/kyc/id-upload-step';
import { api } from '@/lib/api';

const KYC_FACE_CROP_KEY = 'klaro.kyc.face_crop';
const KYC_DOC_ID_KEY    = 'klaro.kyc.doc_id';

function VerifiedBanner() {
  const router = useRouter();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-green-500/10" />
          <svg className="relative h-12 w-12 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600 ring-1 ring-green-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Verified
        </span>
        <div className="space-y-1.5 max-w-xs">
          <h2 className="text-xl font-bold tracking-tight">Identity Verified</h2>
          <p className="text-sm text-muted-foreground">
            Your identity has already been verified. No further action is needed.
          </p>
        </div>
        <Button onClick={() => router.push('/dashboard')} className="w-full max-w-xs">
          Go to Dashboard
        </Button>
      </CardContent>
    </Card>
  );
}

export default function KycPage() {
  const router = useRouter();
  const [step1Done, setStep1Done] = React.useState(false);
  const [kycStatus, setKycStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.get<{ status: string }>('/api/kyc/status')
      .then(({ status }) => setKycStatus(status))
      .catch(() => setKycStatus('pending'));
  }, []);

  const handleStep1Success = React.useCallback(
    (result: { face_crop_base64: string; doc_id?: string }) => {
      sessionStorage.setItem(KYC_FACE_CROP_KEY, result.face_crop_base64);
      if (result.doc_id) sessionStorage.setItem(KYC_DOC_ID_KEY, result.doc_id);
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

      {kycStatus === 'verified' ? (
        <VerifiedBanner />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
