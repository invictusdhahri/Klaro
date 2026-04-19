import { BANK_BY_ID } from '@klaro/shared';
import type { BankAdapter, BankCredentials } from './adapters/base';
import { AttijariAdapter } from './adapters/attijari';
import { StbAdapter } from './adapters/stb';
import { BiatAdapter } from './adapters/biat';
import { UbciAdapter } from './adapters/ubci';
import { logger } from '../../lib/logger';
import { computeAndPersistScore } from '../score.service';
import { supabaseAdmin } from '../supabase';
import { bankIdForSlug } from '../bank.resolver';

const REGISTRY: Record<string, () => BankAdapter> = {
  attijari: () => new AttijariAdapter(),
  stb: () => new StbAdapter(),
  biat: () => new BiatAdapter(),
  ubci: () => new UbciAdapter(),
};

// ---------------------------------------------------------------------------
// In-memory job store (single-process; swap for Redis/DB in production)
// ---------------------------------------------------------------------------

export type ScrapeStatus = 'queued' | 'running' | 'otp_required' | 'success' | 'failed';

export interface ScrapeJob {
  jobId: string;
  bankId: string;
  userId: string;
  startedAt: number;
  status: ScrapeStatus;
  error?: string;
  /** DB row id for the bank_connections record, set once inserted. */
  bankConnectionId?: string;
  /** Resolves the suspended OTP promise so the Playwright session can continue. */
  otpResolver?: (otp: string) => void;
}

const jobStore = new Map<string, ScrapeJob>();

export function getJob(jobId: string): ScrapeJob | undefined {
  return jobStore.get(jobId);
}

/**
 * Provide the OTP for a waiting job.
 * Returns false if the job is not found or not in otp_required state.
 */
export function submitJobOtp(jobId: string, otp: string): boolean {
  const job = jobStore.get(jobId);
  if (!job || job.status !== 'otp_required' || !job.otpResolver) return false;
  job.otpResolver(otp);
  job.otpResolver = undefined;
  return true;
}

// ---------------------------------------------------------------------------
// bank_connections helpers
// ---------------------------------------------------------------------------

async function upsertBankConnection(
  userId: string,
  bankId: string,
  syncStatus: 'syncing' | 'success' | 'failed',
  existingId?: string,
): Promise<string | undefined> {
  if (existingId) {
    await supabaseAdmin
      .from('bank_connections')
      .update({
        sync_status: syncStatus,
        ...(syncStatus === 'success' ? { last_sync_at: new Date().toISOString() } : {}),
      })
      .eq('id', existingId);
    return existingId;
  }

  // Check for an existing row for this user + bank first
  const { data: existing } = await supabaseAdmin
    .from('bank_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('bank_name', bankId)
    .maybeSingle();

  if (existing?.id) {
    await supabaseAdmin
      .from('bank_connections')
      .update({
        sync_status: syncStatus,
        ...(syncStatus === 'success' ? { last_sync_at: new Date().toISOString() } : {}),
      })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data: inserted } = await supabaseAdmin
    .from('bank_connections')
    .insert({
      user_id: userId,
      bank_name: bankId,
      connection_method: 'scraping',
      sync_status: syncStatus,
      ...(syncStatus === 'success' ? { last_sync_at: new Date().toISOString() } : {}),
    })
    .select('id')
    .single();

  return inserted?.id;
}

// ---------------------------------------------------------------------------
// Scrape runner
// ---------------------------------------------------------------------------

export async function runScrape(
  userId: string,
  bankId: string,
  credentials: BankCredentials,
): Promise<{ transactions: number; balances: number }> {
  const factory = REGISTRY[bankId];
  if (!factory) throw new Error(`Unsupported bank: ${bankId}`);

  const adapter = factory();
  const log = logger.child({ scope: 'scrape', userId, bankId });

  log.info('starting scrape');
  await adapter.login(credentials);
  try {
    const [tx, balances] = await Promise.all([
      adapter.extractTransactions(),
      adapter.extractBalances(),
    ]);
    log.info({ tx: tx.length, balances: balances.length }, 'scrape complete');

    // Persist a bank_connections row so the bank can see this user via
    // their dashboard (and so future statement uploads inherit the bank_id).
    // bankId here is the scraping adapter slug (e.g. 'ubci') which matches
    // banks.slug — see migration 0013_seed_banks.sql.
    const resolvedBankId = await bankIdForSlug(bankId);
    const bankInfo = BANK_BY_ID[bankId];
    const { error: connErr } = await supabaseAdmin
      .from('bank_connections')
      .upsert(
        {
          user_id: userId,
          bank_id: resolvedBankId,
          bank_name: bankInfo?.name ?? bankId,
          connection_method: 'scraping',
          last_sync_at: new Date().toISOString(),
          sync_status: 'success',
          account_count: balances.length,
        },
        { onConflict: 'user_id, bank_id' },
      );
    if (connErr) {
      log.warn({ err: connErr }, 'bank_connections upsert failed');
    }

    // Auto-trigger score recalculation after successful sync (non-blocking)
    computeAndPersistScore(userId).catch((err) =>
      log.warn({ err }, 'auto-score after bank sync failed'),
    );

    return { transactions: tx.length, balances: balances.length };
  } finally {
    await adapter.logout().catch((e) => log.warn({ err: e }, 'logout failed'));
    // Wipe sensitive credentials from memory
    credentials.username = '';
    credentials.password = '';
    if (credentials.otp) credentials.otp = '';
  }
}

/**
 * Start a scrape job asynchronously, handling the OTP pause/resume cycle.
 * Returns the jobId immediately; callers poll getJob() for status updates.
 */
export function startScrapeJob(userId: string, bankId: string, credentials: BankCredentials): string {
  const jobId = crypto.randomUUID();
  const job: ScrapeJob = { jobId, bankId, userId, startedAt: Date.now(), status: 'queued' };
  jobStore.set(jobId, job);

  // Inject OTP provider if the bank may require it
  const otpAwareCredentials: BankCredentials = {
    ...credentials,
    userId,
    otpProvider: () =>
      new Promise<string>((resolve) => {
        job.status = 'otp_required';
        job.otpResolver = resolve;
      }),
  };

  // Run asynchronously – do not await
  (async () => {
    job.status = 'running';

    // Record the connection attempt in the DB immediately
    try {
      job.bankConnectionId = await upsertBankConnection(userId, bankId, 'syncing');
    } catch (err) {
      logger.warn({ err, jobId, bankId }, 'bank_connections insert failed — continuing anyway');
    }

    try {
      await runScrape(userId, bankId, otpAwareCredentials);
      job.status = 'success';

      // Mark connection as successful in the DB
      await upsertBankConnection(userId, bankId, 'success', job.bankConnectionId).catch((err) =>
        logger.warn({ err, jobId }, 'bank_connections success update failed'),
      );
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId, bankId }, 'scrape job failed');

      // Mark connection as failed in the DB
      await upsertBankConnection(userId, bankId, 'failed', job.bankConnectionId).catch((e) =>
        logger.warn({ err: e, jobId }, 'bank_connections failed update failed'),
      );
    }
  })();

  return jobId;
}

export function isBankSupported(bankId: string): boolean {
  const info = BANK_BY_ID[bankId];
  return Boolean(info?.supported && bankId in REGISTRY);
}
