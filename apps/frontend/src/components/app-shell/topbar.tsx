'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Props {
  email?: string | null;
}

export function Topbar({ email }: Props) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between px-4 border-b border-white/8 glass-strong lg:pl-6">
      {/* Mobile logo */}
      <span className="lg:hidden text-lg font-black tracking-tighter text-white">Klaro</span>

      {/* Email — desktop only */}
      <div className="hidden lg:block text-sm text-white/40 font-mono">{email}</div>

      <button
        onClick={signOut}
        className="flex items-center gap-1.5 glass rounded-xl px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-all"
      >
        <span>Sign out</span>
        <span>👋</span>
      </button>
    </header>
  );
}
