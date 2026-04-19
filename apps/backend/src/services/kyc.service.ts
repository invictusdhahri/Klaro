/**
 * KYC persistence service.
 *
 * Handles two DB operations:
 *   saveKycDocument  — inserts a kyc_documents row after OCR extraction
 *   completeKyc      — marks the document verified and populates the profile
 */

import { createHash } from 'node:crypto';
import type { Database, Json, OccupationCategory } from '@klaro/shared';
import { supabaseAdmin } from './supabase';

type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

// ── Extracted fields shape (matches vision_extractor output) ──────────────────

export interface OcrExtractedFields {
  full_name: string | null;
  full_name_latin: string | null;
  cin_number: string | null;
  date_of_birth: string | null;
  expiry_date: string | null;
  address: string | null;
  gender: string | null;
  occupation: string | null;
  father_name: string | null;
  mother_name: string | null;
  place_of_birth: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** SHA-256 hex digest of raw image bytes — used as dedup key in kyc_documents. */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Map a free-text occupation to one of the allowed occupation_category values.
 * Falls back to null if no confident match.
 */
function inferOccupationCategory(occ: string | null): OccupationCategory | null {
  if (!occ) return null;
  const s = occ.toLowerCase();
  if (/student|étudiant|étudiente|eleve/.test(s)) return 'student';
  if (/retir|retraité|retraitée|pension/.test(s)) return 'retired';
  if (/unemploy|sans emploi|sans travail|بدون مهنة/.test(s)) return 'unemployed';
  if (/merchant|trader|commerçant|business|entrepreneur|owner/.test(s)) return 'business_owner';
  if (/freelance|indépendant|independent|liberal/.test(s)) return 'freelance';
  // Engineer, doctor, teacher, civil servant, executive → salaried
  if (/engineer|doctor|teacher|professor|director|executive|officer|employee|agent|civil|fonctionnaire|ingénieur|médecin|professeur/.test(s)) return 'salaried';
  // Any remaining non-empty string is likely some form of employment
  if (s.length > 0) return 'salaried';
  return null;
}

/**
 * Extract a Tunisian governorate from a free-text address string.
 * Returns the matched governorate name in English, or null.
 */
function extractGovernorate(address: string | null): string | null {
  if (!address) return null;
  const map: Record<string, string> = {
    tunis: 'Tunis', ariana: 'Ariana', 'ben arous': 'Ben Arous', manouba: 'Manouba',
    nabeul: 'Nabeul', zaghouan: 'Zaghouan', bizerte: 'Bizerte', beja: 'Beja',
    jendouba: 'Jendouba', kef: 'Le Kef', siliana: 'Siliana', sousse: 'Sousse',
    monastir: 'Monastir', mahdia: 'Mahdia', sfax: 'Sfax', kairouan: 'Kairouan',
    kasserine: 'Kasserine', 'sidi bouzid': 'Sidi Bouzid', gabes: 'Gabes',
    medenine: 'Medenine', tataouine: 'Tataouine', gafsa: 'Gafsa',
    tozeur: 'Tozeur', kebili: 'Kebili',
  };
  const lower = address.toLowerCase();
  for (const [key, label] of Object.entries(map)) {
    if (lower.includes(key)) return label;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Insert (or retrieve existing) kyc_documents row after a successful OCR pass.
 *
 * The document_hash ensures we don't double-insert the same image. If the same
 * image is uploaded again, the existing record id is returned.
 *
 * Returns the kyc_documents row id.
 */
export async function saveKycDocument(
  userId: string,
  documentType: string,
  imageBuffer: Buffer,
  ocrData: OcrExtractedFields,
  quality_score: number,
  confidence: number,
): Promise<string> {
  const hash = sha256(imageBuffer);

  // Upsert: if the same user uploads the same image twice, return the existing row.
  const { data, error } = await supabaseAdmin
    .from('kyc_documents')
    .upsert(
      {
        user_id: userId,
        document_type: documentType as 'cin' | 'passport' | 'driver_license' | 'proof_of_address',
        storage_path: `kyc/${userId}/${hash}`,   // logical path — no actual upload yet
        ocr_data: ocrData as unknown as Json,
        authenticity_score: quality_score,
        consistency_score: confidence,
        verification_status: 'pending' as const,
        document_hash: hash,
      },
      { onConflict: 'user_id,document_hash', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) throw new Error(`kyc_documents insert failed: ${error.message}`);
  return data.id as string;
}

/**
 * Mark the KYC document as verified and populate the user's profile from the
 * OCR-extracted fields.
 *
 * Called after a successful face-match check.
 */
export async function completeKyc(
  userId: string,
  docId: string,
  ocrData: OcrExtractedFields,
  faceMatchSimilarity: number,
): Promise<void> {
  // 1. Mark the kyc_document as verified
  const { error: docErr } = await supabaseAdmin
    .from('kyc_documents')
    .update({
      verification_status: 'verified' as const,
      authenticity_score: faceMatchSimilarity,
    })
    .eq('id', docId)
    .eq('user_id', userId);

  if (docErr) throw new Error(`kyc_documents update failed: ${docErr.message}`);

  // 2. Build profile updates from OCR data
  const governorate = extractGovernorate(ocrData.address ?? ocrData.place_of_birth);
  const occupationCategory = inferOccupationCategory(ocrData.occupation);

  const profileUpdate: ProfileUpdate = {
    kyc_status: 'verified',
  };

  // Only overwrite fields if we have confident values — never blank them out
  const latin = ocrData.full_name_latin?.trim();
  if (latin) profileUpdate.full_name = latin;

  if (ocrData.date_of_birth) profileUpdate.date_of_birth = ocrData.date_of_birth;
  if (ocrData.occupation) profileUpdate.occupation = ocrData.occupation;
  if (occupationCategory) profileUpdate.occupation_category = occupationCategory;
  if (governorate) profileUpdate.location_governorate = governorate;

  // 3. Update the profile
  const { error: profErr } = await supabaseAdmin
    .from('profiles')
    .update(profileUpdate)
    .eq('id', userId);

  if (profErr) throw new Error(`profiles update failed: ${profErr.message}`);
}
