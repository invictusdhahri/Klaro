import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export default async function OnboardingConnectPage() {
  await requireUser();

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      {/* Progress stepper */}
      <div className="flex items-center gap-2 mb-10">
        <StepPill emoji="✅" label="Registered" done />
        <StepDivider />
        <StepPill emoji="✅" label="KYC" done />
        <StepDivider />
        <StepPill emoji="🔀" label="Connect" active />
        <StepDivider />
        <StepPill emoji="🔒" label="Score" />
      </div>

      {/* Hero */}
      <div className="text-center space-y-3 mb-10 max-w-xs">
        <div className="text-6xl">🔀</div>
        <h1 className="text-2xl font-bold text-white">Choose your path</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Connect your bank or upload documents to unlock your Klaro score 📊
        </p>
      </div>

      {/* Path cards */}
      <div className="w-full max-w-sm space-y-4">
        {/* Bank — recommended */}
        <Link
          href="/connect-bank?from=onboarding"
          className="group glass-card-strong p-5 flex items-center gap-4 hover:border-indigo-500/40 hover:scale-[1.02] active:scale-[0.99] transition-all duration-200 block"
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-3xl shrink-0 group-hover:bg-indigo-500/30 transition-colors">
            🏦
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-bold text-white">Connect your bank</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-indigo-500/25 text-indigo-300 px-2 py-0.5 rounded-full">
                Recommended
              </span>
            </div>
            <p className="text-xs text-white/50">Fastest • Instant data import • +120 pts potential</p>
          </div>
          <span className="text-white/30 group-hover:text-white/70 text-lg transition-colors shrink-0">→</span>
        </Link>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-white/30 font-medium">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Documents */}
        <Link
          href="/documents?from=onboarding"
          className="group glass-card p-5 flex items-center gap-4 hover:border-white/20 hover:scale-[1.02] active:scale-[0.99] transition-all duration-200 block"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/8 flex items-center justify-center text-3xl shrink-0 group-hover:bg-white/12 transition-colors">
            📄
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-white mb-0.5">Upload documents</div>
            <p className="text-xs text-white/50">Bank statements, payslips, income proof</p>
          </div>
          <span className="text-white/30 group-hover:text-white/70 text-lg transition-colors shrink-0">→</span>
        </Link>
      </div>

      <p className="mt-8 text-xs text-white/30 text-center max-w-xs">
        You can always add more data later to improve your score 📈
      </p>

      {/* Skip for now */}
      <Link
        href="/dashboard"
        className="mt-4 text-xs text-white/25 hover:text-white/50 transition-colors underline underline-offset-4"
      >
        Skip for now
      </Link>
    </div>
  );
}

function StepPill({
  emoji,
  label,
  done = false,
  active = false,
}: {
  emoji: string;
  label: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
        done
          ? 'bg-green-500/15 border-green-500/25 text-green-400'
          : active
            ? 'bg-indigo-500/20 border-indigo-500/35 text-indigo-300'
            : 'bg-white/5 border-white/10 text-white/30'
      }`}
    >
      <span className="text-sm leading-none">{emoji}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

function StepDivider() {
  return <div className="w-4 h-px bg-white/15 shrink-0" />;
}
