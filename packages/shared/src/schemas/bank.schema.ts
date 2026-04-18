import { z } from 'zod';

export const bankConnectionMethodSchema = z.enum(['scraping', 'manual_upload']);

export const bankSyncStatusSchema = z.enum(['pending', 'syncing', 'success', 'failed']);

export const consentScopeSchema = z.enum(['score', 'breakdown', 'transactions', 'full_profile']);

export const bankConnectionStartSchema = z.object({
  bankName: z.string().min(1).max(50),
  connectionMethod: bankConnectionMethodSchema,
  encryptedCredentials: z.string().min(1).optional(),
});

export const bankConsentUpdateSchema = z.object({
  bankId: z.string().uuid(),
  consentGranted: z.boolean(),
  consentScope: z.array(consentScopeSchema).default([]),
});

export type BankConnectionStartInput = z.infer<typeof bankConnectionStartSchema>;
export type BankConsentUpdateInput = z.infer<typeof bankConsentUpdateSchema>;
