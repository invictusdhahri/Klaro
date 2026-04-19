'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { IdUploadStep } from '@/components/kyc/id-upload-step';
import { api } from '@/lib/api';

const KYC_FACE_CROP_KEY = 'klaro.kyc.face_crop';
const KYC_DOC_ID_KEY    = 'klaro.kyc.doc_id';

function VerifiedBanner() {
  const router = useRouter();
  return (
    <div className="glass-card-strong p-8 flex flex-col items-center gap-5 text-center">
      <div className="text-6xl">✅</div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-white">Identity Verified</h2>
        <p className="text-sm text-white/50">
          Your identity has already been verified. No further action needed.
        </p>
      </div>
      <Button
        onClick={() => router.push('/dashboard')}
        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl h-12 btn-glow"
      >
        Go to Dashboard 🏠
      </Button>
    </div>
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
    <div className="mx-auto max-w-lg space-y-4">
      {/* Header */}
      <div className="text-center space-y-1 py-2">
        <div className="text-5xl mb-2">🪪</div>
        <h1 className="text-xl font-bold text-white">Identity Verification</h1>
        <p className="text-sm text-white/40">
          Takes about 2 minutes • Secure & encrypted 🔒
        </p>
      </div>

      {/* Stepper */}
      <div className="glass-card p-4 flex items-center gap-2">
        <StepBadge n={1} done={step1Done} active={!step1Done} label="Upload ID 📸" />
        <div className="flex-1 h-px bg-white/10" />
        <StepBadge n={2} done={false} active={step1Done} label="Liveness 🤳" />
        <div className="flex-1 h-px bg-white/10" />
        <StepBadge n={3} done={false} active={false} label="Result ✨" />
      </div>

      {kycStatus === 'verified' ? (
        <VerifiedBanner />
      ) : (
        <>
          {/* Step 1 */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${step1Done ? 'bg-green-500/20 text-green-400' : 'bg-indigo-500/20 text-indigo-300'}`}>
                {step1Done ? '✓' : '1'}
              </div>
              <div>
                <p className="font-semibold text-white text-sm">Upload your ID</p>
                <p className="text-xs text-white/40">CIN, passport, or driver licence</p>
              </div>
            </div>
            <IdUploadStep onSuccess={handleStep1Success} />
          </div>

          {/* Step 2 */}
          <div className={`glass-card p-5 space-y-4 transition-opacity ${step1Done ? 'opacity-100' : 'opacity-40'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${step1Done ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/8 text-white/30'}`}>
                2
              </div>
              <div>
                <p className="font-semibold text-white text-sm">Liveness check</p>
                <p className="text-xs text-white/40">Quick blink + head rotation — ~5 seconds 🤳</p>
              </div>
            </div>
            <Button
              disabled={!step1Done}
              onClick={() => router.push('/kyc/liveness')}
              className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white btn-glow disabled:opacity-40 disabled:cursor-not-allowed disabled:btn-glow-none"
            >
              {step1Done ? 'Start liveness check →' : 'Complete Step 1 first'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function StepBadge({
  n,
  done,
  active,
  label,
}: {
  n: number;
  done: boolean;
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
          done
            ? 'bg-green-500/25 text-green-400'
            : active
              ? 'bg-indigo-500/25 text-indigo-300 ring-2 ring-indigo-500/40'
              : 'bg-white/8 text-white/25'
        }`}
      >
        {done ? '✓' : n}
      </div>
      <span className={`text-[9px] font-medium truncate max-w-[60px] text-center ${active ? 'text-white/70' : done ? 'text-green-400/70' : 'text-white/25'}`}>
        {label}
      </span>
    </div>
  );
}
