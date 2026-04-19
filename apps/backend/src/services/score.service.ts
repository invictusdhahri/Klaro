import type { Json } from '@klaro/shared';
import { supabaseAdmin } from './supabase';
import { ml, type MLScoreResult } from './ml.client';
import { logger } from '../lib/logger';

const j = (v: unknown): Json => v as Json;

export async function persistAndNotifyScore(
  userId: string,
  mlResult: MLScoreResult,
): Promise<{ scoreId: string; scoreBand: string }> {
  // Actions are stored inside breakdown jsonb under key "actions" (zero-migration approach).
  // breakdown already contains them from compose_score, so we just cast the whole object.
  const { data: scoreRow, error } = await supabaseAdmin
    .from('credit_scores')
    .insert({
      user_id: userId,
      score: mlResult.score,
      confidence: mlResult.confidence,
      risk_category: mlResult.riskCategory,
      data_sufficiency: mlResult.dataSufficiency,
      breakdown: j(mlResult.breakdown),
      flags: j(mlResult.flags),
      recommendations: j(mlResult.coachingTips),
      model_version: mlResult.modelVersion,
      // score_band is GENERATED — do not set
    })
    .select('id, score_band')
    .single();

  if (error || !scoreRow) {
    throw new Error(`Failed to persist score: ${error?.message ?? 'unknown'}`);
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_type: 'user',
    actor_id: userId,
    action: 'compute_score',
    resource_type: 'credit_scores',
    resource_id: scoreRow.id,
    metadata: { score: mlResult.score, model_version: mlResult.modelVersion },
  });

  // Supabase Realtime broadcast to the user's score channel
  try {
    await supabaseAdmin.channel(`score:${userId}`).send({
      type: 'broadcast',
      event: 'score_updated',
      payload: { score: mlResult.score, band: scoreRow.score_band },
    });
  } catch (e) {
    logger.warn({ err: e, userId }, 'realtime notification failed');
  }

  return { scoreId: scoreRow.id, scoreBand: scoreRow.score_band as string };
}

export async function computeAndPersistScore(userId: string): Promise<MLScoreResult & { scoreBand: string }> {
  const mlResult = await ml.score({ userId });
  const { scoreBand } = await persistAndNotifyScore(userId, mlResult);
  return { ...mlResult, scoreBand };
}
