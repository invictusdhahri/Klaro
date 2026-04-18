'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@klaro/ui/cn';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const KYC_FACE_CROP_KEY = 'klaro.kyc.face_crop';
const KYC_SELFIE_KEY = 'klaro.kyc.selfie';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FaceMatchResult {
  match: boolean;
  similarity: number;
  threshold: number;
}

type MatchState =
  | { status: 'loading' }
  | { status: 'success'; similarity: number }
  | { status: 'failure'; similarity: number }
  | { status: 'missing_data' }
  | { status: 'error'; message: string };

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── State panels ──────────────────────────────────────────────────────────────

function LoadingPanel() {
  return (
    <div className="flex flex-col items-center gap-6 py-12">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
        <SpinnerIcon className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-base font-semibold">Comparing with your ID photo…</p>
        <p className="text-sm text-muted-foreground">This only takes a moment.</p>
      </div>
    </div>
  );
}

function SuccessPanel({ similarity }: { similarity: number }) {
  const router = useRouter();
  const pct = Math.round(similarity * 100);

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      {/* Icon */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-green-500/10 animate-pulse" />
        <CheckCircleIcon className="relative h-16 w-16 text-green-500" />
      </div>

      {/* Badge */}
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600 ring-1 ring-green-500/30">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Verified
      </span>

      {/* Copy */}
      <div className="space-y-1.5 max-w-xs">
        <h2 className="text-2xl font-bold tracking-tight">Identity Verified</h2>
        <p className="text-sm text-muted-foreground">
          Your Klaro profile is now active. Face match confidence: {pct}%.
        </p>
      </div>

      {/* Divider */}
      <div className="w-full max-w-xs border-t" />

      <Button onClick={() => router.push('/dashboard')} className="w-full max-w-xs">
        Go to Dashboard
      </Button>
    </div>
  );
}

function FailurePanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      {/* Icon */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-destructive/10" />
        <XCircleIcon className="relative h-16 w-16 text-destructive" />
      </div>

      {/* Copy */}
      <div className="space-y-1.5 max-w-xs">
        <h2 className="text-2xl font-bold tracking-tight">Verification Failed</h2>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t match your selfie to the ID photo. Make sure your face is clearly
          visible and in good lighting.
        </p>
      </div>

      {/* Actions */}
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button variant="outline" onClick={onRetry} className="w-full">
          Try the liveness check again
        </Button>
        <p className="text-xs text-muted-foreground">
          Still having trouble?{' '}
          <a
            href="mailto:support@klaro.tn"
            className="font-medium underline underline-offset-2 text-foreground"
          >
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}

function MissingDataPanel() {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <XCircleIcon className="h-12 w-12 text-muted-foreground" />
      <div className="space-y-1 max-w-xs">
        <h2 className="text-lg font-semibold">Session expired</h2>
        <p className="text-sm text-muted-foreground">
          Your verification session data was not found. Please start over from Step 1.
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/kyc">Restart verification</Link>
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResultStep() {
  const router = useRouter();
  const [state, setState] = React.useState<MatchState>({ status: 'loading' });

  const runFaceMatch = React.useCallback(async () => {
    setState({ status: 'loading' });

    const selfie = sessionStorage.getItem(KYC_SELFIE_KEY);
    const docFace = sessionStorage.getItem(KYC_FACE_CROP_KEY);

    if (!selfie || !docFace) {
      setState({ status: 'missing_data' });
      return;
    }

    try {
      const result = await api.post<FaceMatchResult>('/api/kyc/face-match', {
        selfie_base64: selfie,
        doc_face_base64: docFace,
      });

      if (result.match) {
        // Clean up session data on success
        sessionStorage.removeItem(KYC_SELFIE_KEY);
        sessionStorage.removeItem(KYC_FACE_CROP_KEY);
        setState({ status: 'success', similarity: result.similarity });
      } else {
        setState({ status: 'failure', similarity: result.similarity });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Face match failed. Please try again.';
      setState({ status: 'error', message: msg });
    }
  }, []);

  React.useEffect(() => {
    runFaceMatch();
  }, [runFaceMatch]);

  const handleRetry = React.useCallback(() => {
    router.push('/kyc/liveness');
  }, [router]);

  if (state.status === 'loading') return <LoadingPanel />;
  if (state.status === 'missing_data') return <MissingDataPanel />;
  if (state.status === 'success') return <SuccessPanel similarity={state.similarity} />;
  if (state.status === 'failure') return <FailurePanel onRetry={handleRetry} />;

  // error
  return (
    <div className="space-y-4 py-4">
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {state.message}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={runFaceMatch} className="flex-1">
          Retry
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/kyc">Start over</Link>
        </Button>
      </div>
    </div>
  );
}
