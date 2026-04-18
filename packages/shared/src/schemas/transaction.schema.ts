import { z } from 'zod';

export const transactionTypeSchema = z.enum(['credit', 'debit']);

export const transactionSourceSchema = z.enum(['scraped', 'manual_upload', 'ocr_extracted']);

export const transactionCategorySchema = z.enum([
  'salary',
  'freelance_income',
  'transfer_in',
  'transfer_out',
  'food',
  'food_delivery',
  'groceries',
  'transport',
  'fuel',
  'utilities',
  'rent',
  'telecom',
  'subscription',
  'health',
  'education',
  'entertainment',
  'shopping',
  'cash_withdrawal',
  'fees',
  'loan_payment',
  'insurance',
  'savings',
  'other',
]);

export const transactionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  bankConnectionId: z.string().uuid().nullable(),
  transactionDate: z.string().date(),
  amount: z.number().finite(),
  currency: z.string().length(3).default('TND'),
  transactionType: transactionTypeSchema,
  category: transactionCategorySchema.nullable(),
  description: z.string().max(500).nullable(),
  counterparty: z.string().max(200).nullable(),
  source: transactionSourceSchema,
  createdAt: z.string().datetime(),
});

export const transactionListQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  category: transactionCategorySchema.optional(),
  bankConnectionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
});

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
