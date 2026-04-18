import { env } from '@/config/env';

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

export const ml = {
  health: () => call<{ status: string }>('/health'),
  score: (input: MLScoreInput) => call<MLScoreResult>('/score', input),
  ocrExtract: (storagePath: string) =>
    call<{ fields: Record<string, string> }>('/ocr/extract', { storagePath }),
  livenessCheck: (storagePath: string) =>
    call<{ passed: boolean; confidence: number }>('/kyc/liveness', { storagePath }),
};
