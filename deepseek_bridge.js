(function () {
  'use strict';

  const INSTANCE_KEY = '__DRAFTPULSE_DEEPSEEK_BRIDGE__';
  const previousInstance = globalThis[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === 'function') {
    try { previousInstance.destroy(); } catch (_) {}
  }

  const DP = globalThis.DraftPulseShared;
  const SELECTORS = DP.SELECTORS.deepseek;
  const guard = DP.createRequestGuard();

  const runtimeListener = (request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return undefined;
    if (!DP.isTrustedRuntimeSender(sender, chrome.runtime.id, /^https:\/\/chat\.deepseek\.com\//i)) {
      sendResponse({ success: false, error: '请求来源无效。' });
      return false;
    }

    if (request.action === 'PING_DEEPSEEK_BRIDGE') {
      const composer = findComposer();
      sendResponse({
        success: true,
        ready: Boolean(composer),
        error: composer ? null : '未找到 DeepSeek 输入框；请确认已登录并打开聊天页面。'
      });
      return false;
    }

    if (request.action === 'PREPARE_DEEPSEEK_WEB') {
      if (!guard.tryAcquire(request.requestId)) {
        sendResponse({ success: false, error: 'DeepSeek 正在准备上一条请求，请稍后重试。' });
        return false;
      }
      const startedAt = Date.now();
      const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
      if (!prompt) {
        guard.release(request.requestId);
        sendResponse({ success: false, error: '准备请求为空。' });
        return false;
      }
      prepareDeepSeek(prompt)
        .then(() => sendResponse({
          success: true,
          requestId: request.requestId,
          prepared: true,
          prepareMs: Date.now() - startedAt
        }))
        .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }))
        .finally(() => { guard.release(request.requestId); });
      return true;
    }

    if (request.action === 'CANCEL_DEEPSEEK_WEB') {
      guard.cancel(request.requestId, '请求已取消。');
      sendResponse({ success: true, canceled: guard.isActive(request.requestId) });
      return false;
    }

    return undefined;
  };

  globalThis[INSTANCE_KEY] = {
    destroy() {
      try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch (_) {}
    }
  };
  chrome.runtime.onMessage.addListener(runtimeListener);

  async function prepareDeepSeek(prompt) {
    const composer = await waitForElement(findComposer, 12000, '无法找到 DeepSeek 输入框。请确认已登录并打开聊天页面。');
    ensureNotCancelled();
    fillComposer(composer, prompt);
    composer.scrollIntoView({ block: 'center', behavior: 'smooth' });
    composer.focus();
  }

  function ensureNotCancelled() {
    const reason = guard.takeCancellation(guard.activeRequestId);
    if (reason) throw new Error(reason);
  }

  function findComposer() {
    for (const selector of SELECTORS.composer) {
      const candidates = [...document.querySelectorAll(selector)];
      const element = candidates.find((candidate) => !candidate.disabled && isVisible(candidate) && !isSearchOrSettingsInput(candidate));
      if (element) return element;
    }
    return null;
  }

  function isSearchOrSettingsInput(element) {
    const label = `${element.getAttribute('placeholder') || ''} ${element.getAttribute('aria-label') || ''}`;
    return SELECTORS.excludePlaceholderPattern.test(label);
  }

  function fillComposer(composer, text) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(composer, text);
      else composer.value = text;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand('insertText', false, text); } catch (_) { inserted = false; }
    if (!inserted) {
      composer.replaceChildren(document.createTextNode(text));
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  async function waitForElement(getter, timeoutMs, errorMessage) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = getter();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    throw new Error(errorMessage);
  }
})();
