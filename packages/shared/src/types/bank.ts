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

// ---------------------------------------------------------------------------
// Bank dashboard payloads
// ---------------------------------------------------------------------------

export interface BankProfile {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  country: string;
}

// ---------------------------------------------------------------------------
// Bank API keys (programmatic access for bank backends)
// ---------------------------------------------------------------------------

export type BankApiKeyScope =
  | 'read:clients'
  | 'read:scores'
  | 'read:transactions'
  | 'read:statements';

/** Public-safe representation of a key (never includes the plaintext secret). */
export interface BankApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: BankApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

/** Returned exactly ONCE on creation. `plaintextKey` is unrecoverable after. */
export interface BankApiKeyCreated extends BankApiKey {
  plaintextKey: string;
}

/**
 * Score band keys used by the bank dashboard distribution map.
 * Mirrors `ScoreBand` from types/score, plus 'UNSCORED' for clients without
 * a credit_scores row yet.
 */
export type DashboardScoreBand =
  | 'POOR'
  | 'FAIR'
  | 'GOOD'
  | 'VERY_GOOD'
  | 'EXCELLENT'
  | 'UNSCORED';

export interface BankDashboardStats {
  totalClients: number;
  avgScore: number | null;
  scoreDistribution: Partial<Record<DashboardScoreBand, number>>;
  kycPassRate: number;
  statementsProcessing: number;
  statementsNeedsReview: number;
  statementsProcessed: number;
  anomalyCount30d: number;
  recentUploads: BankRecentUpload[];
}

export interface BankRecentUpload {
  id: string;
  user_id: string;
  full_name: string;
  file_name: string;
  status: string;
  created_at: string;
}

export interface BankStatementSummary {
  id: string;
  fileName: string;
  status: string;
  riskScore: number | null;
  extractedCount: number;
  createdAt: string;
}

export interface BankTransactionRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  type: 'credit' | 'debit';
  category: string | null;
  description: string | null;
  source: string;
}

export interface BankTimelineEntry {
  kind: 'statement' | 'score' | 'anomaly';
  at: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Client behavioural insights — derived from transactions + statements
// ---------------------------------------------------------------------------

export interface SpendingCategory {
  category: string;
  totalAmount: number;
  transactionCount: number;
  /** Percentage of total debit spending (0–100). */
  percentage: number;
}

export interface MonthlyFlow {
  /** "YYYY-MM" */
  month: string;
  income: number;
  expenses: number;
  net: number;
}

export interface TopPayee {
  name: string;
  totalAmount: number;
  count: number;
}

export interface ClientInsights {
  currency: string;

  /** Totals over all available transactions. */
  totalTransactions: number;
  totalCredit: number;
  totalDebit: number;

  /** Monthly averages derived from the trend window. */
  avgMonthlyIncome: number | null;
  avgMonthlyExpense: number | null;
  /** (avgMonthlyIncome - avgMonthlyExpense) / avgMonthlyIncome. Null when no income. */
  savingsRate: number | null;

  /** Debit transactions grouped by category, sorted by amount desc. */
  categoryBreakdown: SpendingCategory[];

  /** Last 6 months of income vs expense. */
  monthlyTrend: MonthlyFlow[];

  /** Top payees by total amount spent, debit only. */
  topPayees: TopPayee[];

  /** Miscellaneous behavioral signals. */
  avgTransactionAmount: number;
  largestExpense: number | null;
  /** Estimated total of regular monthly recurring debits. */
  estimatedRecurring: number;
  /** Day-of-week name with most transactions. */
  mostActiveDay: string | null;
  /** Credit-to-debit ratio (>1 means earning more than spending). */
  creditDebitRatio: number | null;

  /** Income data from the latest ML-processed bank statement. */
  incomeAssessment: Record<string, unknown> | null;

  /** Date range covered. */
  periodFrom: string | null;
  periodTo: string | null;
}
