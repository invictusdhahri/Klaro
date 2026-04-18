import { z } from 'zod';

export const kycDocumentTypeSchema = z.enum([
  'cin',
  'passport',
  'driver_license',
  'proof_of_address',
]);

export const kycExtractionSchema = z.object({
  fullName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  documentNumber: z.string().optional(),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  nationality: z.string().optional(),
  address: z.string().optional(),
});

export const kycUploadRequestSchema = z.object({
  documentType: kycDocumentTypeSchema,
  storagePath: z.string().min(1),
  documentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Expected SHA-256 hex digest'),
});

export const kycVerifyRequestSchema = z.object({
  documentId: z.string().uuid(),
  selfieStoragePath: z.string().min(1).optional(),
});

export type KycUploadRequest = z.infer<typeof kycUploadRequestSchema>;
export type KycVerifyRequest = z.infer<typeof kycVerifyRequestSchema>;
