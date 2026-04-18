import { z } from 'zod';

export const scoreBandSchema = z.enum(['POOR', 'FAIR', 'GOOD', 'VERY_GOOD', 'EXCELLENT']);

export const riskCategorySchema = z.enum(['low', 'medium', 'high', 'very_high']);

export const scoreBreakdownSchema = z
  .object({
    identity: z.number().min(0).max(1).optional(),
    income: z.number().min(0).max(1).optional(),
    spending: z.number().min(0).max(1).optional(),
    paymentBehavior: z.number().min(0).max(1).optional(),
    debtSignals: z.number().min(0).max(1).optional(),
    documentConsistency: z.number().min(0).max(1).optional(),
    behavioralPatterns: z.number().min(0).max(1).optional(),
    ruleLayer: z.number().min(0).max(1000).optional(),
    llmLayer: z.number().min(0).max(1000).optional(),
    anomalyPenalty: z.number().min(0).optional(),
  })
  .passthrough();

export const creditScoreSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  score: z.number().int().min(0).max(1000),
  scoreBand: scoreBandSchema,
  confidence: z.number().min(0).max(1),
  riskCategory: riskCategorySchema,
  dataSufficiency: z.number().min(0).max(1),
  breakdown: scoreBreakdownSchema,
  featureImportance: z.record(z.string(), z.number()),
  flags: z.array(z.string()),
  recommendations: z.array(z.string()),
  dataGaps: z.array(z.string()),
  modelVersion: z.string(),
  createdAt: z.string().datetime(),
});

export const scoreComputeRequestSchema = z.object({
  userId: z.string().uuid().optional(),
  force: z.boolean().default(false),
});

export type ScoreComputeRequest = z.infer<typeof scoreComputeRequestSchema>;
