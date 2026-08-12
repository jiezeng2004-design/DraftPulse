/*
 * xg_adapters.js - 提供商适配器统一接口与能力标记。
 *
 * transport 由 background 注入，职责：
 *   ensureTab(def, opts)          -> Promise<Tab>
 *   waitReady(def, tabId, timeoutMs) -> Promise<void>
 *   send(def, tabId, action, payload, timeoutMs) -> Promise<response>
 *   cancel(def, tabId, action, requestId) -> Promise<void>
 * UMD 包装器：浏览器合并到 DraftPulseShared 命名空间，Node.js 走 module.exports。
 */
(function (global, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    if (!global.DraftPulseShared) global.DraftPulseShared = {};
    Object.assign(global.DraftPulseShared, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROVIDER_DEFS = Object.freeze({
    gemini: Object.freeze({
      id: 'gemini',
      label: 'Gemini',
      home: 'https://gemini.google.com/',
      tabKey: 'draftpulseProviderTabGemini',
      pingAction: 'PING_GEMINI_BRIDGE',
      attachAction: 'ATTACH_GEMINI_IMAGE',
      submitAction: 'SUBMIT_GEMINI_PROMPT',
      waitAction: 'WAIT_GEMINI_RESPONSE',
      extractAction: 'EXTRACT_GEMINI_RESPONSE',
      cancelAction: 'CANCEL_GEMINI_WEB',
      mode: 'auto',
      acceptsImages: true,
      urlPattern: /^https:\/\/gemini\.google\.com\//i
    }),
    chatgpt: Object.freeze({
      id: 'chatgpt',
      label: 'ChatGPT',
      home: 'https://chatgpt.com/',
      tabKey: 'draftpulseProviderTabChatGPT',
      pingAction: 'PING_CHATGPT_BRIDGE',
      requestAction: 'PREPARE_CHATGPT_WEB',
      cancelAction: 'CANCEL_CHATGPT_WEB',
      mode: 'manual',
      acceptsImages: true,
      urlPattern: /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i
    }),
    deepseek: Object.freeze({
      id: 'deepseek',
      label: 'DeepSeek',
      home: 'https://chat.deepseek.com/',
      tabKey: 'draftpulseProviderTabDeepSeek',
      pingAction: 'PING_DEEPSEEK_BRIDGE',
      requestAction: 'PREPARE_DEEPSEEK_WEB',
      cancelAction: 'CANCEL_DEEPSEEK_WEB',
      mode: 'manual',
      acceptsImages: false,
      urlPattern: /^https:\/\/chat\.deepseek\.com\//i
    })
  });

  function getProviderDef(value) {
    const id = String(value || '').toLowerCase();
    return PROVIDER_DEFS[id] || PROVIDER_DEFS.gemini;
  }

  /*
   * 统一适配器。方法名与任务要求一致：
   * id / displayName / capabilities / ensureDedicatedTab / prepareRequest /
   * attachImages / submitPrompt / waitForResponse / extractResponse / cancelRequest
   */
  class ProviderAdapter {
    constructor(def, transport) {
      this.def = def;
      this.id = def.id;
      this.displayName = def.label;
      this.capabilities = Object.freeze({
        supportsImages: def.acceptsImages,
        supportsAutoSubmit: def.mode === 'auto',
        supportsAutoExtract: def.mode === 'auto',
        supportsAutoFill: def.mode === 'auto'
      });
      this.transport = transport;
      this.tab = null;
    }

    async ensureDedicatedTab(options) {
      this.tab = await this.transport.ensureTab(this.def, options || {});
      return this.tab;
    }

    async waitReady(timeoutMs) {
      if (!this.tab || !Number.isInteger(this.tab.id)) throw new Error(`${this.def.label} 专用标签页尚未建立。`);
      await this.transport.waitReady(this.def, this.tab.id, timeoutMs);
    }

    async prepareRequest(payload, timeoutMs) {
      return this.sendMessage(this.def.requestAction, payload, timeoutMs);
    }

    async attachImages(payload, timeoutMs) {
      if (!this.def.attachAction) return { supported: false };
      return this.sendMessage(this.def.attachAction, payload, timeoutMs);
    }

    async submitPrompt(payload, timeoutMs) {
      if (!this.def.submitAction) return { supported: false };
      return this.sendMessage(this.def.submitAction, payload, timeoutMs);
    }

    async waitForResponse(payload, timeoutMs) {
      if (!this.def.waitAction) return { supported: false };
      return this.sendMessage(this.def.waitAction, payload, timeoutMs);
    }

    async extractResponse(payload, timeoutMs) {
      if (!this.def.extractAction) return { supported: false };
      return this.sendMessage(this.def.extractAction, payload, timeoutMs);
    }

    async cancelRequest(requestId) {
      if (!this.def.cancelAction || !this.tab || !Number.isInteger(this.tab.id)) return false;
      try {
        await this.transport.cancel(this.def, this.tab.id, this.def.cancelAction, requestId);
        return true;
      } catch (_) {
        return false;
      }
    }

    sendMessage(action, payload, timeoutMs) {
      if (!this.tab || !Number.isInteger(this.tab.id)) {
        return Promise.reject(new Error(`${this.def.label} 专用标签页尚未建立。`));
      }
      return this.transport.send(this.def, this.tab.id, action, payload, timeoutMs);
    }
  }

  function createProviderAdapter(providerId, transport) {
    return new ProviderAdapter(getProviderDef(providerId), transport);
  }

  return {
    PROVIDER_DEFS,
    getProviderDef,
    ProviderAdapter,
    createProviderAdapter
  };
});
