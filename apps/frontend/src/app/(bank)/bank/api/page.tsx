'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';
import type { BankApiKey, BankApiKeyCreated, BankApiKeyScope } from '@klaro/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const ALL_SCOPES: { value: BankApiKeyScope; label: string; hint: string }[] = [
  { value: 'read:clients', label: 'read:clients', hint: 'List & read consented users' },
  { value: 'read:scores', label: 'read:scores', hint: 'Read latest credit score & breakdown' },
  { value: 'read:transactions', label: 'read:transactions', hint: 'Read transactions' },
  { value: 'read:statements', label: 'read:statements', hint: 'List bank statement uploads' },
];

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString();
}

export default function BankApiKeysPage() {
  const [keys, setKeys] = useState<BankApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<BankApiKeyCreated | null>(null);

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<BankApiKeyScope[]>(ALL_SCOPES.map((s) => s.value));

  async function load() {
    try {
      const res = await api.get<{ data: BankApiKey[] }>(API_ENDPOINTS.bank.apiKeys);
      setKeys(res.data);
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleScope(scope: BankApiKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (scopes.length === 0) {
      toast.error('Select at least one scope');
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<BankApiKeyCreated>(API_ENDPOINTS.bank.apiKeys, {
        name: name.trim(),
        scopes,
      });
      setRevealKey(created);
      setCreateOpen(false);
      setName('');
      setScopes(ALL_SCOPES.map((s) => s.value));
      void load();
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('Revoke this key? Existing requests using it will fail immediately.')) {
      return;
    }
    try {
      await api.delete(API_ENDPOINTS.bank.apiKey(id));
      toast.success('API key revoked');
      void load();
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to revoke key');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Long-lived secret keys for your bank&apos;s back-office systems to query the Klaro API.{' '}
            <Link href="/bank/api/docs" className="text-primary hover:underline">
              View documentation →
            </Link>
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Create new key</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active keys</CardTitle>
          <CardDescription>
            Keys are shown to you exactly once at creation. Treat them like a password — never check
            them into source control or share them in a chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No API keys yet.</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                Create your first key
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Key</th>
                    <th className="pb-2 font-medium">Scopes</th>
                    <th className="pb-2 font-medium">Last used</th>
                    <th className="pb-2 font-medium">Created</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {keys.map((k) => (
                    <tr key={k.id} className="hover:bg-muted/30">
                      <td className="py-3 font-medium">{k.name}</td>
                      <td className="py-3 font-mono text-xs text-muted-foreground">
                        {k.keyPrefix}…
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span
                              key={s}
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDateTime(k.lastUsedAt)}</td>
                      <td className="py-3 text-muted-foreground">{formatDateTime(k.createdAt)}</td>
                      <td className="py-3">
                        {k.revokedAt ? (
                          <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                            Revoked
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {!k.revokedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => handleRevoke(k.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new API key</DialogTitle>
            <DialogDescription>
              Pick a memorable name (the system that will use it) and the scopes it should have.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                required
                maxLength={80}
                value={name}
                placeholder="Production loan-origination system"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="space-y-1.5 rounded-md border p-3">
                {ALL_SCOPES.map((s) => (
                  <label
                    key={s.value}
                    className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={scopes.includes(s.value)}
                      onChange={() => toggleScope(s.value)}
                    />
                    <span className="flex-1">
                      <span className="font-mono text-xs">{s.label}</span>
                      <span className="block text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !name.trim() || scopes.length === 0}>
                {creating ? 'Creating…' : 'Create key'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* One-shot reveal dialog */}
      <Dialog
        open={revealKey !== null}
        onOpenChange={(open) => {
          if (!open) setRevealKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your new API key</DialogTitle>
            <DialogDescription>
              This is the only time the key will be shown. Copy it now and store it in your secret
              manager — you won&apos;t be able to recover it later.
            </DialogDescription>
          </DialogHeader>

          {revealKey && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted p-3">
                <p className="break-all font-mono text-sm">{revealKey.plaintextKey}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={async () => {
                  await navigator.clipboard.writeText(revealKey.plaintextKey);
                  toast.success('Copied to clipboard');
                }}
              >
                Copy to clipboard
              </Button>
              <p className="text-xs text-muted-foreground">
                Use it as the <code className="rounded bg-muted px-1">X-API-Key</code> request
                header. See{' '}
                <Link href="/bank/api/docs" className="text-primary hover:underline">
                  the docs
                </Link>{' '}
                for full examples.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setRevealKey(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
