(function () {
  'use strict';

  const INSTANCE_KEY = '__DRAFTPULSE_GEMINI_BRIDGE__';
  const previousInstance = globalThis[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === 'function') {
    try { previousInstance.destroy(); } catch (_) {}
  }

  const DP = globalThis.DraftPulseShared;
  const SELECTORS = DP.SELECTORS.gemini;
  const MAX_IMAGES = DP.MAX_IMAGES;
  const MAX_DATA_URL_LENGTH = DP.MAX_DATA_URL_LENGTH;
  const RESPONSE_STABLE_IDLE_MS = 500;
  const RESPONSE_STABLE_GENERATING_MS = 1500;
  const SUBMIT_ACK_TIMEOUT_MS = 5000;
  const SUBMIT_RETRY_DELAY_MS = 650;
  const SUBMIT_MAX_ATTEMPTS = 2;

  const guard = DP.createRequestGuard();
  let sessionRequestId = null;
  let activeBaseline = null;
  let lastReplyText = '';
  let responseProgress = null;
  let submissionStartedAt = 0;

  const runtimeListener = (request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return undefined;
    if (!DP.isTrustedRuntimeSender(sender, chrome.runtime.id, /^https:\/\/gemini\.google\.com\//i)) {
      sendResponse({ success: false, error: '请求来源无效。' });
      return false;
    }

    if (request.action === 'PING_GEMINI_BRIDGE') {
      const composer = findComposer();
      sendResponse({
        success: true,
        ready: Boolean(composer),
        error: composer ? null : '未找到 Gemini 输入框；请确认已登录、未停留在验证页面。'
      });
      return false;
    }

    if (request.action === 'ATTACH_GEMINI_IMAGE') {
      handleAttach(request, sendResponse);
      return true;
    }

    if (request.action === 'SUBMIT_GEMINI_PROMPT') {
      handleSubmit(request, sendResponse);
      return true;
    }

    if (request.action === 'WAIT_GEMINI_RESPONSE') {
      handleWait(request, sendResponse);
      return true;
    }

    if (request.action === 'EXTRACT_GEMINI_RESPONSE') {
      handleExtract(request, sendResponse);
      return true;
    }

    if (request.action === 'CANCEL_GEMINI_WEB') {
      handleCancel(request, sendResponse);
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

  async function handleAttach(request, sendResponse) {
    if (!guard.tryAcquire(request.requestId)) {
      sendResponse({ success: false, error: 'Gemini 正在处理上一条请求，请稍后重试。' });
      return;
    }
    sessionRequestId = String(request.requestId || '');
    const startedAt = Date.now();
    try {
      ensureNotCancelled();
      const image = normalizeSingleImage(request.image, Number(request.index) || 0);
      const composer = await waitForElement(findComposer, 10000, '无法找到 Gemini 输入框。请确认已登录并打开正常聊天页面。');
      const before = snapshotAttachmentState(composer);
      const attached = await attachSingleFileWithRetries(composer, image, before.count);
      if (!attached) {
        sendResponse({
          success: true,
          requestId: request.requestId,
          attached: false,
          uploadMs: Date.now() - startedAt,
          error: 'Gemini 未确认附件数量增加。'
        });
        return;
      }
      await waitForAttachmentUploadToSettle(composer, 6000).catch(() => undefined);
      sendResponse({
        success: true,
        requestId: request.requestId,
        attached: true,
        count: snapshotAttachmentState(composer).count,
        uploadMs: Date.now() - startedAt
      });
    } catch (error) {
      sendResponse({ success: false, requestId: request.requestId, error: error.message });
    } finally {
      guard.release(request.requestId);
    }
  }

  async function handleSubmit(request, sendResponse) {
    if (!guard.tryAcquire(request.requestId)) {
      sendResponse({ success: false, error: 'Gemini 正在处理上一条请求，请稍后重试。' });
      return;
    }
    sessionRequestId = String(request.requestId || '');
    const startedAt = Date.now();
    try {
      ensureNotCancelled();
      const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
      if (!prompt) throw new Error('生成请求为空。');
      ensureNotCancelled();
      const composer = await waitForElement(findComposer, 10000, '无法找到 Gemini 输入框。请确认已登录并打开正常聊天页面。');
      activeBaseline = snapshotResponses();
      responseProgress = null;
      lastReplyText = '';
      const baselineUserMessageCount = countUserMessages();
      submissionStartedAt = Date.now();
      const submitAttempts = await submitPromptWithRecovery(
        composer,
        prompt,
        baselineUserMessageCount,
        activeBaseline
      );
      sendResponse({
        success: true,
        requestId: request.requestId,
        submitted: true,
        submitAttempts,
        sendMs: Date.now() - startedAt
      });
    } catch (error) {
      sendResponse({ success: false, requestId: request.requestId, error: error.message });
    } finally {
      guard.release(request.requestId);
    }
  }

  async function submitPromptWithRecovery(initialComposer, prompt, baselineUserMessageCount, baselineResponses) {
    let composer = initialComposer;
    for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt += 1) {
      ensureNotCancelled();
      if (attempt > 1) {
        await DP.sleep(SUBMIT_RETRY_DELAY_MS);
        composer = findComposer() || composer;
      }
      fillComposer(composer, prompt);
      try { composer.focus(); } catch (_) {}
      ensureNotCancelled();
      const sendButton = await waitForSendReady(attempt === 1 ? 30000 : 8000);
      ensureNotCancelled();
      sendButton.click();
      const acknowledged = await waitForSubmitAcknowledgement(
        composer,
        prompt,
        baselineUserMessageCount,
        baselineResponses,
        SUBMIT_ACK_TIMEOUT_MS
      );
      if (acknowledged) return attempt;
    }
    throw new Error('Gemini 两次都未确认提示词已发送；输入内容仍停留在编辑框中。请检查页面是否有遮罩、验证或发送限制后再重试。');
  }

  async function handleWait(request, sendResponse) {
    if (!guard.tryAcquire(request.requestId)) {
      sendResponse({ success: false, error: 'Gemini 正在处理上一条请求，请稍后重试。' });
      return;
    }
    const startedAt = Date.now();
    try {
      ensureNotCancelled();
      ensureRequestMatches(request.requestId);
      const baseline = activeBaseline || snapshotResponses();
      const result = inspectResponseProgress(baseline);
      if (result.ready) lastReplyText = result.text;
      sendResponse({
        success: true,
        requestId: request.requestId,
        ready: result.ready,
        pending: !result.ready,
        generateMs: submissionStartedAt ? Date.now() - submissionStartedAt : Date.now() - startedAt
      });
    } catch (error) {
      sendResponse({ success: false, requestId: request.requestId, error: error.message });
    } finally {
      guard.release(request.requestId);
    }
  }

  function handleExtract(request, sendResponse) {
    const startedAt = Date.now();
    try {
      ensureRequestMatches(request.requestId);
      const text = extractLatestResponseText();
      if (!text) throw new Error('未读取到新的模型回答。');
      const composer = findComposer();
      sendResponse({
        success: true,
        requestId: request.requestId,
        reply: DP.dedupeResponseText(text),
        attachedImageCount: composer ? snapshotAttachmentState(composer).count : 0,
        extractMs: Date.now() - startedAt
      });
    } catch (error) {
      sendResponse({ success: false, requestId: request.requestId, error: error.message });
    }
  }

  function handleCancel(request, sendResponse) {
    const requestId = String(request.requestId || '');
    const canceled = guard.cancel(requestId, '请求已取消。');
    if (sessionRequestId === requestId) responseProgress = null;
    sendResponse({ success: true, canceled });
  }

  function ensureNotCancelled() {
    const reason = guard.takeCancellation(sessionRequestId);
    if (reason) throw new Error(reason);
  }

  function ensureRequestMatches(requestId) {
    if (!sessionRequestId || sessionRequestId !== String(requestId || '')) {
      throw new Error('请求标识不匹配，已忽略过期请求。');
    }
  }

  function normalizeSingleImage(value, index) {
    if (!value || typeof value !== 'object') throw new Error('图片数据缺失。');
    const dataUrl = String(value.dataUrl || '');
    const mimeType = String(value.mimeType || '').toLowerCase();
    const fileName = String(value.fileName || `x-image-${index + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    if (!/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(dataUrl)) throw new Error('收到的图片数据格式无效。');
    if (dataUrl.length > MAX_DATA_URL_LENGTH) throw new Error('收到的单张图片数据过大。');
    if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(mimeType)) throw new Error('收到的图片 MIME 类型不受支持。');
    return { dataUrl, mimeType, fileName };
  }

  async function attachSingleFileWithRetries(composer, image, baselineCount) {
    const file = DP.dataUrlToFile(image, 0);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ensureNotCancelled();
      const before = snapshotAttachmentState(composer);
      if (await tryAttachStrategies(composer, file, before.count)) return true;
      await DP.sleep(500);
    }
    return false;
  }

  async function tryAttachStrategies(composer, file, baselineCount) {
    let input = findFileInput();
    if (!input) input = await revealFileInput();
    if (input) {
      try {
        setInputFiles(input, [file]);
        const state = await waitForAttachmentIncrease(composer, baselineCount, 1, 3500);
        if (state.count >= baselineCount + 1) return true;
      } catch (_) {}
    }
    ensureNotCancelled();
    if (dispatchPasteFiles(composer, [file])) {
      const state = await waitForAttachmentIncrease(composer, baselineCount, 1, 3000);
      if (state.count >= baselineCount + 1) return true;
    }
    ensureNotCancelled();
    if (dispatchDropFiles(composer, [file])) {
      const state = await waitForAttachmentIncrease(composer, baselineCount, 1, 3000);
      if (state.count >= baselineCount + 1) return true;
    }
    return false;
  }

  function dispatchPasteFiles(composer, files) {
    try {
      const transfer = createFileTransfer(files);
      let event;
      try {
        event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      } catch (_) {
        event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: transfer });
      }
      composer.focus();
      composer.dispatchEvent(event);
      return true;
    } catch (_) {
      return false;
    }
  }

  function dispatchDropFiles(composer, files) {
    try {
      const transfer = createFileTransfer(files);
      const target = findComposerContainer(composer);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        let event;
        try {
          event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
        } catch (_) {
          event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'dataTransfer', { value: transfer });
        }
        target.dispatchEvent(event);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function createFileTransfer(files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    return transfer;
  }

  function findFileInput() {
    const inputs = Array.from(document.querySelectorAll(SELECTORS.fileInput));
    return inputs.find((input) => !input.disabled && acceptsImages(input)) || null;
  }

  function acceptsImages(input) {
    const accept = String(input.getAttribute('accept') || '').toLowerCase();
    return !accept || accept.includes('image') || accept.includes('jpeg') || accept.includes('jpg') || accept.includes('png') || accept.includes('webp');
  }

  async function revealFileInput() {
    const attachmentButton = findAttachmentButton();
    if (attachmentButton) {
      attachmentButton.click();
      const existing = await waitForOptionalElement(findFileInput, 1200);
      if (existing) return existing;
    }
    const uploadItem = findUploadMenuItem();
    if (uploadItem) {
      uploadItem.click();
      return waitForOptionalElement(findFileInput, 1800);
    }
    return null;
  }

  function findAttachmentButton() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    return candidates.find((element) => {
      if (!isVisible(element) || element.getAttribute('aria-disabled') === 'true') return false;
      return SELECTORS.attachButtonPattern.test(getElementLabel(element));
    }) || null;
  }

  function findUploadMenuItem() {
    const candidates = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, [role="button"]'));
    return candidates.find((element) => {
      if (!isVisible(element)) return false;
      return SELECTORS.uploadMenuPattern.test(getElementLabel(element));
    }) || null;
  }

  function setInputFiles(input, files) {
    const transfer = createFileTransfer(files);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function snapshotAttachmentState(composer) {
    const root = findComposerContainer(composer);
    const removeControls = uniqueVisibleElements(root, SELECTORS.removeControl);
    const previews = uniqueVisibleElements(root, [
      'img[src^="blob:"]',
      'img[src^="data:image/"]',
      ...SELECTORS.previewUnit.split(',')
    ]).filter((element) => {
      if (element.closest('button[aria-label*="add" i], button[aria-label*="upload" i]')) return false;
      if (element.tagName === 'IMG') {
        const rect = element.getBoundingClientRect();
        const label = getElementLabel(element);
        if (rect.width < 28 || rect.height < 28) return false;
        if (/avatar|logo|icon|头像|图标/i.test(label)) return false;
      }
      return true;
    });

    const count = Math.max(removeControls.length, countDistinctPreviewUnits(previews));
    const signature = [...removeControls, ...previews]
      .map((element) => `${element.tagName}:${getElementLabel(element)}:${element.getAttribute('src') || ''}`)
      .sort()
      .join('|');
    return { count, signature };
  }

  function uniqueVisibleElements(root, selectors) {
    const set = new Set();
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (isVisible(element)) set.add(element);
      }
    }
    return [...set];
  }

  function countDistinctPreviewUnits(elements) {
    const units = new Set();
    for (const element of elements) {
      const unit = element.closest(SELECTORS.previewUnit) || element;
      units.add(unit);
    }
    return units.size;
  }

  async function waitForAttachmentIncrease(composer, baselineCount, expectedIncrease, timeoutMs) {
    const targetCount = baselineCount + expectedIncrease;
    const startedAt = Date.now();
    let last = snapshotAttachmentState(composer);
    while (Date.now() - startedAt < timeoutMs) {
      last = snapshotAttachmentState(composer);
      if (last.count >= targetCount) return last;
      await DP.sleep(140);
    }
    return last;
  }

  async function waitForAttachmentUploadToSettle(composer, timeoutMs) {
    const startedAt = Date.now();
    let stableTicks = 0;
    let previous = snapshotAttachmentState(composer);
    while (Date.now() - startedAt < timeoutMs) {
      const current = snapshotAttachmentState(composer);
      const uploading = isAttachmentUploading(composer);
      if (!uploading && current.count >= previous.count && current.signature === previous.signature) stableTicks += 1;
      else stableTicks = 0;
      previous = current;
      if (stableTicks >= 2) return;
      await DP.sleep(220);
    }
  }

  function isAttachmentUploading(composer) {
    const root = findComposerContainer(composer);
    return SELECTORS.uploading.some((selector) => Array.from(root.querySelectorAll(selector)).some(isVisible));
  }

  function findComposerContainer(composer) {
    return composer.closest(SELECTORS.attachmentRoot) || composer.parentElement?.parentElement?.parentElement || document.body;
  }

  function findComposer() {
    for (const selector of SELECTORS.composer) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find(isVisible);
      if (visible) return visible;
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

  function countUserMessages() {
    return Array.from(document.querySelectorAll(SELECTORS.userMessage)).filter(isVisible).length;
  }

  function readComposerText(composer) {
    if (!composer) return '';
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return String(composer.value || '').trim();
    }
    return String(composer.innerText || composer.textContent || '').trim();
  }

  async function waitForSubmitAcknowledgement(composer, prompt, baselineUserMessageCount, baselineResponses, timeoutMs) {
    const startedAt = Date.now();
    const normalizedPrompt = String(prompt || '').replace(/\s+/g, ' ').trim();
    while (Date.now() - startedAt < timeoutMs) {
      ensureNotCancelled();
      const composerText = readComposerText(composer).replace(/\s+/g, ' ').trim();
      if (countUserMessages() > baselineUserMessageCount) return true;
      if (composerText !== normalizedPrompt) return true;
      if (DP.findNewResponse(responseCandidates(), baselineResponses)) return true;
      if (isGenerating()) return true;
      await DP.sleep(120);
    }
    return false;
  }

  async function waitForSendReady(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      ensureNotCancelled();
      const button = findSendButton();
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
      await DP.sleep(160);
    }
    throw new Error('Gemini 发送按钮长时间未就绪；图片可能仍在上传或页面出现了验证提示。');
  }

  function findSendButton() {
    for (const selector of SELECTORS.sendButton) {
      const button = Array.from(document.querySelectorAll(selector)).find((candidate) => {
        if (!isVisible(candidate)) return false;
        const label = getElementLabel(candidate);
        return /send|发送/i.test(label) || candidate.classList.contains('send-button');
      });
      if (button) return button;
    }
    return null;
  }

  function snapshotResponses() {
    const elements = getResponseElements();
    const last = elements[elements.length - 1];
    return {
      lastIndex: elements.length,
      lastText: extractResponseText(last)
    };
  }

  function responseCandidates() {
    return getResponseElements().map((element, index) => ({
      index: index + 1,
      text: extractResponseText(element),
      isUser: false
    }));
  }

  function inspectResponseProgress(baseline) {
    const found = DP.findNewResponse(responseCandidates(), baseline);
    const text = String(found?.text || '').trim();
    if (!text) return { ready: false, text: '' };

    const now = Date.now();
    if (!responseProgress || responseProgress.text !== text) {
      responseProgress = { text, lastChangedAt: now };
    }
    const ready = DP.isResponseStable(
      { lastChangedAt: responseProgress.lastChangedAt, now, isGenerating: isGenerating() },
      { idleMs: RESPONSE_STABLE_IDLE_MS, whileGeneratingIdleMs: RESPONSE_STABLE_GENERATING_MS }
    );
    return { ready, text };
  }

  function getResponseElements() {
    const seen = new Set();
    const candidates = [];
    for (const selector of SELECTORS.response) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element) || !isVisible(element) || isUserMessageElement(element)) continue;
        const text = extractResponseText(element);
        if (!text) continue;
        seen.add(element);
        candidates.push(element);
      }
    }
    const deepest = candidates.filter((element) => !candidates.some((other) => other !== element && element.contains(other)));
    return deepest.sort(compareDocumentOrder);
  }

  function isUserMessageElement(element) {
    return Boolean(element.closest(SELECTORS.userMessage));
  }

  function extractLatestResponseText() {
    const elements = getResponseElements();
    const last = elements[elements.length - 1];
    if (!last) return '';
    const text = DP.dedupeResponseText(extractResponseText(last));
    return text === (DP.dedupeResponseText(activeBaseline?.lastText)) ? '' : text;
  }

  function extractResponseText(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll(SELECTORS.thinking).forEach((node) => node.remove());
    return String(clone.innerText || clone.textContent || '').trim();
  }

  function compareDocumentOrder(a, b) {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function isGenerating() {
    return SELECTORS.stopButton.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisible))
      || SELECTORS.uploading.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisible));
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
    const element = await waitForOptionalElement(getter, timeoutMs);
    if (element) return element;
    throw new Error(errorMessage);
  }

  async function waitForOptionalElement(getter, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const element = getter();
      if (element) return element;
      await DP.sleep(140);
    }
    return null;
  }

})();
