'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';
import type { BankProfile } from '@klaro/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function BankSettingsPage() {
  const [profile, setProfile] = useState<BankProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const dirty = useRef(false);

  useEffect(() => {
    api
      .get<BankProfile>(API_ENDPOINTS.bank.me)
      .then((data) => {
        setProfile(data);
        setName(data.name);
        setLogoUrl(data.logoUrl ?? '');
      })
      .catch((err: Error) => toast.error(err.message ?? 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  function markDirty() {
    dirty.current = true;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.patch<BankProfile>(API_ENDPOINTS.bank.updateMe, {
        name: name.trim() || undefined,
        logoUrl: logoUrl.trim() || null,
      });
      setProfile(updated);
      dirty.current = false;
      toast.success('Profile updated');
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your bank portal configuration.</p>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your bank portal configuration.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: form */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Bank profile</CardTitle>
              <CardDescription>
                Displayed in the sidebar and visible to clients who have granted you consent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Bank name</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      markDirty();
                    }}
                    placeholder="Banque Internationale Arabe de Tunisie"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    readOnly
                    value={profile?.slug ?? ''}
                    className="cursor-not-allowed opacity-60"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Slug is immutable after registration.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    readOnly
                    value={profile?.country ?? ''}
                    className="cursor-not-allowed opacity-60"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="logo">Logo URL</Label>
                  <Input
                    id="logo"
                    type="url"
                    placeholder="https://…"
                    value={logoUrl}
                    onChange={(e) => {
                      setLogoUrl(e.target.value);
                      markDirty();
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Publicly-accessible image URL (PNG / SVG, square format recommended).
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Danger zone</CardTitle>
              <CardDescription>
                Contact Klaro support to delete or deactivate your bank portal.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Right: live preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Sidebar preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={name}
                    className="h-9 w-9 rounded object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = '';
                    }}
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary/10 text-sm font-bold text-primary">
                    {name.charAt(0).toUpperCase() || 'K'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold leading-tight">
                    {name || 'Bank name'}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Portal
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Bank details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">ID</dt>
                  <dd className="truncate font-mono text-xs">{profile?.id?.slice(0, 16)}…</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Slug</dt>
                  <dd className="font-medium">{profile?.slug}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Country</dt>
                  <dd className="font-medium">{profile?.country}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
