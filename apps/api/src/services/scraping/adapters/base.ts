import type { Transaction } from '@klaro/shared';

export interface BankCredentials {
  username: string;
  password: string;
  otp?: string;
}

export interface BankBalance {
  accountId: string;
  amount: number;
  currency: string;
  asOf: string;
}

export interface BankAdapter {
  bankId: string;
  bankName: string;
  /**
   * Authenticate against the bank portal.
   * Implementations must avoid logging credentials.
   */
  login(credentials: BankCredentials): Promise<void>;
  extractTransactions(): Promise<Omit<Transaction, 'id' | 'userId' | 'createdAt'>[]>;
  extractBalances(): Promise<BankBalance[]>;
  logout(): Promise<void>;
}
