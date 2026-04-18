export type BankConnectionMethod = 'scraping' | 'manual_upload';

export type BankSyncStatus = 'pending' | 'syncing' | 'success' | 'failed';

export interface BankConnection {
  id: string;
  userId: string;
  bankName: string;
  connectionMethod: BankConnectionMethod;
  lastSyncAt: string | null;
  syncStatus: BankSyncStatus;
  accountCount: number;
  createdAt: string;
}

export type ConsentScope = 'score' | 'breakdown' | 'transactions' | 'full_profile';

export interface BankConsent {
  id: string;
  userId: string;
  bankId: string;
  consentGranted: boolean;
  consentScope: ConsentScope[];
  grantedAt: string | null;
  revokedAt: string | null;
}
