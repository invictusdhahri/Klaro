export type ScoreBand = 'POOR' | 'FAIR' | 'GOOD' | 'VERY_GOOD' | 'EXCELLENT';

export type RiskCategory = 'low' | 'medium' | 'high' | 'very_high';

export type ScoreActionCategory = 'income' | 'payments' | 'debt' | 'documents' | 'behavior';

export interface ScoreAction {
  id: string;
  title: string;
  rationale: string;
  category: ScoreActionCategory;
  expectedImpactPoints: number;
  impactConfidence: number;
}

export interface ScoreBreakdown {
  identity?: number;
  income?: number;
  spending?: number;
  paymentBehavior?: number;
  debtSignals?: number;
  documentConsistency?: number;
  behavioralPatterns?: number;
  ruleLayer?: number;
  llmLayer?: number;
  anomalyPenalty?: number;
}

export interface AnomalyFlag {
  id: string;
  userId: string;
  flagType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: Record<string, unknown> | null;
  resolutionStatus: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreditScore {
  id: string;
  userId: string;
  score: number;
  scoreBand: ScoreBand;
  confidence: number;
  riskCategory: RiskCategory;
  dataSufficiency: number;
  breakdown: ScoreBreakdown;
  featureImportance: Record<string, number>;
  flags: string[];
  recommendations: string[];
  actions: ScoreAction[];
  dataGaps: string[];
  modelVersion: string;
  createdAt: string;
}
