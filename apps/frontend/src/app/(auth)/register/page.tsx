'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Check your email to confirm your account ✉️');
    router.push('/login');
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center space-y-2">
        <div className="text-5xl mb-1">👋</div>
        <h1 className="text-2xl font-bold text-white">Welcome to Klaro</h1>
        <p className="text-sm text-white/50">
          Build your alternative credit profile 📊
        </p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="full_name" className="text-white/70 text-xs font-medium uppercase tracking-wider">
            Full name
          </Label>
          <Input
            id="full_name"
            autoComplete="name"
            required
            placeholder="Amen Dhahri"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
          />
        </div>
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
            autoComplete="new-password"
            minLength={8}
            required
            placeholder="Min. 8 characters"
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
          {busy ? 'Creating account…' : 'Create account 🚀'}
        </Button>
      </form>

      <p className="text-center text-sm text-white/40">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  );
}
