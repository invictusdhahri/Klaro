'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-white/70 text-xs font-medium uppercase tracking-wider">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-white/70 text-xs font-medium uppercase tracking-wider">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
        />
      </div>
      <Button
        type="submit"
        className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold btn-glow transition-all"
        disabled={busy}
      >
        {busy ? 'Signing in…' : 'Sign in ✨'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center space-y-2">
        <div className="text-5xl mb-1">🔐</div>
        <h1 className="text-2xl font-bold text-white">Welcome back</h1>
        <p className="text-sm text-white/50">Sign in to your Klaro account</p>
      </div>

      <Suspense fallback={<div className="text-sm text-white/40">Loading…</div>}>
        <LoginForm />
      </Suspense>

      <p className="text-center text-sm text-white/40">
        Don&rsquo;t have an account?{' '}
        <Link href="/register" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
          Create one
        </Link>
      </p>
    </div>
  );
}
