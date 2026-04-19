'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { API_ENDPOINTS } from '@klaro/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function BankRegisterPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [country, setCountry] = useState('TN');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const derivedSlug = useMemo(() => slugify(name), [name]);

  useEffect(() => {
    if (!slugTouched) setSlug(derivedSlug);
  }, [derivedSlug, slugTouched]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) {
      toast.error('Please choose a bank slug');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.bank.register}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          slug,
          name,
          logoUrl: logoUrl.trim() || undefined,
          country,
          admin: { email, password, fullName: adminName },
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      if (!res.ok) {
        toast.error(payload?.message ?? `Registration failed (${res.status})`);
        return;
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        toast.success('Bank registered. Please sign in.');
        router.push('/login');
        return;
      }
      toast.success(`Welcome, ${name} 🎉`);
      router.push('/bank');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="text-5xl mb-1">🏦</div>
        <h1 className="text-2xl font-bold text-white">Register your bank</h1>
        <p className="text-sm text-white/50">Spin up a Klaro portal for your institution</p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-white/70 text-xs font-medium uppercase tracking-wider">
            Bank name
          </Label>
          <Input
            id="name"
            required
            placeholder="Banque Internationale Arabe de Tunisie"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="slug" className="text-white/70 text-xs font-medium uppercase tracking-wider">
            Slug
          </Label>
          <Input
            id="slug"
            required
            placeholder="biat"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
          />
          <p className="text-[11px] text-white/40">Used internally and in URLs. Lowercase, dashes only.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="country" className="text-white/70 text-xs font-medium uppercase tracking-wider">
              Country
            </Label>
            <Input
              id="country"
              required
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logo" className="text-white/70 text-xs font-medium uppercase tracking-wider">
              Logo URL
            </Label>
            <Input
              id="logo"
              type="url"
              placeholder="https://…"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
            />
          </div>
        </div>

        <div className="border-t border-white/10 pt-4 space-y-4">
          <p className="text-[11px] uppercase tracking-wider text-white/40">Administrator account</p>
          <div className="space-y-1.5">
            <Label htmlFor="admin_name" className="text-white/70 text-xs font-medium uppercase tracking-wider">
              Full name
            </Label>
            <Input
              id="admin_name"
              autoComplete="name"
              required
              placeholder="Sami Ben Salem"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-indigo-500/50 focus:ring-indigo-500/20 h-12 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-white/70 text-xs font-medium uppercase tracking-wider">
              Work email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="admin@biat.com.tn"
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
        </div>

        <Button
          type="submit"
          className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold btn-glow transition-all"
          disabled={busy}
        >
          {busy ? 'Registering bank…' : 'Create bank portal 🚀'}
        </Button>
      </form>

      <p className="text-center text-sm text-white/40">
        Already have a bank account?{' '}
        <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  );
}
