'use strict';

const assert = require('node:assert');
const {
  dedupeResponseText,
  findNewResponse,
  isResponseStable,
  createRequestGuard
} = require('../shared/xg_response.js');

const tests = [
  {
    name: '完整段落重复折叠',
    fn() {
      const text = '第一段内容\n第二段内容\n第一段内容\n第二段内容';
      assert.strictEqual(dedupeResponseText(text), '第一段内容\n第二段内容');
    }
  },
  {
    name: '两次相同文本拼接折叠',
    fn() {
      const half = '这是一段比较长的回答内容，用来测试拼接重复';
      assert.strictEqual(dedupeResponseText(`${half}${half}`), half);
    }
  },
  {
    name: 'DOM 嵌套导致的重复行清理',
    fn() {
      const text = 'A 行内容\nB 行内容\nA 行内容\nC 行内容';
      assert.strictEqual(dedupeResponseText(text), 'A 行内容\nB 行内容\nC 行内容');
    }
  },
  {
    name: '正常回答不受影响',
    fn() {
      const text = '这是唯一的一段正常回答。';
      assert.strictEqual(dedupeResponseText(text), text);
    }
  },
  {
    name: '流式回答定位新节点',
    fn() {
      const baseline = { lastIndex: 2, lastText: '旧回答' };
      const found = findNewResponse([
        { index: 1, text: '用户消息', isUser: true },
        { index: 2, text: '旧回答', isUser: false },
        { index: 3, text: '新回答第一段', isUser: false }
      ], baseline);
      assert.ok(found);
      assert.strictEqual(found.text, '新回答第一段');
    }
  },
  {
    name: '旧回答存在时只读新增节点',
    fn() {
      const baseline = { lastIndex: 2, lastText: '旧回答' };
      const found = findNewResponse([
        { index: 1, text: '旧回答', isUser: false },
        { index: 2, text: '旧回答', isUser: false }
      ], baseline);
      assert.strictEqual(found, null);
    }
  },
  {
    name: '流式回答复用最后节点（节点数不增）时按文本变化识别',
    fn() {
      const baseline = { lastIndex: 3, lastText: '旧回答' };
      const found = findNewResponse([
        { index: 1, text: '用户消息', isUser: true },
        { index: 2, text: '旧回答', isUser: false },
        { index: 3, text: '新回答', isUser: false }
      ], baseline);
      assert.ok(found, '复用节点文本变化未被识别为新回答');
      assert.strictEqual(found.text, '新回答');
    }
  },
  {
    name: '复用节点但文本未变化时不误报',
    fn() {
      const baseline = { lastIndex: 3, lastText: '相同文本' };
      const found = findNewResponse([
        { index: 1, text: '相同文本', isUser: false },
        { index: 2, text: '相同文本', isUser: false },
        { index: 3, text: '相同文本', isUser: false }
      ], baseline);
      assert.strictEqual(found, null);
    }
  },
  {
    name: '复用节点且最后为空的用户消息时仍识别文本变化',
    fn() {
      const baseline = { lastIndex: 2, lastText: '旧文本' };
      const found = findNewResponse([
        { index: 1, text: '旧文本', isUser: false },
        { index: 2, text: '新文本', isUser: false },
        { index: 3, text: '', isUser: true }
      ], baseline);
      assert.ok(found);
      assert.strictEqual(found.text, '新文本');
    }
  },
  {
    name: '多个回答节点取新增的最后一个',
    fn() {
      const baseline = { lastIndex: 1, lastText: '第一轮回答' };
      const found = findNewResponse([
        { index: 1, text: '第一轮回答', isUser: false },
        { index: 2, text: '用户第二轮', isUser: true },
        { index: 3, text: '第二轮回答', isUser: false }
      ], baseline);
      assert.ok(found);
      assert.strictEqual(found.text, '第二轮回答');
    }
  },
  {
    name: '稳定性：停止后 500ms 可返回',
    fn() {
      assert.strictEqual(isResponseStable({ lastChangedAt: 1000, now: 1500, isGenerating: false }, { idleMs: 500 }), true);
      assert.strictEqual(isResponseStable({ lastChangedAt: 1000, now: 1300, isGenerating: false }, { idleMs: 500 }), false);
    }
  },
  {
    name: '稳定性：生成中需要更长的静止窗口',
    fn() {
      assert.strictEqual(isResponseStable({ lastChangedAt: 1000, now: 1600, isGenerating: true }, { whileGeneratingIdleMs: 1500 }), false);
      assert.strictEqual(isResponseStable({ lastChangedAt: 1000, now: 2600, isGenerating: true }, { whileGeneratingIdleMs: 1500 }), true);
    }
  },
  {
    name: '单飞守卫拒绝并发请求',
    fn() {
      const guard = createRequestGuard();
      assert.strictEqual(guard.tryAcquire('req-1'), true);
      assert.strictEqual(guard.tryAcquire('req-2'), false);
      assert.strictEqual(guard.isActive('req-1'), true);
      guard.release('req-1');
      assert.strictEqual(guard.tryAcquire('req-2'), true);
    }
  },
  {
    name: '取消后释放并记录原因',
    fn() {
      const guard = createRequestGuard();
      guard.tryAcquire('req-1');
      assert.strictEqual(guard.cancel('req-1', '请求已取消。'), true);
      assert.strictEqual(guard.takeCancellation('req-1'), '请求已取消。');
      assert.strictEqual(guard.takeCancellation('req-1'), null);
      guard.release('req-1');
      assert.strictEqual(guard.tryAcquire('req-3'), true);
    }
  }
];

module.exports = { tests };
