/*
 * xg_growth.js - 浏览量增速快照与计算（纯函数，可测试）。
 * UMD 包装器：浏览器合并到 DraftPulseShared 命名空间，Node.js 走 module.exports。
 *
 * 快照结构只允许：
 * { tweetId, views, observedAt, publishedAt }
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    if (!global.DraftPulseShared) global.DraftPulseShared = {};
    Object.assign(global.DraftPulseShared, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SNAPSHOT_STORAGE_KEY = 'draftpulseViewSnapshotsV1';
  const SNAPSHOT_MIN_INTERVAL_MS = 3 * 60 * 1000;
  const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const SNAPSHOT_MAX_ENTRIES = 600;
  const MIN_AGE_FOR_RATE_MS = 60 * 1000;
  const FUTURE_DRIFT_MS = 5 * 60 * 1000;

  function normalizeSnapshotStore(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
    const result = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      if (!/^\d+$/.test(key) || !entry || typeof entry !== 'object') continue;
      const migrated = migrateLegacySnapshot(key, entry);
      if (!migrated) continue;
      result[key] = migrated;
    }
    return result;
  }

  function migrateLegacySnapshot(tweetId, entry) {
    let views = Number(entry.views);
    let observedAt = Number(entry.observedAt);
    const publishedAt = Number(entry.publishedAt) || 0;

    if (!Number.isFinite(views)) {
      const legacyLast = entry.last && typeof entry.last === 'object' ? entry.last : null;
      views = Number(legacyLast?.views ?? entry.first?.views ?? 0);
    }
    if (!Number.isFinite(observedAt)) {
      observedAt = Number(entry.last?.timestamp ?? entry.updatedAt ?? entry.first?.timestamp ?? 0);
    }
    if (!Number.isFinite(observedAt)) observedAt = 0;
    if (!Number.isFinite(views) || views < 0) return null;
    return { tweetId: String(tweetId), views: Math.round(views), observedAt, publishedAt };
  }

  function pruneSnapshotStore(store, options) {
    const opts = options || {};
    const now = Number(opts.now) || Date.now();
    const maxAgeMs = Number(opts.maxAgeMs) || SNAPSHOT_MAX_AGE_MS;
    const maxEntries = Number(opts.maxEntries) || SNAPSHOT_MAX_ENTRIES;
    const cutoff = now - maxAgeMs;
    const entries = Object.entries(store || {})
      .filter(([, entry]) => Number(entry?.observedAt || 0) >= cutoff)
      .sort((a, b) => Number(b[1]?.observedAt || 0) - Number(a[1]?.observedAt || 0))
      .slice(0, maxEntries);
    return Object.fromEntries(entries);
  }

  /*
   * 计算浏览增速。
   * input: { tweetId, publishedAt, views, now, snapshot, minIntervalMs, minAgeMs }
   * 返回：{ available, source, rate, averageRate, ageHours, intervalMinutes, snapshot }
   * source: 'unavailable' | 'fresh' | 'average' | 'observed'
   */
  function computeViewGrowth(input) {
    const result = {
      available: false,
      source: 'unavailable',
      rate: null,
      averageRate: null,
      ageHours: 0,
      intervalMinutes: null,
      snapshot: null
    };
    if (!input) return result;
    const now = Number(input.now) || Date.now();
    const publishedAt = Number(input.publishedAt);
    const views = Number(input.views);
    const tweetId = String(input.tweetId || '');
    const minIntervalMs = Number(input.minIntervalMs) || SNAPSHOT_MIN_INTERVAL_MS;
    const minAgeMs = Number(input.minAgeMs) || MIN_AGE_FOR_RATE_MS;

    if (!tweetId || !Number.isFinite(publishedAt) || publishedAt <= 0 || !Number.isFinite(views) || views < 0) {
      return result;
    }
    if (publishedAt > now + FUTURE_DRIFT_MS) return result;

    const ageMs = now - publishedAt;
    result.ageHours = Math.max(ageMs / 3600000, 1 / 60);
    result.averageRate = Math.max(0, views / result.ageHours);

    if (ageMs < minAgeMs) {
      result.available = true;
      result.source = 'fresh';
      result.rate = null;
      result.snapshot = { tweetId, views: Math.round(views), observedAt: now, publishedAt };
      return result;
    }

    const existing = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : null;
    if (!existing || !Number.isFinite(Number(existing.observedAt)) || !Number.isFinite(Number(existing.views))) {
      result.available = true;
      result.source = 'average';
      result.rate = result.averageRate;
      result.snapshot = { tweetId, views: Math.round(views), observedAt: now, publishedAt };
      return result;
    }

    const elapsedMs = now - Number(existing.observedAt);
    if (elapsedMs < minIntervalMs) {
      result.available = true;
      result.source = 'average';
      result.rate = result.averageRate;
      return result;
    }

    const delta = views - Number(existing.views);
    if (delta >= 0) {
      result.available = true;
      result.source = 'observed';
      result.rate = Math.max(0, delta / (elapsedMs / 3600000));
      result.intervalMinutes = Math.max(1, Math.round(elapsedMs / 60000));
      result.snapshot = { tweetId, views: Math.round(views), observedAt: now, publishedAt };
      return result;
    }

    // 浏览量下降：回退平均增速，保留旧 views 基线，仅刷新观察时间。
    result.available = true;
    result.source = 'average';
    result.rate = result.averageRate;
    result.snapshot = {
      tweetId,
      views: Math.round(Number(existing.views)),
      observedAt: now,
      publishedAt
    };
    return result;
  }

  const PULSE_WEIGHTS = Object.freeze({
    velocity: 0.5,
    engagement: 0.3,
    freshness: 0.2
  });

  const PULSE_LABELS = Object.freeze({
    hot: '🔥 Hot',
    rising: '↗ Rising',
    normal: '→ Normal',
    cooling: '↓ Cooling'
  });

  /*
   * Normalize a value to 0-100 scale using a soft ceiling.
   * Uses x / (x + halfMax) curve where halfMax is the value that maps to 50.
   */
  function normalizeToScore(value, halfMax) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const normalized = value / (value + halfMax);
    return Math.min(100, normalized * 100);
  }

  /*
   * Compute Pulse Score from growth and engagement data.
   * input: { viewRate, views, likes, replies, reposts, ageHours }
   * Returns: { pulseScore, level, velocityScore, engagementScore, freshnessScore }
   */
  function computePulseScore(input) {
    const result = {
      pulseScore: 0,
      level: 'normal',
      velocityScore: 0,
      engagementScore: 0,
      freshnessScore: 0
    };
    if (!input || typeof input !== 'object') return result;

    const viewRate = Number(input.viewRate);
    const views = Number(input.views);
    const likes = Number(input.likes) || 0;
    const replies = Number(input.replies) || 0;
    const reposts = Number(input.reposts) || 0;
    const ageHours = Number(input.ageHours);

    // Velocity score: views/hour, halfMax=500 (500 views/hr → score 50)
    if (Number.isFinite(viewRate) && viewRate > 0) {
      result.velocityScore = normalizeToScore(viewRate, 500);
    } else if (Number.isFinite(views) && Number.isFinite(ageHours) && ageHours > 0) {
      const avgRate = views / ageHours;
      result.velocityScore = normalizeToScore(avgRate, 500);
    }

    // Engagement score: (likes + replies*2 + reposts*1.5) / views * 100, halfMax=5
    if (views > 0) {
      const engagementRatio = (likes + replies * 2 + reposts * 1.5) / views * 100;
      result.engagementScore = normalizeToScore(engagementRatio, 5);
    }

    // Freshness score: newer = higher, halfMax=6 hours
    if (Number.isFinite(ageHours) && ageHours >= 0) {
      // Invert: fresh content gets high score
      const freshnessValue = Math.max(0, 48 - ageHours); // 48h window
      result.freshnessScore = normalizeToScore(freshnessValue, 6);
    }

    // Weighted total
    result.pulseScore = Math.round(
      result.velocityScore * PULSE_WEIGHTS.velocity +
      result.engagementScore * PULSE_WEIGHTS.engagement +
      result.freshnessScore * PULSE_WEIGHTS.freshness
    );

    // Determine level
    if (result.pulseScore >= 70) result.level = 'hot';
    else if (result.pulseScore >= 45) result.level = 'rising';
    else if (result.pulseScore >= 20) result.level = 'normal';
    else result.level = 'cooling';

    return result;
  }

  return {
    SNAPSHOT_STORAGE_KEY,
    SNAPSHOT_MIN_INTERVAL_MS,
    SNAPSHOT_MAX_AGE_MS,
    SNAPSHOT_MAX_ENTRIES,
    MIN_AGE_FOR_RATE_MS,
    PULSE_WEIGHTS,
    PULSE_LABELS,
    normalizeSnapshotStore,
    migrateLegacySnapshot,
    pruneSnapshotStore,
    computeViewGrowth,
    computePulseScore,
    normalizeToScore
  };
});
