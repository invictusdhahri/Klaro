export type AppRole = 'user' | 'bank' | 'admin';

export type KycStatus = 'pending' | 'verified' | 'flagged' | 'rejected';

export type OccupationCategory =
  | 'student'
  | 'salaried'
  | 'freelance'
  | 'business_owner'
  | 'unemployed'
  | 'retired';

export interface UserProfile {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  age: number | null;
  occupation: string | null;
  occupationCategory: OccupationCategory | null;
  educationLevel: string | null;
  locationGovernorate: string | null;
  locationCountry: string;
  phone: string | null;
  kycStatus: KycStatus;
  createdAt: string;
  updatedAt: string;
}
