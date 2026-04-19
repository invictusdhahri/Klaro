import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto px-4">
      {/* Hero */}
      <section className="text-center pt-20 pb-16 space-y-8">
        <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 text-xs font-semibold text-indigo-300 border border-indigo-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          Alternative credit scoring for Tunisia 🇹🇳
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
          Your real financial story.
          <br />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
            Scored fairly.
          </span>
        </h1>

        <p className="text-lg text-white/50 max-w-xl mx-auto leading-relaxed">
          Klaro builds a transparent, AI-powered credit score from your KYC, bank activity, and
          payment behavior — without the credit bureau gatekeeping.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/register"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 text-white btn-glow transition-all"
          >
            Get my score 📊
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-base font-semibold glass border border-white/12 text-white/70 hover:text-white hover:bg-white/10 transition-all"
          >
            I have an account
          </Link>
        </div>

        {/* Social proof */}
        <p className="text-xs text-white/25">
          🔒 Your documents never leave our infrastructure
        </p>
      </section>

      {/* Score preview card */}
      <section className="flex justify-center pb-16">
        <div className="glass-card-strong p-6 w-full max-w-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Your Klaro Score</span>
            <span className="text-xs glass px-2 py-1 rounded-full text-white/50">0–1000</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke="hsl(25 95% 53%)"
                  strokeWidth="3"
                  strokeDasharray="65 100"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-black text-orange-400">410</span>
                <span className="text-[9px] text-white/40 uppercase tracking-wide">FAIR</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {[
                { label: 'Income stability', pct: 35 },
                { label: 'Payment behavior', pct: 30 },
                { label: 'Document quality', pct: 72 },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-[10px] text-white/40">
                    <span>{item.label}</span>
                    <span>{item.pct}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pt-2 border-t border-white/8 text-xs text-white/35 text-center">
            Connect your bank to unlock +120 pts 📈
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="grid gap-4 sm:grid-cols-3 pb-20">
        {[
          {
            emoji: '🪪',
            title: 'Own your KYC',
            body: 'Open-source pipeline (PaddleOCR, MTCNN, AdaFace, MediaPipe). Your documents stay on our infrastructure — never sold.',
          },
          {
            emoji: '🏦',
            title: 'Real bank insights',
            body: 'Connect your bank or upload statements. Klaro normalizes, categorizes, and scores — transparently and in seconds.',
          },
          {
            emoji: '🤖',
            title: 'AI advisor',
            body: 'A Claude-powered financial advisor that understands your spending patterns and tells you exactly what to fix.',
          },
        ].map((f) => (
          <div key={f.title} className="glass-card p-6 space-y-3">
            <div className="text-3xl">{f.emoji}</div>
            <h3 className="font-bold text-white">{f.title}</h3>
            <p className="text-sm text-white/45 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </section>

      {/* Bottom CTA */}
      <section className="glass-card-strong p-8 text-center space-y-4 mb-16">
        <div className="text-4xl">🚀</div>
        <h2 className="text-2xl font-black text-white">Ready to know your score?</h2>
        <p className="text-sm text-white/45">Takes 5 minutes. Free to start.</p>
        <Link
          href="/register"
          className="inline-block px-8 py-3.5 rounded-2xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white btn-glow transition-all"
        >
          Get started — it&apos;s free 🎯
        </Link>
      </section>
    </div>
  );
}
