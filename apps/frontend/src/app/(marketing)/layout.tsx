import Link from 'next/link';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-gradient min-h-screen flex flex-col relative overflow-hidden">
      {/* Ambient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-20 w-[40rem] h-[40rem] rounded-full bg-indigo-600/20 blur-[100px]" />
        <div className="absolute -bottom-40 -right-20 w-[44rem] h-[44rem] rounded-full bg-blue-600/15 blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-violet-600/10 blur-[80px]" />
      </div>

      {/* Nav */}
      <header className="relative z-10 border-b border-white/8 glass-strong">
        <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
          <Link href="/" className="text-xl font-black tracking-tighter text-white hover:text-indigo-300 transition-colors">
            Klaro
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-4 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/8 transition-all"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white btn-glow transition-all"
            >
              Get started →
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 relative z-10">{children}</main>

      <footer className="relative z-10 border-t border-white/8">
        <div className="container max-w-5xl mx-auto px-4 flex h-14 items-center justify-between text-xs text-white/30">
          <span>© {new Date().getFullYear()} Klaro</span>
          <span>🇹🇳 Made for Tunisia</span>
        </div>
      </footer>
    </div>
  );
}
