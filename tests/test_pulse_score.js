'use strict';

const { computePulseScore, normalizeToScore, PULSE_WEIGHTS, PULSE_LABELS } = require('../shared/xg_growth.js');

module.exports = [
  // ─── normalizeToScore boundary values ───
  {
    name: 'normalizeToScore: NaN returns 0',
    fn() {
      const result = normalizeToScore(NaN, 500);
      if (result !== 0) throw new Error(`Expected 0, got ${result}`);
    }
  },
  {
    name: 'normalizeToScore: Infinity returns 0 (non-finite guarded)',
    fn() {
      const result = normalizeToScore(Infinity, 500);
      // Number.isFinite(Infinity) is false → returns 0
      if (result !== 0) throw new Error(`Expected 0, got ${result}`);
    }
  },
  {
    name: 'normalizeToScore: negative returns 0',
    fn() {
      const result = normalizeToScore(-10, 500);
      if (result !== 0) throw new Error(`Expected 0, got ${result}`);
    }
  },
  {
    name: 'normalizeToScore: zero returns 0',
    fn() {
      const result = normalizeToScore(0, 500);
      if (result !== 0) throw new Error(`Expected 0, got ${result}`);
    }
  },
  {
    name: 'normalizeToScore: halfMax maps to ~50',
    fn() {
      const result = normalizeToScore(500, 500);
      // 500/(500+500) = 0.5 → 50
      if (Math.abs(result - 50) > 0.01) throw new Error(`Expected ~50, got ${result}`);
    }
  },
  {
    name: 'normalizeToScore: very large value caps at 100',
    fn() {
      const result = normalizeToScore(1000000, 500);
      if (result > 100) throw new Error(`Expected <= 100, got ${result}`);
      if (result < 99) throw new Error(`Expected close to 100, got ${result}`);
    }
  },

  // ─── computePulseScore boundary values ───
  {
    name: 'computePulseScore: null input returns zero score',
    fn() {
      const result = computePulseScore(null);
      if (result.pulseScore !== 0) throw new Error(`Expected 0, got ${result.pulseScore}`);
      if (result.level !== 'normal') throw new Error(`Expected normal, got ${result.level}`);
    }
  },
  {
    name: 'computePulseScore: undefined input returns zero score',
    fn() {
      const result = computePulseScore(undefined);
      if (result.pulseScore !== 0) throw new Error(`Expected 0, got ${result.pulseScore}`);
    }
  },
  {
    name: 'computePulseScore: NaN viewRate and NaN views',
    fn() {
      const result = computePulseScore({ viewRate: NaN, views: NaN, ageHours: 10 });
      if (result.velocityScore !== 0) throw new Error(`Expected velocityScore 0, got ${result.velocityScore}`);
    }
  },
  {
    name: 'computePulseScore: Infinity viewRate falls back to avgRate',
    fn() {
      // Infinity is not finite, so falls to else-if: views/ageHours = 1000/1 = 1000
      // normalizeToScore(1000, 500) = 1000/1500*100 ≈ 66.67
      const result = computePulseScore({ viewRate: Infinity, views: 1000, ageHours: 1 });
      if (result.velocityScore < 60 || result.velocityScore > 70) throw new Error(`Expected ~66.67, got ${result.velocityScore}`);
    }
  },
  {
    name: 'computePulseScore: negative views',
    fn() {
      const result = computePulseScore({ viewRate: 100, views: -50, ageHours: 5 });
      // views < 0 so engagement score should be 0 (views > 0 check fails)
      if (result.engagementScore !== 0) throw new Error(`Expected engagementScore 0, got ${result.engagementScore}`);
    }
  },
  {
    name: 'computePulseScore: very old tweet (1000 hours)',
    fn() {
      const result = computePulseScore({ viewRate: 100, views: 100000, ageHours: 1000 });
      // Freshness: max(0, 48 - 1000) = 0 → freshnessScore = 0
      if (result.freshnessScore !== 0) throw new Error(`Expected freshnessScore 0, got ${result.freshnessScore}`);
    }
  },
  {
    name: 'computePulseScore: very new tweet (0.1 hours)',
    fn() {
      const result = computePulseScore({ viewRate: 500, views: 50, ageHours: 0.1 });
      // Freshness: max(0, 48 - 0.1) = 47.9 → normalizeToScore(47.9, 6) ≈ 88.8
      if (result.freshnessScore < 80) throw new Error(`Expected high freshnessScore, got ${result.freshnessScore}`);
    }
  },
  {
    name: 'computePulseScore: same timestamp (ageHours = 0)',
    fn() {
      const result = computePulseScore({ viewRate: 100, views: 100, ageHours: 0 });
      // ageHours = 0: velocityScore uses viewRate path (100 > 0)
      // freshness: max(0, 48 - 0) = 48 → normalizeToScore(48, 6) ≈ 88.9
      if (result.freshnessScore < 80) throw new Error(`Expected high freshnessScore, got ${result.freshnessScore}`);
    }
  },

  // ─── computePulseScore level labels ───
  {
    name: 'computePulseScore: hot level (score >= 70)',
    fn() {
      // High velocity + high engagement + fresh
      const result = computePulseScore({ viewRate: 5000, views: 10000, likes: 5000, replies: 1000, reposts: 500, ageHours: 1 });
      if (result.level !== 'hot') throw new Error(`Expected hot, got ${result.level} (score: ${result.pulseScore})`);
      if (result.pulseScore < 70) throw new Error(`Expected score >= 70, got ${result.pulseScore}`);
    }
  },
  {
    name: 'computePulseScore: rising level (45 <= score < 70)',
    fn() {
      // Moderate values
      const result = computePulseScore({ viewRate: 300, views: 1000, likes: 100, replies: 20, reposts: 10, ageHours: 6 });
      if (result.level !== 'rising') throw new Error(`Expected rising, got ${result.level} (score: ${result.pulseScore})`);
      if (result.pulseScore < 45 || result.pulseScore >= 70) throw new Error(`Expected 45-69, got ${result.pulseScore}`);
    }
  },
  {
    name: 'computePulseScore: normal level (20 <= score < 45)',
    fn() {
      const result = computePulseScore({ viewRate: 50, views: 500, likes: 10, replies: 2, reposts: 1, ageHours: 24 });
      if (result.level !== 'normal') throw new Error(`Expected normal, got ${result.level} (score: ${result.pulseScore})`);
      if (result.pulseScore < 20 || result.pulseScore >= 45) throw new Error(`Expected 20-44, got ${result.pulseScore}`);
    }
  },
  {
    name: 'computePulseScore: cooling level (score < 20)',
    fn() {
      const result = computePulseScore({ viewRate: 1, views: 10, likes: 0, replies: 0, reposts: 0, ageHours: 100 });
      if (result.level !== 'cooling') throw new Error(`Expected cooling, got ${result.level} (score: ${result.pulseScore})`);
      if (result.pulseScore >= 20) throw new Error(`Expected score < 20, got ${result.pulseScore}`);
    }
  },

  // ─── computePulseScore weight normalization ───
  {
    name: 'computePulseScore: weights sum to 1.0',
    fn() {
      const total = PULSE_WEIGHTS.velocity + PULSE_WEIGHTS.engagement + PULSE_WEIGHTS.freshness;
      if (Math.abs(total - 1.0) > 0.001) throw new Error(`Weights sum to ${total}, expected 1.0`);
    }
  },
  {
    name: 'computePulseScore: velocity has highest weight (0.5)',
    fn() {
      if (PULSE_WEIGHTS.velocity !== 0.5) throw new Error(`Expected velocity weight 0.5, got ${PULSE_WEIGHTS.velocity}`);
      if (PULSE_WEIGHTS.engagement >= PULSE_WEIGHTS.velocity) throw new Error('Engagement weight should be less than velocity');
      if (PULSE_WEIGHTS.freshness >= PULSE_WEIGHTS.velocity) throw new Error('Freshness weight should be less than velocity');
    }
  },
  {
    name: 'computePulseScore: pulseScore is weighted sum of sub-scores',
    fn() {
      const input = { viewRate: 200, views: 1000, likes: 50, replies: 10, reposts: 5, ageHours: 4 };
      const result = computePulseScore(input);
      const expected = Math.round(
        result.velocityScore * PULSE_WEIGHTS.velocity +
        result.engagementScore * PULSE_WEIGHTS.engagement +
        result.freshnessScore * PULSE_WEIGHTS.freshness
      );
      if (result.pulseScore !== expected) throw new Error(`Expected pulseScore ${expected}, got ${result.pulseScore}`);
    }
  },
  {
    name: 'computePulseScore: all sub-scores are in 0-100 range',
    fn() {
      const cases = [
        { viewRate: 0, views: 0, ageHours: 0 },
        { viewRate: 10000, views: 1000000, likes: 500000, ageHours: 0.01 },
        { viewRate: 1, views: 1, ageHours: 1000 },
        { viewRate: 500, views: 5000, likes: 100, replies: 50, reposts: 20, ageHours: 12 }
      ];
      for (const input of cases) {
        const result = computePulseScore(input);
        for (const key of ['velocityScore', 'engagementScore', 'freshnessScore']) {
          if (result[key] < 0 || result[key] > 100) {
            throw new Error(`${key} = ${result[key]} out of range for input ${JSON.stringify(input)}`);
          }
        }
        if (result.pulseScore < 0 || result.pulseScore > 100) {
          throw new Error(`pulseScore = ${result.pulseScore} out of range`);
        }
      }
    }
  },

  // ─── PULSE_LABELS ───
  {
    name: 'PULSE_LABELS: has all four levels',
    fn() {
      const levels = ['hot', 'rising', 'normal', 'cooling'];
      for (const level of levels) {
        if (!PULSE_LABELS[level]) throw new Error(`Missing label for level: ${level}`);
      }
    }
  }
];
