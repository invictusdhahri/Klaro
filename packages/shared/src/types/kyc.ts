export type KycDocumentType = 'cin' | 'passport' | 'driver_license' | 'proof_of_address';

export type VerificationStatus = 'pending' | 'verified' | 'flagged' | 'rejected';

export interface KycDocument {
  id: string;
  userId: string;
  documentType: KycDocumentType;
  storagePath: string;
  ocrData: Record<string, unknown> | null;
  deepfakeScore: number | null;
  authenticityScore: number | null;
  consistencyScore: number | null;
  verificationStatus: VerificationStatus;
  documentHash: string;
  createdAt: string;
}

export interface KycExtraction {
  fullName?: string;
  dateOfBirth?: string;
  documentNumber?: string;
  issuedAt?: string;
  expiresAt?: string;
  nationality?: string;
  address?: string;
}

export interface FaceMatchResult {
  match: boolean;
  similarity: number;
  threshold: number;
}

export interface LivenessResult {
  passed: boolean;
  blink: boolean;
  headRotation: boolean;
  antiSpoof: boolean;
  confidence: number;
}
