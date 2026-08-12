'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/*
 * 真实浏览器扩展验证（需配合 browser_verify.ps1）：
 * 1. 确认扩展已加载（service worker target 存在且 chrome.runtime.getManifest() 可读）
 * 2. 打开 https://x.com/ 并确认 content script 注入（window.__DRAFTPULSE_CONTENT_INSTANCE__）
 * 结果以 JSON 输出到 stdout，退出码 0/1。
 */

const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9333);
const EXPECTED_VERSION = process.env.EXPECTED_EXTENSION_VERSION || '1.5.0';

const BRIDGE_PAGES = [
  {
    id: 'gemini',
    url: 'https://gemini.google.com/',
    domain: /^https:\/\/gemini\.google\.com\//i,
    flag: '__DRAFTPULSE_GEMINI_BRIDGE__',
    pingAction: 'PING_GEMINI_BRIDGE'
  },
  {
    id: 'chatgpt',
    url: 'https://chatgpt.com/',
    domain: /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i,
    flag: '__DRAFTPULSE_CHATGPT_BRIDGE__',
    pingAction: 'PING_CHATGPT_BRIDGE'
  },
  {
    id: 'deepseek',
    url: 'https://chat.deepseek.com/',
    domain: /^https:\/\/chat\.deepseek\.com\//i,
    flag: '__DRAFTPULSE_DEEPSEEK_BRIDGE__',
    pingAction: 'PING_DEEPSEEK_BRIDGE'
  }
];

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    } else if (message.method) {
      events.push(message);
    }
  };
  return {
    send(method, params = {}) {
      const messageId = ++id;
      ws.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    events,
    close() {
      try { ws.close(); } catch (_) {}
    }
  };
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待超时: ${label}`);
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluate 异常: ${JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails.text)}`);
  }
  return result.result?.value;
}

async function main() {
  const hardDeadline = Date.now() + 100000;
  const report = {
    extensionLoaded: false,
    extensionVersion: null,
    contentScriptInjected: false,
    injectedVersion: null,
    xPageUrl: null,
    popup: null,
    popupExport: null,
    note: ''
  };

  const version = await waitFor(
    () => getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null),
    20000,
    'Chrome 调试端口'
  );
  if (Date.now() > hardDeadline) throw new Error('整体验证超过 100 秒硬超时');
  const browser = await connect(version.webSocketDebuggerUrl);

  const workerTargets = await waitFor(async () => {
    const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`).catch(() => []);
    const workers = targets.filter((target) =>
      target.type === 'service_worker' && /chrome-extension:\/\//.test(target.url) && target.webSocketDebuggerUrl
    );
    return workers.length ? workers : null;
  }, 15000, '扩展 service worker 启动');

  let worker = null;
  for (const candidate of workerTargets) {
    const candidateSession = await connect(candidate.webSocketDebuggerUrl);
    try {
      await candidateSession.send('Runtime.enable');
      const manifest = await evaluate(candidateSession, 'chrome.runtime.getManifest()');
      if (manifest?.version === EXPECTED_VERSION && manifest?.name?.includes('DraftPulse')) {
        worker = candidate;
        candidateSession.close();
        break;
      }
    } catch (_) {}
    candidateSession.close();
  }

  if (!worker) {
    report.note = '未发现 DraftPulse 扩展 service worker（可能加载失败或版本不匹配）；请确认 --load-extension 路径正确';
    browser.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const workerSession = await connect(worker.webSocketDebuggerUrl);
  await workerSession.send('Runtime.enable');
  const manifest = await evaluate(workerSession, 'chrome.runtime.getManifest()');
  report.extensionLoaded = Boolean(manifest);
  report.extensionVersion = manifest?.version || null;
  if (report.extensionVersion !== EXPECTED_VERSION) {
    report.note = `扩展版本 ${report.extensionVersion} 与预期 ${EXPECTED_VERSION} 不一致`;
    browser.close();
    workerSession.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const extensionId = worker.url.match(/chrome-extension:\/\/([^/]+)\//)?.[1] || '';
  report.extensionId = extensionId;

  const popupPage = await browser.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup.html` });
  const popupSession = await connect(`http://127.0.0.1:${DEBUG_PORT}/devtools/page/${popupPage.targetId}`);
  await popupSession.send('Runtime.enable');

  const popupState = await waitFor(async () => {
    const result = await popupSession.send('Runtime.evaluate', {
      expression: `(() => {
        const versionLabel = document.getElementById('versionLabel');
        const diagVersion = document.getElementById('diagVersion');
        const provider = document.getElementById('provider');
        const repair = document.getElementById('repairXBtn');
        return {
          ready: Boolean(versionLabel && diagVersion && provider && repair),
          versionLabel: versionLabel ? versionLabel.textContent : '',
          diagVersion: diagVersion ? diagVersion.textContent : '',
          providerCount: provider ? provider.options.length : 0
        };
      })()`,
      returnByValue: true
    });
    const state = result.result?.value;
    // diagVersion 从 HTML 初始的 "-" 变为版本号，说明 popup.js 初始化与首次诊断刷新已完成。
    return state && state.ready && state.diagVersion === EXPECTED_VERSION ? state : null;
  }, 15000, 'popup.html 渲染与诊断初始化');
  report.popup = popupState;

  await popupSession.send('Runtime.evaluate', {
    expression: `document.getElementById('exportDiagBtn').click(); true`,
    returnByValue: true
  });
  const diagText = await waitFor(async () => {
    const result = await popupSession.send('Runtime.evaluate', {
      expression: `(() => {
        const output = document.getElementById('diagOutput');
        return { value: output ? output.value : '', hidden: output ? output.hidden : true };
      })()`,
      returnByValue: true
    });
    const value = result.result?.value;
    return value && value.value ? value : null;
  }, 10000, '导出脱敏诊断 JSON').catch(async (error) => {
    const debug = await popupSession.send('Runtime.evaluate', {
      expression: `(() => {
        const output = document.getElementById('diagOutput');
        const last = document.getElementById('diagLastRequest');
        const err = document.getElementById('diagError');
        return JSON.stringify({
          outputValue: output ? output.value.slice(0, 200) : '(no element)',
          outputHidden: output ? output.hidden : null,
          lastRequest: last ? last.textContent : '',
          diagError: err ? err.textContent : '',
          htmlSnippet: document.body ? document.body.innerHTML.slice(0, 400) : ''
        });
      })()`,
      returnByValue: true
    });
    console.error('EXPORT DEBUG:', debug.result?.value || JSON.stringify(debug));
    throw error;
  });
  report.popupExport = {
    length: diagText.value.length,
    hasVersion: diagText.value.includes('"version"'),
    hasProvider: diagText.value.includes('"provider"'),
    hasTweetText: diagText.value.includes('tweetText'),
    hasImages: diagText.value.includes('"images"'),
    hasReply: diagText.value.includes('"reply"')
  };
  popupSession.close();

  const page = await browser.send('Target.createTarget', { url: 'https://x.com/' });
  const pageSession = await connect(`http://127.0.0.1:${DEBUG_PORT}/devtools/page/${page.targetId}`);
  await pageSession.send('Runtime.enable');
  await pageSession.send('Page.enable');

  try {
    const isolatedContext = await waitFor(async () => {
      const context = pageSession.events
        .filter((event) => event.method === 'Runtime.executionContextCreated')
        .map((event) => event.params.context)
        .find((item) => item.auxData?.type === 'isolated' && (item.origin || '').includes(extensionId));
      if (context) return context;
      return null;
    }, Math.min(45000, Math.max(5000, hardDeadline - Date.now())), 'x.com content script 隔离世界注入');

    const instance = await pageSession.send('Runtime.evaluate', {
      expression: 'window.__DRAFTPULSE_CONTENT_INSTANCE__',
      contextId: isolatedContext.id,
      returnByValue: true,
      awaitPromise: true
    });
    report.contentScriptInjected = true;
    report.injectedVersion = instance.result?.value?.version || null;
    report.xPageUrl = await evaluate(pageSession, 'location.href');

    // 安装 sender 探针（与 content.js 自己的监听器并存），定位来源校验失败的原因。
    await pageSession.send('Runtime.evaluate', {
      expression: `(() => {
        window.__xgProbe = null;
        chrome.runtime.onMessage.addListener((request, sender) => {
          if (request && request.action === 'DRAFTPULSE_PING') {
            window.__xgProbe = {
              id: sender ? sender.id : null,
              url: sender ? sender.url : null,
              tabUrl: sender && sender.tab ? sender.tab.url : null,
              runtimeId: chrome.runtime.id
            };
          }
        });
        return true;
      })()`,
      contextId: isolatedContext.id,
      returnByValue: true
    });

    // 核心消息通道往返：background 向 x.com 标签页发送 DRAFTPULSE_PING，验证 content listener 响应。
    const roundtrip = await workerSession.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
          const tab = tabs.find((item) => /^https:\\/\\/(www\\.)?x\\.com\\//.test(item.url || ''));
          if (!tab) return { ok: false, error: 'no x.com tab' };
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_PING' });
          return {
            ok: Boolean(response && response.success),
            version: response ? response.version : null,
            tweets: response ? response.tweets : null,
            panels: response ? response.panels : null,
            raw: response ? JSON.stringify(response) : '(empty response)',
            senderUrl: tab.url
          };
        } catch (error) {
          return { ok: false, error: String(error && error.message || error) };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    report.messagingRoundtrip = roundtrip.result?.value || null;
    const probe = await pageSession.send('Runtime.evaluate', {
      expression: 'window.__xgProbe',
      contextId: isolatedContext.id,
      returnByValue: true
    });
    report.senderProbe = probe.result?.value || null;

    // 在 x.com 页面注入测试推文 DOM，验证 content script 的 MutationObserver 检测并渲染工具栏。
    await pageSession.send('Runtime.evaluate', {
      expression: `(() => {
        const main = document.querySelector('main') || document.body;
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');

        const userName = document.createElement('div');
        userName.setAttribute('data-testid', 'User-Name');
        userName.textContent = '测试账号\\n@test_account';
        article.appendChild(userName);

        const tweetText = document.createElement('div');
        tweetText.setAttribute('data-testid', 'tweetText');
        tweetText.textContent = '浏览器验证注入的多图推文';
        article.appendChild(tweetText);

        const photos = document.createElement('div');
        const photo1 = document.createElement('img');
        photo1.setAttribute('src', 'https://pbs.twimg.com/media/VERIFY_1?format=jpg&name=small');
        photo1.setAttribute('alt', '第一张图');
        const photo2 = document.createElement('img');
        photo2.setAttribute('src', 'https://pbs.twimg.com/media/VERIFY_2?format=jpg&name=large');
        photo2.setAttribute('alt', '第二张图');
        photos.setAttribute('data-testid', 'tweetPhoto');
        photos.append(photo1, photo2);
        article.appendChild(photos);

        const time = document.createElement('time');
        time.setAttribute('datetime', new Date(Date.now() - 2 * 3600000).toISOString());
        time.textContent = '2小时';
        const statusLink = document.createElement('a');
        statusLink.setAttribute('href', '/test_account/status/990011223344');
        statusLink.style.display = 'none';
        statusLink.appendChild(time);
        article.appendChild(statusLink);

        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        const reply = document.createElement('button');
        reply.setAttribute('data-testid', 'reply');
        reply.setAttribute('aria-label', '3 条回复');
        const retweet = document.createElement('button');
        retweet.setAttribute('data-testid', 'retweet');
        retweet.setAttribute('aria-label', '12 次转推');
        const like = document.createElement('button');
        like.setAttribute('data-testid', 'like');
        like.setAttribute('aria-label', '56 个喜欢');
        const views = document.createElement('a');
        views.setAttribute('href', '/test_account/status/990011223344/analytics');
        views.setAttribute('aria-label', '12,345 次浏览');
        group.append(reply, retweet, like, views);
        article.appendChild(group);

        main.appendChild(article);
        return true;
      })()`,
      returnByValue: true
    });

    const tweetPanel = await waitFor(async () => {
      const result = await pageSession.send('Runtime.evaluate', {
        expression: `(() => {
          const panel = document.querySelector('.draftpulse-panel');
          if (!panel) return null;
          const badge = panel.querySelector('.draftpulse-heat-badge');
          const metrics = panel.querySelector('.draftpulse-metrics');
          const button = panel.querySelector('.draftpulse-reply-btn');
          return {
            panelCount: document.querySelectorAll('.draftpulse-panel').length,
            badge: badge ? badge.textContent : '',
            metrics: metrics ? metrics.textContent : '',
            button: button ? button.textContent : ''
          };
        })()`,
        returnByValue: true
      });
      const value = result.result?.value;
      return value && value.panelCount >= 1 && value.badge ? value : null;
    }, 15000, '注入推文后的工具栏渲染');
    report.tweetPanel = tweetPanel;

    // 布局检查：工具栏位于推文卡片内、文字不溢出、子元素不重叠。
    const layout = await pageSession.send('Runtime.evaluate', {
      expression: `(() => {
        const panel = document.querySelector('.draftpulse-panel');
        const article = panel ? panel.closest('article') : null;
        if (!panel || !article) return { ok: false, error: 'panel/article missing' };
        const panelRect = panel.getBoundingClientRect();
        const articleRect = article.getBoundingClientRect();
        const inBounds = panelRect.width > 0 &&
          panelRect.left >= articleRect.left - 1 &&
          panelRect.right <= articleRect.right + 1;

        const textEls = ['.draftpulse-heat-badge', '.draftpulse-metrics', '.draftpulse-reply-btn', '.draftpulse-provider-select'];
        const overflow = [];
        for (const selector of textEls) {
          const el = panel.querySelector(selector);
          if (el && el.scrollWidth > el.clientWidth + 2) {
            overflow.push(selector);
          }
        }

        const rects = [];
        for (const selector of ['.draftpulse-heat-badge', '.draftpulse-metrics', '.draftpulse-provider-select', '.draftpulse-reply-btn']) {
          const el = panel.querySelector(selector);
          if (el) {
            const r = el.getBoundingClientRect();
            rects.push({ selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          }
        }
        let overlap = false;
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            const a = rects[i];
            const b = rects[j];
            const hit = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            if (hit) {
              overlap = true;
              break;
            }
          }
          if (overlap) break;
        }
        return {
          ok: inBounds && overflow.length === 0 && !overlap,
          inBounds,
          overflow,
          overlap,
          panelWidth: Math.round(panelRect.width),
          articleWidth: Math.round(articleRect.width)
        };
      })()`,
      returnByValue: true
    });
    report.layout = layout.result?.value || null;

    // 注入后重新 PING：tweets/panels 计数应与渲染一致。
    const roundtripAfter = await workerSession.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
          const tab = tabs.find((item) => /^https:\\/\\/(www\\.)?x\\.com\\//.test(item.url || ''));
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_PING' });
          return { ok: Boolean(response && response.success), tweets: response ? response.tweets : null, panels: response ? response.panels : null };
        } catch (error) {
          return { ok: false, error: String(error && error.message || error) };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    report.pingAfterTweet = roundtripAfter.result?.value || null;

    // RESCAN 后面板数应保持不变（防重复工具栏）。
    const rescanResult = await workerSession.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const tabs = await chrome.tabs.query({ url: 'https://x.com/*' });
          const tab = tabs.find((item) => /^https:\\/\\/(www\\.)?x\\.com\\//.test(item.url || ''));
          await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_RESCAN' });
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'DRAFTPULSE_PING' });
          return { ok: Boolean(response && response.success), panels: response ? response.panels : null };
        } catch (error) {
          return { ok: false, error: String(error && error.message || error) };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    report.panelsAfterRescan = rescanResult.result?.value || null;

    // X 页面截图（浅色）供视觉检查。
    if (process.env.DRAFTPULSE_SCREENSHOT_DIR) {
      await pageSession.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: 'light' }]
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      const shot = await pageSession.send('Page.captureScreenshot', { format: 'png' });
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const screenshotPath = path.join(process.env.DRAFTPULSE_SCREENSHOT_DIR, 'draftpulse_x_tweet_panel.png');
      fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
      report.screenshot = screenshotPath;
    }
  } catch (error) {
    report.note = `x.com 页面验证失败: ${error.message}（可能为网络受限或 X 返回验证页）`;
    browser.close();
    workerSession.close();
    pageSession.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // AI 提供商桥接验证：页面可达时验证隔离世界注入与 PING 往返。
  report.bridges = {};
  for (const bridge of BRIDGE_PAGES) {
    const entry = { reachable: false, injected: false, ping: null, note: '' };
    let bridgePage = null;
    let bridgeSession = null;
    try {
      bridgePage = await browser.send('Target.createTarget', { url: bridge.url });
      bridgeSession = await connect(`http://127.0.0.1:${DEBUG_PORT}/devtools/page/${bridgePage.targetId}`);
      await bridgeSession.send('Runtime.enable');
      await bridgeSession.send('Page.enable');

      // 等待页面导航到目标域名（含登录/验证页跳转后的同域页面）。
      const loaded = await waitFor(async () => {
        const result = await bridgeSession.send('Runtime.evaluate', {
          expression: 'location.href',
          returnByValue: true
        }).catch(() => null);
        const href = result?.result?.value || '';
        return bridge.domain.test(href) ? href : null;
      }, 20000, `${bridge.id} 页面导航`).catch(() => null);
      if (!loaded) {
        entry.note = '页面未加载到目标域名（网络受限或重定向到其他域名）';
        continue;
      }
      entry.reachable = true;

      const bridgeContext = await waitFor(async () => {
        const context = bridgeSession.events
          .filter((event) => event.method === 'Runtime.executionContextCreated')
          .map((event) => event.params.context)
          .find((item) => item.auxData?.type === 'isolated' && (item.origin || '').includes(extensionId));
        return context || null;
      }, 15000, `${bridge.id} 桥接隔离世界`).catch(() => null);

      if (bridgeContext) {
        const flagResult = await bridgeSession.send('Runtime.evaluate', {
          expression: `window.${bridge.flag}`,
          contextId: bridgeContext.id,
          returnByValue: true
        });
        entry.injected = Boolean(flagResult.result?.value);
      }

      const ping = await workerSession.send('Runtime.evaluate', {
        expression: `(async () => {
          try {
            const tabs = await chrome.tabs.query({ url: '${bridge.url}*' });
            const tab = tabs.find((item) => ${bridge.domain}.test(item.url || ''));
            if (!tab) return { ok: false, error: 'no tab' };
            const response = await chrome.tabs.sendMessage(tab.id, { action: '${bridge.pingAction}' });
            return { ok: Boolean(response && response.success), ready: response ? response.ready : null, error: response ? response.error : null };
          } catch (error) {
            return { ok: false, error: String(error && error.message || error) };
          }
        })()`,
        awaitPromise: true,
        returnByValue: true
      });
      entry.ping = ping.result?.value || null;
    } catch (error) {
      entry.note = String(error && error.message || error);
    } finally {
      if (bridgeSession) bridgeSession.close();
      if (bridgePage?.targetId) {
        await browser.send('Target.closeTarget', { targetId: bridgePage.targetId }).catch(() => null);
      }
    }
    report.bridges[bridge.id] = entry;
  }

  browser.close();
  workerSession.close();
  pageSession.close();
  console.log(JSON.stringify(report, null, 2));
  const popupOk = report.popup?.versionLabel?.includes(EXPECTED_VERSION) &&
    report.popup?.diagVersion === EXPECTED_VERSION &&
    !report.popupExport?.hasTweetText &&
    !report.popupExport?.hasReply;
  const roundtripOk = report.messagingRoundtrip?.ok === true &&
    report.messagingRoundtrip?.version === EXPECTED_VERSION;
  const tweetPanelOk = report.tweetPanel?.panelCount === 1 &&
    /浏览\/小时/.test(report.tweetPanel?.badge || '') &&
    /浏览/.test(report.tweetPanel?.metrics || '') &&
    /2\s*图/.test(report.tweetPanel?.metrics || '');
  const layoutOk = report.layout?.ok === true;
  const pingAfterTweetOk = report.pingAfterTweet?.ok === true &&
    report.pingAfterTweet?.tweets === 1 &&
    report.pingAfterTweet?.panels === 1;
  const rescanOk = report.panelsAfterRescan?.ok === true &&
    report.panelsAfterRescan?.panels === 1;
  // 桥接站点遵循尽力而为：页面可达时注入与 PING 必须成功；页面不可达（网络受限）不算失败。
  const bridgeOk = Object.values(report.bridges || {}).every((entry) => {
    if (!entry.reachable) return true;
    return entry.injected && entry.ping?.ok === true;
  });
  process.exit(
    report.extensionLoaded && report.contentScriptInjected && popupOk &&
    roundtripOk && bridgeOk && tweetPanelOk && layoutOk &&
    pingAfterTweetOk && rescanOk ? 0 : 1
  );
}

const watchdog = setTimeout(() => {
  console.error('browser_verify 全局 200 秒硬超时，强制退出。');
  process.exit(1);
}, 200000);
watchdog.unref();

main()
  .then(() => {
    clearTimeout(watchdog);
  })
  .catch((error) => {
    console.error(error.stack || String(error));
    clearTimeout(watchdog);
    process.exit(1);
  });
