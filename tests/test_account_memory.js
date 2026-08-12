(function () {
  'use strict';
  const DP = require('../shared/xg_account_memory.js');

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message || 'assertEqual') + `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  const tests = [];

  // ── Constants ──────────────────────────────────────────────────────────────
  tests.push({
    name: 'ACCOUNT_MEMORY_KEY is correct',
    fn: () => {
      assertEqual(DP.ACCOUNT_MEMORY_KEY, 'draftpulseAccountMemoryV1');
    }
  });

  tests.push({
    name: 'MAX_ACCOUNTS is 20',
    fn: () => {
      assertEqual(DP.MAX_ACCOUNTS, 20);
    }
  });

  // ── normalizeAccountMemoryStore ─────────────────────────────────────────────
  tests.push({
    name: 'normalizeAccountMemoryStore: null returns empty object',
    fn: () => {
      const result = DP.normalizeAccountMemoryStore(null);
      assert(typeof result === 'object');
      assert(Object.keys(result).length === 0);
    }
  });

  tests.push({
    name: 'normalizeAccountMemoryStore: undefined returns empty object',
    fn: () => {
      const result = DP.normalizeAccountMemoryStore(undefined);
      assert(Object.keys(result).length === 0);
    }
  });

  tests.push({
    name: 'normalizeAccountMemoryStore: array returns empty object',
    fn: () => {
      const result = DP.normalizeAccountMemoryStore([1, 2, 3]);
      assert(Object.keys(result).length === 0);
    }
  });

  tests.push({
    name: 'normalizeAccountMemoryStore: strips invalid entries',
    fn: () => {
      const result = DP.normalizeAccountMemoryStore({
        user1: { persona: 'professional', language: 'en' },
        user2: null,
        user3: 'invalid',
        user4: { unknownField: 'value' }
      });
      assert(result.user1 !== undefined, 'user1 should be kept');
      assertEqual(result.user1.persona, 'professional');
      assertEqual(result.user1.language, 'en');
      assert(result.user2 === undefined, 'null entry should be dropped');
      assert(result.user3 === undefined, 'string entry should be dropped');
      // user4 has only unknownField which is not in ALLOWED_ENTRY_KEYS
      assert(result.user4 === undefined, 'entry with only unknown fields should be dropped');
    }
  });

  tests.push({
    name: 'normalizeAccountMemoryStore: lowercases keys',
    fn: () => {
      const result = DP.normalizeAccountMemoryStore({
        TestUser: { persona: 'casual' }
      });
      assert(result.testuser !== undefined, 'key should be lowercased');
      assert(result.TestUser === undefined, 'original case key should not exist');
    }
  });

  tests.push({
    name: 'normalizeAccountMemoryStore: keeps lastUsedAt as number',
    fn: () => {
      const ts = 1700000000000;
      const result = DP.normalizeAccountMemoryStore({
        user1: { lastUsedAt: ts, persona: 'professional' }
      });
      assertEqual(result.user1.lastUsedAt, ts);
    }
  });

  tests.push({
    name: 'normalizeAccountMemoryStore: drops non-finite lastUsedAt',
    fn: () => {
      const result = DP.normalizeAccountMemoryStore({
        user1: { lastUsedAt: 'not-a-number', persona: 'professional' }
      });
      // persona is still valid, so entry should exist
      assert(result.user1 !== undefined);
      assert(result.user1.lastUsedAt === undefined, 'non-finite lastUsedAt should be dropped');
      assertEqual(result.user1.persona, 'professional');
    }
  });

  // ── getAccountDefaults ──────────────────────────────────────────────────────
  tests.push({
    name: 'getAccountDefaults: returns null for null store',
    fn: () => {
      assert(DP.getAccountDefaults(null, 'user1') === null);
    }
  });

  tests.push({
    name: 'getAccountDefaults: returns null for unknown account',
    fn: () => {
      const store = { user1: { persona: 'professional', lastUsedAt: 1000 } };
      assert(DP.getAccountDefaults(store, 'unknown') === null);
    }
  });

  tests.push({
    name: 'getAccountDefaults: case-insensitive lookup',
    fn: () => {
      const store = { testuser: { persona: 'casual', lastUsedAt: 1000 } };
      const result = DP.getAccountDefaults(store, 'TestUser');
      assert(result !== null);
      assertEqual(result.persona, 'casual');
    }
  });

  tests.push({
    name: 'getAccountDefaults: returns null for empty accountId',
    fn: () => {
      const store = { user1: { persona: 'professional', lastUsedAt: 1000 } };
      assert(DP.getAccountDefaults(store, '') === null);
      assert(DP.getAccountDefaults(store, null) === null);
    }
  });

  tests.push({
    name: 'getAccountDefaults: returns entry with all fields',
    fn: () => {
      const store = {
        user1: { persona: 'humorous', language: 'ja', replyStyle: 'witty', lastUsedAt: 5000 }
      };
      const result = DP.getAccountDefaults(store, 'user1');
      assertEqual(result.persona, 'humorous');
      assertEqual(result.language, 'ja');
      assertEqual(result.replyStyle, 'witty');
      assertEqual(result.lastUsedAt, 5000);
    }
  });

  // ── setAccountDefaults ──────────────────────────────────────────────────────
  tests.push({
    name: 'setAccountDefaults: creates new entry',
    fn: () => {
      const result = DP.setAccountDefaults({}, 'user1', { persona: 'professional' });
      assert(result.user1 !== undefined);
      assertEqual(result.user1.persona, 'professional');
      assert(result.user1.lastUsedAt > 0);
    }
  });

  tests.push({
    name: 'setAccountDefaults: updates existing entry',
    fn: () => {
      const store = { user1: { persona: 'casual', lastUsedAt: 1000 } };
      const result = DP.setAccountDefaults(store, 'user1', { persona: 'professional' });
      assertEqual(result.user1.persona, 'professional');
    }
  });

  tests.push({
    name: 'setAccountDefaults: prunes to MAX_ACCOUNTS',
    fn: () => {
      // Create 25 accounts
      const store = {};
      for (let i = 0; i < 25; i++) {
        store[`user${i}`] = { persona: 'casual', lastUsedAt: i * 1000 };
      }
      const result = DP.setAccountDefaults(store, 'newuser', { persona: 'professional' });
      const keyCount = Object.keys(result).length;
      assert(keyCount <= DP.MAX_ACCOUNTS, `Expected at most ${DP.MAX_ACCOUNTS} accounts, got ${keyCount}`);
      // newuser should be kept since it has the latest lastUsedAt
      assert(result.newuser !== undefined, 'newly added user should be kept');
    }
  });

  tests.push({
    name: 'setAccountDefaults: empty accountId returns normalized store',
    fn: () => {
      const store = { user1: { persona: 'professional', lastUsedAt: 1000 } };
      const result = DP.setAccountDefaults(store, '', { persona: 'casual' });
      assert(result.user1 !== undefined, 'existing entries should be preserved');
    }
  });

  tests.push({
    name: 'setAccountDefaults: preserves existing fields when not overridden',
    fn: () => {
      const store = { user1: { persona: 'professional', language: 'en', lastUsedAt: 1000 } };
      const result = DP.setAccountDefaults(store, 'user1', { persona: 'casual' });
      assertEqual(result.user1.persona, 'casual');
      assertEqual(result.user1.language, 'en', 'language should be preserved');
    }
  });

  // ── mergeAccountOverrides ───────────────────────────────────────────────────
  tests.push({
    name: 'mergeAccountOverrides: returns overrides object',
    fn: () => {
      const globalSettings = { replyPersona: 'professional', replyLanguage: 'en' };
      const accountDefaults = { persona: 'humorous', language: 'ja' };
      const overrides = DP.mergeAccountOverrides(globalSettings, accountDefaults);
      assertEqual(overrides.replyPersona, 'humorous');
      assertEqual(overrides.replyLanguage, 'ja');
    }
  });

  tests.push({
    name: 'mergeAccountOverrides: null accountDefaults returns empty object',
    fn: () => {
      const overrides = DP.mergeAccountOverrides({}, null);
      assert(Object.keys(overrides).length === 0);
    }
  });

  tests.push({
    name: 'mergeAccountOverrides: only overrides provided fields',
    fn: () => {
      const accountDefaults = { persona: 'casual', language: null, replyStyle: null };
      const overrides = DP.mergeAccountOverrides({}, accountDefaults);
      assertEqual(overrides.replyPersona, 'casual');
      assert(overrides.replyLanguage === undefined, 'null language should not override');
      assert(overrides.customReplyStyle === undefined, 'null replyStyle should not override');
    }
  });

  tests.push({
    name: 'mergeAccountOverrides: maps replyStyle to customReplyStyle',
    fn: () => {
      const accountDefaults = { replyStyle: 'witty and short' };
      const overrides = DP.mergeAccountOverrides({}, accountDefaults);
      assertEqual(overrides.customReplyStyle, 'witty and short');
    }
  });

  // ── detectCurrentXAccount ───────────────────────────────────────────────────
  tests.push({
    name: 'detectCurrentXAccount: returns null without DOM',
    fn: () => {
      // In Node.js there is no document, so it should return null
      const result = DP.detectCurrentXAccount({ x: {} });
      assert(result === null);
    }
  });

  tests.push({
    name: 'detectCurrentXAccount: returns null for null selectors',
    fn: () => {
      const result = DP.detectCurrentXAccount(null);
      assert(result === null);
    }
  });

  module.exports = { tests };
})();
