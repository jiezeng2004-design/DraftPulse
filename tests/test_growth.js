'use strict';

const assert = require('node:assert');
const {
  computeViewGrowth,
  normalizeSnapshotStore,
  pruneSnapshotStore,
  migrateLegacySnapshot,
  computePulseScore,
  normalizeToScore,
  PULSE_WEIGHTS,
  PULSE_LABELS
} = require('../shared/xg_growth.js');

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN_INTERVAL = 3 * 60 * 1000;

function growth(overrides) {
  return computeViewGrowth({
    tweetId: '111',
    publishedAt: NOW - 4 * 3600000,
    views: 6200,
    now: NOW,
    minIntervalMs: MIN_INTERVAL,
    ...overrides
  });
}

const tests = [
  {
    name: '正常平均增速',
    fn() {
      const result = growth({});
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.source, 'average');
      assert.strictEqual(result.rate, 6200 / 4);
      assert.strictEqual(result.snapshot.views, 6200);
    }
  },
  {
    name: '两次快照的近次增速',
    fn() {
      const previous = { tweetId: '111', views: 5000, observedAt: NOW - 12 * 60 * 1000, publishedAt: NOW - 4 * 3600000 };
      const result = growth({ views: 6200, snapshot: previous });
      assert.strictEqual(result.source, 'observed');
      assert.strictEqual(result.rate, 1200 / 0.2);
      assert.strictEqual(result.intervalMinutes, 12);
      assert.strictEqual(result.snapshot.views, 6200);
    }
  },
  {
    name: '时间间隔过短回退平均',
    fn() {
      const previous = { tweetId: '111', views: 5000, observedAt: NOW - 60 * 1000, publishedAt: NOW - 4 * 3600000 };
      const result = growth({ views: 6200, snapshot: previous });
      assert.strictEqual(result.source, 'average');
      assert.strictEqual(result.rate, 6200 / 4);
      assert.strictEqual(result.snapshot, null);
    }
  },
  {
    name: '浏览量下降回退平均并保留基线',
    fn() {
      const previous = { tweetId: '111', views: 6200, observedAt: NOW - 12 * 60 * 1000, publishedAt: NOW - 4 * 3600000 };
      const result = growth({ views: 6000, snapshot: previous });
      assert.strictEqual(result.source, 'average');
      assert.strictEqual(result.rate, 6000 / 4);
      assert.strictEqual(result.snapshot.views, 6200);
      assert.strictEqual(result.snapshot.observedAt, NOW);
    }
  },
  {
    name: '发布时间缺失不可用',
    fn() {
      const result = growth({ publishedAt: 0 });
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.source, 'unavailable');
    }
  },
  {
    name: '刚发布推文显示 fresh 不产生巨大数值',
    fn() {
      const result = growth({ publishedAt: NOW - 30 * 1000, views: 5000 });
      assert.strictEqual(result.source, 'fresh');
      assert.strictEqual(result.rate, null);
      assert.strictEqual(result.available, true);
    }
  },
  {
    name: '时间异常（未来时间）不可用',
    fn() {
      const result = growth({ publishedAt: NOW + 3600000 });
      assert.strictEqual(result.available, false);
    }
  },
  {
    name: '跨天快照增速',
    fn() {
      const previous = { tweetId: '111', views: 10000, observedAt: NOW - 25 * 3600000, publishedAt: NOW - 30 * 3600000 };
      const result = growth({ views: 10000 + 500, snapshot: previous });
      assert.strictEqual(result.source, 'observed');
      assert.strictEqual(result.rate, 500 / 25);
      assert.strictEqual(result.intervalMinutes, 1500);
    }
  },
  {
    name: '快照迁移：v1.4.0 旧结构',
    fn() {
      const legacy = { first: { views: 100, timestamp: NOW - 3600000 }, last: { views: 200, timestamp: NOW - 60000 }, recentRate: 3, updatedAt: NOW - 60000 };
      const migrated = migrateLegacySnapshot('222', legacy);
      assert.strictEqual(migrated.views, 200);
      assert.strictEqual(migrated.observedAt, NOW - 60000);
      assert.deepStrictEqual(Object.keys(migrated).sort(), ['observedAt', 'publishedAt', 'tweetId', 'views']);
    }
  },
  {
    name: '快照存储清洗与裁剪',
    fn() {
      const store = normalizeSnapshotStore({
        '1': { tweetId: '1', views: 10, observedAt: NOW - 60000, publishedAt: NOW - 3600000 },
        '2': { tweetId: '2', views: 20, observedAt: NOW - 20 * 24 * 3600000, publishedAt: NOW - 30 * 24 * 3600000 },
        bad: { views: 1 },
        '3': 'junk'
      });
      assert.strictEqual(Object.keys(store).length, 2);
      const pruned = pruneSnapshotStore(store, { now: NOW });
      assert.deepStrictEqual(Object.keys(pruned), ['1']);
      const capped = pruneSnapshotStore({ '1': { observedAt: NOW }, '2': { observedAt: NOW - 1000 } }, { now: NOW, maxEntries: 1 });
      assert.strictEqual(Object.keys(capped).length, 1);
    }
  },
  // Pulse Score tests
  {
    name: 'computePulseScore: null input returns defaults',
    fn: () => {
      const r = computePulseScore(null);
      assert(r.pulseScore === 0);
      assert(r.level === 'normal');
    }
  },
  {
    name: 'computePulseScore: high velocity → hot',
    fn: () => {
      const r = computePulseScore({ viewRate: 5000, views: 50000, likes: 500, replies: 200, reposts: 100, ageHours: 10 });
      assert(r.pulseScore > 0);
      assert(r.velocityScore > 50);
      assert(['hot', 'rising'].includes(r.level));
    }
  },
  {
    name: 'computePulseScore: low engagement → cooling',
    fn: () => {
      const r = computePulseScore({ viewRate: 10, views: 100, likes: 0, replies: 0, reposts: 0, ageHours: 48 });
      assert(r.pulseScore < 20);
      assert(r.level === 'cooling');
    }
  },
  {
    name: 'computePulseScore: NaN/Infinity safe',
    fn: () => {
      const r = computePulseScore({ viewRate: NaN, views: Infinity, likes: NaN, replies: NaN, reposts: NaN, ageHours: NaN });
      assert(r.pulseScore === 0);
      assert(!Number.isNaN(r.pulseScore));
    }
  },
  {
    name: 'computePulseScore: negative views safe',
    fn: () => {
      const r = computePulseScore({ viewRate: -100, views: -50, likes: -10, replies: -5, reposts: -3, ageHours: 5 });
      assert(r.pulseScore >= 0);
    }
  },
  {
    name: 'computePulseScore: fresh content gets freshness bonus',
    fn: () => {
      const fresh = computePulseScore({ viewRate: 100, views: 1000, likes: 50, replies: 20, reposts: 10, ageHours: 1 });
      const old = computePulseScore({ viewRate: 100, views: 1000, likes: 50, replies: 20, reposts: 10, ageHours: 40 });
      assert(fresh.freshnessScore > old.freshnessScore);
    }
  },
  {
    name: 'computePulseScore: high engagement ratio',
    fn: () => {
      const r = computePulseScore({ viewRate: 100, views: 1000, likes: 200, replies: 100, reposts: 50, ageHours: 6 });
      assert(r.engagementScore > 50);
    }
  },
  {
    name: 'PULSE_WEIGHTS are frozen',
    fn: () => {
      assert(Object.isFrozen(PULSE_WEIGHTS));
    }
  },
  {
    name: 'PULSE_LABELS are frozen',
    fn: () => {
      assert(Object.isFrozen(PULSE_LABELS));
    }
  }
];

module.exports = { tests };
