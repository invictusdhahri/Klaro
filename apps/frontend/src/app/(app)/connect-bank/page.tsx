'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_ENDPOINTS, TUNISIAN_BANKS } from '@klaro/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

type JobStatus = 'idle' | 'queued' | 'error';

interface BankState {
  status: JobStatus;
  jobId?: string;
  error?: string;
}

export default function ConnectBankPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fromOnboarding = searchParams.get('from') === 'onboarding';

  const [bankStates, setBankStates] = useState<Record<string, BankState>>({});
  const [openDialog, setOpenDialog] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [anyQueued, setAnyQueued] = useState(false);

  function setBank(bankId: string, state: Partial<BankState>) {
    setBankStates((prev) => ({ ...prev, [bankId]: { ...prev[bankId], status: 'idle', ...state } }));
  }

  async function handleConnect(bankId: string, bankName: string) {
    if (!credentials.username || !credentials.password) return;
    setBank(bankId, { status: 'queued', error: undefined });
    setOpenDialog(null);
    try {
      const { jobId } = await api.post<{ jobId: string; status: string }>(
        API_ENDPOINTS.scrape.start,
        {
          bankName,
          connectionMethod: 'scraping',
          encryptedCredentials: JSON.stringify(credentials),
        },
      );
      setBank(bankId, { status: 'queued', jobId });
      setAnyQueued(true);
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string } }).body;
      setBank(bankId, { status: 'error', error: body?.error ?? 'Connection failed' });
    } finally {
      setCredentials({ username: '', password: '' });
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Post-connect continue CTA */}
      {fromOnboarding && anyQueued && (
        <div className="glass-card-strong p-4 flex items-center gap-3 border border-green-500/25">
          <span className="text-2xl shrink-0">✅</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm">Bank connection queued!</p>
            <p className="text-xs text-white/45">We&apos;re syncing your data in the background</p>
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white btn-glow transition-all"
          >
            Continue →
          </button>
        </div>
      )}

      {/* Header */}
      <div className="text-center space-y-1 py-2">
        <div className="text-5xl mb-2">🏦</div>
        <h1 className="text-xl font-bold text-white">Connect your bank</h1>
        <p className="text-sm text-white/40">
          Encrypted in your browser before sending 🔒
        </p>
      </div>

      {/* Bank grid */}
      <div className="space-y-3">
        {TUNISIAN_BANKS.map((bank) => {
          const state = bankStates[bank.id];
          const isOpen = openDialog === bank.id;
          const queued = state?.status === 'queued';

          return (
            <div
              key={bank.id}
              className={`glass-card p-4 transition-all ${queued ? 'border-green-500/30' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-white/8 flex items-center justify-center text-xl font-bold text-white/60 shrink-0">
                  {bank.shortName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white text-sm truncate">{bank.shortName}</p>
                    {!bank.supported && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide bg-white/8 text-white/40 px-1.5 py-0.5 rounded-full shrink-0">
                        Soon
                      </span>
                    )}
                    {queued && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full shrink-0">
                        ✓ Queued
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/35 truncate">{bank.name}</p>
                </div>

                {!isOpen && !queued && (
                  <button
                    disabled={!bank.supported}
                    onClick={() => bank.supported && setOpenDialog(bank.id)}
                    className={`shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                      bank.supported
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white btn-glow'
                        : 'bg-white/5 text-white/25 cursor-not-allowed'
                    }`}
                  >
                    {bank.supported ? 'Connect' : 'Soon'}
                  </button>
                )}
              </div>

              {/* Inline credential form */}
              {isOpen && (
                <div className="mt-4 pt-4 border-t border-white/8 space-y-3">
                  <Input
                    placeholder="Username / ID"
                    value={credentials.username}
                    onChange={(e) => setCredentials((c) => ({ ...c, username: e.target.value }))}
                    autoComplete="username"
                    className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 h-11 rounded-xl"
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={credentials.password}
                    onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
                    autoComplete="current-password"
                    className="glass border-white/10 bg-white/5 text-white placeholder:text-white/25 h-11 rounded-xl"
                  />
                  {state?.status === 'error' && (
                    <p className="text-xs text-red-400">⚠️ {state.error}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white btn-glow"
                      onClick={() => handleConnect(bank.id, bank.shortName)}
                      disabled={!credentials.username || !credentials.password}
                    >
                      Connect 🔗
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-11 rounded-xl text-white/50 hover:text-white hover:bg-white/8"
                      onClick={() => {
                        setOpenDialog(null);
                        setCredentials({ username: '', password: '' });
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Prefer documents */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📄</span>
          <div>
            <p className="font-semibold text-white text-sm">Prefer to upload statements?</p>
            <p className="text-xs text-white/40">PDFs, images, CSVs — all verified 🔍</p>
          </div>
        </div>
        <Link href="/documents">
          <button className="w-full h-11 rounded-xl glass border-white/15 text-white/70 hover:text-white hover:bg-white/10 text-sm font-medium transition-all">
            Upload documents →
          </button>
        </Link>
      </div>
    </div>
  );
}
