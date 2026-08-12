'use strict';

const assert = require('node:assert');

globalThis.DraftPulseShared = {};
Object.assign(globalThis.DraftPulseShared, require('../shared/xg_response.js'));
Object.assign(globalThis.DraftPulseShared, require('../shared/xg_prompt.js'));
const { normalizeReplyCandidates, stripReplyPrefix } = require('../shared/xg_reply.js');

function normalize(value, options) {
  return normalizeReplyCandidates(value, 'Gemini', options || {});
}

const tests = [
  {
    name: '“回复：”前缀清理',
    fn() {
      assert.deepStrictEqual(normalize('回复：这是一条回复'), ['这是一条回复']);
      assert.deepStrictEqual(normalize('reply: hi there'), ['hi there']);
    }
  },
  {
    name: '引号包裹清理',
    fn() {
      assert.deepStrictEqual(normalize('“带引号的内容”'), ['带引号的内容']);
      assert.deepStrictEqual(normalize('"quoted"'), ['quoted']);
    }
  },
  {
    name: '空内容抛错',
    fn() {
      assert.throws(() => normalize(''), /空内容/);
      assert.throws(() => normalize('   '), /空内容/);
      assert.throws(() => normalize(null), /空内容/);
    }
  },
  {
    name: '3 条候选拆分',
    fn() {
      const result = normalize('[候选1] 第一条\n[候选2] 第二条\n[候选3] 第三条', { replyCount: 3 });
      assert.deepStrictEqual(result, ['第一条', '第二条', '第三条']);
    }
  },
  {
    name: '重复候选去重',
    fn() {
      const result = normalize('[候选1] 相同\n[候选2] 相同', { replyCount: 3 });
      assert.strictEqual(result.length, 1);
    }
  },
  {
    name: '长度截断（中文按码点）',
    fn() {
      const result = normalize('这是一条很长很长的回复内容', { maxReplyLength: 6 });
      assert.strictEqual(result[0], '这是一条很…');
    }
  },
  {
    name: '单条模式不拆分',
    fn() {
      const result = normalize('[候选1] 不要拆\n[候选2] 不要拆', { replyCount: 1 });
      assert.strictEqual(result.length, 1);
    }
  },
  {
    name: '拼接重复回答折叠',
    fn() {
      const half = '这段文字用于测试拼接重复的折叠';
      assert.deepStrictEqual(normalize(half + half), [half]);
    }
  }
];

module.exports = { tests };
