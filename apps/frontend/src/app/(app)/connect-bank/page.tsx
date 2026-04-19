'use client';

import Link from 'next/link';
import { useState, useRef, useCallback, useEffect } from 'react';
import { API_ENDPOINTS, TUNISIAN_BANKS } from '@klaro/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';

type JobStatus = 'idle' | 'queued' | 'running' | 'otp_required' | 'success' | 'failed' | 'error';

interface BankState {
  status: JobStatus;
  jobId?: string;
  error?: string;
}

/** Banks that use OTP-based login (Playwright flow with mid-session pause). */
const OTP_BANKS = new Set(['ubci']);

const POLL_INTERVAL_MS = 2_000;
const STORAGE_KEY = 'klaro:connected-banks';

/** Read the set of bank IDs that were previously connected from localStorage. */
function loadConnectedBanks(): Record<string, BankState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Persist only the 'success' states so credentials/job data never reach disk. */
function saveConnectedBanks(states: Record<string, BankState>) {
  try {
    const toSave: Record<string, BankState> = {};
    for (const [id, state] of Object.entries(states)) {
      if (state.status === 'success') toSave[id] = { status: 'success' };
    }
    if (Object.keys(toSave).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable — fail silently
  }
}

export default function ConnectBankPage() {
  // Start empty on both server and client to avoid SSR/hydration mismatch.
  // localStorage is read in a useEffect (client-only) after first render.
  const [bankStates, setBankStates] = useState<Record<string, BankState>>({});

  // Inline-expand state for non-OTP banks
  const [openInline, setOpenInline] = useState<string | null>(null);

  // Modal state for OTP banks (e.g. UBCI)
  const [modalBank, setModalBank] = useState<string | null>(null);
  const [modalStep, setModalStep] = useState<'credentials' | 'otp'>('credentials');

  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [otp, setOtp] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from localStorage once on mount (client-only)
  useEffect(() => {
    const saved = loadConnectedBanks();
    if (Object.keys(saved).length > 0) {
      setBankStates(saved);
    }
  }, []);

  // Persist successful connections to localStorage whenever states change
  useEffect(() => {
    saveConnectedBanks(bankStates);
  }, [bankStates]);

  function setBank(bankId: string, state: Partial<BankState>) {
    setBankStates((prev) => ({ ...prev, [bankId]: { ...prev[bankId], status: 'idle', ...state } }));
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (bankId: string, jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const { status, error } = await api.get<{ jobId: string; status: string; error?: string }>(
            API_ENDPOINTS.scrape.status(jobId),
          );

          if (status === 'otp_required') {
            setBank(bankId, { status: 'otp_required', jobId });
            setModalStep('otp');
            // Keep modal open – don't stop polling yet
          } else if (status === 'success') {
            setBank(bankId, { status: 'success', jobId });
            stopPolling();
            setModalBank(null);
          } else if (status === 'failed') {
            setBank(bankId, { status: 'failed', jobId, error: error ?? 'Connection failed' });
            stopPolling();
            setModalBank(null);
          }
          // 'queued' / 'running' → keep polling
        } catch {
          // Network blip – keep polling
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  // ── Non-OTP banks (inline form) ────────────────────────────────────────────

  async function handleConnect(bankId: string, bankName: string) {
    if (!credentials.username || !credentials.password) return;
    setBank(bankId, { status: 'queued', error: undefined });
    setOpenInline(null);
    try {
      const { jobId } = await api.post<{ jobId: string; status: string }>(
        API_ENDPOINTS.scrape.start,
        {
          bankName: bankId,
          connectionMethod: 'scraping',
          encryptedCredentials: JSON.stringify(credentials),
        },
      );
      setBank(bankId, { status: 'queued', jobId });
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string } }).body;
      setBank(bankId, { status: 'error', error: body?.error ?? 'Connection failed' });
    } finally {
      setCredentials({ username: '', password: '' });
    }
  }

  // ── OTP banks (modal flow) ─────────────────────────────────────────────────

  async function handleOtpBankConnect(bankId: string) {
    if (!credentials.username || !credentials.password) return;
    setBank(bankId, { status: 'queued', error: undefined });
    try {
      const { jobId } = await api.post<{ jobId: string; status: string }>(
        API_ENDPOINTS.scrape.start,
        {
          bankName: bankId,
          connectionMethod: 'scraping',
          encryptedCredentials: JSON.stringify(credentials),
        },
      );
      setBank(bankId, { status: 'running', jobId });
      startPolling(bankId, jobId);
      // Keep modal open – it will transition to OTP step when polling detects otp_required
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string } }).body;
      setBank(bankId, { status: 'error', error: body?.error ?? 'Connection failed' });
      setModalBank(null);
    } finally {
      setCredentials({ username: '', password: '' });
    }
  }

  async function handleOtpSubmit(bankId: string) {
    if (!otp.trim()) return;
    const jobId = bankStates[bankId]?.jobId;
    if (!jobId) return;
    try {
      await api.post<{ jobId: string; status: string }>(
        API_ENDPOINTS.scrape.submitOtp(jobId),
        { otp: otp.trim() },
      );
      setBank(bankId, { status: 'running', jobId });
      setOtp('');
      // Polling continues – will detect 'success' or 'failed'
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string } }).body;
      setBank(bankId, { status: 'error', error: body?.error ?? 'Invalid OTP' });
      setModalBank(null);
      stopPolling();
    }
  }

  function openOtpModal(bankId: string) {
    setModalBank(bankId);
    setModalStep('credentials');
    setCredentials({ username: '', password: '' });
    setOtp('');
  }

  function closeOtpModal() {
    setModalBank(null);
    setCredentials({ username: '', password: '' });
    setOtp('');
    stopPolling();
  }

  function disconnect(bankId: string) {
    setBankStates((prev) => {
      const next = { ...prev };
      delete next[bankId];
      return next;
    });
  }

  // ── Derived helpers ────────────────────────────────────────────────────────

  function statusLabel(status: JobStatus | undefined) {
    switch (status) {
      case 'queued':
      case 'running':
        return 'Connecting…';
      case 'otp_required':
        return 'Waiting for OTP…';
      case 'success':
        return '✓ Connected';
      case 'failed':
      case 'error':
        return null; // shown via error message
      default:
        return null;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect your bank</h1>
        <p className="text-sm text-muted-foreground">
          Pick your bank to fetch your transaction history. Credentials are encrypted in your
          browser before leaving your device.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TUNISIAN_BANKS.map((bank) => {
          const state = bankStates[bank.id];
          const isOtpBank = OTP_BANKS.has(bank.id);
          const busy = state?.status === 'queued' || state?.status === 'running' || state?.status === 'otp_required';

          return (
            <Card key={bank.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{bank.shortName}</span>
                  {!bank.supported && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      Coming soon
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{bank.name}</p>

                {/* Inline credential form – non-OTP banks only */}
                {!isOtpBank && openInline === bank.id && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Input
                      placeholder="Username / ID"
                      value={credentials.username}
                      onChange={(e) => setCredentials((c) => ({ ...c, username: e.target.value }))}
                      autoComplete="username"
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={credentials.password}
                      onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
                      autoComplete="current-password"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleConnect(bank.id, bank.shortName)}
                        disabled={!credentials.username || !credentials.password}
                      >
                        Connect
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setOpenInline(null);
                          setCredentials({ username: '', password: '' });
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Status messages */}
                {busy && !isOtpBank && (
                  <p className="text-xs text-muted-foreground">
                    {statusLabel(state?.status)}{state?.jobId ? ` (${state.jobId.slice(0, 8)}…)` : ''}
                  </p>
                )}
                {state?.status === 'success' && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-green-500">✓ Connected</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => disconnect(bank.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                )}
                {(state?.status === 'error' || state?.status === 'failed') && (
                  <p className="text-xs text-destructive">{state.error}</p>
                )}

                {/* Connect / Notify me button */}
                {openInline !== bank.id && !busy && state?.status !== 'success' && (
                  <Button
                    disabled={!bank.supported}
                    variant={bank.supported ? 'default' : 'outline'}
                    onClick={() => {
                      if (!bank.supported) return;
                      if (isOtpBank) {
                        openOtpModal(bank.id);
                      } else {
                        setOpenInline(bank.id);
                      }
                    }}
                  >
                    {bank.supported ? 'Connect' : 'Notify me'}
                  </Button>
                )}

                {/* OTP bank – show status inline too */}
                {isOtpBank && busy && (
                  <p className="text-xs text-muted-foreground">
                    {statusLabel(state?.status)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── UBCI (OTP-bank) modal ──────────────────────────────────────────── */}
      {modalBank && OTP_BANKS.has(modalBank) && (() => {
        const bank = TUNISIAN_BANKS.find((b) => b.id === modalBank)!;
        const state = bankStates[modalBank];
        const submitting = state?.status === 'running' || state?.status === 'queued';

        return (
          <Dialog open onOpenChange={(open) => { if (!open) closeOtpModal(); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Connect to {bank.shortName}</DialogTitle>
                <DialogDescription>
                  {modalStep === 'credentials'
                    ? 'Enter your online banking credentials. They are used only to connect and are never stored.'
                    : 'A one-time code has been sent to your registered phone or email. Enter it below to continue.'}
                </DialogDescription>
              </DialogHeader>

              {modalStep === 'credentials' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ubci-username">Identifiant Utilisateur</Label>
                    <Input
                      id="ubci-username"
                      placeholder="Identifiant Utilisateur"
                      value={credentials.username}
                      onChange={(e) => setCredentials((c) => ({ ...c, username: e.target.value }))}
                      autoComplete="username"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ubci-password">Mot de passe</Label>
                    <Input
                      id="ubci-password"
                      type="password"
                      placeholder="Mot de passe"
                      value={credentials.password}
                      onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
                      autoComplete="current-password"
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}

              {modalStep === 'otp' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ubci-otp">Code de vérification (OTP)</Label>
                    <Input
                      id="ubci-otp"
                      placeholder="••••••"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={10}
                      disabled={submitting}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Check your SMS or email for the code sent by UBCI.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={closeOtpModal} disabled={submitting}>
                  Cancel
                </Button>

                {modalStep === 'credentials' && (
                  <Button
                    onClick={() => handleOtpBankConnect(modalBank)}
                    disabled={!credentials.username || !credentials.password || submitting}
                  >
                    {submitting ? 'Connecting…' : 'Connect'}
                  </Button>
                )}

                {modalStep === 'otp' && (
                  <Button
                    onClick={() => handleOtpSubmit(modalBank)}
                    disabled={!otp.trim() || submitting}
                  >
                    {submitting ? 'Verifying…' : 'Verify'}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      <Card>
        <CardHeader>
          <CardTitle>Prefer to upload statements?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Upload PDF statements, images, CSV exports, or payslips. Each file goes through
            deepfake detection, authenticity checks, and cross-consistency verification before
            transactions are imported.
          </p>
          <Link href="/documents">
            <Button variant="outline">Upload statement</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
