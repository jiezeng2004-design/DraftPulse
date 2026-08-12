(function () {
  'use strict';

  const VERSION = '2.0';
  const INSTANCE_KEY = '__DRAFTPULSE_CONTENT_INSTANCE__';
  const LAST_REQUEST_KEY = 'draftpulseLastRequest';
  const UPDATE_DELAYS = [0, 250, 900, 2200];
  const SCAN_DEBOUNCE_MS = 300;
  const EDITOR_WAIT_TIMEOUT_MS = 10000;
  const AUTO_MODE_EDITOR_WAIT_MS = 1200;
  const POST_GENERATION_EDITOR_WAIT_MS = 2500;
  const EDITOR_POLL_INTERVAL_MS = 120;
  const REMOVABLE_PANEL_SELECTOR = '.draftpulse-panel, #draftpulse-toast';
  const EPHEMERAL_MAP_MAX = 60;
  const TWEET_META_CACHE_TTL_MS = 5000;
  const METRICS_CACHE_TTL_MS = 2000;
  const BACKGROUND_RESPONSE_TIMEOUT_MS = 140000;
  const PROVIDER_LABELS = Object.freeze({ gemini: 'Gemini', chatgpt: 'ChatGPT', deepseek: 'DeepSeek' });
  const PROVIDER_MODES = Object.freeze({ gemini: 'auto', chatgpt: 'manual', deepseek: 'manual' });
  const PROVIDER_IMAGES = Object.freeze({ gemini: true, chatgpt: true, deepseek: false });
  const CANDIDATE_STYLE_LABELS = Object.freeze(['Insightful · 深度洞察', 'Casual · 轻松随意', 'Short · 简短精炼']);

  // Idle scheduler: use requestIdleCallback when available, fall back to setTimeout.
  const scheduleIdle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 50);

  // IntersectionObserver pre-filter: mark tweets visible in/near viewport so incremental
  // scans can skip off-screen articles. Non-breaking — full scan still works as fallback.
  let viewportObserver = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.dataset.draftpulseVisible = '1';
          }
        }
      }, { rootMargin: '200px' })
    : null;

  // Track which tweetIds have changed since last persist — skip writes when nothing changed.
  let dirtyTweetIds = new Set();

  const previousInstance = globalThis[INSTANCE_KEY];
  if (previousInstance && typeof previousInstance.destroy === 'function') {
    try { previousInstance.destroy(); } catch (_) {}
  }

  // 扩展更新/重载会让旧隔离世界失效，但旧世界插入的 DOM 仍可能留在页面上。
  // 新实例启动时先扫掉这些孤儿面板，避免同一推文出现两套工具栏或旧状态。
  try {
    document.querySelectorAll(REMOVABLE_PANEL_SELECTOR).forEach((element) => element.remove());
  } catch (_) {}

  const DP = globalThis.DraftPulseShared;
  const XS = DP.SELECTORS.x;

  let selectedProvider = 'gemini';
  let extensionEnabled = true;
  let pulseEnabled = true;
  let scanTimer = null;
  let destroyed = false;
  let observer = null;
  let viewSnapshots = Object.create(null);
  let persistTimer = null;
  let persistScheduledAt = 0;
  let snapshotEpoch = 0;
  let cooldownManager = null;
  let currentAccount = null;
  let accountMemoryStore = {};
  const pendingReplies = new Map();
  const filledCandidates = new Map();
  const cancelledRequestIds = new Set();
  const panelRefs = new WeakMap();

  const storageListener = (changes, areaName) => {
    if (areaName === 'sync') {
      if (changes.selectedProvider) {
        selectedProvider = DP.normalizeProviderId(changes.selectedProvider.newValue);
        scheduleScan();
      }
      if (changes.extensionEnabled) {
        extensionEnabled = changes.extensionEnabled.newValue !== false;
        if (extensionEnabled) startEnhancement();
        else pauseEnhancement();
      }
      if (changes.generationCooldownSeconds && cooldownManager) {
        cooldownManager.setCooldownSeconds(Number(changes.generationCooldownSeconds.newValue) || 30);
      }
    }
    if (areaName === 'local' && changes.draftpulsePulseSettings) {
      const newVal = changes.draftpulsePulseSettings.newValue;
      pulseEnabled = newVal && typeof newVal === 'object' ? newVal.enabled !== false : true;
    }
  };

  const runtimeListener = (request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return undefined;
    if (sender?.id !== chrome.runtime.id || !isAllowedSender(sender)) {
      sendResponse({ success: false, error: '请求来源无效。' });
      return false;
    }
    if (request.action === 'DRAFTPULSE_PING') {
      sendResponse({
        success: true,
        version: VERSION,
        enabled: extensionEnabled,
        panels: countOwnPanels(),
        tweets: document.querySelectorAll(XS.article).length
      });
      return false;
    }
    if (request.action === 'DRAFTPULSE_RESCAN') {
      if (!extensionEnabled) {
        sendResponse({ success: true, paused: true });
        return false;
      }
      document.querySelectorAll('.draftpulse-panel').forEach((panel) => {
        panel.removeAttribute('data-draftpulse-meta');
        panel.removeAttribute('data-draftpulse-metrics');
      });
      scheduleScan();
      sendResponse({ success: true });
      return false;
    }
    if (request.action === 'DRAFTPULSE_CLEAR_SNAPSHOTS') {
      // 世代号 +1：此前排入的落盘任务触发时直接放弃，避免旧快照写回。
      snapshotEpoch += 1;
      viewSnapshots = Object.create(null);
      dirtyTweetIds.clear();
      schedulePersistSnapshots(true, snapshotEpoch);
      sendResponse({ success: true });
      return false;
    }
    return undefined;
  };

  globalThis[INSTANCE_KEY] = {
    version: VERSION,
    destroy() {
      destroyed = true;
      pauseEnhancement({ cancelRequests: false });
      if (persistTimer) clearTimeout(persistTimer);
      persistScheduledAt = 0;
      filledCandidates.clear();
      pendingReplies.clear();
      cancelledRequestIds.clear();
      if (cooldownManager) cooldownManager.clear();
      cooldownManager = null;
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.runtime.onMessage.removeListener(runtimeListener);
    }
  };

  chrome.storage.onChanged.addListener(storageListener);
  chrome.runtime.onMessage.addListener(runtimeListener);
  initializeSettings();

  async function initializeSettings() {
    try {
      const [syncStored, localStored] = await Promise.all([
        chrome.storage.sync.get(['selectedProvider', 'extensionEnabled']),
        chrome.storage.local.get([DP.SNAPSHOT_STORAGE_KEY, 'draftpulsePulseSettings'])
      ]);
      selectedProvider = DP.normalizeProviderId(syncStored.selectedProvider);
      extensionEnabled = syncStored.extensionEnabled !== false;
      const pulseSettings = localStored['draftpulsePulseSettings'];
      pulseEnabled = pulseSettings && typeof pulseSettings === 'object' ? pulseSettings.enabled !== false : true;
      viewSnapshots = DP.normalizeSnapshotStore(localStored[DP.SNAPSHOT_STORAGE_KEY]);
      viewSnapshots = DP.pruneSnapshotStore(viewSnapshots);
    } catch (_) {
      selectedProvider = 'gemini';
      extensionEnabled = true;
      viewSnapshots = Object.create(null);
    }

    // Initialize cooldown manager
    try {
      const { generationCooldownSeconds } = await chrome.storage.sync.get(['generationCooldownSeconds']);
      const cooldownSec = Number(generationCooldownSeconds) || 30;
      cooldownManager = new DP.CooldownManager({ cooldownSeconds: cooldownSec });
    } catch (_) {
      cooldownManager = new DP.CooldownManager();
    }

    // Load per-account memory
    try {
      const accountData = await chrome.storage.local.get([DP.ACCOUNT_MEMORY_KEY]);
      accountMemoryStore = DP.normalizeAccountMemoryStore(accountData[DP.ACCOUNT_MEMORY_KEY]);
      currentAccount = DP.detectCurrentXAccount ? DP.detectCurrentXAccount(XS) : null;
    } catch (_) {}

    if (destroyed) return;
    if (extensionEnabled) startEnhancement();
    else pauseEnhancement({ cancelRequests: false });
  }

  function startEnhancement() {
    if (destroyed || !extensionEnabled) return;
    if (!observer) {
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // Start observing viewport for IntersectionObserver pre-filter.
    if (!viewportObserver && typeof IntersectionObserver !== 'undefined') {
      viewportObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.dataset.draftpulseVisible = '1';
          }
        }
      }, { rootMargin: '200px' });
    }
    if (viewportObserver) {
      document.querySelectorAll(XS.article).forEach((article) => viewportObserver.observe(article));
    }
    scheduleScan();
  }

  function pauseEnhancement({ cancelRequests = true } = {}) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    observer?.disconnect();
    observer = null;
    if (viewportObserver) { viewportObserver.disconnect(); viewportObserver = null; }
    if (cancelRequests) cancelActiveRequestsForPause();
    document.querySelectorAll(REMOVABLE_PANEL_SELECTOR).forEach((element) => element.remove());
  }

  function cancelActiveRequestsForPause() {
    for (const panel of document.querySelectorAll('.draftpulse-panel[data-active-request-id]')) {
      const requestId = String(panel.dataset.activeRequestId || '');
      if (!requestId) continue;
      cancelledRequestIds.add(requestId);
      const provider = getPanelRefs(panel).button?.dataset?.provider || selectedProvider;
      sendRuntimeMessage({ action: 'CANCEL_PROVIDER_REQUEST', provider, requestId }).catch(() => undefined);
    }
  }

  function isAllowedSender(sender) {
    return DP.isTrustedRuntimeSender(
      sender,
      chrome.runtime.id,
      /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i
    );
  }

  function ownQuery(article, selector) {
    for (const element of article.querySelectorAll(selector)) {
      if (element.closest(XS.article) === article) return element;
    }
    return null;
  }

  function ownQueryAll(article, selector) {
    return [...article.querySelectorAll(selector)].filter((element) => element.closest(XS.article) === article);
  }

  function readMetricFromElement(element) {
    if (!element) return 0;
    return DP.parseMetric(`${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`);
  }

  function getMetrics(article) {
    const actionGroup = findActionGroup(article);
    const reply = ownQuery(article, XS.replyButton);
    const repost = ownQuery(article, XS.retweetButton);
    const like = ownQuery(article, XS.likeButton);
    const viewElement = ownQuery(article, XS.viewLink);

    const metrics = {
      replies: readMetricFromElement(reply),
      reposts: readMetricFromElement(repost),
      likes: readMetricFromElement(like),
      views: readMetricFromElement(viewElement),
      hasViews: Boolean(viewElement)
    };

    if (actionGroup) {
      for (const element of actionGroup.querySelectorAll('button, a')) {
        const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`;
        if (!metrics.replies && /(repl|回复|评论)/i.test(label)) metrics.replies = DP.parseMetric(label);
        if (!metrics.reposts && /(repost|retweet|转发|转推)/i.test(label)) metrics.reposts = DP.parseMetric(label);
        if (!metrics.likes && /(like|喜欢|点赞)/i.test(label)) metrics.likes = DP.parseMetric(label);
        if (/(view|浏览|观看)/i.test(label)) {
          metrics.hasViews = true;
          if (!metrics.views) metrics.views = DP.parseMetric(label);
        }
      }
    }
    return metrics;
  }

  function findActionGroup(article) {
    const replyButton = ownQuery(article, XS.replyButton);
    if (replyButton) {
      const group = replyButton.closest(XS.actionGroup);
      if (group && group.closest(XS.article) === article) return group;
    }
    return ownQueryAll(article, XS.actionGroup).find((group) =>
      group.querySelector(`${XS.likeButton}, ${XS.retweetButton}, a[href$="/analytics"]`)
    ) || null;
  }

  function getTweetIdentity(article) {
    const timeElement = ownQuery(article, XS.time);
    const publishedAt = timeElement ? Date.parse(timeElement.getAttribute('datetime') || '') : NaN;
    const links = [
      timeElement?.closest(XS.statusLink),
      ...ownQueryAll(article, XS.statusLink)
    ].filter(Boolean);

    let tweetId = '';
    for (const link of links) {
      const match = String(link.getAttribute('href') || '').match(/\/status\/(\d+)/);
      if (match) {
        tweetId = match[1];
        break;
      }
    }
    return {
      tweetId,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0
    };
  }

  function getViewGrowth(article, metrics, identityOverride) {
    const identity = identityOverride || getTweetIdentity(article);
    if (!metrics || !metrics.hasViews) {
      return { available: false, rate: 0, source: 'unavailable', ageHours: 0, identity };
    }
    const now = Date.now();
    const result = DP.computeViewGrowth({
      tweetId: identity.tweetId,
      publishedAt: identity.publishedAt,
      views: metrics.views,
      now,
      snapshot: identity.tweetId ? viewSnapshots[identity.tweetId] : null
    });
    if (result.snapshot && identity.tweetId) {
      viewSnapshots[identity.tweetId] = result.snapshot;
      dirtyTweetIds.add(identity.tweetId);
      schedulePersistSnapshots(false, snapshotEpoch);
    }
    return { ...result, identity };
  }

  function normalizeSnapshotPersistence() {
    viewSnapshots = DP.pruneSnapshotStore(viewSnapshots);
  }

  function schedulePersistSnapshots(forceImmediate, epoch) {
    const now = Date.now();
    // 纯防抖在持续扫描（滚动、虚拟列表复用）时会不断重置，导致快照长时间不落盘。
    // 用最大延迟兜底：调度超过 5 秒仍被重置则立即落盘。
    const MAX_PERSIST_DELAY_MS = 5000;
    if (!forceImmediate && persistScheduledAt === 0) persistScheduledAt = now;
    if (!forceImmediate && now - persistScheduledAt >= MAX_PERSIST_DELAY_MS) {
      forceImmediate = true;
    }
    if (persistTimer) clearTimeout(persistTimer);
    // Skip scheduling when nothing changed and not forced — avoids redundant storage writes.
    if (!forceImmediate && dirtyTweetIds.size === 0) {
      persistScheduledAt = 0;
      return;
    }
    const doPersist = async () => {
      persistTimer = null;
      persistScheduledAt = 0;
      if (epoch !== undefined && epoch !== snapshotEpoch) return;
      normalizeSnapshotPersistence();
      try { await chrome.storage.local.set({ [DP.SNAPSHOT_STORAGE_KEY]: viewSnapshots }); } catch (_) {}
      dirtyTweetIds.clear();
    };
    if (forceImmediate) {
      persistTimer = setTimeout(doPersist, 0);
    } else {
      // Use requestIdleCallback for non-critical persist — keeps main thread responsive.
      persistTimer = setTimeout(() => scheduleIdle(doPersist), 1200);
    }
  }

  function getTweetImageDescriptors(article) {
    const descriptors = [];
    const photoSelectors = [XS.tweetPhotoImage, XS.photoLinkImage, XS.anyMediaImage].join(',');
    for (const img of ownQueryAll(article, photoSelectors)) {
      const type = classifyImageElement(img);
      if (!type) continue;
      descriptors.push({
        url: pickBestImageSource(img),
        alt: img.getAttribute('alt') || '',
        type
      });
    }
    if (descriptors.filter((d) => d.type === 'image').length < DP.MAX_IMAGES) {
      for (const element of ownQueryAll(article, XS.backgroundPhoto)) {
        if (element.closest(XS.videoContainer) || element.closest(XS.cardContainer)) continue;
        const match = String(element.getAttribute('style') || '').match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
        descriptors.push({ url: match?.[1] || '', alt: '', type: 'image' });
      }
    }
    return descriptors;
  }

  function classifyImageElement(img) {
    const src = String(img.currentSrc || img.src || '');
    const collect = DP.shouldCollectImage({
      inVideo: Boolean(img.closest(XS.videoContainer)),
      inCard: Boolean(img.closest(XS.cardContainer)),
      inQuote: Boolean(img.closest(XS.quoteContainer)),
      inAvatar: Boolean(img.closest(XS.avatarContainer)),
      src
    });
    return collect ? 'image' : null;
  }

  function pickBestImageSource(image) {
    return DP.pickBestSrcset(image.getAttribute('srcset')) || image.currentSrc || image.src || '';
  }

  function getTweetImages(article) {
    return DP.collectTweetImages(getTweetImageDescriptors(article), DP.MAX_IMAGES);
  }

  function readPanelAttr(panel, attr) {
    try {
      const raw = panel.getAttribute(attr);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writePanelAttr(panel, attr, value) {
    panel.setAttribute(attr, JSON.stringify(value));
  }

  function getCachedMeta(article, panel) {
    const now = Date.now();
    const cache = readPanelAttr(panel, 'data-draftpulse-meta');
    if (cache && now - cache.ts < TWEET_META_CACHE_TTL_MS) {
      return {
        images: Number(cache.images) || 0,
        tweetId: String(cache.tweetId || ''),
        publishedAt: Number(cache.publishedAt) || 0
      };
    }
    const images = getTweetImages(article).length;
    const identity = getTweetIdentity(article);
    const value = { images, tweetId: identity.tweetId, publishedAt: identity.publishedAt, ts: now };
    writePanelAttr(panel, 'data-draftpulse-meta', value);
    return {
      images: Number(value.images) || 0,
      tweetId: String(value.tweetId || ''),
      publishedAt: Number(value.publishedAt) || 0
    };
  }

  function getCachedMetrics(article, panel) {
    const now = Date.now();
    const cache = readPanelAttr(panel, 'data-draftpulse-metrics');
    if (cache && cache.hasViews === true && now - cache.ts < METRICS_CACHE_TTL_MS) {
      return {
        replies: Number(cache.replies) || 0,
        reposts: Number(cache.reposts) || 0,
        likes: Number(cache.likes) || 0,
        views: Number(cache.views) || 0,
        hasViews: Boolean(cache.hasViews)
      };
    }
    const metrics = getMetrics(article);
    if (metrics.hasViews) {
      writePanelAttr(panel, 'data-draftpulse-metrics', { ...metrics, ts: now });
    }
    return metrics;
  }


  function findOwnPanel(article) {
    const panels = ownQueryAll(article, '.draftpulse-panel');
    if (!panels.length) return null;

    // 只复用当前实例创建、在 WeakMap 中有引用的面板。扩展重载后遗留的
    // 面板没有 refs，必须移除并重建，否则看起来像重复渲染且按钮不能工作。
    const managed = panels.find((panel) => panelRefs.has(panel)) || null;
    for (const panel of panels) {
      if (panel !== managed) panel.remove();
    }
    return managed;
  }

  function createPanel(article) {
    const panel = document.createElement('div');
    panel.className = 'draftpulse-panel';
    panel.setAttribute('data-draftpulse-version', VERSION);

    const summary = document.createElement('div');
    summary.className = 'draftpulse-summary';
    const badge = document.createElement('span');
    badge.className = 'draftpulse-heat-badge normal';
    const metricsText = document.createElement('span');
    metricsText.className = 'draftpulse-metrics';
    summary.append(badge, metricsText);

    const controls = document.createElement('div');
    controls.className = 'draftpulse-controls';

    const providerSelect = document.createElement('select');
    providerSelect.className = 'draftpulse-provider-select';
    providerSelect.setAttribute('aria-label', '选择网页模型');
    providerSelect.innerHTML = [
      '<option value="gemini">Gemini · 自动</option>',
      '<option value="chatgpt">ChatGPT · 半自动</option>',
      '<option value="deepseek">DeepSeek · 半自动</option>'
    ].join('');
    providerSelect.addEventListener('click', (event) => event.stopPropagation());
    providerSelect.addEventListener('change', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedProvider = DP.normalizeProviderId(providerSelect.value);
      try { await chrome.storage.sync.set({ selectedProvider }); } catch (_) {}
      scheduleScan();
    });

    const button = document.createElement('button');
    button.className = 'draftpulse-reply-btn';
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      generateReply(article, panel, button);
    });

    const cancelButton = document.createElement('button');
    cancelButton.className = 'draftpulse-cancel-btn';
    cancelButton.type = 'button';
    cancelButton.textContent = '取消';
    cancelButton.hidden = true;
    cancelButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelCurrentRequest(panel, button);
    });

    controls.append(providerSelect, button, cancelButton);

    const candidateRow = document.createElement('div');
    candidateRow.className = 'draftpulse-candidates';
    candidateRow.hidden = true;
    const candidateSelect = document.createElement('select');
    candidateSelect.className = 'draftpulse-candidate-select';
    candidateSelect.setAttribute('aria-label', '选择候选回复');
    candidateSelect.addEventListener('change', () => switchCandidate(article, panel));
    candidateRow.append(candidateSelect);

    const status = document.createElement('div');
    status.className = 'draftpulse-status';
    status.hidden = true;

    panel.append(summary, controls, candidateRow, status);
    panelRefs.set(panel, {
      badge,
      metricsText,
      providerSelect,
      button,
      cancelButton,
      status,
      candidateRow,
      candidateSelect
    });
    return panel;
  }

  function getPanelRefs(panel) {
    return panelRefs.get(panel) || {};
  }

  function placePanel(article, panel) {
    const actionGroup = findActionGroup(article);
    if (actionGroup) {
      actionGroup.insertAdjacentElement('afterend', panel);
      return true;
    }
    const tweetText = ownQuery(article, XS.tweetText);
    if (tweetText) {
      tweetText.insertAdjacentElement('afterend', panel);
      return true;
    }
    const lastOwnChild = [...article.children].reverse().find((child) => child.closest(XS.article) === article);
    if (lastOwnChild) {
      lastOwnChild.insertAdjacentElement('afterend', panel);
      return true;
    }
    return false;
  }

  function updateTweet(article) {
    if (destroyed || !extensionEnabled || !(article instanceof HTMLElement) || !article.isConnected) return 'skipped';

    let panel = findOwnPanel(article);
    let created = false;
    if (!panel) {
      panel = createPanel(article);
      if (!placePanel(article, panel)) return 'skipped';
      created = true;
    }

    const metrics = getCachedMetrics(article, panel);
    const meta = getCachedMeta(article, panel);
    const growth = getViewGrowth(article, metrics, {
      tweetId: meta.tweetId,
      publishedAt: meta.publishedAt
    });
    const images = meta.images;
    const { badge, metricsText, providerSelect, button } = getPanelRefs(panel);

    if (badge) {
      badge.classList.remove('viral', 'fast', 'normal');
      if (!growth.available) {
        badge.classList.add('normal');
        badge.textContent = '📈 浏览增速待获取';
        badge.title = '当前页面没有同时显示推文发布时间和浏览量。';
      } else if (growth.source === 'fresh') {
        badge.classList.add('normal');
        badge.textContent = '📈 刚发布 · 增速待积累';
        badge.title = '推文发布不足 1 分钟，为避免异常巨大数值，暂不估算增速。';
      } else {
        const level = growth.rate >= 10000 ? 'viral' : growth.rate >= 1000 ? 'fast' : 'normal';
        badge.classList.add(level);
        badge.textContent = `${level === 'viral' ? '🔥' : '⚡'} ${DP.formatRate(growth.rate)} 浏览/小时`;
        badge.title = growth.source === 'observed'
          ? `根据扩展前后两次看到该推文时的浏览量差值计算；本次间隔约 ${growth.intervalMinutes} 分钟。`
          : '当前浏览量 ÷ 发布后经过小时数的平均估算；快照间隔达到阈值后会改用实际增量。';
      }
    }

    if (metricsText) {
      const parts = [
        `回复 ${DP.formatMetric(metrics.replies)}`,
        `转发 ${DP.formatMetric(metrics.reposts)}`,
        `喜欢 ${DP.formatMetric(metrics.likes)}`,
        `浏览 ${DP.formatMetric(metrics.views)}`
      ];
      if (growth.available) {
        parts.push(`发布 ${DP.formatAge(growth.ageHours)}`);
        parts.push(growth.source === 'observed'
          ? `近次增速 · 间隔 ${growth.intervalMinutes} 分钟`
          : (growth.source === 'average' ? '平均增速' : '刚发布'));
      }
      parts.push(`${images} 图`);
      metricsText.textContent = parts.join(' · ');
      metricsText.title = '互动数字直接读取自当前 X 页面；图片数仅统计主推文配图，不含头像、引用推文、视频和卡片图。';
    }

    // Pulse Score
    if (pulseEnabled && growth.available && DP.computePulseScore) {
      const pulse = DP.computePulseScore({
        viewRate: growth.rate,
        views: metrics.views,
        likes: metrics.likes,
        replies: metrics.replies,
        reposts: metrics.reposts,
        ageHours: growth.ageHours
      });
      // Add pulse level indicator to badge
      if (badge && pulse.level !== 'normal') {
        const pulseLabel = DP.PULSE_LABELS ? DP.PULSE_LABELS[pulse.level] : pulse.level;
        badge.title = `${badge.title} Pulse: ${pulseLabel} (${pulse.pulseScore})`;
      }
      // Add pulse info to metrics text
      if (metricsText) {
        const pulseLabel = DP.PULSE_LABELS ? DP.PULSE_LABELS[pulse.level] : pulse.level;
        const currentText = metricsText.textContent;
        metricsText.textContent = currentText + ` · Pulse ${pulseLabel}`;
      }
    }

    if (providerSelect && providerSelect.value !== selectedProvider) providerSelect.value = selectedProvider;
    if (button && !button.disabled) {
      if (panel.dataset.contextInvalidated === 'true') button.textContent = '刷新 X 页面恢复';
      else setButtonLabel(button, images);
    }
    return created ? 'created' : 'updated';
  }

  function setButtonLabel(button, imageCount) {
    const provider = selectedProvider;
    const label = PROVIDER_LABELS[provider];
    const supportsImages = PROVIDER_IMAGES[provider];
    const mode = PROVIDER_MODES[provider];
    button.textContent = mode === 'auto'
      ? (imageCount ? `生成图文草稿${imageCount > 1 ? `（${imageCount}图）` : ''}` : '生成回复草稿')
      : (imageCount && supportsImages ? `准备图文提示词${imageCount > 1 ? `（${imageCount}图）` : ''}` : '准备回复提示词');
    const imageDescription = imageCount
      ? (supportsImages ? `并附加 ${imageCount} 张图片` : `；当前不会附加 ${imageCount} 张图片`)
      : '';
    button.setAttribute('aria-label', `${label} ${mode === 'auto' ? '自动生成并回填' : '准备提示词'}${imageDescription}`);
    button.dataset.provider = provider;
  }

  async function generateReply(article, panel, button) {
    if (button.disabled) return;

    if (panel.dataset.contextInvalidated === 'true') {
      reloadPageForExtensionRecovery();
      return;
    }
    if (!isExtensionContextAvailable()) {
      markExtensionContextInvalidated(panel, button);
      return;
    }

    const provider = selectedProvider;
    const providerLabel = PROVIDER_LABELS[provider];
    const mode = PROVIDER_MODES[provider];
    const identity = getTweetIdentity(article);
    const pending = identity.tweetId ? pendingReplies.get(identity.tweetId) : null;
    const { candidateRow } = getPanelRefs(panel);
    candidateRow.hidden = true;
    if (identity.tweetId) filledCandidates.delete(identity.tweetId);

    if (pending) {
      await tryFillPending(article, panel, button, pending);
      return;
    }

    // Cooldown check (skip for pending fills — re-clicks to fill pending drafts must not be blocked)
    if (cooldownManager && identity.tweetId) {
      const cooldownCheck = cooldownManager.tryAcquire(identity.tweetId);
      if (!cooldownCheck.allowed) {
        const remainingSec = Math.ceil(cooldownCheck.remainingMs / 1000);
        setPanelStatus(panel, 'warn', `请等待 ${remainingSec} 秒后再次生成。`);
        showToast(`冷却中，请等待 ${remainingSec} 秒。`, 'info', 3000);
        return;
      }
    }

    let replyFilled = false;

    const tweetText = await readFullTweetText(article);
    const author = ownQuery(article, XS.userName)?.innerText?.split('\n')?.[0]?.trim() || '';
    const images = getTweetImages(article);

    if (!tweetText && images.length === 0) {
      setPanelStatus(panel, 'error', '未读取到推文正文或配图。');
      return;
    }
    if (!tweetText && images.length && !PROVIDER_IMAGES[provider]) {
      setPanelStatus(panel, 'error', `${providerLabel} 当前桥接不能处理纯图片推文，请改用 Gemini 或 ChatGPT。`);
      return;
    }

    if (mode === 'auto') {
      const editor = await findOpenReplyEditor(AUTO_MODE_EDITOR_WAIT_MS);
      if (!editor) {
        setPanelStatus(panel, 'error', '未检测到已打开的回复框。扩展不会自动点击回复/发布按钮；请先打开回复框，再点击生成。');
        return;
      }
    }

    // Thread context extraction
    let threadContext = null;
    const threadMode = (await chrome.storage.sync.get(['threadContextMode'])).threadContextMode || 'smart';
    if (threadMode !== 'single' && DP.extractThreadContext) {
      const contextTweets = DP.collectThreadTweetsFromDOM
        ? DP.collectThreadTweetsFromDOM(article, XS, identity.tweetId)
        : [];
      threadContext = DP.extractThreadContext({
        mode: threadMode,
        currentTweet: { tweetId: identity.tweetId, text: tweetText, author },
        contextTweets
      });
    }

    const requestId = crypto.randomUUID();
    const { cancelButton } = getPanelRefs(panel);
    button.disabled = true;
    cancelButton.hidden = false;
    panel.dataset.activeRequestId = requestId;
    setButtonLabel(button, images.length);
    button.textContent = mode === 'auto'
      ? (images.length ? `上传并识别 ${images.length} 图…` : '生成中…')
      : `准备 ${providerLabel}…`;
    setPanelStatus(panel, 'info', mode === 'auto' ? '正在上传图片并生成回答…' : `正在准备 ${providerLabel} 提示词…`);

    try {
      const response = await DP.withTimeout(
        sendRuntimeMessage({
          action: 'GENERATE_AI_REPLY_WEB',
          data: { provider, requestId, tweetText, author, images, threadContext, authorAccountId: currentAccount?.accountId || '' }
        }),
        BACKGROUND_RESPONSE_TIMEOUT_MS,
        '生成请求超时。请检查网络或专用标签页状态，稍后重试。'
      );
      if (!extensionEnabled || cancelledRequestIds.has(requestId)) {
        await recordLastRequest({
          requestId,
          provider,
          status: 'error',
          error: '请求已取消。',
          timings: response?.timings || null
        });
        setPanelStatus(panel, 'info', '请求已取消，已忽略已完成的回答。');
        showToast('请求已取消，不会填入回复框。', 'info', 3500);
        return;
      }
      if (!response?.success) {
        const error = new Error(response?.error || `${providerLabel} 未返回结果。`);
        error.timings = response?.timings || null;
        throw error;
      }
      if (response.requestId !== requestId) throw new Error('请求标识不匹配，已忽略过期响应。');

      const timings = { ...(response.timings || {}) };
      if (mode === 'auto') {
        const candidates = Array.isArray(response.candidates) && response.candidates.length
          ? response.candidates.map((text) => String(text || '').trim()).filter(Boolean)
          : [];
        const reply = candidates[0] || String(response.reply || '');

        // Check if Draft Panel mode is enabled
        const draftPanelMode = (await chrome.storage.sync.get(['draftPanelMode'])).draftPanelMode || 'auto_fill';
        if (draftPanelMode === 'panel') {
          showDraftPanel(article, panel, candidates.length ? candidates : [reply]);
          const usedImages = Number(response.imageCount || 0);
          const skippedImages = Number(response.skippedImageCount || 0);
          await recordLastRequest({ requestId, provider, status: 'success', imageCount: usedImages, skippedImageCount: skippedImages, timings });
          setPanelStatus(panel, 'success', '草稿已生成，请在下方面板中选择、编辑并填入。');
          showToast('草稿已生成，请在面板中查看。', 'success', 4000);
          return;
        }

        const backfillStartedAt = Date.now();
        const editor = await findOpenReplyEditor(POST_GENERATION_EDITOR_WAIT_MS);
        if (!editor) {
          // 先删除再写入，让最近写入的 key 位于 Map 迭代末尾（LRU 语义）。
          pendingReplies.delete(identity.tweetId);
          pendingReplies.set(identity.tweetId, {
            reply,
            candidates,
            replyCount: Number(response.replyCount || 1),
            imageCount: Number(response.imageCount || 0),
            skippedImageCount: Number(response.skippedImageCount || 0)
          });
          pruneEphemeralMaps();
          timings.backfillMs = Date.now() - backfillStartedAt;
          await recordLastRequest({
            requestId,
            provider,
            status: 'pending_fill',
            imageCount: Number(response.imageCount || 0),
            skippedImageCount: Number(response.skippedImageCount || 0),
            timings
          });
          setPanelStatus(panel, 'warn', '回答已生成，但回复框已关闭。请打开回复框后再次点击生成，将直接填入草稿（不会重复生成）。');
          showToast('回答已生成，回复框未打开。打开回复框后再次点击生成即可填入。', 'info', 7000);
          return;
        }
        const fillResult = await fillXEditor(editor, reply);
        timings.backfillMs = Date.now() - backfillStartedAt;
        const usedImages = Number(response.imageCount || 0);
        const skippedImages = Number(response.skippedImageCount || 0);
        const imageNote = usedImages ? `，已结合 ${usedImages} 张图片` : '';
        const skippedNote = skippedImages ? `；${skippedImages} 张图片未能读取` : '';
        if (fillResult.action === 'blocked') {
          await recordLastRequest({ requestId, provider, status: 'error', error: '回复框已有内容，未覆盖。', timings });
          setPanelStatus(panel, 'error', '回复框已有内容，未覆盖；请手动处理。');
          showToast('回复框已有内容，未覆盖。', 'error', 6000);
          return;
        }
        if (fillResult.action === 'skip') {
          await recordLastRequest({ requestId, provider, status: 'success', imageCount: usedImages, skippedImageCount: skippedImages, timings });
          setPanelStatus(panel, 'success', '回复框已包含相同内容，未重复插入。');
          showToast('回复框已包含相同内容，未重复插入。', 'success', 4500);
          return;
        }
        replyFilled = true;
        await recordLastRequest({ requestId, provider, status: 'success', imageCount: usedImages, skippedImageCount: skippedImages, timings });
        populateCandidates(article, panel, candidates);
        const multiNote = candidates.length > 1 ? '；可在工具栏切换候选' : '';
        setPanelStatus(panel, 'success', `已填入回复框${imageNote}${skippedNote}${multiNote}；请检查后手动发布。`);
        showToast(`回复草稿已填入${imageNote}${skippedNote}，请检查后手动发布。`, skippedImages ? 'info' : 'success', 5500);
      } else {
        const omittedImages = Number(response.omittedImageCount || 0);
        const omittedNote = omittedImages ? ` 当前未向 ${providerLabel} 附加 ${omittedImages} 张图片。` : '';
        await recordLastRequest({
          requestId,
          provider,
          status: 'success',
          imageCount: Number(response.imageCount || 0),
          skippedImageCount: Number(response.skippedImageCount || 0),
          timings
        });
        setPanelStatus(panel, 'success', `提示词已放入 ${providerLabel}。请手动发送、复制并粘贴。${omittedNote}`);
        showToast(`${response.instruction || `提示词已放入 ${providerLabel}。`}${omittedNote}`, 'success', 7500);
      }
    } catch (error) {
      if (isExtensionContextError(error)) {
        markExtensionContextInvalidated(panel, button);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await recordLastRequest({
        requestId,
        provider,
        status: 'error',
        error: message,
        timings: error && typeof error === 'object' && error.timings ? error.timings : null
      });
      setPanelStatus(panel, 'error', `${message} 可再次点击生成重试。`);
      showToast(message, 'error', 7500);
    } finally {
      // 生成失败时释放冷却锁，允许用户立即重试
      if (!replyFilled && cooldownManager && identity.tweetId) {
        cooldownManager.release(identity.tweetId);
      }
      cancelledRequestIds.delete(requestId);
      if (panel.dataset.activeRequestId === requestId) delete panel.dataset.activeRequestId;
      button.disabled = false;
      cancelButton.hidden = true;
      if (panel.dataset.contextInvalidated === 'true') {
        button.disabled = false;
        button.textContent = '刷新 X 页面恢复';
      } else {
        setButtonLabel(button, getTweetImages(article).length);
        setTimeout(() => updateTweet(article), 0);
      }
    }
  }

  async function readFullTweetText(article) {
    let text = readTweetText(article);
    const showMore = ownQuery(article, XS.showMore);
    if (!showMore || !isVisible(showMore)) return text;

    // X 的普通长推文通常已把完整正文放在 DOM 中，只是以 CSS 截断；
    // readTweetText 会优先采用更长的 textContent。若 DOM 也确实被截断，
    // 再点击页面自身的“显示更多”并等待正文重绘后读取。
    try { showMore.click(); } catch (_) { return text; }
    const before = text;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 1600) {
      await DP.sleep(80);
      text = readTweetText(article);
      if (text && text !== before) break;
      if (!showMore.isConnected || !isVisible(showMore)) break;
    }
    return text || before;
  }

  function readTweetText(article) {
    const element = ownQuery(article, XS.tweetText);
    if (!element) return '';
    const visibleText = normalizeTweetText(element.innerText);
    const domText = normalizeTweetText(element.textContent);
    return [...domText].length > [...visibleText].length ? domText : visibleText;
  }

  function normalizeTweetText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isExtensionContextAvailable() {
    try { return Boolean(chrome?.runtime?.id && chrome.runtime.sendMessage); } catch (_) { return false; }
  }

  function isExtensionContextError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return error?.code === 'XG_EXTENSION_CONTEXT_INVALIDATED'
      || /Extension context invalidated|context invalidated|扩展已更新或重新加载|Cannot access a chrome:\/\/ URL|Receiving end does not exist/i.test(message)
      || !isExtensionContextAvailable();
  }

  async function sendRuntimeMessage(message) {
    if (!isExtensionContextAvailable()) throw new Error('Extension context invalidated.');
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextError(error)) {
        const wrapped = new Error('扩展已更新或重新加载，当前 X 标签页仍在运行旧脚本。');
        wrapped.code = 'XG_EXTENSION_CONTEXT_INVALIDATED';
        wrapped.cause = error;
        throw wrapped;
      }
      throw error;
    }
  }

  function markExtensionContextInvalidated(panel, button) {
    panel.dataset.contextInvalidated = 'true';
    button.disabled = false;
    button.textContent = '刷新 X 页面恢复';
    setPanelStatus(panel, 'warn', '扩展已更新或重新加载，当前 X 标签页的旧脚本已失效。点击“刷新 X 页面恢复”即可重新连接；刷新前请先保存回复框中未发布的文字。');
    showToast('扩展上下文已失效，请刷新当前 X 页面恢复。', 'info', 8000);
  }

  function reloadPageForExtensionRecovery() {
    const editorText = findVisibleReplyEditorText();
    if (editorText && !window.confirm('刷新会清空当前回复框中尚未发布的文字。确认已保存并继续刷新吗？')) return;
    try { window.location.reload(); } catch (_) { location.reload(); }
  }

  function findVisibleReplyEditorText() {
    const selectors = [XS.replyEditorDialog, XS.replyEditorTextbox, XS.replyEditorInline, XS.replyEditorGlobal];
    for (const selector of selectors) {
      for (const editor of document.querySelectorAll(selector)) {
        if (isVisible(editor)) return String(editor.innerText || editor.textContent || '').trim();
      }
    }
    return '';
  }

  async function tryFillPending(article, panel, button, pending) {
    const editor = await findOpenReplyEditor(POST_GENERATION_EDITOR_WAIT_MS);
    if (!editor) {
      setPanelStatus(panel, 'warn', '回复框未打开。请先打开回复框，再点击生成。');
      return;
    }
    const identity = getTweetIdentity(article);
    const candidates = Array.isArray(pending.candidates) && pending.candidates.length
      ? pending.candidates
      : [pending.reply];
    const fillResult = await fillXEditor(editor, pending.reply);
    if (fillResult.action === 'blocked') {
      await recordLastRequest({ requestId: '', provider: selectedProvider, status: 'error', error: '补填时回复框已有内容，未覆盖。' });
      setPanelStatus(panel, 'error', '回复框已有内容，未覆盖；请手动处理。');
      return;
    }
    if (fillResult.action === 'skip') {
      await recordLastRequest({ requestId: '', provider: selectedProvider, status: 'success', imageCount: pending.imageCount });
      setPanelStatus(panel, 'success', '回复框已包含相同内容，未重复插入。');
    } else {
      populateCandidates(article, panel, candidates);
      await recordLastRequest({ requestId: '', provider: selectedProvider, status: 'success', imageCount: pending.imageCount });
      setPanelStatus(panel, 'success', `已填入已生成的草稿${pending.imageCount ? `（结合 ${pending.imageCount} 张图片）` : ''}。`);
      showToast('已填入之前生成的草稿，请检查后手动发布。', 'success', 4500);
    }
    pendingReplies.delete(identity.tweetId);
  }

  function showDraftPanel(article, panel, candidates) {
    const identity = getTweetIdentity(article);
    if (!identity.tweetId || !Array.isArray(candidates) || !candidates.length) return;

    // Remove existing draft panel if any
    const existing = panel.querySelector('.draftpulse-draft-panel');
    if (existing) existing.remove();

    const draftPanel = document.createElement('div');
    draftPanel.className = 'draftpulse-draft-panel';

    candidates.forEach((text, index) => {
      const card = document.createElement('div');
      card.className = 'draftpulse-candidate-card';

      const label = document.createElement('span');
      label.className = 'draftpulse-candidate-label';
      label.textContent = CANDIDATE_STYLE_LABELS[index] || `候选 ${index + 1}`;

      const textarea = document.createElement('textarea');
      textarea.className = 'draftpulse-candidate-textarea';
      textarea.value = text;
      textarea.rows = 3;
      textarea.setAttribute('aria-label', `候选回复 ${index + 1}`);

      const actions = document.createElement('div');
      actions.className = 'draftpulse-candidate-actions';

      const fillBtn = document.createElement('button');
      fillBtn.className = 'draftpulse-draft-btn fill-btn';
      fillBtn.type = 'button';
      fillBtn.textContent = 'Fill Reply';
      fillBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const editorText = textarea.value.trim();
        if (!editorText) return;
        const editor = await findOpenReplyEditor(POST_GENERATION_EDITOR_WAIT_MS);
        if (!editor) {
          setPanelStatus(panel, 'warn', '请先打开回复框。');
          return;
        }
        const fillResult2 = await overwriteXEditor(editor, editorText);
        if (fillResult2 && DP.normalizeForCompare(fillResult2) === DP.normalizeForCompare(editorText)) {
          setPanelStatus(panel, 'success', '已填入回复框，请检查后手动发布。');
        } else {
          setPanelStatus(panel, 'error', '填入失败，请手动复制粘贴。');
        }
        showToast('回复草稿已填入回复框，请检查后手动发布。', 'success', 4500);
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'draftpulse-draft-btn copy-btn';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(textarea.value);
          showToast('已复制到剪贴板。', 'success', 2500);
        } catch (_) {
          showToast('复制失败，请手动选择文本复制。', 'error', 3000);
        }
      });

      actions.append(fillBtn, copyBtn);
      card.append(label, textarea, actions);
      draftPanel.append(card);
    });

    panel.appendChild(draftPanel);
  }

  function populateCandidates(article, panel, candidates) {
    const { candidateRow: row, candidateSelect: select } = getPanelRefs(panel);
    const identity = getTweetIdentity(article);
    if (!row || !select || !identity.tweetId || !Array.isArray(candidates) || candidates.length < 2) return;
    select.replaceChildren();
    candidates.forEach((_, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `候选 ${index + 1}`;
      select.append(option);
    });
    // 先删除再写入，让最近写入的 key 位于 Map 迭代末尾（LRU 语义）。
    filledCandidates.delete(identity.tweetId);
    filledCandidates.set(identity.tweetId, { texts: candidates.slice(), filledIndex: 0 });
    pruneEphemeralMaps();
    select.value = '0';
    row.hidden = false;
  }

  function pruneEphemeralMaps() {
    while (pendingReplies.size > EPHEMERAL_MAP_MAX) {
      const oldestKey = pendingReplies.keys().next().value;
      if (oldestKey === undefined) break;
      pendingReplies.delete(oldestKey);
    }
    while (filledCandidates.size > EPHEMERAL_MAP_MAX) {
      const oldestKey = filledCandidates.keys().next().value;
      if (oldestKey === undefined) break;
      filledCandidates.delete(oldestKey);
    }
  }

  async function switchCandidate(article, panel) {
    const identity = getTweetIdentity(article);
    const entry = filledCandidates.get(identity.tweetId);
    const { candidateSelect: select } = getPanelRefs(panel);
    if (!entry || !select) return;
    const target = Number(select.value) || 0;
    if (target === entry.filledIndex) return;
    const editor = await findOpenReplyEditor(POST_GENERATION_EDITOR_WAIT_MS);
    if (!editor) {
      select.value = String(entry.filledIndex);
      setPanelStatus(panel, 'warn', '回复框未打开，无法切换候选。');
      return;
    }
    const current = String(editor.innerText || editor.textContent || '');
    if (DP.normalizeForCompare(current) !== DP.normalizeForCompare(entry.texts[entry.filledIndex])) {
      select.value = String(entry.filledIndex);
      setPanelStatus(panel, 'warn', '回复框内容已被修改，未切换候选。');
      return;
    }
    const switchResult = await overwriteXEditor(editor, entry.texts[target]);
    if (!switchResult || DP.normalizeForCompare(switchResult) !== DP.normalizeForCompare(entry.texts[target])) {
      setPanelStatus(panel, 'error', '切换候选失败，请手动复制粘贴。');
      return;
    }
    entry.filledIndex = target;
    setPanelStatus(panel, 'success', `已切换到候选 ${target + 1}。`);
  }

  async function cancelCurrentRequest(panel, button) {
    const requestId = panel.dataset.activeRequestId;
    if (!requestId) return;
    cancelledRequestIds.add(requestId);
    setPanelStatus(panel, 'info', '正在取消…');
    try {
      await chrome.runtime.sendMessage({
        action: 'CANCEL_PROVIDER_REQUEST',
        provider: selectedProvider,
        requestId
      });
    } catch (_) {}
  }

  async function findOpenReplyEditor(timeoutMs) {
    const startedAt = Date.now();
    const limit = Number(timeoutMs) || EDITOR_WAIT_TIMEOUT_MS;
    while (Date.now() - startedAt < limit) {
      const candidates = [
        ...document.querySelectorAll(XS.replyEditorDialog),
        ...document.querySelectorAll(XS.replyEditorTextbox),
        ...document.querySelectorAll(XS.replyEditorInline),
        ...document.querySelectorAll(XS.replyEditorGlobal)
      ].filter(isVisible);
      const editor = DP.pickReplyEditor(candidates);
      if (editor) return editor;
      await DP.sleep(EDITOR_POLL_INTERVAL_MS);
    }
    return null;
  }

  async function fillXEditor(editor, text) {
    const value = DP.sanitizeReplyForEditor(text);
    if (!value) return { action: 'blocked', reason: '生成内容为空。' };
    const currentText = String(editor.innerText || editor.textContent || '');
    const decision = DP.decideFill({ editorText: currentText, replyText: value });
    if (decision.action !== 'fill') return decision;

    const afterText = await overwriteXEditor(editor, value);
    // 后验证：确认文本实际持久化
    const normalizedAfter = DP.normalizeForCompare(afterText);
    const normalizedValue = DP.normalizeForCompare(value);
    if (!normalizedAfter || normalizedAfter !== normalizedValue) {
      return { action: 'blocked', reason: '填入后验证失败，回复框未接受文本。' };
    }
    return { action: 'fill', reason: 'empty' };
  }

  async function overwriteXEditor(editor, text) {
    editor.focus();
    // 等待 React 在 focus 后稳定
    await new Promise(r => requestAnimationFrame(r));
    // 记录 paste 前的内容，用于判断 paste 是否生效
    const beforeText = String(editor.innerText || editor.textContent || '').trim();
    // 通过 ClipboardEvent paste 让 React 的 paste 处理器接收文本并更新内部状态
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData
    });
    editor.dispatchEvent(pasteEvent);
    // 如果 paste 事件未被处理（X 未拦截），回退到直接 DOM 操作
    await DP.sleep(50);
    const afterText = String(editor.innerText || editor.textContent || '').trim();
    // 仅当 paste 实际改变了内容时才跳过回退
    if (afterText === beforeText) {
      // 回退：直接设置 innerText 并派发 input 事件
      editor.innerText = text;
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text
      }));
    }
    return String(editor.innerText || editor.textContent || '').trim();
  }

  function setPanelStatus(panel, type, message) {
    const { status } = getPanelRefs(panel);
    if (!status) return;
    status.hidden = !message;
    status.className = `draftpulse-status ${type}`;
    status.textContent = message || '';
  }

  async function recordLastRequest(record) {
    try {
      await chrome.storage.local.set({
        [LAST_REQUEST_KEY]: {
          timestamp: Date.now(),
          requestId: String(record.requestId || ''),
          provider: String(record.provider || ''),
          status: String(record.status || 'error'),
          imageCount: Number(record.imageCount) || 0,
          skippedImageCount: Number(record.skippedImageCount) || 0,
          timings: record.timings && typeof record.timings === 'object' ? record.timings : {},
          error: String(record.error || '').slice(0, 300)
        }
      });
    } catch (_) {}
  }

  function scheduleScan() {
    if (destroyed || !extensionEnabled) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (destroyed || !extensionEnabled) return;
      const scrollAnchor = captureScrollAnchor();
      const createdArticles = [];
      document.querySelectorAll(XS.article).forEach((article) => {
        if (viewportObserver && !article.dataset.draftpulseVisible) {
          viewportObserver.observe(article);
        }
        if (updateTweet(article) === 'created') createdArticles.push(article);
      });
      createdArticles.forEach((article) => {
        UPDATE_DELAYS.forEach((delay) => setTimeout(() => updateTweet(article), delay));
      });
      restoreScrollAnchor(scrollAnchor);
    }, SCAN_DEBOUNCE_MS);
  }

  function captureScrollAnchor() {
    const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
    if (!viewportHeight) return null;
    for (const article of document.querySelectorAll(XS.article)) {
      const rect = article.getBoundingClientRect();
      if (!Number.isFinite(rect?.top) || !Number.isFinite(rect?.bottom)) continue;
      if (rect.bottom > 0 && rect.top < viewportHeight) return { article, top: rect.top };
    }
    return null;
  }

  function restoreScrollAnchor(anchor) {
    if (!anchor?.article?.isConnected || typeof window.scrollBy !== 'function') return;
    const nextTop = anchor.article.getBoundingClientRect()?.top;
    const delta = Number(nextTop) - Number(anchor.top);
    const maxCorrection = Math.max(1200, Number(window.innerHeight || 0) * 2);
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5 || Math.abs(delta) > maxCorrection) return;
    window.scrollBy(0, delta);
  }

  function showToast(message, type = 'info', duration = 4200) {
    let toast = document.getElementById('draftpulse-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'draftpulse-toast';
      document.documentElement.appendChild(toast);
    }
    clearTimeout(showToast.timer);
    clearTimeout(showToast.fadeTimer);
    toast.className = `draftpulse-toast ${type}`;
    toast.textContent = message;
    toast.hidden = false;
    showToast.timer = setTimeout(() => {
      toast.classList.add('draftpulse-toast-fadeout');
      showToast.fadeTimer = setTimeout(() => { toast.hidden = true; toast.classList.remove('draftpulse-toast-fadeout'); }, 300);
    }, duration);
  }

  function countOwnPanels() {
    const articles = new Set();
    for (const panel of document.querySelectorAll('.draftpulse-panel')) {
      const article = panel.closest(XS.article);
      if (article) articles.add(article);
    }
    return articles.size;
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

})();



