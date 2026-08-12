'use strict';

const assert = require('node:assert');
const { normalizeSettings, DEFAULT_SETTINGS } = require('../shared/xg_settings.js');
const { splitReplyCandidates } = require('../shared/xg_prompt.js');

const tests = [
  {
    name: 'draftPanelMode 默认值为 auto_fill',
    fn() {
      const settings = normalizeSettings({});
      assert.strictEqual(settings.draftPanelMode, 'auto_fill');
      assert.strictEqual(DEFAULT_SETTINGS.draftPanelMode, 'auto_fill');
    }
  },
  {
    name: 'draftPanelMode 合法值 panel 被保留',
    fn() {
      const settings = normalizeSettings({ draftPanelMode: 'panel' });
      assert.strictEqual(settings.draftPanelMode, 'panel');
    }
  },
  {
    name: 'draftPanelMode 非法值回退 auto_fill',
    fn() {
      assert.strictEqual(normalizeSettings({ draftPanelMode: 'invalid' }).draftPanelMode, 'auto_fill');
      assert.strictEqual(normalizeSettings({ draftPanelMode: 'auto' }).draftPanelMode, 'auto_fill');
      assert.strictEqual(normalizeSettings({ draftPanelMode: '' }).draftPanelMode, 'auto_fill');
      assert.strictEqual(normalizeSettings({ draftPanelMode: null }).draftPanelMode, 'auto_fill');
      assert.strictEqual(normalizeSettings({ draftPanelMode: 0 }).draftPanelMode, 'auto_fill');
    }
  },
  {
    name: 'draftPanelMode 通过 normalizeSettings 往返保持一致',
    fn() {
      const original = { draftPanelMode: 'panel', replyPersona: 'humorous', replyLanguage: 'en' };
      const normalized = normalizeSettings(original);
      const roundTripped = normalizeSettings(normalized);
      assert.strictEqual(roundTripped.draftPanelMode, 'panel');
      assert.strictEqual(roundTripped.replyPersona, 'humorous');
      assert.strictEqual(roundTripped.replyLanguage, 'en');
    }
  },
  {
    name: 'CANDIDATE_STYLE_LABELS 概念：splitReplyCandidates 正确解析 3 条带标记的候选',
    fn() {
      // CANDIDATE_STYLE_LABELS = ['Insightful · 深度洞察', 'Casual · 轻松随意', 'Short · 简短精炼']
      // 对应 splitReplyCandidates 在 replyCount=3 时解析 3 个候选块。
      const reply = '[候选1] This is the insightful reply.\n[候选2] Casual reply here.\n[候选3] Short one.';
      const candidates = splitReplyCandidates(reply, 3);
      assert.strictEqual(candidates.length, 3);
      assert.ok(candidates[0].includes('insightful reply'));
      assert.ok(candidates[1].includes('Casual reply'));
      assert.ok(candidates[2].includes('Short one'));
    }
  },
  {
    name: 'splitReplyCandidates 在 replyCount=1 时返回单元素数组',
    fn() {
      const reply = 'Just a single reply.';
      const candidates = splitReplyCandidates(reply, 1);
      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0], 'Just a single reply.');
    }
  },
  {
    name: 'splitReplyCandidates 空输入返回空数组',
    fn() {
      assert.deepStrictEqual(splitReplyCandidates('', 3), []);
      assert.deepStrictEqual(splitReplyCandidates(null, 3), []);
    }
  },
  {
    name: 'splitReplyCandidates 无标记时在 replyCount=3 仍返回单元素',
    fn() {
      const reply = 'No markers here.';
      const candidates = splitReplyCandidates(reply, 3);
      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0], 'No markers here.');
    }
  }
];

module.exports = { tests };
