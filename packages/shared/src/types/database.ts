/**
 * Typed schema for the Klaro Supabase database.
 * Mirrors supabase/migrations/0001_init.sql — keep in sync when schema changes.
 */

export type KycStatus = 'pending' | 'verified' | 'flagged' | 'rejected';
export type VerificationStatus = 'pending' | 'verified' | 'flagged' | 'rejected';
export type DocumentType = 'cin' | 'passport' | 'driver_license' | 'proof_of_address';
export type OccupationCategory =
  | 'student'
  | 'salaried'
  | 'freelance'
  | 'business_owner'
  | 'unemployed'
  | 'retired';

export interface ProfileRow {
  id: string;
  full_name: string;
  date_of_birth: string | null;        // date → ISO string
  age: number | null;                  // generated column
  occupation: string | null;
  occupation_category: OccupationCategory | null;
  education_level: string | null;
  location_governorate: string | null;
  location_country: string;
  phone: string | null;
  kyc_status: KycStatus;
  created_at: string;
  updated_at: string;
}

export interface KycDocumentRow {
  id: string;
  user_id: string;
  document_type: DocumentType;
  storage_path: string;
  ocr_data: Record<string, unknown> | null;
  deepfake_score: number | null;
  authenticity_score: number | null;
  consistency_score: number | null;
  verification_status: VerificationStatus;
  document_hash: string;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, 'age' | 'created_at' | 'updated_at'> & {
          age?: never;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ProfileRow, 'id' | 'age'>>;
      };
      kyc_documents: {
        Row: KycDocumentRow;
        Insert: Omit<KycDocumentRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<KycDocumentRow, 'id' | 'user_id' | 'created_at'>>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
