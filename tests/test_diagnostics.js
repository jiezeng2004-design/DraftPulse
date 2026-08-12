'use strict';

const assert = require('node:assert');
const { formatTimings, formatMs } = require('../shared/xg_diagnostics.js');

const tests = [
  {
    name: '分阶段耗时完整格式化',
    fn() {
      const text = formatTimings({
        downloadMs: 1200,
        uploadMs: 500,
        sendMs: 300,
        generateMs: 9000,
        extractMs: 200,
        backfillMs: 100,
        totalMs: 11300
      });
      assert.ok(text.includes('图片下载 1.2s'), text);
      assert.ok(text.includes('图片上传 500ms'), text);
      assert.ok(text.includes('模型生成 9.0s'), text);
      assert.ok(text.includes('X 回填 100ms'), text);
      assert.ok(text.includes('总耗时 11.3s'), text);
    }
  },
  {
    name: '零值与非零值过滤',
    fn() {
      const text = formatTimings({ downloadMs: 0, sendMs: 42, totalMs: 0 });
      assert.ok(!text.includes('图片下载'), text);
      assert.ok(text.includes('提示词发送 42ms'), text);
      assert.ok(!text.includes('总耗时'), text);
    }
  },
  {
    name: '空对象与非法输入',
    fn() {
      assert.strictEqual(formatTimings({}), '各阶段耗时：暂无');
      assert.strictEqual(formatTimings(null), '各阶段耗时：暂无。');
      assert.strictEqual(formatTimings(undefined), '各阶段耗时：暂无。');
      assert.strictEqual(formatTimings('x'), '各阶段耗时：暂无。');
    }
  },
  {
    name: 'formatMs 阈值',
    fn() {
      assert.strictEqual(formatMs(999), '999ms');
      assert.strictEqual(formatMs(1000), '1.0s');
      assert.strictEqual(formatMs(2500), '2.5s');
    }
  }
];

module.exports = { tests };
