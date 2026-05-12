import { getServerApi } from '@/lib/api.server';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ScoreDashboardClient } from '@/components/score/score-dashboard-client';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await requireUser();
  const api = await getServerApi();
  const supabase = await createClient();

  // Check profile completion
  const { data: profileData } = await supabase
    .from('profiles')
    .select('kyc_status, full_name')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as { kyc_status: string; full_name: string } | null;

  if (!profile || profile.kyc_status === 'pending') {
    redirect('/kyc');
  }

  // Check bank connections
  const { count: bankCount } = await supabase
    .from('bank_connections')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  // Check documents
  const { count: docCount } = await supabase
    .from('kyc_documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const kycDone = profile?.kyc_status === 'verified';
  const dataDone = (bankCount ?? 0) > 0 || (docCount ?? 0) > 0;
  const setupComplete = kycDone && dataDone;

  // Next pending onboarding step
  const nextStep = !kycDone
    ? { href: '/kyc', label: 'Verify your identity', sublabel: 'KYC — 2 min', emoji: '🪪' }
    : !dataDone
      ? { href: '/onboarding/connect', label: 'Connect bank or upload docs', sublabel: 'To generate your score', emoji: '🏦' }
      : null;

  // Steps for progress bar (2 total)
  const stepsCompleted = (kycDone ? 1 : 0) + (dataDone ? 1 : 0);

  let initialScore = null;
  try {
    initialScore = await api.get('/api/score/current');
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-5 max-w-2xl mx-auto">

      {/* ── Onboarding banner ── shown until both steps are complete */}
      {!setupComplete && nextStep && (
        <Link
          href={nextStep.href}
          className="group block w-full rounded-2xl overflow-hidden relative border border-indigo-500/25 hover:border-indigo-400/40 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.12) 100%)' }}
        >
          {/* Shimmer line at top */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent" />

          <div className="flex items-center gap-4 px-5 py-4">
            {/* Icon */}
            <div className="w-11 h-11 rounded-xl bg-indigo-500/20 flex items-center justify-center text-2xl shrink-0 group-hover:bg-indigo-500/30 transition-colors">
              {nextStep.emoji}
            </div>

            {/* Text + progress */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
                  Onboarding · step {stepsCompleted + 1} of 2
                </span>
              </div>
              <p className="text-sm font-semibold text-white leading-tight">{nextStep.label}</p>
              <p className="text-xs text-white/45 mt-0.5">{nextStep.sublabel}</p>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 mt-2.5">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i < stepsCompleted
                        ? 'w-4 bg-green-400'
                        : i === stepsCompleted
                          ? 'w-4 bg-indigo-400'
                          : 'w-1.5 bg-white/15'
                    }`}
                  />
                ))}
                <span className="ml-1 text-[10px] text-white/30">{stepsCompleted}/2 done</span>
              </div>
            </div>

            {/* Arrow */}
            <span className="text-indigo-400/60 group-hover:text-indigo-300 text-xl transition-colors shrink-0 group-hover:translate-x-0.5 transform duration-150">
              →
            </span>
          </div>
        </Link>
      )}

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">
          Hey {firstName} 👋
        </h1>
        <p className="text-sm text-white/40">
          Your Klaro credit profile
        </p>
      </div>

      {/* Score dashboard */}
      <ScoreDashboardClient
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialScore={initialScore as any}
        userId={user.id}
      />
    </div>
  );
}
