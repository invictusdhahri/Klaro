import type { BankAdapter, BankCredentials } from './adapters/base';
import { AttijariAdapter } from './adapters/attijari';
import { StbAdapter } from './adapters/stb';
import { BiatAdapter } from './adapters/biat';
import { logger } from '@/lib/logger';

const REGISTRY: Record<string, () => BankAdapter> = {
  attijari: () => new AttijariAdapter(),
  stb: () => new StbAdapter(),
  biat: () => new BiatAdapter(),
};

export interface ScrapeJob {
  jobId: string;
  bankId: string;
  userId: string;
  startedAt: number;
}

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
    return { transactions: tx.length, balances: balances.length };
  } finally {
    await adapter.logout().catch((e) => log.warn({ err: e }, 'logout failed'));
    // Wipe sensitive credentials from memory.
    credentials.username = '';
    credentials.password = '';
    if (credentials.otp) credentials.otp = '';
  }
}

export function isBankSupported(bankId: string): boolean {
  return bankId in REGISTRY;
}
