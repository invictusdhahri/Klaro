import { z } from 'zod';

export const bankConnectionMethodSchema = z.enum(['scraping', 'manual_upload']);

export const bankSyncStatusSchema = z.enum(['pending', 'syncing', 'success', 'failed']);

export const consentScopeSchema = z.enum(['score', 'breakdown', 'transactions', 'full_profile']);

export const bankConnectionStartSchema = z.object({
  bankName: z.string().min(1).max(50),
  connectionMethod: bankConnectionMethodSchema,
  encryptedCredentials: z.string().min(1).optional(),
});

export const otpSubmitSchema = z.object({
  otp: z.string().min(4).max(10),
});

export const bankConsentUpdateSchema = z.object({
  bankId: z.string().uuid(),
  consentGranted: z.boolean(),
  consentScope: z.array(consentScopeSchema).default([]),
});

/**
 * Public schema for bank self-registration.
 *
 * Slug is the canonical short id used everywhere downstream (and matches the
 * scraping adapter ids when applicable). It must be lowercase alphanumeric +
 * dashes, no leading/trailing dash. Country defaults to TN.
 */
export const bankRegistrationSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, digits, and dashes only'),
  name: z.string().min(2).max(120),
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
  country: z.string().length(2).default('TN'),
  admin: z.object({
    email: z.string().email().max(255),
    password: z.string().min(8).max(72),
    fullName: z.string().min(2).max(120),
  }),
});

export type BankRegistrationInput = z.infer<typeof bankRegistrationSchema>;

// ---------------------------------------------------------------------------
// Bank API key management
// ---------------------------------------------------------------------------

export const bankApiKeyScopeSchema = z.enum([
  'read:clients',
  'read:scores',
  'read:transactions',
  'read:statements',
]);

export const bankApiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  scopes: z.array(bankApiKeyScopeSchema).min(1).default([
    'read:clients',
    'read:scores',
    'read:transactions',
    'read:statements',
  ]),
});

export type BankApiKeyCreateInput = z.infer<typeof bankApiKeyCreateSchema>;

export type BankConnectionStartInput = z.infer<typeof bankConnectionStartSchema>;
export type BankConsentUpdateInput = z.infer<typeof bankConsentUpdateSchema>;
export type OtpSubmitInput = z.infer<typeof otpSubmitSchema>;
