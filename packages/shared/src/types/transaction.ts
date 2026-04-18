export type TransactionType = 'credit' | 'debit';

export type TransactionSource = 'scraped' | 'manual_upload' | 'ocr_extracted';

export type TransactionCategory =
  | 'salary'
  | 'freelance_income'
  | 'transfer_in'
  | 'transfer_out'
  | 'food'
  | 'food_delivery'
  | 'groceries'
  | 'transport'
  | 'fuel'
  | 'utilities'
  | 'rent'
  | 'telecom'
  | 'subscription'
  | 'health'
  | 'education'
  | 'entertainment'
  | 'shopping'
  | 'cash_withdrawal'
  | 'fees'
  | 'loan_payment'
  | 'insurance'
  | 'savings'
  | 'other';

export interface Transaction {
  id: string;
  userId: string;
  bankConnectionId: string | null;
  transactionDate: string;
  amount: number;
  currency: string;
  transactionType: TransactionType;
  category: TransactionCategory | null;
  description: string | null;
  counterparty: string | null;
  source: TransactionSource;
  createdAt: string;
}
