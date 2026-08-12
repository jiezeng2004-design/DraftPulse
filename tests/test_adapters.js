'use strict';

const assert = require('node:assert');
const { createProviderAdapter, getProviderDef, PROVIDER_DEFS } = require('../shared/xg_adapters.js');

function createFakeTransport() {
  const calls = [];
  return {
    calls,
    async ensureTab(def, opts) {
      calls.push({ kind: 'ensureTab', defId: def.id, opts });
      return { id: 7, url: def.home };
    },
    async waitReady(def, tabId, timeoutMs) {
      calls.push({ kind: 'waitReady', defId: def.id, tabId, timeoutMs });
    },
    async send(def, tabId, action, payload, timeoutMs) {
      calls.push({ kind: 'send', defId: def.id, tabId, action, payload, timeoutMs });
      return { success: true, requestId: payload?.requestId, attached: true };
    },
    async cancel(def, tabId, action, requestId) {
      calls.push({ kind: 'cancel', defId: def.id, tabId, action, requestId });
      return true;
    }
  };
}

function callsOf(transport, kind) {
  return transport.calls.filter((call) => call.kind === kind);
}

const tests = [
  {
    name: 'Gemini 能力标记：自动 + 图片',
    fn() {
      const adapter = createProviderAdapter('gemini', createFakeTransport());
      assert.strictEqual(adapter.id, 'gemini');
      assert.strictEqual(adapter.displayName, 'Gemini');
      assert.strictEqual(adapter.capabilities.supportsImages, true);
      assert.strictEqual(adapter.capabilities.supportsAutoSubmit, true);
      assert.strictEqual(adapter.capabilities.supportsAutoExtract, true);
      assert.strictEqual(adapter.capabilities.supportsAutoFill, true);
    }
  },
  {
    name: 'ChatGPT 能力标记：半自动 + 图片',
    fn() {
      const adapter = createProviderAdapter('chatgpt', createFakeTransport());
      assert.strictEqual(adapter.capabilities.supportsImages, true);
      assert.strictEqual(adapter.capabilities.supportsAutoSubmit, false);
      assert.strictEqual(adapter.capabilities.supportsAutoExtract, false);
      assert.strictEqual(adapter.capabilities.supportsAutoFill, false);
    }
  },
  {
    name: 'DeepSeek 能力标记：半自动 + 无图片',
    fn() {
      const adapter = createProviderAdapter('deepseek', createFakeTransport());
      assert.strictEqual(adapter.capabilities.supportsImages, false);
      assert.strictEqual(adapter.capabilities.supportsAutoSubmit, false);
    }
  },
  {
    name: 'ensureDedicatedTab 与 waitReady 接线',
    fn() {
      const transport = createFakeTransport();
      const adapter = createProviderAdapter('gemini', transport);
      return adapter.ensureDedicatedTab({ activateWhenCreated: true })
        .then((tab) => {
          assert.strictEqual(tab.id, 7);
          assert.strictEqual(adapter.tab.id, 7);
          return adapter.waitReady(30000);
        })
        .then(() => {
          const ensureCalls = callsOf(transport, 'ensureTab');
          assert.strictEqual(ensureCalls.length, 1);
          assert.deepStrictEqual(ensureCalls[0].opts, { activateWhenCreated: true });
          assert.strictEqual(callsOf(transport, 'waitReady')[0].timeoutMs, 30000);
        });
    }
  },
  {
    name: 'attachImages 使用 ATTACH_GEMINI_IMAGE 并传递载荷',
    fn() {
      const transport = createFakeTransport();
      const adapter = createProviderAdapter('gemini', transport);
      adapter.tab = { id: 9 };
      return adapter.attachImages({ requestId: 'req-1', index: 0, image: { dataUrl: 'data:image/jpeg;base64,x' } }, 25000)
        .then((response) => {
          assert.strictEqual(response.attached, true);
          const send = callsOf(transport, 'send')[0];
          assert.strictEqual(send.action, 'ATTACH_GEMINI_IMAGE');
          assert.strictEqual(send.tabId, 9);
          assert.strictEqual(send.payload.requestId, 'req-1');
          assert.strictEqual(send.payload.index, 0);
          assert.strictEqual(send.timeoutMs, 25000);
        });
    }
  },
  {
    name: '半自动适配器 prepareRequest 使用请求动作',
    fn() {
      const transport = createFakeTransport();
      const adapter = createProviderAdapter('chatgpt', transport);
      adapter.tab = { id: 5 };
      return adapter.prepareRequest({ requestId: 'req-2', prompt: 'hi' }, 60000)
        .then(() => {
          const send = callsOf(transport, 'send')[0];
          assert.strictEqual(send.action, 'PREPARE_CHATGPT_WEB');
          assert.strictEqual(send.payload.prompt, 'hi');
        });
    }
  },
  {
    name: '不支持的接口返回 { supported: false }',
    fn() {
      const transport = createFakeTransport();
      const chatgpt = createProviderAdapter('chatgpt', transport);
      chatgpt.tab = { id: 5 };
      return chatgpt.submitPrompt({ requestId: 'x' }, 1000).then((result) => {
        assert.strictEqual(result.supported, false);
        assert.strictEqual(callsOf(transport, 'send').length, 0);
        const deepseek = createProviderAdapter('deepseek', transport);
        deepseek.tab = { id: 5 };
        return deepseek.extractResponse({ requestId: 'y' }, 1000).then((extractResult) => {
          assert.strictEqual(extractResult.supported, false);
        });
      });
    }
  },
  {
    name: 'cancelRequest 使用取消动作并在无标签页时短路',
    fn() {
      const transport = createFakeTransport();
      const adapter = createProviderAdapter('gemini', transport);
      return adapter.cancelRequest('req-3').then((canceled) => {
        assert.strictEqual(canceled, false);
        assert.strictEqual(callsOf(transport, 'cancel').length, 0);
        adapter.tab = { id: 11 };
        return adapter.cancelRequest('req-3');
      }).then((canceled) => {
        assert.strictEqual(canceled, true);
        const cancel = callsOf(transport, 'cancel')[0];
        assert.strictEqual(cancel.action, 'CANCEL_GEMINI_WEB');
        assert.strictEqual(cancel.requestId, 'req-3');
      });
    }
  },
  {
    name: '未建立标签页时发送请求被拒绝',
    fn() {
      const transport = createFakeTransport();
      const adapter = createProviderAdapter('gemini', transport);
      return adapter.prepareRequest({ requestId: 'req-4' }, 1000).then(
        () => { throw new Error('不应成功'); },
        (error) => { assert.ok(/尚未建立/.test(error.message)); }
      );
    }
  },
  {
    name: '未知提供商回退 Gemini',
    fn() {
      assert.strictEqual(getProviderDef('unknown').id, 'gemini');
      assert.strictEqual(getProviderDef(undefined).id, 'gemini');
      assert.strictEqual(getProviderDef('DEEPSEEK').id, 'deepseek');
      assert.ok(PROVIDER_DEFS.gemini.tabKey.startsWith('draftpulseProviderTab'));
    }
  }
];

module.exports = { tests };

