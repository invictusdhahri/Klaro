import { getServerApi } from '@/lib/api.server';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ScoreDashboardClient } from '@/components/score/score-dashboard-client';
import Link from 'next/link';

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
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">
          Hey {firstName} 👋
        </h1>
        <p className="text-sm text-white/40">
          Your Klaro credit profile
        </p>
      </div>

      {/* Setup progress — shown if not fully set up */}
      {!setupComplete && (
        <div className="glass-card-strong p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡️</span>
            <div>
              <p className="font-semibold text-white text-sm">Complete your profile</p>
              <p className="text-xs text-white/40">Unlock your score in 2 steps</p>
            </div>
          </div>
          <div className="space-y-2.5">
            <SetupStep
              emoji="🪪"
              label="Verify your identity"
              sublabel="KYC — 2 min"
              done={kycDone}
              href="/kyc"
            />
            <SetupStep
              emoji="🏦"
              label="Connect bank or upload docs"
              sublabel="To generate your score"
              done={dataDone}
              href="/onboarding/connect"
            />
          </div>
        </div>
      )}

      {/* Score dashboard */}
      <ScoreDashboardClient
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialScore={initialScore as any}
        userId={user.id}
      />
    </div>
  );
}

function SetupStep({
  emoji,
  label,
  sublabel,
  done,
  href,
}: {
  emoji: string;
  label: string;
  sublabel: string;
  done: boolean;
  href: string;
}) {
  return (
    <Link
      href={done ? '#' : href}
      className={`flex items-center gap-3 rounded-xl p-3 transition-all ${
        done
          ? 'bg-green-500/10 border border-green-500/20 pointer-events-none'
          : 'glass hover:bg-white/10 border border-white/8'
      }`}
    >
      <span className="text-xl leading-none w-8 text-center">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-green-400' : 'text-white'}`}>{label}</p>
        <p className="text-xs text-white/40">{sublabel}</p>
      </div>
      <span className="text-lg leading-none shrink-0">
        {done ? '✅' : '→'}
      </span>
    </Link>
  );
}
