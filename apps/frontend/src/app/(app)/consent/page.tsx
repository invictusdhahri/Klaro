'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@klaro/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Bank {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  country: string;
}

interface ConsentRow {
  id: string;
  bank_id: string;
  consent_granted: boolean;
  consent_scope: string[];
  granted_at: string | null;
  revoked_at: string | null;
  banks: { slug: string; name: string; logo_url: string | null };
}

const SCOPES = [
  { id: 'score', label: 'Credit score', description: 'Your overall Klaro credit score and band.' },
  { id: 'breakdown', label: 'Score breakdown', description: 'Detailed sub-scores (income, behaviour…).' },
  { id: 'transactions', label: 'Transactions', description: 'Your extracted bank transactions.' },
  { id: 'full_profile', label: 'Full profile', description: 'KYC status and occupation category.' },
] as const;

type ScopeId = (typeof SCOPES)[number]['id'];

// ---------------------------------------------------------------------------

function BankLogo({ name, logoUrl }: { name: string; logoUrl: string | null | undefined }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={name}
      className="h-10 w-10 rounded object-contain bg-muted"
    />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-primary/10 text-sm font-bold text-primary">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ScopeToggle({
  scope,
  checked,
  onChange,
}: {
  scope: (typeof SCOPES)[number];
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40 transition-colors">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <p className="text-sm font-medium leading-tight">{scope.label}</p>
        <p className="text-xs text-muted-foreground">{scope.description}</p>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------

function ConsentModal({
  bank,
  existing,
  onClose,
  onSaved,
}: {
  bank: Bank;
  existing: ConsentRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultScopes: ScopeId[] = existing?.consent_granted
    ? (existing.consent_scope as ScopeId[])
    : ['score'];
  const [scopes, setScopes] = useState<Set<ScopeId>>(new Set(defaultScopes));
  const [saving, setSaving] = useState(false);

  function toggle(id: ScopeId, on: boolean) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function grant() {
    if (scopes.size === 0) {
      toast.error('Select at least one scope to share');
      return;
    }
    setSaving(true);
    try {
      await api.post(API_ENDPOINTS.me.bankConsent, {
        bankId: bank.id,
        consentGranted: true,
        consentScope: [...scopes],
      });
      toast.success(`Access granted to ${bank.name}`);
      onSaved();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Failed to grant consent');
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    try {
      await api.post(API_ENDPOINTS.me.bankConsent, {
        bankId: bank.id,
        consentGranted: false,
        consentScope: [],
      });
      toast.success(`Access revoked from ${bank.name}`);
      onSaved();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Failed to revoke consent');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-md rounded-xl border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <BankLogo name={bank.name} logoUrl={bank.logoUrl} />
          <div>
            <h2 className="font-semibold">{bank.name}</h2>
            <p className="text-xs text-muted-foreground">Choose what you share with this bank</p>
          </div>
        </div>

        <div className="space-y-2 p-5">
          {SCOPES.map((s) => (
            <ScopeToggle
              key={s.id}
              scope={s}
              checked={scopes.has(s.id)}
              onChange={(v) => toggle(s.id, v)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4">
          {existing?.consent_granted ? (
            <Button variant="destructive" size="sm" onClick={revoke} disabled={saving}>
              {saving ? 'Revoking…' : 'Revoke access'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={grant} disabled={saving}>
              {saving ? 'Saving…' : existing?.consent_granted ? 'Update access' : 'Grant access'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ConsentPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Bank | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [banksRes, consentsRes] = await Promise.all([
        api.get<{ data: Bank[] }>(API_ENDPOINTS.banks.list),
        api.get<{ data: ConsentRow[] }>(API_ENDPOINTS.me.bankConsent),
      ]);
      setBanks(banksRes.data);
      setConsents(consentsRes.data);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function getConsent(bankId: string): ConsentRow | null {
    return consents.find((c) => c.bank_id === bankId) ?? null;
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-24" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      {banks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No banks have registered on Klaro yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <ActiveConsents consents={consents} banks={banks} onManage={setSelected} />
          <AllBanks banks={banks} consents={consents} onManage={setSelected} />
        </>
      )}

      {selected && (
        <ConsentModal
          bank={selected}
          existing={getConsent(selected.id)}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            setSelected(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Bank consent</h1>
      <p className="text-sm text-muted-foreground">
        Control which banks can access your Klaro data. You can revoke access at any time.
      </p>
    </div>
  );
}

function ActiveConsents({
  consents,
  banks,
  onManage,
}: {
  consents: ConsentRow[];
  banks: Bank[];
  onManage: (b: Bank) => void;
}) {
  const active = consents.filter((c) => c.consent_granted);
  if (active.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Active consents ({active.length})
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((c) => {
          const bank = banks.find((b) => b.id === c.bank_id);
          if (!bank) return null;
          return (
            <Card key={c.id} className="border-green-500/20 bg-green-500/5">
              <CardContent className="flex items-center gap-3 py-4">
                <BankLogo name={bank.name} logoUrl={bank.logoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{bank.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.consent_scope.length} scope{c.consent_scope.length !== 1 ? 's' : ''} shared
                  </p>
                  {c.granted_at && (
                    <p className="text-[11px] text-muted-foreground">
                      Since {new Date(c.granted_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => onManage(bank)}
                >
                  Manage
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function AllBanks({
  banks,
  consents,
  onManage,
}: {
  banks: Bank[];
  consents: ConsentRow[];
  onManage: (b: Bank) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Available banks
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {banks.map((bank) => {
          const consent = consents.find((c) => c.bank_id === bank.id);
          const granted = consent?.consent_granted ?? false;
          return (
            <Card
              key={bank.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => onManage(bank)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <BankLogo name={bank.name} logoUrl={bank.logoUrl} />
                  <div className="min-w-0">
                    <CardTitle className="text-sm leading-tight">{bank.name}</CardTitle>
                    <CardDescription className="text-[11px]">
                      {bank.slug} · {bank.country}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    granted
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${granted ? 'bg-green-500' : 'bg-muted-foreground/50'}`}
                  />
                  {granted ? 'Access granted' : 'No access'}
                </span>
                <Button size="sm" variant={granted ? 'outline' : 'default'}>
                  {granted ? 'Manage' : 'Grant access'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
