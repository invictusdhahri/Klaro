'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
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
        <Label htmlFor="email" className="mono text-[10.5px] tracking-[0.18em] uppercase text-white/55">
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
          className="h-11"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password" className="mono text-[10.5px] tracking-[0.18em] uppercase text-white/55">
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
          className="h-11"
        />
      </div>
      <Button type="submit" className="w-full h-11" disabled={busy}>
        {busy ? (
          <>
            <span className="mono">Signing in</span>
            <Dots />
          </>
        ) : (
          <>
            Sign in
            <span aria-hidden>→</span>
          </>
        )}
      </Button>
    </form>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5 ml-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full bg-current"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  );
}

export default function LoginPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }}
      className="hairline rounded-2xl bg-white/[0.025] p-8 space-y-6 backdrop-blur-sm"
    >
      <div className="space-y-2">
        <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-white/55">
          Sign in
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Welcome back.
        </h1>
        <p className="text-sm text-white/55">Pick up where you left off.</p>
      </div>

      <Suspense fallback={<div className="text-sm text-white/40 mono">Loading…</div>}>
        <LoginForm />
      </Suspense>

      <div className="hairline-t pt-4 text-center text-sm text-white/55">
        Don&rsquo;t have an account?{' '}
        <Link
          href="/register"
          className="text-white hover:underline underline-offset-4 font-medium"
        >
          Create one
        </Link>
      </div>

      <p className="text-center text-xs text-white/30">
        Are you a bank?{' '}
        <Link
          href="/bank/login"
          className="text-sky-400/80 hover:text-sky-300 font-medium transition-colors"
        >
          Bank portal
        </Link>
        {' · '}
        <Link
          href="/bank/register"
          className="text-sky-400/80 hover:text-sky-300 font-medium transition-colors"
        >
          Register
        </Link>
      </p>
    </motion.div>
  );
}
