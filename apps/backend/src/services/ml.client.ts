import { env } from '../config/env';

export interface MLScoreAction {
  id: string;
  title: string;
  rationale: string;
  category: 'income' | 'payments' | 'debt' | 'documents' | 'behavior';
  expectedImpactPoints: number;
  impactConfidence: number;
}

export interface MLScoreInput {
  userId: string;
}

export interface MLScoreResult {
  score: number;
  band: string;
  riskCategory: string;
  confidence: number;
  breakdown: Record<string, unknown>;
  flags: string[];
  explanation: string;
  coachingTips: string[];
  actions: MLScoreAction[];
  dataSufficiency: number;
  modelVersion: string;
}

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
    const text = await res.text();
    const err = new MLError(`ML call failed (${res.status})`, res.status, text);
    throw err;
  }
  const json = await res.json();
  // Map snake_case ML response to camelCase
  if (path === '/score') {
    return mapScoreResponse(json as Record<string, unknown>) as T;
  }
  return json as T;
}

function mapScoreResponse(raw: Record<string, unknown>): MLScoreResult {
  const rawActions = (raw.actions ?? []) as Array<Record<string, unknown>>;
  const actions: MLScoreAction[] = rawActions.map((a) => ({
    id: a.id as string,
    title: a.title as string,
    rationale: a.rationale as string,
    category: a.category as MLScoreAction['category'],
    expectedImpactPoints: a.expected_impact_points as number,
    impactConfidence: a.impact_confidence as number,
  }));

  return {
    score: raw.score as number,
    band: raw.band as string,
    riskCategory: raw.risk_category as string,
    confidence: raw.confidence as number,
    breakdown: raw.breakdown as Record<string, unknown>,
    flags: (raw.flags ?? []) as string[],
    explanation: (raw.explanation ?? '') as string,
    coachingTips: (raw.coaching_tips ?? []) as string[],
    actions,
    dataSufficiency: (raw.data_sufficiency ?? 1) as number,
    modelVersion: raw.model_version as string,
  };
}

export class MLError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'MLError';
  }
}

// ---------------------------------------------------------------------------
// Statement processing types
// ---------------------------------------------------------------------------

export interface RawTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  category?: string;
}

export interface CoherenceFlag {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface AnomalySignal {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface ForensicSignal {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
  source?: string;
}

export interface LayerDeepfake {
  passed: boolean;
  /** Composite forensic score 0-1 (1 = clean). */
  score: number;
  /** Composite forensic risk 0-1 (1 = clearly fake). */
  risk_score: number;
  confidence: number;
  /** Rich typed signals from PDF structure / image forensics / vision ensemble. */
  signals: ForensicSignal[];
  reasoning?: string;
  vision_pages_analysed?: number;
  vision_available?: boolean;
  soft_fail?: boolean;
}

export interface LayerAuthenticity {
  passed: boolean;
  score: number;
  failed_rules: string[];
}

export interface LayerConsistency {
  passed: boolean;
  coherence_score: number;
  flags: CoherenceFlag[];
  web_checks: Array<{ query: string; finding: string; passed: boolean }>;
}

export interface IncomeBand {
  p25: number;
  p50: number;
  p75: number;
  currency: string;
  source: string;
}

export interface IncomeFlag {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
  source?: string;
}

export interface SuggestedQuestion {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'free_text' | 'amount';
  prompt: string;
  options: string[];
  linked_flag?: string;
}

export interface LayerIncomePlausibility {
  passed: boolean;
  implied_monthly_income: number;
  local_band: IncomeBand;
  remote_band: IncomeBand;
  gap_local_pct: number;
  gap_remote_pct: number;
  primary_band: 'local' | 'remote';
  foreign_currency_share: number;
  flags: IncomeFlag[];
  suggested_questions: SuggestedQuestion[];
  reasoning: string;
  applied_answers?: string[];
}

export interface StatementVerification {
  passed: boolean;
  verdict?: 'approved' | 'needs_review' | 'rejected';
  failed_layer:
    | 'deepfake'
    | 'authenticity'
    | 'consistency'
    | 'income_plausibility'
    | 'reasoner'
    | 'extraction'
    | null;
  layers: {
    deepfake: LayerDeepfake;
    authenticity: LayerAuthenticity;
    consistency: LayerConsistency;
    income_plausibility?: LayerIncomePlausibility;
  };
}

export interface StatementAnomalies {
  anomaly_score: number;
  flagged: boolean;
  signals: AnomalySignal[];
}

export interface PerFlagExplanation {
  flag_type: string;
  why_it_matters: string;
  what_would_clear_it: string;
}

export interface StatementReasoning {
  risk_score: number;
  rubric_risk_score?: number;
  rubric_breakdown?: Record<string, number>;
  verdict: 'approved' | 'needs_review' | 'rejected';
  reasoning_summary: string;
  per_flag_explanations: PerFlagExplanation[];
  questions: SuggestedQuestion[];
  applied_answers?: string[];
}

export interface StatementProcessResult {
  extraction: { transactions: RawTransaction[] };
  verification: StatementVerification;
  anomalies: StatementAnomalies;
  reasoning: StatementReasoning;
}

export interface ClarificationAnswer {
  question_id: string;
  value: unknown;
}

export interface UserContext {
  fullName: string;
  occupation: string | null;
  occupationCategory: string | null;
  educationLevel: string | null;
  age: number | null;
  kycStatus: string;
  locationGovernorate: string | null;
  locationCountry: string | null;
  kycDocuments: Array<{ type: string; status: string }>;
  priorStatements: Array<{ fileName: string; uploadedAt: string }>;
  /** Enrichment signals accumulated from previous clarification rounds. */
  profileContext: Record<string, unknown>;
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
  ocrExtract: (
    imageBuffer: Buffer,
    mimeType: string,
    documentType: string,
    verso?: { buffer: Buffer; mimeType: string },
  ) => {
    const form = new FormData();
    form.append('image', new Blob([imageBuffer], { type: mimeType }), 'document');
    form.append('document_type', documentType);
    if (verso) {
      form.append('image_verso', new Blob([verso.buffer], { type: verso.mimeType }), 'document_verso');
    }
    return callMultipart<OcrExtractResult>('/ocr/extract', form);
  },
  verifyLiveness: (frames: string[], clientSignals?: ClientLivenessSignals) =>
    call<LivenessResult>('/kyc/liveness', { frames, client_signals: clientSignals }),
  faceMatch: (selfie_base64: string, doc_face_base64: string) =>
    call<FaceMatchResult>('/kyc/face-match', { selfie_base64, doc_face_base64 }),
  statementProcess: (
    storagePath: string,
    mimeType: string,
    userContext: UserContext,
    fileBuffer?: Buffer,
  ) =>
    call<StatementProcessResult>('/statements/process', {
      storagePath,
      mimeType,
      userContext,
      fileBytes: fileBuffer ? fileBuffer.toString('base64') : undefined,
    }),
  statementReanalyze: (input: {
    userContext: UserContext;
    transactions: RawTransaction[];
    layers: StatementVerification['layers'];
    previousAnswers: ClarificationAnswer[];
    newAnswers: ClarificationAnswer[];
  }) => call<StatementProcessResult>('/statements/reanalyze', input),
};
