'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SHARED_FILES = [
  'xg_shared',
  'xg_parse',
  'xg_timeout',
  'xg_images',
  'xg_growth',
  'xg_settings',
  'xg_diagnostics',
  'xg_response',
  'xg_editor',
  'xg_selectors',
  'xg_xdom',
  'xg_prompt',
  'xg_reply',
  'xg_adapters',
  'xg_cooldown'
];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function createElementMock(id, opts) {
  const attributes = new Map();
  const propValues = {};
  const listeners = {};
  const dataset = {};
  const config = opts || {};
  const target = {};
  if (config.elementClass) Object.setPrototypeOf(target, config.elementClass.prototype);
  return new Proxy(target, {
    get(target, prop) {
      if (prop in propValues) return propValues[prop];
      if (prop === 'value') return 'gemini';
      if (prop === 'checked') return true;
      if (prop === 'hidden') return false;
      if (prop === 'disabled') return false;
      if (prop === 'textContent') return '';
      if (prop === 'innerText') return '';
      if (prop === 'className') return '';
      if (prop === 'title') return '';
      if (prop === 'type') return '';
      if (prop === 'id') return id || '';
      if (prop === 'dataset') return dataset;
      if (prop === 'style') return {};
      if (prop === 'classList') return { add() {}, remove() {}, contains() { return false; } };
      if (prop === 'files') return [];
      if (prop === 'multiple') return true;
      if (prop === 'isConnected') return true;
      if (prop === '__listeners') return listeners;
      if (prop === 'fire') return (type) => {
        for (const callback of listeners[type] || []) callback({ preventDefault() {}, stopPropagation() {} });
      };
      if (prop === 'currentSrc') return '';
      if (prop === 'src') return '';
      if (prop === 'alt') return '';
      if (prop === 'srcset') return '';
      if (prop === 'placeholder') return '';
      if (prop === 'accept') return '';
      if (prop === 'addEventListener') return (type, callback) => {
        (listeners[type] ||= []).push(callback);
      };
      if (prop === 'removeEventListener') return () => {};
      if (prop === 'focus') return () => {};
      if (prop === 'select') return () => {};
      if (prop === 'click') return () => {
        if (config.onClick) config.onClick();
      };
      if (prop === 'setAttribute') return (key, value) => attributes.set(String(key), String(value));
      if (prop === 'getAttribute') return (key) => attributes.get(String(key)) ?? null;
      if (prop === 'removeAttribute') return (key) => attributes.delete(String(key));
      if (prop === 'replaceChildren') return (...nodes) => {
        const textNode = nodes[0];
        if (textNode && typeof textNode.textContent === 'string') {
          propValues.textContent = textNode.textContent;
          propValues.innerText = textNode.textContent;
        }
      };
      if (prop === 'append') return () => {};
      if (prop === 'appendChild') return () => {};
      if (prop === 'insertAdjacentElement') return (position, element) => {
        if (config.onInsertAdjacent) config.onInsertAdjacent(position, element);
      };
      if (prop === 'querySelector') return (selector) => (config.querySelector ? config.querySelector(selector) : null);
      if (prop === 'querySelectorAll') return (selector) => (config.querySelectorAll ? config.querySelectorAll(selector) : []);
      if (prop === 'closest') return (selector) => {
        if (propValues.__closestResult) return propValues.__closestResult(selector);
        return config.closestResult ? config.closestResult(selector) : null;
      };
      if (prop === 'contains') return (other) => (config.contains ? config.contains(other) : false);
      if (prop === 'compareDocumentPosition') return (other) => (config.compareDocumentPosition ? config.compareDocumentPosition(other) : 0);
      if (prop === 'remove') return () => {
        if (config.onRemove) config.onRemove();
      };
      if (prop === 'scrollIntoView') return () => {};
      if (prop === 'dispatchEvent') return () => true;
      if (prop === 'getBoundingClientRect') return () => (config.rect || { width: 0, height: 0 });
      if (prop === 'cloneNode') return () => (config.cloneNode ? config.cloneNode() : createElementMock());
      return undefined;
    },
    set(target, key, value) {
      if (typeof key === 'string') propValues[key] = value;
      return true;
    }
  });
}

function createDocumentMock(options) {
  const opts = options || {};
  const domContentLoadedListeners = [];
  const elements = {};
  const element = createElementMock('shared');
  const created = [];
  const execCommandCalls = [];
  return {
    domContentLoadedListeners,
    element,
    elements,
    created,
    execCommandCalls,
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') domContentLoadedListeners.push(callback);
    },
    getElementById(id) {
      return (elements[id] ||= createElementMock(id));
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    createElement(tag) {
      const el = createElementMock(tag);
      created.push(el);
      return el;
    },
    createTextNode(text) {
      return { textContent: String(text) };
    },
    execCommand(command, showUI, value) {
      execCommandCalls.push({ command, value: String(value || '') });
      return opts.execCommandResult === false ? false : true;
    },
    createRange() {
      return { selectNodeContents() {} };
    },
    documentElement: element,
    body: element,
    head: element
  };
}

function createChromeMock(options) {
  const opts = options || {};
  const sendCalls = [];
  const tabQueryCalls = [];
  const scriptCalls = [];
  const cssCalls = [];
  const messageListeners = [];
  const storageListeners = [];
  const sandboxContextRef = { current: null };
  const areas = {
    sync: createStorageArea(opts.syncStore),
    local: createStorageArea(opts.localStore),
    session: createStorageArea(opts.sessionStore)
  };
  function createStorageArea(initial) {
    const data = Object.assign({}, initial || {});
    return {
      setCalls: [],
      async get() {
        if (arguments.length && Array.isArray(arguments[0])) {
          const result = {};
          for (const key of arguments[0]) result[key] = data[key];
          return result;
        }
        return data;
      },
      async set(value) {
        if (opts.failStorageSet) throw new Error('storage set failed');
        // 深拷贝快照等嵌套对象，避免后续原地修改污染历史记录（模拟真实 storage 序列化）。
        this.setCalls.push(JSON.parse(JSON.stringify({ ...value, __setAt: Date.now() })));
        Object.assign(data, value);
        return undefined;
      },
      async remove() {
        for (const key of arguments.length && Array.isArray(arguments[0]) ? arguments[0] : []) delete data[key];
        return undefined;
      }
    };
  }
  return {
    sendCalls,
    tabQueryCalls,
    scriptCalls,
    cssCalls,
    messageListeners,
    storageListeners,
    _sandboxContextRef: sandboxContextRef,
    runtime: {
      id: 'test-extension-id',
      getManifest() {
        return { version: '2.0' };
      },
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        },
        removeListener(listener) {
          const index = messageListeners.indexOf(listener);
          if (index >= 0) messageListeners.splice(index, 1);
        }
      },
      async sendMessage(message) {
        sendCalls.push(message);
        let result;
        if (opts.runtimeMessages && opts.runtimeMessages[message.action]) {
          result = await opts.runtimeMessages[message.action](message);
        } else {
          result = {
            success: true,
            version: '2.0',
            activeProvider: 'gemini',
            providers: {
              gemini: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
              chatgpt: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
              deepseek: { ready: false, state: 'missing', message: '尚未建立专用标签页' }
            },
            xPage: { ready: false, state: 'missing', message: '当前 X 页面尚未加载增强脚本' },
            lastRequest: null
          };
        }
        // 主 realm 对象进入 vm 沙箱后 Number(obj[key]) 会失效，深拷贝进沙箱 realm。
        if (sandboxContextRef.current && result && typeof result === 'object') {
          try {
            result = vm.runInContext(`JSON.parse(${JSON.stringify(result)})`, sandboxContextRef.current);
          } catch (_) {}
        }
        return result;
      }
    },
    storage: {
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
        removeListener(listener) {
          const index = storageListeners.indexOf(listener);
          if (index >= 0) storageListeners.splice(index, 1);
        }
      },
      sync: areas.sync,
      local: areas.local,
      session: areas.session
    },
    tabs: {
      async query(queryInfo) {
        tabQueryCalls.push(queryInfo || {});
        if (opts.tabQuery) return opts.tabQuery(queryInfo || {});
        return [{ id: 1, url: 'https://x.com/' }];
      },
      async get() {
        if (opts.tabGet) return opts.tabGet();
        return { id: 1, status: 'complete', url: 'https://gemini.google.com/' };
      },
      async sendMessage(tabId, message) {
        if (opts.tabMessages && opts.tabMessages[message.action]) {
          return opts.tabMessages[message.action](message);
        }
        return { success: true, ready: true };
      },
      async create() {
        return { id: 99 };
      },
      async update() {
        return { id: 1 };
      }
    },
    scripting: {
      async insertCSS(details) { cssCalls.push(details); },
      async executeScript(details) { scriptCalls.push(details); }
    }
  };
}

function createContext(chromeMock, documentMock, options) {
  const opts = options || {};
  const SandboxElement = class Element {};
  const SandboxHTMLElement = class HTMLElement extends SandboxElement {};
  const SandboxHTMLTextAreaElement = class HTMLTextAreaElement extends SandboxHTMLElement {};
  const SandboxHTMLInputElement = class HTMLInputElement extends SandboxHTMLElement {};
  const sandbox = {
    chrome: chromeMock,
    document: documentMock,
    window: {
      getSelection() {
        return { removeAllRanges() {}, addRange() {} };
      },
      confirm: () => true,
      innerHeight: 800,
      scrollBy: typeof opts.scrollBy === 'function' ? opts.scrollBy : () => {}
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    Element: SandboxElement,
    HTMLElement: SandboxHTMLElement,
    HTMLTextAreaElement: SandboxHTMLTextAreaElement,
    HTMLInputElement: SandboxHTMLInputElement,
    console,
    URL,
    Intl,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    TypeError,
    AbortController: opts.AbortController || globalThis.AbortController,
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    setInterval: () => 1,
    crypto: globalThis.crypto,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    File: globalThis.File || class File {},
    DataTransfer: globalThis.DataTransfer || class DataTransfer { constructor() { this._data = {}; } setData(format, data) { this._data[format] = data; } getData(format) { return this._data[format] || ''; } },
    ClipboardEvent: globalThis.ClipboardEvent || class ClipboardEvent {},
    DragEvent: globalThis.DragEvent || class DragEvent {},
    Event: globalThis.Event || class Event {},
    InputEvent: globalThis.InputEvent || class InputEvent {},
    Node: globalThis.Node || class Node {}
  };
  if (opts.fetch) sandbox.fetch = opts.fetch;
  const context = vm.createContext(sandbox);
  if (chromeMock._sandboxContextRef) chromeMock._sandboxContextRef.current = context;
  for (const name of SHARED_FILES) {
    vm.runInContext(read(`shared/${name}.js`), context, { filename: `shared/${name}.js` });
  }
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(read(file), context, { filename: file });
    }
  };
  return context;
}

function runBrowserScript(context, filename) {
  vm.runInContext(read(filename), context, { filename });
}

function invokeListener(chromeMock, index, request, sender) {
  return new Promise((resolve) => {
    chromeMock.messageListeners[index](request, sender, (response) => resolve(response));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createArticleMock(context, options) {
  const opts = options || {};
  const HTMLElementClass = vm.runInContext('HTMLElement', context);
  const panels = [];
  const tweetTextOpts = {
    elementClass: HTMLElementClass,
    closestResult: null,
    querySelectorAll: () => [],
    onInsertAdjacent(position, element) {
      if (String(element.className || '').startsWith('draftpulse-panel')) {
        panels.push(element);
        element.__closestResult = (selector) => (selector === 'article[data-testid="tweet"]' ? article : null);
      }
    }
  };
  const tweetText = createElementMock('tweetText', tweetTextOpts);
  const userName = createElementMock('userName', tweetTextOpts);
  const time = createElementMock('time', tweetTextOpts);
  let showMoreClicks = 0;
  const showMore = opts.showMoreText === undefined ? null : createElementMock('showMore', {
    elementClass: HTMLElementClass,
    rect: { width: 80, height: 24 },
    closestResult: null,
    onClick() {
      showMoreClicks += 1;
      tweetText.innerText = String(opts.showMoreText || '');
      tweetText.textContent = String(opts.showMoreText || '');
    }
  });
  time.setAttribute('datetime', new Date(Date.now() - 2 * 3600000).toISOString());
  const statusId = opts.statusId || (opts.tweetId && /^\d+$/.test(opts.tweetId) ? opts.tweetId : '990011223344');
  const statusLink = createElementMock('statusLink', tweetTextOpts);
  statusLink.setAttribute('href', `/test/status/${statusId}`);
  const viewsLink = createElementMock('viewsLink', tweetTextOpts);
  viewsLink.setAttribute('href', `/test/status/${statusId}/analytics`);
  viewsLink.setAttribute('aria-label', opts.views ? `${opts.views} 次浏览` : '12345 次浏览');
  let viewsLinkVisible = opts.viewsLinkVisible !== false;
  tweetTextOpts.closestResult = (selector) => {
    if (selector === 'article[data-testid="tweet"]') return article;
    if (selector === 'a[href*="/status/"]') return statusLink;
    return null;
  };
  if (showMore) showMore.__closestResult = (selector) => (selector === 'article[data-testid="tweet"]' ? article : null);
  const articleOpts = {
    elementClass: HTMLElementClass,
    querySelector(selector) {
      if (selector === 'time[datetime]') return time;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'article[data-testid="tweet"]') return [];
      if (selector === '.draftpulse-panel') return panels;
      if (selector === 'div[data-testid="tweetText"]') return [tweetText];
      if (selector === '[data-testid="tweet-text-show-more-link"], button[aria-label*="Show more" i], button[aria-label*="显示更多"]') {
        return showMore ? [showMore] : [];
      }
      if (selector === 'div[data-testid="User-Name"]') return [userName];
      if (selector === 'time[datetime]') return [time];
      if (selector === 'a[href*="/status/"]') return [statusLink];
      if (selector === 'a[href$="/analytics"], a[aria-label*="view" i], a[aria-label*="浏览"], a[aria-label*="观看"]') {
        return viewsLinkVisible ? [viewsLink] : [];
      }
      return [];
    }
  };
  const article = createElementMock('article', articleOpts);
  article.setViewsLinkVisible = (visible) => { viewsLinkVisible = Boolean(visible); };
  article.getShowMoreClicks = () => showMoreClicks;
  tweetText.innerText = opts.tweetText === undefined ? '' : opts.tweetText;
  tweetText.textContent = opts.tweetDomText === undefined ? '' : opts.tweetDomText;
  userName.innerText = '作者A\n@author';
  return article;
}

function findCreated(docMock, className) {
  return docMock.created.find((el) => String(el.className || '').startsWith(className));
}

async function waitForStatusText(docMock, fragment, timeoutMs) {
  const status = findCreated(docMock, 'draftpulse-status');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (String(status.textContent).includes(fragment)) return status;
    await delay(100);
  }
  return status;
}

const tests = [
  {
    name: '共享命名空间 API 完整（vm 沙箱）',
    fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      const XG = vm.runInContext('globalThis.DraftPulseShared', context);
      assert.ok(XG, 'DraftPulseShared 未建立');
      for (const key of [
        'isTrustedRuntimeSender',
        'parseMetric',
        'formatRate',
        'normalizeXImageUrl',
        'collectTweetImages',
        'validateDownloadResult',
        'computeViewGrowth',
        'normalizeSnapshotStore',
        'normalizeSettings',
        'buildPrompt',
        'splitReplyCandidates',
        'normalizeReplyCandidates',
        'dedupeResponseText',
        'decideFill',
        'SELECTORS',
        'shouldCollectImage',
        'pickBestSrcset',
        'createProviderAdapter'
      ]) {
        assert.ok(XG[key] !== undefined, `缺少 API: ${key}`);
      }
    }
  },
  {
    name: 'gemini_bridge.js 冒烟：加载与监听器注册',
    fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'gemini_bridge.js');
      assert.strictEqual(vm.runInContext('typeof globalThis.__DRAFTPULSE_GEMINI_BRIDGE__.destroy', context), 'function');
      assert.ok(chromeMock.messageListeners.length >= 1, 'Gemini 监听器未注册');
    }
  },
  {
    name: 'gemini_bridge.js PING：合法来源返回状态、非法来源被拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'gemini_bridge.js');
      const valid = await invokeListener(chromeMock, 0, { action: 'PING_GEMINI_BRIDGE' }, { id: 'test-extension-id', url: 'https://gemini.google.com/' });
      assert.strictEqual(valid.success, true);
      assert.strictEqual(valid.ready, false);
      const invalid = await invokeListener(chromeMock, 0, { action: 'PING_GEMINI_BRIDGE' }, { id: 'evil', url: 'https://evil.example.com/' });
      assert.strictEqual(invalid.success, false);
      assert.ok(/来源无效/.test(invalid.error));
      const noUrl = await invokeListener(chromeMock, 0, { action: 'PING_GEMINI_BRIDGE' }, { id: 'test-extension-id' });
      assert.strictEqual(noUrl.success, true, '无 URL 元数据的扩展来源应被接受（tabs.sendMessage 兼容）');
      const serviceWorker = await invokeListener(chromeMock, 0, { action: 'PING_GEMINI_BRIDGE' }, { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background.js' });
      assert.strictEqual(serviceWorker.success, true, '本扩展 service worker URL 应被接受');
      const evilUrl = await invokeListener(chromeMock, 0, { action: 'PING_GEMINI_BRIDGE' }, { id: 'test-extension-id', url: 'https://evil.example.com/' });
      assert.strictEqual(evilUrl.success, false, 'URL 存在且不是 gemini.google.com 时应被拒绝');
    }
  },
  {
    name: 'gemini_bridge.js ATTACH：来源合法但图片载荷非法时拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'gemini_bridge.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'ATTACH_GEMINI_IMAGE',
          requestId: 'req-bad-image',
          index: 0,
          image: { dataUrl: 'data:text/html;base64,PHNjcmlwdD4', mimeType: 'image/jpeg', fileName: 'x.jpg' }
        },
        { id: 'test-extension-id', url: 'https://gemini.google.com/' }
      );
      assert.strictEqual(response.success, false);
      assert.ok(/图片数据格式无效/.test(response.error), `错误信息不符: ${response.error}`);
    }
  },
  {
    name: 'gemini_bridge.js WAIT 轮询：新回答先 pending，稳定后 ready 并可提取',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      const ElementClass = vm.runInContext('Element', context);
      const visible = { width: 300, height: 60 };
      const cloneWithText = (text) => {
        const clone = createElementMock('', { elementClass: ElementClass, rect: visible });
        clone.innerText = text;
        clone.textContent = text;
        return clone;
      };
      const makeResponse = (text) => {
        const element = createElementMock('', {
          elementClass: ElementClass,
          rect: visible,
          cloneNode: () => cloneWithText(text)
        });
        element.innerText = text;
        element.textContent = text;
        return element;
      };
      const oldResponse = makeResponse('旧回答');
      const newResponse = makeResponse('新回答已经完成');
      let responses = [oldResponse];
      let userMessages = [createElementMock('', { elementClass: ElementClass, rect: visible })];
      const composer = createElementMock('', { elementClass: ElementClass, rect: visible });
      let sendClicks = 0;
      const sendButton = createElementMock('', {
        elementClass: ElementClass,
        rect: visible,
        onClick() {
          sendClicks += 1;
          if (sendClicks === 1) return;
          composer.innerText = '';
          composer.textContent = '';
          userMessages = [...userMessages, createElementMock('', { elementClass: ElementClass, rect: visible })];
          responses = [oldResponse, newResponse];
        }
      });
      sendButton.setAttribute('aria-label', '发送');

      documentMock.execCommand = (command, showUI, value) => {
        composer.innerText = String(value || '');
        composer.textContent = String(value || '');
        return true;
      };
      documentMock.querySelectorAll = (selector) => {
        if (selector === 'rich-textarea [contenteditable="true"]') return [composer];
        if (selector === 'message-content') return responses;
        if (selector === 'user-query, [data-message-author-role="user"], [data-author="user"]') return userMessages;
        if (selector === 'button[aria-label*="发送"]') return [sendButton];
        return [];
      };

      runBrowserScript(context, 'gemini_bridge.js');
      const sender = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background.js' };
      const requestId = 'req-gemini-poll';
      const submitted = await invokeListener(
        chromeMock,
        0,
        { action: 'SUBMIT_GEMINI_PROMPT', requestId, prompt: '测试提示词' },
        sender
      );
      assert.strictEqual(submitted.success, true, submitted.error);
      assert.strictEqual(submitted.submitAttempts, 2, '首次无响应时应自动重新唤醒并提交一次');
      assert.strictEqual(sendClicks, 2, '发送按钮应只尝试两次');

      const pending = await invokeListener(
        chromeMock,
        0,
        { action: 'WAIT_GEMINI_RESPONSE', requestId, poll: true },
        sender
      );
      assert.strictEqual(pending.success, true, pending.error);
      assert.strictEqual(pending.ready, false, '首次发现回答应先等待稳定窗口');
      assert.strictEqual(pending.pending, true);

      await delay(550);
      const ready = await invokeListener(
        chromeMock,
        0,
        { action: 'WAIT_GEMINI_RESPONSE', requestId, poll: true },
        sender
      );
      assert.strictEqual(ready.success, true, ready.error);
      assert.strictEqual(ready.ready, true, '回答稳定后应立即返回 ready');

      const extracted = await invokeListener(
        chromeMock,
        0,
        { action: 'EXTRACT_GEMINI_RESPONSE', requestId },
        sender
      );
      assert.strictEqual(extracted.success, true, extracted.error);
      assert.strictEqual(extracted.reply, '新回答已经完成');
    }
  },
  {
    name: 'chatgpt_bridge.js 冒烟：加载与监听器注册',
    fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'chatgpt_bridge.js');
      assert.strictEqual(vm.runInContext('typeof globalThis.__DRAFTPULSE_CHATGPT_BRIDGE__.destroy', context), 'function');
      assert.ok(chromeMock.messageListeners.length >= 1, 'ChatGPT 监听器未注册');
    }
  },
  {
    name: 'chatgpt_bridge.js PING：合法来源返回状态、非法来源被拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'chatgpt_bridge.js');
      const valid = await invokeListener(chromeMock, 0, { action: 'PING_CHATGPT_BRIDGE' }, { id: 'test-extension-id', url: 'https://chatgpt.com/' });
      assert.strictEqual(valid.success, true);
      assert.strictEqual(valid.ready, false);
      const invalid = await invokeListener(chromeMock, 0, { action: 'PING_CHATGPT_BRIDGE' }, { id: 'evil', url: 'https://evil.example.com/' });
      assert.strictEqual(invalid.success, false);
      const noUrl = await invokeListener(chromeMock, 0, { action: 'PING_CHATGPT_BRIDGE' }, { id: 'test-extension-id' });
      assert.strictEqual(noUrl.success, true, '无 URL 元数据的扩展来源应被接受（tabs.sendMessage 兼容）');
      const serviceWorker = await invokeListener(chromeMock, 0, { action: 'PING_CHATGPT_BRIDGE' }, { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background.js' });
      assert.strictEqual(serviceWorker.success, true, '本扩展 service worker URL 应被接受');
      const evilUrl = await invokeListener(chromeMock, 0, { action: 'PING_CHATGPT_BRIDGE' }, { id: 'test-extension-id', url: 'https://evil.example.com/' });
      assert.strictEqual(evilUrl.success, false, 'URL 存在且不是 chatgpt.com 时应被拒绝');
    }
  },
  {
    name: 'chatgpt_bridge.js PREPARE：来源合法但图片载荷非法时拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'chatgpt_bridge.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'PREPARE_CHATGPT_WEB',
          requestId: 'req-bad-image',
          prompt: 'hi',
          images: [{ dataUrl: 'data:text/html;base64,PHNjcmlwdD4', mimeType: 'image/jpeg', fileName: 'x.jpg' }]
        },
        { id: 'test-extension-id', url: 'https://chatgpt.com/' }
      );
      assert.strictEqual(response.success, false);
      assert.ok(/图片数据格式无效/.test(response.error), `错误信息不符: ${response.error}`);
    }
  },
  {
    name: 'deepseek_bridge.js 冒烟：加载与监听器注册',
    fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'deepseek_bridge.js');
      assert.strictEqual(vm.runInContext('typeof globalThis.__DRAFTPULSE_DEEPSEEK_BRIDGE__.destroy', context), 'function');
      assert.ok(chromeMock.messageListeners.length >= 1, 'DeepSeek 监听器未注册');
    }
  },
  {
    name: 'deepseek_bridge.js PING：合法来源返回状态、非法来源被拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'deepseek_bridge.js');
      const valid = await invokeListener(chromeMock, 0, { action: 'PING_DEEPSEEK_BRIDGE' }, { id: 'test-extension-id', url: 'https://chat.deepseek.com/' });
      assert.strictEqual(valid.success, true);
      assert.strictEqual(valid.ready, false);
      const invalid = await invokeListener(chromeMock, 0, { action: 'PING_DEEPSEEK_BRIDGE' }, { id: 'evil', url: 'https://evil.example.com/' });
      assert.strictEqual(invalid.success, false);
      const noUrl = await invokeListener(chromeMock, 0, { action: 'PING_DEEPSEEK_BRIDGE' }, { id: 'test-extension-id' });
      assert.strictEqual(noUrl.success, true, '无 URL 元数据的扩展来源应被接受（tabs.sendMessage 兼容）');
      const serviceWorker = await invokeListener(chromeMock, 0, { action: 'PING_DEEPSEEK_BRIDGE' }, { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background.js' });
      assert.strictEqual(serviceWorker.success, true, '本扩展 service worker URL 应被接受');
      const evilUrl = await invokeListener(chromeMock, 0, { action: 'PING_DEEPSEEK_BRIDGE' }, { id: 'test-extension-id', url: 'https://evil.example.com/' });
      assert.strictEqual(evilUrl.success, false, 'URL 存在且不是 chat.deepseek.com 时应被拒绝');
    }
  },
  {
    name: 'deepseek_bridge.js PREPARE：空提示词时拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'deepseek_bridge.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'PREPARE_DEEPSEEK_WEB', requestId: 'req-empty', prompt: '   ' },
        { id: 'test-extension-id', url: 'https://chat.deepseek.com/' }
      );
      assert.strictEqual(response.success, false);
      assert.ok(/准备请求为空/.test(response.error), `错误信息不符: ${response.error}`);
    }
  },
  {
    name: 'content.js 冒烟：实例建立并可用 destroy',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'content.js');
      const instance = vm.runInContext('globalThis.__DRAFTPULSE_CONTENT_INSTANCE__', context);
      assert.ok(instance, 'content 实例未建立');
      assert.strictEqual(instance.version, '2.0');
      assert.ok(typeof instance.destroy === 'function');
      assert.ok(chromeMock.messageListeners.length >= 1, 'content 监听器未注册');
      assert.ok(chromeMock.storageListeners.length >= 1, 'content storage 监听器未注册');
      const listenerCountBefore = chromeMock.messageListeners.length + chromeMock.storageListeners.length;
      instance.destroy();
      assert.strictEqual(
        chromeMock.messageListeners.length + chromeMock.storageListeners.length,
        0,
        'destroy 后监听器应全部移除'
      );
      assert.ok(listenerCountBefore > 0, '监听器初始计数异常');
      assert.strictEqual(chromeMock.messageListeners.length, 0, 'runtime 监听器未全部移除');
      assert.strictEqual(chromeMock.storageListeners.length, 0, 'storage 监听器未全部移除');
    }
  },
  {
    name: 'content.js 重载恢复：启动时清理旧隔离世界遗留的重复面板',
    fn() {
      let removed = 0;
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const stalePanelA = createElementMock('stale-a', { onRemove() { removed += 1; } });
      const stalePanelB = createElementMock('stale-b', { onRemove() { removed += 1; } });
      docMock.querySelectorAll = (selector) => selector === '.draftpulse-panel, #draftpulse-toast'
        ? [stalePanelA, stalePanelB]
        : [];
      const context = createContext(chromeMock, docMock);
      runBrowserScript(context, 'content.js');
      assert.strictEqual(removed, 2, '旧实例遗留面板未在新实例启动时全部清理');
    }
  },
  {
    name: 'content.js DRAFTPULSE_PING：扩展来源（无 URL 元数据）被接受、非法来源被拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'content.js');
      const valid = await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_PING' }, { id: 'test-extension-id' });
      assert.strictEqual(valid.success, true);
      assert.strictEqual(valid.version, '2.0');
      assert.strictEqual(valid.enabled, true);
      const serviceWorker = await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_PING' }, { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/background.js' });
      assert.strictEqual(serviceWorker.success, true, '本扩展 service worker URL 应被接受');
      const invalid = await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_PING' }, { id: 'evil-extension', url: 'https://x.com/' });
      assert.strictEqual(invalid.success, false);
      const evilUrl = await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_PING' }, { id: 'test-extension-id', url: 'https://evil.example.com/' });
      assert.strictEqual(evilUrl.success, false, 'URL 存在且不是 X 站点时应被拒绝');
    }
  },
  {
    name: 'content.js 暂停状态：启动时不扫描，恢复后才注入工具栏',
    async fn() {
      const chromeMock = createChromeMock({ syncStore: { extensionEnabled: false } });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '暂停测试', tweetId: 'pause-1' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      assert.strictEqual(findCreated(docMock, 'draftpulse-panel'), undefined, '暂停时不应创建工具栏');

      const pausedPing = await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_PING' }, { id: 'test-extension-id' });
      assert.strictEqual(pausedPing.enabled, false);

      chromeMock.storageListeners[0]({ extensionEnabled: { oldValue: false, newValue: true } }, 'sync');
      await delay(450);
      assert.ok(findCreated(docMock, 'draftpulse-panel'), '恢复后应重新扫描并创建工具栏');
      const resumedPing = await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_PING' }, { id: 'test-extension-id' });
      assert.strictEqual(resumedPing.enabled, true);
    }
  },
  {
    name: 'content.js 注入布局：批量新增工具栏后保持当前推文视口锚点',
    async fn() {
      const scrollCalls = [];
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock, { scrollBy: (x, y) => scrollCalls.push([x, y]) });
      const above = createArticleMock(context, { tweetText: '上方推文', tweetId: 'anchor-above' });
      const anchor = createArticleMock(context, { tweetText: '当前推文', tweetId: 'anchor-current' });
      above.getBoundingClientRect = () => ({ top: -300, bottom: -100, width: 500, height: 200 });
      anchor.getBoundingClientRect = () => {
        const insertedAbove = above.querySelectorAll('.draftpulse-panel').length;
        const top = 100 + insertedAbove * 54;
        return { top, bottom: top + 200, width: 500, height: 200 };
      };
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [above, anchor] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      assert.deepStrictEqual(scrollCalls, [[0, 54]], `视口补偿不符: ${JSON.stringify(scrollCalls)}`);
    }
  },
  {
    name: 'content.js DRAFTPULSE_CLEAR_SNAPSHOTS：清除并持久化空快照',
    async fn() {
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '789' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);

      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'DRAFTPULSE_CLEAR_SNAPSHOTS' },
        { id: 'test-extension-id' }
      );
      assert.strictEqual(response.success, true, '清除快照失败');
      await delay(100);
      const lastSet = chromeMock.storage.local.setCalls[chromeMock.storage.local.setCalls.length - 1];
      assert.ok(lastSet && Object.prototype.hasOwnProperty.call(lastSet, 'draftpulseViewSnapshotsV1'), '未持久化快照存储');
      assert.strictEqual(Object.keys(lastSet.draftpulseViewSnapshotsV1).length, 0, '清除后快照应为空对象');
    }
  },
  {
    name: 'content.js 指标缓存：浏览量锚点延迟出现时不缓存 unavailable，出现后缓存生效',
    async fn() {
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      // 初始无浏览量锚点（X 延迟渲染），有正文与互动数字。
      const article = createArticleMock(context, {
        tweetText: '你好世界',
        tweetId: 'cache-1',
        statusId: '990011330001',
        viewsLinkVisible: false
      });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);

      // 第一次扫描：无浏览量，不应写入指标缓存。
      await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      await delay(500);
      const panel = docMock.created.filter((el) => String(el.className || '').startsWith('draftpulse-panel')).pop();
      assert.ok(panel, '面板未创建');
      assert.strictEqual(panel.getAttribute('data-draftpulse-metrics'), null, '无浏览量时不应缓存指标');
      const badgeBefore = findCreated(docMock, 'draftpulse-heat-badge');
      assert.ok(String(badgeBefore.textContent).includes('增速待获取'), `文案不符: ${badgeBefore.textContent}`);

      // X 延迟渲染出浏览量锚点，再次扫描：缓存应写入且增速显示。
      article.setViewsLinkVisible(true);
      await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      await delay(500);
      const metricsCache = panel.getAttribute('data-draftpulse-metrics');
      assert.ok(metricsCache, '有浏览量后应写入指标缓存');
      assert.ok(metricsCache.includes('"hasViews":true'), `缓存未标记 hasViews: ${metricsCache}`);
      const badgeAfter = findCreated(docMock, 'draftpulse-heat-badge');
      assert.ok(/浏览\/小时/.test(badgeAfter.textContent), `增速文案不符: ${badgeAfter.textContent}`);
    }
  },
  {
    name: 'content.js 元数据缓存：TTL 内重复扫描不重写缓存',
    async fn() {
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: 'meta-1', statusId: '990011440001', views: '1000' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);

      await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      await delay(500);
      const panel = docMock.created.filter((el) => String(el.className || '').startsWith('draftpulse-panel')).pop();
      const firstMeta = panel.getAttribute('data-draftpulse-meta');
      assert.ok(firstMeta, '首次扫描应写入元数据缓存');

      // TTL 内再次扫描：缓存命中，不应重写（ts 不变）。
      await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      await delay(500);
      const secondMeta = panel.getAttribute('data-draftpulse-meta');
      assert.strictEqual(secondMeta, firstMeta, 'TTL 内缓存命中不应重写元数据');
      const parsed = JSON.parse(secondMeta);
      assert.ok(parsed.images >= 0, '缓存应含 images 计数');
    }
  },
  {
    name: 'content.js storageListener：sync 中 selectedProvider 变化后新请求使用新提供商',
    async fn() {
      const requestProviders = [];
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            requestProviders.push(message.data.provider);
            return {
              success: true,
              mode: 'manual',
              provider: 'chatgpt',
              requestId: message.data.requestId,
              prepared: true,
              imageCount: 0,
              skippedImageCount: 0,
              omittedImageCount: 0,
              timings: { sendMs: 2, totalMs: 5 },
              instruction: '已把提示词放入 ChatGPT。'
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '101' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);

      // 通过 storage 变化（非 select change）切换提供商。
      chromeMock.storageListeners[0]({ selectedProvider: { newValue: 'chatgpt' } }, 'sync');
      await delay(400);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(100);
      assert.deepStrictEqual(requestProviders, ['chatgpt'], 'storage 同步后未使用新提供商');
    }
  },
  {
    name: 'content.js 快照持久化：持续调度超过 5 秒后仍强制落盘',
    async fn() {
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      // 每个新推文使用独立 article 元素（模拟 X 虚拟列表：新推文是新面板，无缓存干扰）。
      let articles = [createArticleMock(context, { tweetText: '你好世界', tweetId: 'snap-1', statusId: '990011220001', views: '12345' })];
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? articles : []);
      runBrowserScript(context, 'content.js');
      await delay(450);

      // 触发首次扫描：生成快照并调度持久化。
      await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      // 等待首次 updateTweet（300ms 防抖）完成且 1200ms 防抖 timer 尚未到期（200ms < 1200ms）。
      await delay(200);
      const before = chromeMock.storage.local.setCalls.length;

      // 持续出现新推文（模拟滚动期间高频扫描）：每个新推文首次快照都会重置调度。
      for (let i = 0; i < 6; i += 1) {
        await delay(500);
        articles = [createArticleMock(context, { tweetText: `新推文${i}`, tweetId: `snap-new-${i}`, statusId: `99001122000${i + 2}`, views: '100' })];
        await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      }
      const afterContinuous = chromeMock.storage.local.setCalls.length;
      // 纯防抖下 3 秒内不会有任何落盘（每次调度都被下一个新推文重置）。
      assert.strictEqual(afterContinuous - before, 0, '3 秒持续调度不应触发落盘（仍处防抖窗口）');

      // 继续注入新推文直到超过 5 秒最大延迟。
      for (let i = 0; i < 6; i += 1) {
        await delay(500);
        articles = [createArticleMock(context, { tweetText: `新推文-2-${i}`, tweetId: `snap-new2-${i}`, statusId: `99001122100${i}`, views: '200' })];
        await invokeListener(chromeMock, 0, { action: 'DRAFTPULSE_RESCAN' }, { id: 'test-extension-id' });
      }
      await delay(100);
      const afterMaxDelay = chromeMock.storage.local.setCalls.length;
      assert.ok(afterMaxDelay > before, '超过 5 秒最大延迟后应强制落盘');
      const snapshotSet = chromeMock.storage.local.setCalls.find((call) =>
        Object.prototype.hasOwnProperty.call(call, 'draftpulseViewSnapshotsV1')
      );
      assert.ok(snapshotSet, '未找到快照持久化写入');
    }
  },
  {
    name: 'content.js 生成流程：无正文无图时提示错误且不发送请求',
    async fn() {
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      chromeMock.sendCalls.length = 0;
      button.fire('click');
      await delay(30);
      assert.strictEqual(chromeMock.sendCalls.length, 0, '不应发送生成请求');
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(status, '状态区未创建');
      assert.ok(String(status.textContent).includes('未读取到推文正文或配图'), `文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 长推文：未手动点击显示更多时自动展开并传输完整正文',
    async fn() {
      let transferredText = '';
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'chatgpt' },
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            transferredText = message.data.tweetText;
            return {
              success: true,
              mode: 'manual',
              provider: 'chatgpt',
              requestId: message.data.requestId,
              instruction: '提示词已放入 ChatGPT。',
              imageCount: 0,
              omittedImageCount: 0,
              timings: { totalMs: 1 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const fullText = '这是展开后的完整长推文正文，后半部分以前不会被传输。';
      const article = createArticleMock(context, { tweetText: '这是展开前的截断正文…', showMoreText: fullText });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      findCreated(docMock, 'draftpulse-reply-btn').fire('click');
      await delay(300);
      assert.strictEqual(article.getShowMoreClicks(), 1, '未点击 X 的显示更多控件');
      assert.strictEqual(transferredText, fullText, '传输的不是展开后的完整正文');
    }
  },
  {
    name: 'content.js 扩展上下文失效：转换为可恢复中文状态而非暴露原始异常',
    async fn() {
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'chatgpt' },
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB() {
            throw new Error('Extension context invalidated.');
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '正文' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      button.fire('click');
      await delay(150);
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('旧脚本已失效'), `恢复文案不符: ${status.textContent}`);
      assert.ok(!String(status.textContent).includes('Extension context invalidated'), '不应暴露原始英文异常');
      assert.strictEqual(button.textContent, '刷新 X 页面恢复');
    }
  },
  {
    name: 'content.js 生成流程：自动模式回复框未打开时明确提示且不发送请求',
    async fn() {
      const chromeMock = createChromeMock();
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '你好世界' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      chromeMock.sendCalls.length = 0;
      button.fire('click');
      await delay(1400);
      assert.strictEqual(chromeMock.sendCalls.length, 0, '不应发送生成请求');
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('未检测到已打开的回复框'), `文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 生成流程：请求失败时最近请求保留分阶段耗时',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            return {
              success: false,
              requestId: message.data.requestId,
              error: '模拟生成失败',
              timings: { downloadMs: 1200, sendMs: 300, totalMs: 1500 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '202' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(400);

      const lastSet = chromeMock.storage.local.setCalls[chromeMock.storage.local.setCalls.length - 1];
      assert.ok(lastSet && lastSet.draftpulseLastRequest, 'recordLastRequest 未写入 storage.local');
      assert.strictEqual(lastSet.draftpulseLastRequest.status, 'error');
      assert.ok(lastSet.draftpulseLastRequest.timings, '失败请求未保留 timings');
      assert.strictEqual(lastSet.draftpulseLastRequest.timings.downloadMs, 1200, 'downloadMs 丢失');
      assert.strictEqual(lastSet.draftpulseLastRequest.timings.totalMs, 1500, 'totalMs 丢失');
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('模拟生成失败'), `文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 生成流程：自动模式成功回填（空回复框直接填入）',
    async fn() {
      const requestIds = [];
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB: async (message) => {
            requestIds.push(message.data.requestId);
            // 延迟响应，模拟生成期间用户关闭回复框。
            await delay(150);
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '这是生成的回复',
              candidates: ['这是生成的回复'],
              replyCount: 1,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { downloadMs: 1, uploadMs: 0, sendMs: 2, generateMs: 3, extractMs: 1, totalMs: 10 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(400);
      assert.strictEqual(requestIds.length, 1, '应发送一次生成请求');
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('已填入回复框'), `文案不符: ${status.textContent}`);
      const metrics = findCreated(docMock, 'draftpulse-metrics');
      assert.ok(String(metrics.textContent).includes('0 图'), `图片计数段不符: ${metrics.textContent}`);
      const lastSet = chromeMock.storage.local.setCalls[chromeMock.storage.local.setCalls.length - 1];
      assert.ok(lastSet && lastSet.draftpulseLastRequest, 'recordLastRequest 未写入 storage.local');
      assert.strictEqual(lastSet.draftpulseLastRequest.status, 'success');
      assert.strictEqual(lastSet.draftpulseLastRequest.provider, 'gemini');
    }
  },
  {
    name: 'content.js 生成流程：回复框已有用户手写内容时不覆盖',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '模型生成的回复',
              candidates: ['模型生成的回复'],
              replyCount: 1,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      editor.innerText = '用户自己写的内容';
      const article = createArticleMock(context, { tweetText: '你好世界' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(100);
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('回复框已有内容，未覆盖'), `文案不符: ${status.textContent}`);
      assert.strictEqual(editor.innerText, '用户自己写的内容', '用户手写内容被覆盖');
    }
  },
  {
    name: 'content.js 生成流程：回复框已有相同内容时不重复插入',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '这是生成的回复',
              candidates: ['这是生成的回复'],
              replyCount: 1,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      editor.innerText = '这是生成的回复';
      const article = createArticleMock(context, { tweetText: '你好世界' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(100);
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('已包含相同内容，未重复插入'), `文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 生成流程：半自动模式（ChatGPT）不要求回复框且显示提示词已放入',
    async fn() {
      const requestIds = [];
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            requestIds.push(message.data.provider);
            return {
              success: true,
              mode: 'manual',
              provider: 'chatgpt',
              requestId: message.data.requestId,
              prepared: true,
              imageCount: 0,
              skippedImageCount: 0,
              omittedImageCount: 0,
              timings: { sendMs: 2, totalMs: 5 },
              instruction: '已把提示词放入 ChatGPT。请手动发送，复制生成结果，再返回 X 粘贴。'
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const article = createArticleMock(context, { tweetText: '你好世界' });
      docMock.querySelectorAll = (selector) => (selector === 'article[data-testid="tweet"]' ? [article] : []);
      runBrowserScript(context, 'content.js');
      await delay(450);
      const providerSelect = findCreated(docMock, 'draftpulse-provider-select');
      providerSelect.value = 'chatgpt';
      providerSelect.fire('change');
      await delay(30);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(100);
      assert.deepStrictEqual(requestIds, ['chatgpt'], '未向 ChatGPT 发送请求');
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('提示词已放入 ChatGPT'), `文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 生成流程：回复框关闭时保存待回填，再次点击补填成功',
    async fn() {
      let editorVisible = false;
      const requestIds = [];
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB: async (message) => {
            requestIds.push(message.data.requestId);
            // 延迟响应，模拟生成期间用户关闭回复框。
            await delay(150);
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '这是生成的回复',
              candidates: ['这是生成的回复'],
              replyCount: 1,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '123' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return editorVisible ? [editor] : [];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');

      // 第一次：生成预检时回复框打开（否则不会发送请求），生成期间关闭，
      // 回答生成后进入待回填状态。
      editorVisible = true;
      button.fire('click');
      await delay(30);
      assert.strictEqual(requestIds.length, 1, '第一次应发送生成请求');
      editorVisible = false;
      // 第一次的 findOpenReplyEditor(2500) 等待结束后才进入待回填分支，轮询等待。
      let status = await waitForStatusText(docMock, '回答已生成，但回复框已关闭', 6000);
      assert.ok(String(status.textContent).includes('回答已生成，但回复框已关闭'), `文案不符: ${status.textContent}`);

      // 第二次：回复框已打开，直接补填，不再发送新请求。
      editorVisible = true;
      button.fire('click');
      status = await waitForStatusText(docMock, '已填入已生成的草稿', 3000);
      assert.strictEqual(requestIds.length, 1, '补填不应再次发送生成请求');
      assert.ok(String(status.textContent).includes('已填入已生成的草稿'), `补填文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 候选切换：3 候选生成后切换写入新候选',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '候选1',
              candidates: ['候选1', '候选2', '候选3'],
              replyCount: 3,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          }
        }
      });
      const docMock = createDocumentMock({ execCommandResult: false });
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '456' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      assert.ok(button, '生成按钮未创建');
      button.fire('click');
      await delay(400);

      const candidateRow = findCreated(docMock, 'draftpulse-candidates');
      assert.ok(candidateRow, '候选行未创建');
      assert.strictEqual(candidateRow.hidden, false, '候选行应显示');
      assert.strictEqual(editor.innerText, '候选1', '首次应填入候选1');

      const candidateSelect = findCreated(docMock, 'draftpulse-candidate-select');
      candidateSelect.value = '1';
      candidateSelect.fire('change');
      await delay(300);

      assert.strictEqual(editor.innerText, '候选2', '切换后应写入候选2');
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('已切换到候选 2'), `文案不符: ${status.textContent}`);
    }
  },
  {
    name: 'content.js 候选切换：回复框内容被修改时拒绝切换并还原选择',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB(message) {
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '候选1',
              candidates: ['候选1', '候选2', '候选3'],
              replyCount: 3,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          }
        }
      });
      const docMock = createDocumentMock({ execCommandResult: false });
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '457' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      button.fire('click');
      await delay(400);
      assert.strictEqual(editor.innerText, '候选1', '首次应填入候选1');

      editor.innerText = '用户手动修改的内容';
      const candidateSelect = findCreated(docMock, 'draftpulse-candidate-select');
      candidateSelect.value = '2';
      candidateSelect.fire('change');
      await delay(300);

      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('回复框内容已被修改，未切换候选'), `文案不符: ${status.textContent}`);
      assert.strictEqual(candidateSelect.value, '0', '选择应还原为已填候选');
      assert.strictEqual(editor.innerText, '用户手动修改的内容', '用户内容不应被覆盖');
    }
  },
  {
    name: 'content.js 生成流程：生成中点击取消发送取消请求并忽略已完成的回答',
    async fn() {
      const cancelCalls = [];
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB: async (message) => {
            await delay(150);
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '晚到的回答',
              candidates: ['晚到的回答'],
              replyCount: 1,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          },
          CANCEL_PROVIDER_REQUEST(message) {
            cancelCalls.push(message.requestId);
            return { success: true, canceled: true };
          }
        }
      });
      const docMock = createDocumentMock({ execCommandResult: false });
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '458' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return [editor];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');
      button.fire('click');
      await delay(30);

      const cancelButton = findCreated(docMock, 'draftpulse-cancel-btn');
      assert.ok(cancelButton, '取消按钮未创建');
      assert.strictEqual(cancelButton.hidden, false, '生成中取消按钮应可见');
      cancelButton.fire('click');
      await delay(50);
      assert.strictEqual(cancelCalls.length, 1, '未发送取消请求');

      await delay(400);
      const status = findCreated(docMock, 'draftpulse-status');
      assert.ok(String(status.textContent).includes('请求已取消，已忽略已完成的回答'), `文案不符: ${status.textContent}`);
      assert.notStrictEqual(editor.innerText, '晚到的回答', '取消后不应回填回答');
      assert.strictEqual(button.disabled, false, '按钮未恢复');
    }
  },
  {
    name: 'content.js 生成流程：待回填补填时回复框已有用户内容不覆盖',
    async fn() {
      let editorVisible = false;
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GENERATE_AI_REPLY_WEB: async (message) => {
            await delay(150);
            return {
              success: true,
              mode: 'auto',
              provider: 'gemini',
              requestId: message.data.requestId,
              reply: '这是生成的回复',
              candidates: ['这是生成的回复'],
              replyCount: 1,
              imageCount: 0,
              skippedImageCount: 0,
              timings: { totalMs: 5 }
            };
          }
        }
      });
      const docMock = createDocumentMock();
      const context = createContext(chromeMock, docMock);
      const ElementClass = vm.runInContext('Element', context);
      const editor = createElementMock('editor', {
        elementClass: ElementClass,
        rect: { width: 300, height: 40 }
      });
      const article = createArticleMock(context, { tweetText: '你好世界', tweetId: '459' });
      docMock.querySelectorAll = (selector) => {
        if (selector === 'article[data-testid="tweet"]') return [article];
        if (selector.startsWith('[role="dialog"]')) return editorVisible ? [editor] : [];
        return [];
      };
      runBrowserScript(context, 'content.js');
      await delay(450);
      const button = findCreated(docMock, 'draftpulse-reply-btn');

      editorVisible = true;
      button.fire('click');
      await delay(30);
      editorVisible = false;
      let status = await waitForStatusText(docMock, '回答已生成，但回复框已关闭', 6000);
      assert.ok(String(status.textContent).includes('回答已生成，但回复框已关闭'), `文案不符: ${status.textContent}`);

      editorVisible = true;
      editor.innerText = '用户手写内容';
      button.fire('click');
      status = await waitForStatusText(docMock, '回复框已有内容，未覆盖', 3000);
      assert.ok(String(status.textContent).includes('回复框已有内容，未覆盖'), `文案不符: ${status.textContent}`);
      assert.strictEqual(editor.innerText, '用户手写内容', '用户内容不应被覆盖');
    }
  },
  {
    name: 'popup.js 冒烟：DOMContentLoaded 后完成初始化',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      assert.ok(documentMock.domContentLoadedListeners.length === 1, 'DOMContentLoaded 回调未注册');
      await documentMock.domContentLoadedListeners[0]();
      assert.ok(chromeMock.sendCalls.length >= 1, '初始化未发起诊断请求');
      const actions = chromeMock.sendCalls.map((call) => call.action);
      assert.ok(actions.includes('GET_DIAGNOSTICS'), '未调用 GET_DIAGNOSTICS');
    }
  },
  {
    name: 'popup.js 交互：保存设置写入 storage.sync',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();

      const saveButton = documentMock.getElementById('saveBtn');
      const personaSelect = documentMock.getElementById('persona');
      personaSelect.value = 'counter';
      const languageSelect = documentMock.getElementById('replyLanguage');
      languageSelect.value = 'ja';
      saveButton.fire('click');
      await new Promise((resolve) => setTimeout(resolve, 20));

      const saved = chromeMock.storage.sync.setCalls;
      assert.ok(saved.length >= 1, 'storage.sync.set 未被调用');
      const last = saved[saved.length - 1];
      assert.strictEqual(last.replyPersona, 'counter');
      assert.strictEqual(last.replyLanguage, 'ja');
      assert.strictEqual(last.maxReplyLength, 200);
      assert.strictEqual(last.replyCount, 1);
      assert.strictEqual(last.useEmoji, true);
    }
  },
  {
    name: 'popup.js 交互：暂时关闭与恢复按钮持久化启用状态',
    async fn() {
      const chromeMock = createChromeMock({ syncStore: { extensionEnabled: true } });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();

      const toggle = documentMock.getElementById('toggleExtensionBtn');
      assert.strictEqual(toggle.textContent, '暂时关闭插件');
      toggle.fire('click');
      await delay(250);
      const pauseWrite = chromeMock.storage.sync.setCalls.find((call) => call.extensionEnabled === false);
      assert.ok(pauseWrite, '未持久化暂停状态');
      assert.strictEqual(toggle.textContent, '恢复插件');

      toggle.fire('click');
      await delay(250);
      const resumeWrite = chromeMock.storage.sync.setCalls.find((call) => call.extensionEnabled === true);
      assert.ok(resumeWrite, '未持久化恢复状态');
      assert.strictEqual(toggle.textContent, '暂时关闭插件');
    }
  },
  {
    name: 'popup.js 交互：保存设置写入失败时提示并恢复按钮',
    async fn() {
      const chromeMock = createChromeMock({ failStorageSet: true });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();

      const saveButton = documentMock.getElementById('saveBtn');
      saveButton.fire('click');
      await delay(30);
      assert.strictEqual(saveButton.textContent, '保存失败，请重试', `文案不符: ${saveButton.textContent}`);
      assert.strictEqual(saveButton.disabled, false, '按钮未恢复可点');
    }
  },
  {
    name: 'popup.js 刷新防重入：in-flight 时重复触发不叠加诊断请求',
    async fn() {
      let diagnosticsCalls = 0;
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GET_DIAGNOSTICS: async () => {
            diagnosticsCalls += 1;
            await delay(200);
            return {
              success: true,
              version: '2.0',
              activeProvider: 'gemini',
              providers: {
                gemini: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
                chatgpt: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
                deepseek: { ready: false, state: 'missing', message: '尚未建立专用标签页' }
              },
              xPage: { ready: false, state: 'missing', message: '当前 X 页面尚未加载增强脚本' },
              lastRequest: null
            };
          }
        }
      });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      await delay(50);

      // 初始化已完成（第 1 次诊断）。连续触发 3 次 change，每次都会调 refreshAll。
      const providerSelect = documentMock.getElementById('provider');
      const callsBefore = diagnosticsCalls;
      providerSelect.fire('change');
      providerSelect.fire('change');
      providerSelect.fire('change');
      await delay(350);

      // 防重入应让后两次在 in-flight 期间直接返回，最终只有一次新增诊断请求。
      assert.strictEqual(diagnosticsCalls - callsBefore, 1, `诊断请求叠加: ${diagnosticsCalls - callsBefore}`);
    }
  },
  {
    name: 'popup.js X 状态：当前标签页不是 X 时显示提示文案',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GET_DIAGNOSTICS: () => ({
            success: true,
            version: '2.0',
            activeProvider: 'gemini',
            providers: {
              gemini: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
              chatgpt: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
              deepseek: { ready: false, state: 'missing', message: '尚未建立专用标签页' }
            },
            xPage: { ready: false, state: 'no_x_tab', message: '当前标签页不是 X/Twitter。请先打开 x.com，再点击扩展。' },
            lastRequest: null
          })
        }
      });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      await delay(50);

      assert.strictEqual(documentMock.getElementById('xPageStatus').textContent, '未注入');
      assert.strictEqual(documentMock.getElementById('xPageDetail').textContent, '当前标签页不是 X/Twitter。请先打开 x.com，再点击扩展。');
    }
  },
  {
    name: 'popup.js 交互：重新注入与重新扫描按钮',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      chromeMock.sendCalls.length = 0;

      documentMock.getElementById('repairXBtn').fire('click');
      await new Promise((resolve) => setTimeout(resolve, 20));
      documentMock.getElementById('rescanXBtn').fire('click');
      await new Promise((resolve) => setTimeout(resolve, 20));

      const actions = chromeMock.sendCalls.map((call) => call.action);
      assert.ok(actions.includes('REPAIR_X_PAGE'), '未调用 REPAIR_X_PAGE');
      assert.ok(actions.includes('RESCAN_X_PAGE'), '未调用 RESCAN_X_PAGE');
    }
  },
  {
    name: 'popup.js 交互：打开专用标签页按钮',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      chromeMock.sendCalls.length = 0;
      documentMock.getElementById('openProviderBtn').fire('click');
      await delay(30);
      const actions = chromeMock.sendCalls.map((call) => call.action);
      assert.ok(actions.includes('OPEN_PROVIDER_TAB'), '未调用 OPEN_PROVIDER_TAB');
      assert.strictEqual(chromeMock.sendCalls[0].provider, 'gemini');
    }
  },
  {
    name: 'popup.js 交互：清除热度快照按钮（确认后发送动作）',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      chromeMock.sendCalls.length = 0;
      documentMock.getElementById('clearSnapshotsBtn').fire('click');
      await delay(30);
      const actions = chromeMock.sendCalls.map((call) => call.action);
      assert.ok(actions.includes('CLEAR_VIEW_SNAPSHOTS'), '未调用 CLEAR_VIEW_SNAPSHOTS');
    }
  },
  {
    name: 'popup.js 交互：导出脱敏诊断输出 JSON 并恢复按钮',
    async fn() {
      const chromeMock = createChromeMock();
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      chromeMock.sendCalls.length = 0;
      const exportButton = documentMock.getElementById('exportDiagBtn');
      exportButton.fire('click');
      await delay(30);
      const output = documentMock.getElementById('diagOutput');
      assert.ok(String(output.value).includes('"version"'), '导出未包含 version');
      assert.ok(String(output.value).includes('"provider"'), '导出未包含 provider');
      assert.ok(!String(output.value).includes('tweetText'), '导出包含推文正文');
      assert.strictEqual(exportButton.disabled, false, '导出后按钮未恢复');
    }
  },
  {
    name: 'popup.js 失败路径：打开标签页与重新注入失败时显示错误',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          OPEN_PROVIDER_TAB: () => ({ success: false, error: '打开失败原因' }),
          REPAIR_X_PAGE: () => ({ success: false, error: '注入失败原因' })
        }
      });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();

      documentMock.getElementById('openProviderBtn').fire('click');
      await delay(30);
      assert.strictEqual(documentMock.getElementById('providerTabStatus').textContent, '打开失败');
      assert.strictEqual(documentMock.getElementById('statusDetail').textContent, '打开失败原因');

      documentMock.getElementById('repairXBtn').fire('click');
      await delay(30);
      assert.strictEqual(documentMock.getElementById('xPageStatus').textContent, '修复失败');
      assert.strictEqual(documentMock.getElementById('xPageDetail').textContent, '注入失败原因');
    }
  },
  {
    name: 'popup.js 诊断：最近请求分阶段耗时展示',
    async fn() {
      const chromeMock = createChromeMock({
        runtimeMessages: {
          GET_DIAGNOSTICS: () => ({
            success: true,
            version: '2.0',
            activeProvider: 'gemini',
            providers: {
              gemini: { ready: true, state: 'ready', message: '已连接' },
              chatgpt: { ready: false, state: 'missing', message: '尚未建立专用标签页' },
              deepseek: { ready: false, state: 'missing', message: '尚未建立专用标签页' }
            },
            xPage: { ready: true, state: 'ready', message: '已注入' },
            lastRequest: {
              timestamp: Date.now(),
              requestId: 'req-diag',
              provider: 'gemini',
              status: 'success',
              imageCount: 0,
              skippedImageCount: 0,
              timings: { downloadMs: 1200, uploadMs: 500, sendMs: 300, generateMs: 9000, extractMs: 200, backfillMs: 100, totalMs: 11300 },
              error: ''
            }
          })
        }
      });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      await delay(50);

      const timings = documentMock.getElementById('diagTimings');
      const text = String(timings.textContent);
      assert.ok(text.includes('图片下载'), `缺少图片下载: ${text}`);
      assert.ok(text.includes('模型生成'), `缺少模型生成: ${text}`);
      assert.ok(text.includes('X 回填'), `缺少 X 回填: ${text}`);
      assert.ok(text.includes('总耗时'), `缺少总耗时: ${text}`);
      const lastRequest = documentMock.getElementById('diagLastRequest');
      assert.ok(String(lastRequest.textContent).includes('成功'), `最近请求状态不符: ${lastRequest.textContent}`);
    }
  },
  {
    name: 'popup.js 交互：恢复默认设置按钮重置所有设置',
    async fn() {
      const chromeMock = createChromeMock({
        syncStore: {
          replyPersona: 'humorous',
          replyLanguage: 'en',
          maxReplyLength: 300,
          replyCount: 3,
          useEmoji: false,
          askQuestion: true
        }
      });
      const documentMock = createDocumentMock();
      const context = createContext(chromeMock, documentMock);
      runBrowserScript(context, 'popup.js');
      await documentMock.domContentLoadedListeners[0]();
      await delay(30);

      const personaSelect = documentMock.getElementById('persona');
      assert.strictEqual(personaSelect.value, 'humorous', '初始化未应用预设风格');

      const resetBtn = documentMock.getElementById('resetSettingsBtn');
      assert.ok(resetBtn, '恢复默认设置按钮不存在');
      resetBtn.fire('click');
      await delay(100);

      const resetWrite = chromeMock.storage.sync.setCalls.find(
        (call) => call.replyPersona === 'professional' && call.replyLanguage === 'auto' && call.useEmoji === true
      );
      assert.ok(resetWrite, '未写入默认设置');
      assert.strictEqual(personaSelect.value, 'professional', '风格未重置为默认');
      const languageSelect = documentMock.getElementById('replyLanguage');
      assert.strictEqual(languageSelect.value, 'auto', '语言未重置为默认');
      const maxLen = documentMock.getElementById('maxReplyLength');
      assert.strictEqual(Number(maxLen.value), 200, '最大长度未重置');
    }
  },
  {
    name: 'background.js 冒烟：importScripts 加载与监听器注册',
    fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      assert.ok(chromeMock.messageListeners.length >= 1, 'background 监听器未注册');
      assert.ok(vm.runInContext('typeof DraftPulseShared.parseMetric === "function"', context), '共享模块未通过 importScripts 加载');
    }
  },
  {
    name: 'background.js GET_DIAGNOSTICS 集成：合法来源',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GET_DIAGNOSTICS' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' }
      );
      assert.strictEqual(response.success, true);
      assert.strictEqual(response.version, '2.0');
      assert.strictEqual(response.activeProvider, 'gemini');
      assert.ok(response.providers && response.providers.gemini, 'providers 缺失');
      assert.ok(response.xPage, 'xPage 缺失');
    }
  },
  {
    name: 'background.js GET_DIAGNOSTICS：自动认领用户已打开的 Gemini 标签页',
    async fn() {
      const chromeMock = createChromeMock({
        tabQuery: (queryInfo) => queryInfo.active
          ? [{ id: 1, active: true, url: 'https://x.com/home' }]
          : [
              { id: 42, active: false, lastAccessed: 10, url: 'https://gemini.google.com/app' },
              { id: 43, active: true, lastAccessed: 20, url: 'https://gemini.google.com/app/abc' }
            ],
        tabMessages: {
          PING_GEMINI_BRIDGE: () => ({ success: true, ready: true })
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GET_DIAGNOSTICS' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.providers.gemini.ready, true);
      assert.strictEqual(response.providers.gemini.state, 'ready');
      const session = await chromeMock.storage.session.get(['draftpulseProviderTabGemini']);
      assert.strictEqual(session.draftpulseProviderTabGemini, 43, '应认领最近使用的活动 Gemini 标签页');
    }
  },
  {
    name: 'background.js GET_DIAGNOSTICS：Gemini PING 空响应时自动重注入并恢复',
    async fn() {
      let pingCalls = 0;
      const chromeMock = createChromeMock({
        tabQuery: (queryInfo) => queryInfo.active
          ? [{ id: 1, active: true, url: 'https://x.com/home' }]
          : [{ id: 42, active: true, url: 'https://gemini.google.com/app' }],
        tabMessages: {
          PING_GEMINI_BRIDGE: () => {
            pingCalls += 1;
            if (pingCalls === 1) return undefined;
            return { success: true, ready: true };
          }
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GET_DIAGNOSTICS' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' }
      );
      assert.strictEqual(response.providers.gemini.ready, true, response.providers.gemini.message);
      assert.ok(pingCalls >= 2, `Gemini PING 未重试: ${pingCalls}`);
      const injection = chromeMock.scriptCalls.find((call) => call.target?.tabId === 42);
      assert.ok(injection, '未向 Gemini 标签页重注入桥接');
      assert.strictEqual(injection.files[0], 'shared/xg_shared.js');
      assert.strictEqual(injection.files.at(-1), 'gemini_bridge.js');
    }
  },
  {
    name: 'background.js GET_DIAGNOSTICS：X PING 空响应时自动完整重注入并恢复',
    async fn() {
      let pingCalls = 0;
      const chromeMock = createChromeMock({
        tabQuery: (queryInfo) => queryInfo.active
          ? [{ id: 7, active: true, url: 'https://x.com/home' }]
          : [],
        tabMessages: {
          DRAFTPULSE_PING: () => {
            pingCalls += 1;
            if (pingCalls === 1) return undefined;
            return { success: true, version: '2.0', tweets: 3, panels: 2 };
          }
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GET_DIAGNOSTICS' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' }
      );
      assert.strictEqual(response.xPage.ready, true, response.xPage.message);
      assert.strictEqual(response.xPage.tweets, 3);
      assert.strictEqual(response.xPage.panels, 2);
      assert.ok(pingCalls >= 2, `DRAFTPULSE_PING 未重试: ${pingCalls}`);
      const injection = chromeMock.scriptCalls.find((call) => call.target?.tabId === 7);
      assert.ok(injection, '未向 X 页面重注入脚本');
      assert.strictEqual(injection.files[0], 'shared/xg_shared.js');
      assert.strictEqual(injection.files.at(-1), 'content.js');
      assert.ok(injection.files.length > 2, '只注入了入口脚本，缺少共享依赖');
    }
  },
  {
    name: 'background.js OPEN_PROVIDER_TAB：无标签页时创建并返回 tabId',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'OPEN_PROVIDER_TAB', provider: 'chatgpt' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.provider, 'chatgpt');
      assert.strictEqual(response.tabId, 99, '应创建新标签页');
      const session = await chromeMock.storage.session.get(['draftpulseProviderTabChatGPT']);
      assert.strictEqual(session.draftpulseProviderTabChatGPT, 99, '标签页 id 未存入 session storage');
    }
  },
  {
    name: 'background.js REPAIR_X_PAGE / RESCAN_X_PAGE / CLEAR_VIEW_SNAPSHOTS 集成',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const sender = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' };

      const repair = await invokeListener(chromeMock, 0, { action: 'REPAIR_X_PAGE' }, sender);
      assert.strictEqual(repair.success, true, `REPAIR_X_PAGE: ${repair.error}`);
      assert.strictEqual(repair.ready, true, 'repair 后应 ready');
      assert.strictEqual(repair.state, 'ready');
      const injection = chromeMock.scriptCalls[0];
      assert.strictEqual(injection.files[0], 'shared/xg_shared.js');
      assert.strictEqual(injection.files.at(-1), 'content.js');
      assert.ok(injection.files.length > 2, 'REPAIR_X_PAGE 必须完整注入共享依赖');

      const rescan = await invokeListener(chromeMock, 0, { action: 'RESCAN_X_PAGE' }, sender);
      assert.strictEqual(rescan.success, true, `RESCAN_X_PAGE: ${rescan.error}`);
      assert.strictEqual(rescan.ready, true);

      const clear = await invokeListener(chromeMock, 0, { action: 'CLEAR_VIEW_SNAPSHOTS' }, sender);
      assert.strictEqual(clear.success, true, `CLEAR_VIEW_SNAPSHOTS: ${clear.error}`);
      assert.strictEqual(clear.removed, true);
      assert.strictEqual(clear.clearedTab, true);
      const local = await chromeMock.storage.local.get(['draftpulseViewSnapshotsV1']);
      assert.ok(!local.draftpulseViewSnapshotsV1, '清除后 local 不应再有快照键');
    }
  },
  {
    name: '桥接脚本可重复注入且只保留一个消息监听器',
    fn() {
      for (const bridgeFile of ['gemini_bridge.js', 'chatgpt_bridge.js', 'deepseek_bridge.js']) {
        const chromeMock = createChromeMock();
        const context = createContext(chromeMock, createDocumentMock());
        runBrowserScript(context, bridgeFile);
        assert.strictEqual(chromeMock.messageListeners.length, 1, `${bridgeFile} 首次监听器数量异常`);
        runBrowserScript(context, bridgeFile);
        assert.strictEqual(chromeMock.messageListeners.length, 1, `${bridgeFile} 重注入后监听器重复或丢失`);
      }
    }
  },
  {
    name: 'background.js GENERATE_AI_REPLY_WEB：twitter.com 来源被接受',
    async fn() {
      const requestId = 'req-twitter-sender';
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'gemini', replyPersona: 'professional', replyLanguage: 'auto', maxReplyLength: 200, replyCount: 1 },
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: {
          PING_GEMINI_BRIDGE: () => ({ success: true, ready: true }),
          SUBMIT_GEMINI_PROMPT: (message) => ({ success: true, requestId: message.requestId, submitted: true, sendMs: 2 }),
          WAIT_GEMINI_RESPONSE: (message) => ({ success: true, requestId: message.requestId, ready: true, generateMs: 3 }),
          EXTRACT_GEMINI_RESPONSE: (message) => ({
            success: true,
            requestId: message.requestId,
            reply: 'twitter 来源回答',
            attachedImageCount: 0,
            extractMs: 1
          })
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'GENERATE_AI_REPLY_WEB',
          data: { provider: 'gemini', requestId, tweetText: 'hi', author: '作者', images: [] }
        },
        { id: 'test-extension-id', url: 'https://twitter.com/jiezeng2004/status/1' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.reply, 'twitter 来源回答');
    }
  },
  {
    name: 'background.js GET_DIAGNOSTICS：标签页存在但桥接未就绪时返回 loading',
    async fn() {
      const chromeMock = createChromeMock({
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: {
          PING_GEMINI_BRIDGE: () => { throw new Error('Receiving end does not exist'); }
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GET_DIAGNOSTICS' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' }
      );
      assert.strictEqual(response.success, true);
      assert.strictEqual(response.providers.gemini.state, 'loading', `状态不符: ${response.providers.gemini.state}`);
      assert.strictEqual(response.providers.gemini.ready, false);
      assert.ok(/尚未就绪/.test(response.providers.gemini.message), `文案不符: ${response.providers.gemini.message}`);
    }
  },
  {
    name: 'background.js waitForBridge：PING 先失败后成功的轮询恢复',
    async fn() {
      let pingCalls = 0;
      const requestId = 'req-bridge-recover';
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'gemini', replyPersona: 'professional', replyLanguage: 'auto', maxReplyLength: 200, replyCount: 1 },
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: {
          PING_GEMINI_BRIDGE: async () => {
            pingCalls += 1;
            if (pingCalls === 1) throw new Error('bridge not ready yet');
            return { success: true, ready: true };
          },
          SUBMIT_GEMINI_PROMPT: (message) => ({ success: true, requestId: message.requestId, submitted: true, sendMs: 2 }),
          WAIT_GEMINI_RESPONSE: (message) => ({ success: true, requestId: message.requestId, ready: true, generateMs: 3 }),
          EXTRACT_GEMINI_RESPONSE: (message) => ({
            success: true,
            requestId: message.requestId,
            reply: '轮询恢复后的回答',
            attachedImageCount: 0,
            extractMs: 1
          })
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'GENERATE_AI_REPLY_WEB',
          data: { provider: 'gemini', requestId, tweetText: 'hi', author: '作者', images: [] }
        },
        { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.reply, '轮询恢复后的回答');
      assert.ok(pingCalls >= 2, `PING 未发生轮询: ${pingCalls} 次`);
    }
  },
  {
    name: 'background.js 取消标记：请求完成后同 ID 重试不再被取消拦截',
    async fn() {
      const requestId = 'req-cancel-cleanup';
      let pingCalls = 0;
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'gemini', replyPersona: 'professional', replyLanguage: 'auto', maxReplyLength: 200, replyCount: 1 },
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: {
          PING_GEMINI_BRIDGE: async () => {
            pingCalls += 1;
            if (pingCalls === 1) throw new Error('bridge not ready yet');
            return { success: true, ready: true };
          },
          SUBMIT_GEMINI_PROMPT: (message) => ({ success: true, requestId: message.requestId, submitted: true, sendMs: 2 }),
          WAIT_GEMINI_RESPONSE: (message) => ({ success: true, requestId: message.requestId, ready: true, generateMs: 3 }),
          EXTRACT_GEMINI_RESPONSE: (message) => ({
            success: true,
            requestId: message.requestId,
            reply: '第一次回答',
            attachedImageCount: 0,
            extractMs: 1
          })
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const xSender = { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' };

      // 第一次请求完成。
      const first = await invokeListener(
        chromeMock,
        0,
        { action: 'GENERATE_AI_REPLY_WEB', data: { provider: 'gemini', requestId, tweetText: 'hi', author: '作者', images: [] } },
        xSender
      );
      assert.strictEqual(first.success, true, first.error);
      assert.strictEqual(first.reply, '第一次回答');

      // 取消同一个 requestId：此时标记应已清理，且任务已完成，不会真正拦截。
      const cancel = await invokeListener(
        chromeMock,
        0,
        { action: 'CANCEL_PROVIDER_REQUEST', provider: 'gemini', requestId },
        xSender
      );
      assert.strictEqual(cancel.success, true);

      // 同 requestId 再发新请求：不应被取消标记拦截，应正常完成（清理已生效）。
      const second = await invokeListener(
        chromeMock,
        0,
        { action: 'GENERATE_AI_REPLY_WEB', data: { provider: 'gemini', requestId, tweetText: 'hi', author: '作者', images: [] } },
        xSender
      );
      assert.strictEqual(second.success, true, second.error);
      assert.strictEqual(second.reply, '第一次回答');
    }
  },
  {
    name: 'background.js 拒绝非法消息来源',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GET_DIAGNOSTICS' },
        { id: 'evil-extension', url: 'https://evil.example.com/' }
      );
      assert.strictEqual(response.success, false);
      assert.ok(/来源无效/.test(response.error), `错误信息不符: ${response.error}`);
    }
  },
  {
    name: 'background.js GENERATE_AI_REPLY_WEB：非法来源立即拒绝',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GENERATE_AI_REPLY_WEB', data: { requestId: 'req-x', tweetText: 'hi' } },
        { id: 'evil-extension', url: 'https://evil.example.com/' }
      );
      assert.strictEqual(response.success, false);
      assert.ok(/来源无效/.test(response.error), `错误信息不符: ${response.error}`);
    }
  },
  {
    name: 'background.js GENERATE_AI_REPLY_WEB：取消标记使请求立即失败',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const xSender = { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' };
      const requestId = 'req-cancel-probe';

      const cancelResponse = await invokeListener(
        chromeMock,
        0,
        { action: 'CANCEL_PROVIDER_REQUEST', provider: 'gemini', requestId },
        xSender
      );
      assert.strictEqual(cancelResponse.success, true);

      const genResponse = await invokeListener(
        chromeMock,
        0,
        { action: 'GENERATE_AI_REPLY_WEB', data: { provider: 'gemini', requestId, tweetText: 'hi' } },
        xSender
      );
      assert.strictEqual(genResponse.success, false);
      assert.ok(/取消/.test(genResponse.error), `错误信息不符: ${genResponse.error}`);
      assert.strictEqual(genResponse.requestId, requestId);
    }
  },
  {
    name: 'background.js GENERATE_AI_REPLY_WEB：合法来源走完整链路并返回耗时',
    async fn() {
      const chromeMock = createChromeMock();
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const requestId = 'req-normal-probe';
      const response = await invokeListener(
        chromeMock,
        0,
        { action: 'GENERATE_AI_REPLY_WEB', data: { provider: 'gemini', requestId, tweetText: 'hi' } },
        { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' }
      );
      // 沙箱无真实 Gemini DOM/fetch，链路最终失败，但必须返回 requestId 与分阶段耗时。
      assert.strictEqual(response.success, false);
      assert.strictEqual(response.requestId, requestId);
      assert.ok(response.timings && typeof response.timings === 'object', 'timings 缺失');
      assert.ok(response.timings.downloadMs !== undefined, 'downloadMs 缺失');
      assert.ok(response.timings.totalMs !== undefined, 'totalMs 缺失');
    }
  },
  {
    name: 'background.js Gemini 自动成功路径：无图请求走完 ATTACH/SUBMIT/WAIT/EXTRACT',
    async fn() {
      const requestId = 'req-gemini-ok';
      const callOrder = [];
      let waitPollCalls = 0;
      const chromeMock = createChromeMock({
        syncStore: {
          selectedProvider: 'gemini',
          replyPersona: 'professional',
          customReplyStyle: '',
          replyLanguage: 'auto',
          customReplyLanguage: '',
          maxReplyLength: 200,
          useEmoji: true,
          askQuestion: false,
          allowDisagreement: true,
          replyCount: 1,
          customRequirements: ''
        },
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: {
          PING_GEMINI_BRIDGE: async () => { callOrder.push('PING'); await delay(2); return { success: true, ready: true }; },
          SUBMIT_GEMINI_PROMPT: async (message) => {
            callOrder.push('SUBMIT');
            await delay(2);
            return { success: true, requestId: message.requestId, submitted: true, sendMs: 5 };
          },
          WAIT_GEMINI_RESPONSE: async (message) => {
            callOrder.push('WAIT');
            waitPollCalls += 1;
            await delay(2);
            assert.strictEqual(message.poll, true, '后台必须使用短轮询请求等待回答');
            return {
              success: true,
              requestId: message.requestId,
              ready: waitPollCalls >= 2,
              pending: waitPollCalls < 2,
              generateMs: 12
            };
          },
          EXTRACT_GEMINI_RESPONSE: async (message) => {
            callOrder.push('EXTRACT');
            await delay(2);
            return {
              success: true,
              requestId: message.requestId,
              reply: '这是一条测试回复',
              attachedImageCount: 0,
              extractMs: 3
            };
          }
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'GENERATE_AI_REPLY_WEB',
          data: { provider: 'gemini', requestId, tweetText: 'hi', author: '作者', images: [] }
        },
        { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.mode, 'auto');
      assert.strictEqual(response.requestId, requestId);
      assert.strictEqual(response.reply, '这是一条测试回复');
      assert.strictEqual(response.candidates.length, 1);
      assert.strictEqual(response.candidates[0], '这是一条测试回复');
      assert.strictEqual(response.imageCount, 0);
      assert.strictEqual(response.skippedImageCount, 0);
      assert.strictEqual(response.replyCount, 1);
      assert.ok(response.timings.sendMs === 5, `sendMs=${response.timings.sendMs}`);
      assert.ok(response.timings.generateMs === 12, `generateMs=${response.timings.generateMs}`);
      assert.ok(response.timings.extractMs === 3, `extractMs=${response.timings.extractMs}`);
      assert.ok(response.timings.totalMs > 0);
      assert.strictEqual(waitPollCalls, 2, 'pending 后应继续轮询直到 ready');
      assert.deepStrictEqual(callOrder, ['PING', 'SUBMIT', 'WAIT', 'WAIT', 'EXTRACT'], `调用顺序异常: ${callOrder.join(',')}`);
    }
  },
  {
    name: 'background.js ChatGPT 半自动成功路径：准备提示词返回 manual',
    async fn() {
      const requestId = 'req-chatgpt-ok';
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'chatgpt' },
        sessionStore: { draftpulseProviderTabChatGPT: 43 },
        tabGet: () => ({ id: 43, status: 'complete', url: 'https://chatgpt.com/' }),
        tabMessages: {
          PING_CHATGPT_BRIDGE: () => ({ success: true, ready: true }),
          PREPARE_CHATGPT_WEB: (message) => ({ success: true, requestId: message.requestId, prepared: true, imageCount: 0, prepareMs: 7 })
        }
      });
      const context = createContext(chromeMock, createDocumentMock());
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'GENERATE_AI_REPLY_WEB',
          data: { provider: 'chatgpt', requestId, tweetText: 'hi', author: '作者', images: [] }
        },
        { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.mode, 'manual');
      assert.strictEqual(response.requestId, requestId);
      assert.strictEqual(response.prepared, true);
      assert.strictEqual(response.imageCount, 0);
      assert.ok(response.instruction.includes('ChatGPT'), 'instruction 未包含提供商');
      assert.ok(response.timings.sendMs === 7, `sendMs=${response.timings.sendMs}`);
    }
  },
  {
    name: 'background.js 图片下载成功路径：fetch 校验通过并附加 1 张图',
    async fn() {
      const requestId = 'req-gemini-img-ok';
      const fetchCalls = [];
      const fetchMock = async (url, init) => {
        fetchCalls.push({ url, hasSignal: Boolean(init && init.signal) });
        const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        const response = new Response(body, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(body.length)
          }
        });
        Object.defineProperty(response, 'url', { value: 'https://pbs.twimg.com/media/FIXTURE_OK?format=jpg&name=large' });
        return response;
      };
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'gemini', maxReplyLength: 200, replyCount: 1 },
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: {
          PING_GEMINI_BRIDGE: () => ({ success: true, ready: true }),
          ATTACH_GEMINI_IMAGE: (message) => ({ success: true, requestId: message.requestId, attached: true, count: 1, uploadMs: 4 }),
          SUBMIT_GEMINI_PROMPT: (message) => ({ success: true, requestId: message.requestId, submitted: true, sendMs: 5 }),
          WAIT_GEMINI_RESPONSE: (message) => ({ success: true, requestId: message.requestId, ready: true, generateMs: 12 }),
          EXTRACT_GEMINI_RESPONSE: (message) => ({
            success: true,
            requestId: message.requestId,
            reply: '图片回复',
            attachedImageCount: 1,
            extractMs: 3
          })
        }
      });
      const context = createContext(chromeMock, createDocumentMock(), { fetch: fetchMock });
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'GENERATE_AI_REPLY_WEB',
          data: {
            provider: 'gemini',
            requestId,
            tweetText: '带图推文',
            author: '作者',
            images: [{ url: 'https://pbs.twimg.com/media/FIXTURE_OK?format=jpg&name=small', alt: '图' }]
          }
        },
        { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' }
      );
      assert.strictEqual(response.success, true, response.error);
      assert.strictEqual(response.imageCount, 1);
      assert.strictEqual(fetchCalls.length, 1, 'fetch 未被调用');
      assert.strictEqual(fetchCalls[0].hasSignal, true, '下载请求未携带 abort signal');
      assert.ok(response.timings.downloadMs > 0, 'downloadMs 缺失');
    }
  },
  {
    name: 'background.js 图片下载失败路径：重定向到非法域名时纯图请求报错',
    async fn() {
      const requestId = 'req-gemini-img-bad';
      const fetchMock = async (url, init) => {
        const response = new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' }
        });
        Object.defineProperty(response, 'url', { value: 'https://evil.example.com/media/FIXTURE_BAD' });
        return response;
      };
      const chromeMock = createChromeMock({
        syncStore: { selectedProvider: 'gemini' },
        sessionStore: { draftpulseProviderTabGemini: 42 },
        tabGet: () => ({ id: 42, status: 'complete', url: 'https://gemini.google.com/' }),
        tabMessages: { PING_GEMINI_BRIDGE: () => ({ success: true, ready: true }) }
      });
      const context = createContext(chromeMock, createDocumentMock(), { fetch: fetchMock });
      runBrowserScript(context, 'background.js');
      const response = await invokeListener(
        chromeMock,
        0,
        {
          action: 'GENERATE_AI_REPLY_WEB',
          data: {
            provider: 'gemini',
            requestId,
            tweetText: '',
            author: '作者',
            images: [{ url: 'https://pbs.twimg.com/media/FIXTURE_BAD?format=jpg&name=small' }]
          }
        },
        { id: 'test-extension-id', url: 'https://x.com/jiezeng2004/status/1' }
      );
      assert.strictEqual(response.success, false);
      assert.strictEqual(response.requestId, requestId);
      assert.ok(/图片下载失败/.test(response.error), `错误信息不符: ${response.error}`);
      assert.ok(response.timings && response.timings.downloadMs >= 0, '失败响应未附带下载耗时');
    }
  }
];

module.exports = { tests };
