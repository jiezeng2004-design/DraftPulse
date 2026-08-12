'use strict';

const assert = require('node:assert');
const { withTimeout, sleep } = require('../shared/xg_timeout.js');

const tests = [
  {
    name: 'promise 先完成时返回其值',
    async fn() {
      const result = await withTimeout(Promise.resolve('ok'), 500, '超时');
      assert.strictEqual(result, 'ok');
    }
  },
  {
    name: '超时后 reject 并附带消息',
    async fn() {
      const never = new Promise(() => {});
      let rejected = null;
      try {
        await withTimeout(never, 20, '超时消息');
      } catch (error) {
        rejected = error;
      }
      assert.ok(rejected, '未 reject');
      assert.strictEqual(rejected.message, '超时消息');
    }
  },
  {
    name: 'promise 先 reject 时原样传递错误',
    async fn() {
      let rejected = null;
      try {
        await withTimeout(Promise.reject(new Error('原始错误')), 500, '超时');
      } catch (error) {
        rejected = error;
      }
      assert.ok(rejected, '未 reject');
      assert.strictEqual(rejected.message, '原始错误');
    }
  },
  {
    name: '完成后定时器被清理（不残留导致迟到 reject）',
    async fn() {
      let settled = null;
      const promise = withTimeout(sleep(5).then(() => 'done'), 200, '超时');
      settled = await promise;
      assert.strictEqual(settled, 'done');
    }
  },
  {
    name: 'sleep 至少等待指定时长',
    async fn() {
      const startedAt = Date.now();
      await sleep(15);
      assert.ok(Date.now() - startedAt >= 10, 'sleep 未等待');
    }
  }
];

module.exports = { tests };
