'use strict';

const assert = require('node:assert');
const { decideFill, pickReplyEditor, sanitizeReplyForEditor, normalizeForCompare } = require('../shared/xg_editor.js');

const tests = [
  {
    name: '空回复框直接填入',
    fn() {
      assert.strictEqual(decideFill({ editorText: '', replyText: '新回复' }).action, 'fill');
      assert.strictEqual(decideFill({ editorText: '   ', replyText: '新回复' }).action, 'fill');
    }
  },
  {
    name: '已有相同内容不重复插入',
    fn() {
      assert.strictEqual(decideFill({ editorText: '相同内容', replyText: '相同内容' }).action, 'skip');
      assert.strictEqual(decideFill({ editorText: '相同\n内容', replyText: '相同 内容' }).action, 'skip');
      assert.strictEqual(decideFill({ editorText: '相同  内容', replyText: '相同内容' }).action, 'blocked');
    }
  },
  {
    name: '已有用户手写内容不得覆盖',
    fn() {
      assert.strictEqual(decideFill({ editorText: '用户自己写的内容', replyText: '模型回复' }).action, 'blocked');
    }
  },
  {
    name: '空回答视为 blocked',
    fn() {
      assert.strictEqual(decideFill({ editorText: '', replyText: '   ' }).action, 'blocked');
    }
  },
  {
    name: '多回复框选第一个可见',
    fn() {
      const a = { id: 'a' };
      const b = { id: 'b' };
      assert.strictEqual(pickReplyEditor([a, b]), a);
      assert.strictEqual(pickReplyEditor([]), null);
      assert.strictEqual(pickReplyEditor(null), null);
    }
  },
  {
    name: '回填文本清洗',
    fn() {
      assert.strictEqual(sanitizeReplyForEditor('  hello\x00\n  world  '), 'hello\nworld');
    }
  },
  {
    name: '比较折叠连续空白为单个空格',
    fn() {
      assert.strictEqual(normalizeForCompare('a\n b  c'), 'a b c');
      assert.notStrictEqual(normalizeForCompare('a b'), normalizeForCompare('ab'));
      assert.strictEqual(normalizeForCompare('第一行\n第二行'), normalizeForCompare('第一行 第二行'));
    }
  },
  {
    name: '仅空白差异视为相同，缺词视为不同',
    fn() {
      assert.strictEqual(decideFill({ editorText: 'hello\nworld', replyText: 'hello world' }).action, 'skip');
      assert.strictEqual(decideFill({ editorText: 'hello world', replyText: 'helloworld' }).action, 'blocked');
    }
  },
  {
    name: '比较忽略首尾空白',
    fn() {
      assert.strictEqual(normalizeForCompare('  文本  '), normalizeForCompare('文本'));
      assert.strictEqual(normalizeForCompare('第一行\n第二行'), normalizeForCompare('第一行 第二行'));
    }
  },
  {
    name: '多行相同内容判定为 skip',
    fn() {
      assert.strictEqual(decideFill({ editorText: '第一行\n第二行', replyText: '第一行 第二行' }).action, 'skip');
      assert.strictEqual(decideFill({ editorText: '第一行\n第二行', replyText: '第一行\n第三行' }).action, 'blocked');
    }
  }
];

module.exports = { tests };
