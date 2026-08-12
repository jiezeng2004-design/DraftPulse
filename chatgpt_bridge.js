(function () {
  'use strict';

  const INSTANCE_KEY = '__DRAFTPULSE_CHATGPT_BRIDGE__';
  const previousInstance = globalThis[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === 'function') {
    try { previousInstance.destroy(); } catch (_) {}
  }

  const DP = globalThis.DraftPulseShared;
  const SELECTORS = DP.SELECTORS.chatgpt;
  const MAX_IMAGES = DP.MAX_IMAGES;
  const MAX_DATA_URL_LENGTH = DP.MAX_DATA_URL_LENGTH;
  const guard = DP.createRequestGuard();

  const runtimeListener = (request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return undefined;
    if (!DP.isTrustedRuntimeSender(sender, chrome.runtime.id, /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i)) {
      sendResponse({ success: false, error: '请求来源无效。' });
      return false;
    }

    if (request.action === 'PING_CHATGPT_BRIDGE') {
      const composer = findComposer();
      sendResponse({
        success: true,
        ready: Boolean(composer),
        error: composer ? null : '未找到 ChatGPT 输入框；请确认已登录并打开普通聊天页面。'
      });
      return false;
    }

    if (request.action === 'PREPARE_CHATGPT_WEB') {
      if (!guard.tryAcquire(request.requestId)) {
        sendResponse({ success: false, error: 'ChatGPT 正在准备上一条请求，请稍后重试。' });
        return false;
      }
      const startedAt = Date.now();
      const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
      if (!prompt) {
        guard.release(request.requestId);
        sendResponse({ success: false, error: '准备请求为空。' });
        return false;
      }
      let images;
      try {
        images = normalizeIncomingImages(request.images);
      } catch (error) {
        guard.release(request.requestId);
        sendResponse({ success: false, requestId: request.requestId, error: error.message });
        return false;
      }
      prepareChatGPT(prompt, images)
        .then(() => sendResponse({
          success: true,
          requestId: request.requestId,
          prepared: true,
          imageCount: images.length,
          prepareMs: Date.now() - startedAt
        }))
        .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }))
        .finally(() => { guard.release(request.requestId); });
      return true;
    }

    if (request.action === 'CANCEL_CHATGPT_WEB') {
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

  async function prepareChatGPT(prompt, images) {
    const composer = await waitForElement(findComposer, 12000, '无法找到 ChatGPT 输入框。请确认已登录并打开普通聊天页面。');
    if (images.length) await attachImages(composer, images);
    ensureNotCancelled();
    fillComposer(composer, prompt);
    composer.scrollIntoView({ block: 'center', behavior: 'smooth' });
    composer.focus();
  }

  function ensureNotCancelled() {
    const reason = guard.takeCancellation(guard.activeRequestId);
    if (reason) throw new Error(reason);
  }

  function normalizeIncomingImages(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_IMAGES).map((item, index) => {
      const dataUrl = String(item?.dataUrl || '');
      const mimeType = String(item?.mimeType || '').toLowerCase();
      const fileName = String(item?.fileName || `x-image-${index + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      if (!/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(dataUrl)) throw new Error('收到的图片数据格式无效。');
      if (dataUrl.length > MAX_DATA_URL_LENGTH) throw new Error('收到的单张图片数据过大。');
      if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(mimeType)) throw new Error('收到的图片 MIME 类型不受支持。');
      return { dataUrl, mimeType, fileName };
    });
  }

  async function attachImages(composer, images) {
    const files = images.map((image, index) => DP.dataUrlToFile(image, index));
    let input = findFileInput();
    if (!input) input = await revealFileInput();
    if (!input) throw new Error('未找到 ChatGPT 图片上传入口。你可以先手动上传图片，再保留扩展准备的文字提示词。');

    if (input.multiple || files.length === 1) {
      setInputFiles(input, files);
    } else {
      for (let index = 0; index < files.length; index += 1) {
        ensureNotCancelled();
        const currentInput = index === 0 ? input : (findFileInput() || await revealFileInput());
        if (!currentInput) throw new Error(`无法附加第 ${index + 1} 张图片。`);
        setInputFiles(currentInput, [files[index]]);
        await DP.sleep(650);
      }
    }

    await waitForAttachmentSignal(composer, 7000);
  }

  function findFileInput() {
    return [...document.querySelectorAll(SELECTORS.fileInput)].find((input) => !input.disabled && acceptsImages(input)) || null;
  }

  function acceptsImages(input) {
    const accept = String(input.getAttribute('accept') || '').toLowerCase();
    return !accept || accept.includes('image') || accept.includes('.png') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.webp');
  }

  async function revealFileInput() {
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(isVisible);
    const attachButton = buttons.find((element) => SELECTORS.attachButtonPattern.test(getElementLabel(element)));
    if (!attachButton) return null;
    attachButton.click();

    const directInput = await waitForOptionalElement(findFileInput, 2500);
    if (directInput) return directInput;

    const menuItems = [...document.querySelectorAll('[role="menuitem"], button, [role="button"]')].filter(isVisible);
    const uploadItem = menuItems.find((element) => SELECTORS.uploadMenuPattern.test(getElementLabel(element)));
    if (uploadItem) uploadItem.click();
    return waitForOptionalElement(findFileInput, 3000);
  }

  function setInputFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function waitForAttachmentSignal(composer, timeoutMs) {
    const root = composer.closest('form') || composer.parentElement || document.body;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      ensureNotCancelled();
      if (root.querySelector(SELECTORS.attachSignal)) return;
      await DP.sleep(180);
    }
    throw new Error('ChatGPT 没有显示图片附件。请在专用标签页中确认上传状态。');
  }

  function findComposer() {
    for (const selector of SELECTORS.composer) {
      const candidates = [...document.querySelectorAll(selector)];
      const element = candidates.find((candidate) => !candidate.disabled && isVisible(candidate));
      if (element) return element;
    }
    return null;
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

  function getElementLabel(element) {
    return `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.textContent || ''}`.replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  async function waitForElement(getter, timeoutMs, errorMessage) {
    const result = await waitForOptionalElement(getter, timeoutMs);
    if (!result) throw new Error(errorMessage);
    return result;
  }

  async function waitForOptionalElement(getter, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = getter();
      if (value) return value;
      await DP.sleep(180);
    }
    return null;
  }

})();
