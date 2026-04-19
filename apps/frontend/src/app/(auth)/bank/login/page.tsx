'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

function BankLoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/bank';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const role = data.user?.app_metadata?.role as string | undefined;
    if (role !== 'bank' && role !== 'admin') {
      await supabase.auth.signOut();
      toast.error('This login is for bank accounts only. Use the regular sign-in for personal accounts.');
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <Label
          htmlFor="email"
          className="text-white/70 text-xs font-medium uppercase tracking-wider"
        >
          Work email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="admin@yourbank.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-sky-500/50 focus:ring-sky-500/20 h-12 rounded-xl"
        />
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="password"
          className="text-white/70 text-xs font-medium uppercase tracking-wider"
        >
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
          className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-sky-500/50 focus:ring-sky-500/20 h-12 rounded-xl"
        />
      </div>

      <Button
        type="submit"
        className="w-full h-12 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-all shadow-lg shadow-sky-600/20"
        disabled={busy}
      >
        {busy ? 'Signing in…' : 'Access bank portal'}
      </Button>
    </form>
  );
}

export default function BankLoginPage() {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-600/20 text-3xl mb-1">
          🏦
        </div>
        <h1 className="text-2xl font-bold text-white">Bank portal</h1>
        <p className="text-sm text-white/50">
          Sign in to access your institution&apos;s Klaro dashboard
        </p>
      </div>

      <Suspense fallback={<div className="text-sm text-white/40">Loading…</div>}>
        <BankLoginForm />
      </Suspense>

      <div className="space-y-3 pt-1">
        <p className="text-center text-xs text-white/30">
          Not registered yet?{' '}
          <Link
            href="/bank/register"
            className="text-sky-400/90 hover:text-sky-300 font-medium transition-colors"
          >
            Register your bank
          </Link>
        </p>

        <p className="text-center text-xs text-white/20">
          Personal account?{' '}
          <Link
            href="/login"
            className="text-white/40 hover:text-white/60 transition-colors"
          >
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}
