import { env } from '../config/env';

export interface MLScoreInput {
  userId: string;
  features: Record<string, unknown>;
}

export interface MLScoreResult {
  score: number;
  band: string;
  breakdown: Record<string, number>;
  flags: string[];
  recommendations: string[];
}

export interface OcrExtractedFields {
  full_name: string | null;
  full_name_latin: string | null;
  cin_number: string | null;
  date_of_birth: string | null;
  expiry_date: string | null;
  address: string | null;
  gender: string | null;
}

export type OcrExtractResult =
  | {
      success: true;
      extracted: OcrExtractedFields;
      face_crop_base64: string;
      confidence: number;
      quality_score: number;
    }
  | { success: false; reason: 'low_quality' | 'no_face_detected' };

export interface ClientLivenessSignals {
  blink_detected: boolean;
  yaw_right_reached: boolean;
  yaw_left_reached: boolean;
  pitch_up_reached: boolean;
  max_yaw_deg: number;
}

export interface LivenessResult {
  passed: boolean;
  confidence: number;
  blink: boolean;
  head_rotation: boolean;
}

export interface FaceMatchResult {
  match: boolean;
  similarity: number;
  threshold: number;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.ML_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`ML call failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function callMultipart<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${env.ML_BASE_URL}${path}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`ML call failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const ml = {
  health: () => call<{ status: string }>('/health'),
  score: (input: MLScoreInput) => call<MLScoreResult>('/score', input),
  ocrExtract: (imageBuffer: Buffer, mimeType: string, documentType: string) => {
    const form = new FormData();
    form.append('image', new Blob([imageBuffer], { type: mimeType }), 'document');
    form.append('document_type', documentType);
    return callMultipart<OcrExtractResult>('/ocr/extract', form);
  },
  verifyLiveness: (frames: string[], clientSignals?: ClientLivenessSignals) =>
    call<LivenessResult>('/kyc/liveness', { frames, client_signals: clientSignals }),
  faceMatch: (selfie_base64: string, doc_face_base64: string) =>
    call<FaceMatchResult>('/kyc/face-match', { selfie_base64, doc_face_base64 }),
};
