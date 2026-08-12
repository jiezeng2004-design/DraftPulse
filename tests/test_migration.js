'use strict';

const assert = require('node:assert');
const { normalizeSettings, DEFAULT_SETTINGS, normalizeMyVoice } = require('../shared/xg_settings.js');
const { normalizeSnapshotStore, pruneSnapshotStore } = require('../shared/xg_growth.js');
const { normalizeAccountMemoryStore } = require('../shared/xg_account_memory.js');

const tests = [
  // ── normalizeSettings 空/非法输入 ──────────────────────────────────────────
  {
    name: 'normalizeSettings({}) 返回完整默认结构',
    fn() {
      const result = normalizeSettings({});
      assert.strictEqual(result.extensionEnabled, DEFAULT_SETTINGS.extensionEnabled);
      assert.strictEqual(result.selectedProvider, 'gemini');
      assert.strictEqual(result.replyPersona, 'professional');
      assert.strictEqual(result.draftPanelMode, 'auto_fill');
      assert.strictEqual(result.threadContextMode, 'smart');
      assert.strictEqual(result.generationCooldownSeconds, 30);
      assert.ok(result.myVoice && result.myVoice.enabled === false);
    }
  },
  {
    name: 'normalizeSettings(null) 不抛错，返回默认结构',
    fn() {
      const result = normalizeSettings(null);
      assert.strictEqual(result.extensionEnabled, true);
      assert.strictEqual(result.replyPersona, 'professional');
      assert.strictEqual(result.draftPanelMode, 'auto_fill');
    }
  },
  {
    name: 'normalizeSettings(undefined) 不抛错，返回默认结构',
    fn() {
      const result = normalizeSettings(undefined);
      assert.strictEqual(result.extensionEnabled, true);
      assert.strictEqual(result.draftPanelMode, 'auto_fill');
      assert.strictEqual(result.myVoice.enabled, false);
    }
  },
  {
    name: 'normalizeSettings 处理旧版设置（缺少新字段）',
    fn() {
      const legacy = { replyPersona: 'humorous', replyLanguage: 'en', selectedProvider: 'chatgpt' };
      const result = normalizeSettings(legacy);
      // 旧字段保留
      assert.strictEqual(result.replyPersona, 'humorous');
      assert.strictEqual(result.replyLanguage, 'en');
      assert.strictEqual(result.selectedProvider, 'chatgpt');
      // 新字段回退默认
      assert.strictEqual(result.threadContextMode, DEFAULT_SETTINGS.threadContextMode);
      assert.strictEqual(result.generationCooldownSeconds, DEFAULT_SETTINGS.generationCooldownSeconds);
      assert.strictEqual(result.draftPanelMode, DEFAULT_SETTINGS.draftPanelMode);
      assert.ok(result.myVoice && result.myVoice.enabled === false);
    }
  },
  {
    name: 'normalizeSettings 旧版缺少 myVoice 时 myVoice 有默认结构',
    fn() {
      const legacy = { replyPersona: 'questioning' };
      const result = normalizeSettings(legacy);
      assert.ok(result.myVoice);
      assert.strictEqual(result.myVoice.enabled, false);
      assert.strictEqual(result.myVoice.description, '');
      assert.ok(Array.isArray(result.myVoice.samples));
      assert.ok(Array.isArray(result.myVoice.forbiddenPhrases));
    }
  },

  // ── normalizeSnapshotStore 空/非法输入 ─────────────────────────────────────
  {
    name: 'normalizeSnapshotStore(null) 返回空对象',
    fn() {
      const result = normalizeSnapshotStore(null);
      assert.ok(result && typeof result === 'object');
      assert.deepStrictEqual(Object.keys(result), []);
    }
  },
  {
    name: 'normalizeSnapshotStore(undefined) 返回空对象',
    fn() {
      const result = normalizeSnapshotStore(undefined);
      assert.ok(result && typeof result === 'object');
      assert.deepStrictEqual(Object.keys(result), []);
    }
  },
  {
    name: 'normalizeSnapshotStore({}) 返回空对象',
    fn() {
      const result = normalizeSnapshotStore({});
      assert.ok(result && typeof result === 'object');
      assert.deepStrictEqual(Object.keys(result), []);
    }
  },
  {
    name: 'normalizeSnapshotStore 过滤非数字 key 和无效条目',
    fn() {
      const result = normalizeSnapshotStore({
        'abc': { views: 100, observedAt: Date.now() },
        '12345': { views: 500, observedAt: Date.now() },
        'notanumber': null
      });
      assert.ok(!result['abc']);
      assert.ok(result['12345']);
      assert.strictEqual(result['12345'].views, 500);
    }
  },
  {
    name: 'normalizeSnapshotStore(数组) 返回空对象',
    fn() {
      const result = normalizeSnapshotStore([1, 2, 3]);
      assert.ok(result && typeof result === 'object');
      assert.deepStrictEqual(Object.keys(result), []);
    }
  },

  // ── normalizeAccountMemoryStore 空/非法输入 ────────────────────────────────
  {
    name: 'normalizeAccountMemoryStore(null) 返回空对象',
    fn() {
      const result = normalizeAccountMemoryStore(null);
      assert.deepStrictEqual(result, {});
    }
  },
  {
    name: 'normalizeAccountMemoryStore(undefined) 返回空对象',
    fn() {
      const result = normalizeAccountMemoryStore(undefined);
      assert.deepStrictEqual(result, {});
    }
  },
  {
    name: 'normalizeAccountMemoryStore({}) 返回空对象',
    fn() {
      const result = normalizeAccountMemoryStore({});
      assert.deepStrictEqual(result, {});
    }
  },
  {
    name: 'normalizeAccountMemoryStore 过滤无效条目',
    fn() {
      const result = normalizeAccountMemoryStore({
        'user1': { persona: 'humorous', language: 'en' },
        'user2': null,
        'user3': 'invalid',
        'user4': { persona: 'developer' }
      });
      assert.ok(result['user1']);
      assert.strictEqual(result['user1'].persona, 'humorous');
      assert.ok(!result['user2']);
      assert.ok(!result['user3']);
      assert.ok(result['user4']);
      assert.strictEqual(result['user4'].persona, 'developer');
    }
  },
  {
    name: 'normalizeAccountMemoryStore(数组) 返回空对象',
    fn() {
      const result = normalizeAccountMemoryStore([1, 2]);
      assert.deepStrictEqual(result, {});
    }
  },

  // ── 向后兼容 ───────────────────────────────────────────────────────────────
  {
    name: '所有 normalize 函数对完全空输入向后兼容',
    fn() {
      // normalizeSettings
      const settings = normalizeSettings({});
      assert.ok(settings && typeof settings === 'object');
      // normalizeSnapshotStore
      const snapshots = normalizeSnapshotStore({});
      assert.ok(snapshots && typeof snapshots === 'object');
      // normalizeAccountMemoryStore
      const memory = normalizeAccountMemoryStore({});
      assert.ok(memory && typeof memory === 'object');
      // pruneSnapshotStore 也能处理空输入
      const pruned = pruneSnapshotStore(snapshots);
      assert.ok(pruned && typeof pruned === 'object');
    }
  },
  {
    name: 'normalizeMyVoice 处理 null/undefined/空对象',
    fn() {
      const nullResult = normalizeMyVoice(null);
      assert.strictEqual(nullResult.enabled, false);
      assert.strictEqual(nullResult.description, '');
      const undefResult = normalizeMyVoice(undefined);
      assert.strictEqual(undefResult.enabled, false);
      const emptyResult = normalizeMyVoice({});
      assert.strictEqual(emptyResult.enabled, false);
      assert.ok(Array.isArray(emptyResult.samples));
      assert.ok(Array.isArray(emptyResult.forbiddenPhrases));
    }
  }
];

module.exports = { tests };
