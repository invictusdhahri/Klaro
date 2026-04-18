import type { ScoreBand } from '../types/score';

export interface ScoreBandRange {
  band: ScoreBand;
  min: number;
  max: number;
  labelEn: string;
  description: string;
}

export const SCORE_BANDS: readonly ScoreBandRange[] = [
  { band: 'POOR', min: 0, max: 399, labelEn: 'Poor', description: 'High risk profile, multiple red flags.' },
  { band: 'FAIR', min: 400, max: 599, labelEn: 'Fair', description: 'Some risk signals; collateral often required.' },
  { band: 'GOOD', min: 600, max: 749, labelEn: 'Good', description: 'Reliable profile with minor irregularities.' },
  { band: 'VERY_GOOD', min: 750, max: 849, labelEn: 'Very good', description: 'Strong financial behavior.' },
  { band: 'EXCELLENT', min: 850, max: 1000, labelEn: 'Excellent', description: 'Stable income, low debt, consistent payments.' },
] as const;

export function getScoreBand(score: number): ScoreBand {
  for (const band of SCORE_BANDS) {
    if (score >= band.min && score <= band.max) return band.band;
  }
  return 'POOR';
}
