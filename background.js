'use strict';

importScripts(
  'shared/xg_shared.js',
  'shared/xg_parse.js',
  'shared/xg_timeout.js',
  'shared/xg_images.js',
  'shared/xg_settings.js',
  'shared/xg_prompt.js',
  'shared/xg_response.js',
  'shared/xg_reply.js',
  'shared/xg_adapters.js',
  'shared/xg_diagnostics.js',
  'shared/xg_platforms.js',
  'shared/xg_cooldown.js',
  'shared/xg_thread.js',
  'shared/xg_account_memory.js'
);

const DP = globalThis.DraftPulseShared;

const MAX_TWEET_LENGTH = 12000;
const BRIDGE_READY_TIMEOUT_MS = 30000;
const GENERATION_TIMEOUT_MS = 125000;
const PREPARE_TIMEOUT_MS = 60000;
const ATTACH_MESSAGE_TIMEOUT_MS = 25000;
const CANCEL_TIMEOUT_MS = 2000;
const IMAGE_FETCH_TIMEOUT_MS = 30000;
const RESPONSE_POLL_INTERVAL_MS = 500;
const RESPONSE_POLL_MESSAGE_TIMEOUT_MS = 5000;
const LAST_REQUEST_KEY = 'draftpulseLastRequest';
const X_PAGE_SCRIPT_FILES = Object.freeze([
  'shared/xg_shared.js',
  'shared/xg_parse.js',
  'shared/xg_timeout.js',
  'shared/xg_images.js',
  'shared/xg_growth.js',
  'shared/xg_settings.js',
  'shared/xg_response.js',
  'shared/xg_editor.js',
  'shared/xg_selectors.js',
  'shared/xg_xdom.js',
  'shared/xg_platforms.js',
  'shared/xg_cooldown.js',
  'shared/xg_thread.js',
  'shared/xg_account_memory.js',
  'content.js'
]);
const PROVIDER_BRIDGE_FILES = Object.freeze({
  gemini: Object.freeze([
    'shared/xg_shared.js',
    'shared/xg_timeout.js',
    'shared/xg_images.js',
    'shared/xg_response.js',
    'shared/xg_selectors.js',
    'gemini_bridge.js'
  ]),
  chatgpt: Object.freeze([
    'shared/xg_shared.js',
    'shared/xg_timeout.js',
    'shared/xg_images.js',
    'shared/xg_response.js',
    'shared/xg_selectors.js',
    'chatgpt_bridge.js'
  ]),
  deepseek: Object.freeze([
    'shared/xg_shared.js',
    'shared/xg_timeout.js',
    'shared/xg_response.js',
    'shared/xg_selectors.js',
    'deepseek_bridge.js'
  ])
});

let requestQueue = Promise.resolve();
const cancelledRequests = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request.action !== 'string' || sender?.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: '请求来源无效。' });
    return false;
  }

  if (request.action === 'GENERATE_AI_REPLY_WEB') {
    if (!isAllowedXSender(sender)) {
      sendResponse({ success: false, error: '请求来源无效。' });
      return false;
    }
    requestQueue = requestQueue
      .catch(() => undefined)
      .then(() => handleWebSessionReply(request.data));
    requestQueue
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => {
        sendResponse({
          success: false,
          requestId: request?.data?.requestId || '',
          error: safeErrorMessage(error),
          timings: extractTimings(error)
        });
      })
      .finally(() => {
        if (request?.data?.requestId) cancelledRequests.delete(String(request.data.requestId));
      });
    return true;
  }

  if (request.action === 'CANCEL_PROVIDER_REQUEST') {
    if (!isAllowedXSender(sender)) {
      sendResponse({ success: false, error: '请求来源无效。' });
      return false;
    }
    const cancelRequestId = String(request.requestId || '');
    if (cancelRequestId) cancelledRequests.add(cancelRequestId);
    cancelProviderRequest(request.provider, request.requestId)
      .then((canceled) => sendResponse({ success: true, canceled }))
      .catch((error) => sendResponse({ success: false, error: safeErrorMessage(error) }));
    return true;
  }

  if (!isExtensionPageSender(sender)) {
    sendResponse({ success: false, error: '请求来源无效。' });
    return false;
  }

  if (request.action === 'OPEN_PROVIDER_TAB') {
    const provider = DP.getProviderDef(request.provider);
    openOrActivateProviderTab(provider)
      .then((tab) => sendResponse({ success: true, provider: provider.id, tabId: tab.id }))
      .catch((error) => sendResponse({ success: false, error: safeErrorMessage(error) }));
    return true;
  }

  if (request.action === 'REPAIR_X_PAGE') {
    repairActiveXPage()
      .then((status) => sendResponse({ success: true, ...status }))
      .catch((error) => sendResponse({ success: false, error: safeErrorMessage(error) }));
    return true;
  }

  if (request.action === 'RESCAN_X_PAGE') {
    rescanActiveXPage()
      .then((status) => sendResponse({ success: true, ...status }))
      .catch((error) => sendResponse({ success: false, error: safeErrorMessage(error) }));
    return true;
  }

  if (request.action === 'CLEAR_VIEW_SNAPSHOTS') {
    clearViewSnapshots()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: safeErrorMessage(error) }));
    return true;
  }

  if (request.action === 'GET_DIAGNOSTICS') {
    getDiagnostics()
      .then((diagnostics) => sendResponse({ success: true, ...diagnostics }))
      .catch((error) => sendResponse({ success: false, error: safeErrorMessage(error) }));
    return true;
  }

  return undefined;
});

async function handleWebSessionReply(data) {
  const providerId = DP.normalizeProviderId(data?.provider || await getActiveProviderId());
  const provider = DP.getProviderDef(providerId);
  const requestId = String(data?.requestId || '');
  if (requestId.length < 8) throw new Error('请求缺少有效标识。');
  throwIfCancelled(requestId);

  const tweetText = DP.sanitizeText(data?.tweetText, MAX_TWEET_LENGTH);
  const author = DP.sanitizeText(data?.author, 300) || '匿名作者';
  const sanitizedTweetText = DP.sanitizeTweetForPrompt ? DP.sanitizeTweetForPrompt(tweetText) : tweetText;
  const imageRequests = normalizeImageRequests(data?.images);
  const threadContext = Array.isArray(data?.threadContext) ? data.threadContext : null;

  if (!tweetText && imageRequests.length === 0) throw new Error('未读取到推文正文或配图。');
  if (!tweetText && imageRequests.length > 0 && !provider.acceptsImages) {
    throw new Error(`${provider.label} 当前桥接仅准备文字提示词，无法处理纯图片推文。请改用 Gemini 或 ChatGPT。`);
  }

  const timings = {
    downloadMs: 0,
    uploadMs: 0,
    sendMs: 0,
    generateMs: 0,
    extractMs: 0,
    totalMs: 0
  };
  const startedAt = Date.now();

  throwIfCancelled(requestId);
  const imageResult = provider.acceptsImages
    ? await downloadTweetImages(imageRequests, timings, requestId)
    : { images: [], skipped: 0 };

  if (!tweetText && imageRequests.length > 0 && provider.acceptsImages && imageResult.images.length === 0) {
    const error = new Error('推文只有图片，但图片下载失败。请刷新 X 页面后重试。');
    error.timings = { ...timings, totalMs: Date.now() - startedAt };
    throw error;
  }

  const settings = DP.normalizeSettings(await chrome.storage.sync.get([
    'selectedProvider',
    'replyPersona',
    'customReplyStyle',
    'replyLanguage',
    'customReplyLanguage',
    'maxReplyLength',
    'useEmoji',
    'askQuestion',
    'allowDisagreement',
    'replyCount',
    'customRequirements',
    'myVoice'
  ]));

  // Per-account memory overrides
  const authorAccountId = String(data?.authorAccountId || '').toLowerCase();
  if (authorAccountId && DP.ACCOUNT_MEMORY_KEY) {
    try {
      const accountData = await chrome.storage.local.get([DP.ACCOUNT_MEMORY_KEY]);
      const store = DP.normalizeAccountMemoryStore(accountData[DP.ACCOUNT_MEMORY_KEY]);
      const accountDefaults = DP.getAccountDefaults(store, authorAccountId);
      if (accountDefaults) {
        Object.assign(settings, DP.mergeAccountOverrides(settings, accountDefaults));
      }
    } catch (_) {}
  }
  const persona = DP.getPersonaInstruction(settings.replyPersona, settings.customReplyStyle);
  const personaObj = DP.getPersona ? DP.getPersona(settings.replyPersona) : null;
  const language = DP.getLanguageInstruction(settings.replyLanguage, settings.customReplyLanguage);
  const prompt = DP.buildPrompt({
    tweetText: sanitizedTweetText,
    author,
    persona,
    personaObj,
    language,
    images: imageResult.images,
    omittedImages: provider.acceptsImages ? 0 : imageRequests.length,
    settings,
    threadContext,
    myVoice: settings.myVoice
  });

  const adapter = DP.createProviderAdapter(providerId, createTransport());
  throwIfCancelled(requestId);
  await adapter.ensureDedicatedTab({ activateWhenCreated: true });
  await adapter.waitReady(BRIDGE_READY_TIMEOUT_MS);

  let result;
  try {
    result = await DP.withTimeout(
      runAdapterRequest(adapter, {
        requestId,
        prompt,
        images: imageResult.images,
        settings,
        timings,
        hasText: Boolean(tweetText)
      }),
      provider.mode === 'auto' ? GENERATION_TIMEOUT_MS : PREPARE_TIMEOUT_MS,
      provider.mode === 'auto'
        ? `${provider.label} 网页生成超时。请检查登录、验证码、附件上传或额度提示。`
        : `${provider.label} 网页提示词准备超时。请打开专用标签页检查登录状态。`
    );
  } catch (error) {
    const wrapped = new Error(describeTabMessageError(error, provider));
    wrapped.timings = { ...timings, totalMs: Date.now() - startedAt };
    throw wrapped;
  }

  if (provider.mode === 'auto') {
    let candidates;
    try {
      candidates = DP.normalizeReplyCandidates(result.reply, provider.label, settings);
    } catch (error) {
      const wrapped = new Error(safeErrorMessage(error));
      wrapped.timings = { ...timings, totalMs: Date.now() - startedAt };
      throw wrapped;
    }
    timings.totalMs = Date.now() - startedAt;
    return {
      mode: 'auto',
      provider: provider.id,
      providerLabel: provider.label,
      requestId,
      reply: candidates[0],
      candidates,
      replyCount: settings.replyCount,
      imageCount: result.confirmedImageCount,
      skippedImageCount: imageResult.skipped + Math.max(0, imageResult.images.length - result.confirmedImageCount),
      omittedImageCount: 0,
      timings
    };
  }

  await chrome.tabs.update(adapter.tab.id, { active: true });
  timings.totalMs = Date.now() - startedAt;
  return {
    mode: 'manual',
    provider: provider.id,
    providerLabel: provider.label,
    requestId,
    prepared: true,
    imageCount: imageResult.images.length,
    skippedImageCount: imageResult.skipped,
    omittedImageCount: provider.acceptsImages ? 0 : imageRequests.length,
    timings,
    instruction: `已把提示词${imageResult.images.length ? `和 ${imageResult.images.length} 张图片` : ''}放入 ${provider.label}。请手动发送，复制生成结果，再返回 X 粘贴。`
  };
}

async function runAdapterRequest(adapter, context) {
  const { requestId, prompt, images, settings, timings, hasText } = context;
  let confirmedImageCount = 0;

  if (adapter.capabilities.supportsImages && adapter.id === 'gemini') {
    const attachment = await attachGeminiImages(adapter, { requestId, images, timings, hasText });
    confirmedImageCount = attachment.confirmed;
  }

  if (adapter.capabilities.supportsAutoSubmit) {
    throwIfCancelled(requestId);
    const submitResponse = await adapter.submitPrompt({ requestId, prompt }, 45000);
    assertBridgeResponse(submitResponse, requestId, '发送提示词失败。');
    timings.sendMs = Number(submitResponse.sendMs) || 0;

    const waitResponse = await pollForProviderResponse(adapter, requestId, GENERATION_TIMEOUT_MS - 20000);
    timings.generateMs = Number(waitResponse.generateMs) || 0;

    const extractResponse = await adapter.extractResponse({ requestId }, 10000);
    assertBridgeResponse(extractResponse, requestId, '提取回答失败。');
    timings.extractMs = Number(extractResponse.extractMs) || 0;
    return {
      reply: String(extractResponse.reply || ''),
      confirmedImageCount: Math.min(images.length, Number(extractResponse.attachedImageCount ?? confirmedImageCount) || confirmedImageCount)
    };
  }

  const prepareResponse = await adapter.prepareRequest(
    { requestId, prompt, images },
    PREPARE_TIMEOUT_MS - 5000
  );
  assertBridgeResponse(prepareResponse, requestId, `${adapter.displayName} 提示词准备失败。`);
  timings.sendMs = Number(prepareResponse.prepareMs) || 0;
  return {
    prepared: true,
    confirmedImageCount: Math.min(images.length, Number(prepareResponse.imageCount) || images.length),
    reply: ''
  };
}

async function pollForProviderResponse(adapter, requestId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    throwIfCancelled(requestId);
    const response = await adapter.waitForResponse(
      { requestId, poll: true },
      RESPONSE_POLL_MESSAGE_TIMEOUT_MS
    );
    assertBridgeResponse(response, requestId, '等待回答失败。');
    if (response.ready === true) return response;
    await DP.sleep(RESPONSE_POLL_INTERVAL_MS);
  }
  throw new Error(`等待 ${adapter.displayName} 新回答超时；页面可能有验证、额度提示，或提示词未成功发送。`);
}

async function attachGeminiImages(adapter, context) {
  const { requestId, images, timings, hasText } = context;
  let confirmed = 0;
  const maxAttempts = 3;

  for (let index = 0; index < images.length; index += 1) {
    throwIfCancelled(requestId);
    const image = images[index];
    let lastError = '';
    let attached = false;
    for (let attempt = 0; attempt < maxAttempts && !attached; attempt += 1) {
      if (attempt > 0) await DP.sleep(700 * attempt);
      try {
        const response = await adapter.attachImages(
          { requestId, index, image },
          ATTACH_MESSAGE_TIMEOUT_MS
        );
        assertBridgeResponse(response, requestId, '附加图片失败。');
        if (response.attached) {
          attached = true;
          confirmed += 1;
          timings.uploadMs += Number(response.uploadMs) || 0;
        } else {
          lastError = String(response.error || 'Gemini 未确认附件增加。');
        }
      } catch (error) {
        lastError = safeErrorMessage(error);
      }
      if (/取消/.test(lastError)) throw new Error(lastError);
    }
    if (!attached) {
      if (hasText) continue;
      throw new Error(`第 ${index + 1} 张图片上传失败：${lastError || '未知原因'}。已确认 ${confirmed} 张，可重试。`);
    }
    await DP.sleep(350);
  }
  return { confirmed };
}

function assertBridgeResponse(response, requestId, fallback) {
  if (!response) throw new Error(fallback);
  if (!response.success) throw new Error(response.error || fallback);
  if (response.requestId && response.requestId !== requestId) {
    throw new Error('请求标识不匹配，已忽略过期响应。');
  }
}

async function downloadTweetImages(requests, timings, requestId) {
  const downloadStartedAt = Date.now();
  try {
    const results = [];
    let cursor = 0;
    const workerCount = Math.min(2, requests.length || 1);
    async function worker() {
      while (cursor < requests.length) {
        const index = cursor;
        cursor += 1;
        throwIfCancelled(requestId);
        try {
          results[index] = { image: await fetchTweetImage(requests[index], index) };
        } catch (_) {
          results[index] = { error: true };
        }
      }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const images = [];
    let skipped = 0;
    let totalBytes = 0;
    for (const result of results) {
      if (!result?.image) {
        skipped += 1;
        continue;
      }
      if (totalBytes + result.image.byteLength > DP.MAX_TOTAL_IMAGE_BYTES) {
        skipped += 1;
        continue;
      }
      totalBytes += result.image.byteLength;
      images.push(result.image);
    }
    return { images, skipped };
  } finally {
    timings.downloadMs = Date.now() - downloadStartedAt;
  }
}

async function fetchTweetImage(request, index) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'force-cache',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`图片请求失败 (${response.status})`);

    const finalUrl = new URL(response.url);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    const blob = await response.blob();
    const mimeType = DP.normalizeImageMimeType(blob.type || response.headers.get('content-type') || '');
    // Cumulative size is enforced post-download by downloadTweetImages().
    const validation = DP.validateDownloadResult({
      finalProtocol: finalUrl.protocol,
      finalHostname: finalUrl.hostname,
      finalPathname: finalUrl.pathname,
      declaredLength,
      blobSize: blob.size,
      mimeType
    });
    if (!validation.ok) throw new Error(validation.error);

    return {
      dataUrl: DP.toDataUrl(new Uint8Array(await blob.arrayBuffer()), validation.mimeType),
      mimeType: validation.mimeType,
      fileName: DP.buildImageFileName(request.url, validation.mimeType, index),
      alt: request.alt,
      byteLength: blob.size
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeImageRequests(value) {
  if (!Array.isArray(value)) return [];
  const results = [];
  const seen = new Set();
  for (const item of value.slice(0, DP.MAX_IMAGES)) {
    const url = DP.normalizeXImageUrl(item?.url);
    if (!url) continue;
    const key = DP.imageIdentityKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ url, alt: DP.sanitizeText(item?.alt, 500) });
  }
  return results;
}

async function getActiveProviderId() {
  const { selectedProvider = 'gemini' } = await chrome.storage.sync.get(['selectedProvider']);
  return DP.normalizeProviderId(selectedProvider);
}

async function cancelProviderRequest(providerId, requestId) {
  const provider = DP.getProviderDef(providerId);
  const tab = await getDedicatedProviderTab(provider);
  if (!tab) return false;
  const adapter = DP.createProviderAdapter(providerId, createTransport());
  adapter.tab = tab;
  return adapter.cancelRequest(String(requestId || ''));
}

function throwIfCancelled(requestId) {
  if (cancelledRequests.has(String(requestId || ''))) throw new Error('请求已取消。');
}

function createTransport() {
  return {
    ensureTab: (def, options) => getOrCreateDedicatedProviderTab(def, options),
    waitReady: (def, tabId, timeoutMs) => waitForBridge(def, tabId, timeoutMs),
    send: (def, tabId, action, payload, timeoutMs) => DP.withTimeout(
      chrome.tabs.sendMessage(tabId, { action, ...payload }),
      timeoutMs,
      `${def.label} 网页响应超时。`
    ),
    cancel: (def, tabId, action, requestId) => DP.withTimeout(
      chrome.tabs.sendMessage(tabId, { action, requestId }).catch(() => null),
      CANCEL_TIMEOUT_MS,
      '取消请求超时。'
    )
  };
}

async function getProviderStatus(provider) {
  const tab = await getDedicatedProviderTab(provider);
  if (!tab) return { ready: false, state: 'missing', message: '尚未建立专用标签页' };

  try {
    const response = await pingProviderBridge(provider, tab.id, true);
    if (response?.success) {
      const ready = Boolean(response.ready);
      return {
        ready,
        state: ready ? 'ready' : 'login_required',
        message: ready
          ? (provider.mode === 'auto' ? '已连接，可自动生成并回填草稿' : '已连接，可准备提示词；发送和复制由你完成')
          : (response.error || `请确认 ${provider.label} 已登录并可输入`)
      };
    }
  } catch (_) {
    return { ready: false, state: 'loading', message: '标签页存在，但桥接脚本尚未就绪' };
  }
  return { ready: false, state: 'unknown', message: `${provider.label} 状态未知` };
}

async function openOrActivateProviderTab(provider) {
  const existing = await getDedicatedProviderTab(provider);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    return existing;
  }
  return getOrCreateDedicatedProviderTab(provider, { activateWhenCreated: true });
}

async function getOrCreateDedicatedProviderTab(provider, { activateWhenCreated }) {
  const existing = await getDedicatedProviderTab(provider);
  if (existing?.id) return existing;
  const tab = await chrome.tabs.create({ url: provider.home, active: Boolean(activateWhenCreated) });
  if (!Number.isInteger(tab.id)) throw new Error(`无法创建 ${provider.label} 标签页。`);
  await chrome.storage.session.set({ [provider.tabKey]: tab.id });
  return tab;
}

async function getDedicatedProviderTab(provider) {
  const session = await chrome.storage.session.get([provider.tabKey]);
  const tabId = session[provider.tabKey];
  if (Number.isInteger(tabId)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (provider.urlPattern.test(tab.url || tab.pendingUrl || '')) return tab;
    } catch (_) {}
    await chrome.storage.session.remove([provider.tabKey]);
  }

  // session storage 只记录由本扩展建立或已经认领过的标签页。扩展重载、
  // service worker 重启或用户手动先打开网页时，这条记录可能不存在；此时
  // 从当前窗口集合中恢复最近使用的匹配页，避免把已打开的网页误报为缺失。
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) {}
  const candidates = tabs.filter((tab) => Number.isInteger(tab?.id)
    && provider.urlPattern.test(tab.url || tab.pendingUrl || ''));
  candidates.sort((left, right) => {
    const activeDelta = Number(Boolean(right.active)) - Number(Boolean(left.active));
    if (activeDelta) return activeDelta;
    return Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0);
  });
  const discovered = candidates[0] || null;
  if (discovered) await chrome.storage.session.set({ [provider.tabKey]: discovered.id });
  return discovered;
}

async function waitForBridge(provider, tabId, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  let repairAttempted = false;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await pingProviderBridge(provider, tabId, !repairAttempted);
      repairAttempted = true;
      if (response?.success) {
        if (!response.ready) throw new Error(response.error || `${provider.label} 尚未登录或输入框不可用。`);
        return;
      }
    } catch (error) {
      lastError = error;
      repairAttempted = true;
    }
    await DP.sleep(700);
  }
  throw new Error(lastError?.message?.includes('尚未登录')
    ? lastError.message
    : `无法连接 ${provider.label} 网页桥接。请打开专用标签页，确认已登录并刷新后重试。`);
}

async function pingProviderBridge(provider, tabId, repairOnFailure) {
  const sendPing = async () => {
    const response = await DP.withTimeout(
      chrome.tabs.sendMessage(tabId, { action: provider.pingAction }),
      5000,
      '连接检测超时'
    );
    // 部分 Chrome/MV3 组合在接收端不存在时不会 reject，而会 resolve
    // undefined。空响应与显式失败都表示当前桥接不可用，必须进入重注入
    // 路径；否则弹窗只会显示“状态未知”，永远不会触发自恢复。
    if (!response || response.success !== true) {
      throw new Error(response?.error || `${provider.label} 桥接未返回有效状态。`);
    }
    return response;
  };
  try {
    return await sendPing();
  } catch (firstError) {
    if (!repairOnFailure) throw firstError;
    await injectProviderBridge(provider, tabId);
    await DP.sleep(150);
    return sendPing();
  }
}

async function injectProviderBridge(provider, tabId) {
  const files = PROVIDER_BRIDGE_FILES[provider.id];
  if (!files) throw new Error(`${provider.label} 桥接配置缺失。`);
  await chrome.scripting.executeScript({ target: { tabId }, files: [...files] });
}

async function getActiveXTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const url = tab?.url || tab?.pendingUrl || '';
  if (!Number.isInteger(tab?.id) || !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url)) {
    throw new Error('当前标签页不是 X/Twitter。请先打开 x.com，再点击扩展。');
  }
  return tab;
}

async function getActiveXPageStatus({ repairIfMissing = true } = {}) {
  const tab = await getActiveXTab();
  try {
    let response;
    try {
      response = await pingXPage(tab.id);
    } catch (firstError) {
      if (!repairIfMissing) throw firstError;
      await injectXPageScripts(tab.id);
      await DP.sleep(150);
      response = await pingXPage(tab.id);
    }
    if (response?.success) return formatXPageStatus(response);
  } catch (_) {}
  return { ready: false, state: 'missing', panels: 0, tweets: 0, message: '当前 X 页面尚未加载增强脚本' };
}

async function repairActiveXPage() {
  const tab = await getActiveXTab();
  await injectXPageScripts(tab.id);
  await DP.sleep(500);
  try { await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_RESCAN' }); } catch (_) {}
  await DP.sleep(500);
  const status = await getActiveXPageStatus({ repairIfMissing: false });
  if (!status.ready) throw new Error('脚本已尝试注入，但 X 页面仍未响应。请检查扩展的网站访问权限。');
  return status;
}

async function pingXPage(tabId) {
  const response = await DP.withTimeout(
    chrome.tabs.sendMessage(tabId, { action: 'DRAFTPULSE_PING' }),
    4000,
    'X 页面增强脚本响应超时'
  );
  // 与提供商桥接一致：接收端缺失在部分环境中表现为 resolved
  // undefined，而不是 Promise rejection。必须把空响应提升为失联错误，
  // 让 getActiveXPageStatus 执行完整依赖重注入。
  if (!response || response.success !== true) {
    throw new Error(response?.error || 'X 页面增强脚本未返回有效状态。');
  }
  return response;
}

async function injectXPageScripts(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] }).catch(() => undefined);
  await chrome.scripting.executeScript({ target: { tabId }, files: [...X_PAGE_SCRIPT_FILES] });
}

function formatXPageStatus(response) {
  if (response.enabled === false) {
    return {
      ready: false,
      state: 'paused',
      version: response.version || '',
      panels: 0,
      tweets: Number(response.tweets || 0),
      message: '插件已暂停；不会扫描 X 页面或显示工具栏。'
    };
  }
  return {
    ready: true,
    state: 'ready',
    version: response.version || '',
    panels: Number(response.panels || 0),
    tweets: Number(response.tweets || 0),
    message: `已注入 v${response.version || '?'}；识别 ${Number(response.tweets || 0)} 条推文，显示 ${Number(response.panels || 0)} 个工具栏`
  };
}

async function rescanActiveXPage() {
  const tab = await getActiveXTab();
  try { await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_RESCAN' }); } catch (_) {}
  await DP.sleep(300);
  return getActiveXPageStatus();
}

async function clearViewSnapshots() {
  const removed = await chrome.storage.local.remove([DP.SNAPSHOT_STORAGE_KEY]);
  let tab = null;
  try { tab = await getActiveXTab(); } catch (_) {}
  if (tab) {
    try { await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_CLEAR_SNAPSHOTS' }); } catch (_) {}
  }
  return { removed: true, clearedTab: Boolean(tab) };
}

async function getDiagnostics() {
  const providerIds = ['gemini', 'chatgpt', 'deepseek'];
  const providers = {};
  await Promise.all(providerIds.map(async (id) => {
    const def = DP.getProviderDef(id);
    providers[id] = await getProviderStatus(def);
  }));
  let xPage = null;
  try { xPage = await getActiveXPageStatus(); } catch (_) { xPage = { ready: false, state: 'no_x_tab', message: '当前标签页不是 X/Twitter' }; }
  let lastRequest = null;
  try {
    const stored = await chrome.storage.local.get([LAST_REQUEST_KEY]);
    lastRequest = stored[LAST_REQUEST_KEY] || null;
  } catch (_) {}

  // Storage usage estimation
  let storageUsage = null;
  try {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null)
    ]);
    const syncBytes = JSON.stringify(syncData).length * 2; // rough UTF-16 estimate
    const localBytes = JSON.stringify(localData).length * 2;
    storageUsage = { syncBytes, localBytes, syncQuota: 102400, localQuota: 10485760 };
  } catch (_) {}

  const activeProviderId = await getActiveProviderId();
  const health = DP.computeHealthScore ? DP.computeHealthScore({
    xPage,
    activeProvider: activeProviderId,
    providers
  }) : null;

  return {
    version: chrome.runtime.getManifest().version,
    activeProvider: activeProviderId,
    providers,
    xPage,
    lastRequest,
    storageUsage,
    health
  };
}

function extractTimings(error) {
  return error && typeof error === 'object' && error.timings ? error.timings : null;
}

function isAllowedXSender(sender) {
  const url = sender?.url || sender?.tab?.url || '';
  return /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
}

function isExtensionPageSender(sender) {
  const url = sender?.url || '';
  return /^chrome-extension:\/\//i.test(url);
}

function describeTabMessageError(error, provider) {
  const message = safeErrorMessage(error);
  if (/Receiving end does not exist|Could not establish connection/i.test(message)) {
    return `${provider.label} 桥接脚本未加载。请刷新专用标签页后重试。`;
  }
  return message;
}

function safeErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || '未知错误');
}
