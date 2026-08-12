/*
 * xg_account_memory.js - 按 X 账号记忆默认设置（persona / language / replyStyle）。
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

  const ACCOUNT_MEMORY_KEY = 'draftpulseAccountMemoryV1';
  const MAX_ACCOUNTS = 20;

  const ALLOWED_ENTRY_KEYS = Object.freeze(['persona', 'language', 'replyStyle', 'lastUsedAt']);

  /*
   * 读取当前 X 页面登录账号的 handle。
   * 优先使用左侧导航栏的个人资料链接，回退到时间线中的用户名链接。
   * 返回 { accountId, handle } 或 null；任何异常都返回 null。
   */
  function detectCurrentXAccount(selectors) {
    try {
      if (!selectors || typeof selectors !== 'object') return null;
      const xs = selectors.x || selectors;

      // 首选：左侧导航栏的个人资料链接
      // nav a[data-testid="AppTabBar_Profile_Link"]
      const profileLink = document.querySelector('nav a[data-testid="AppTabBar_Profile_Link"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || '';
        const match = href.match(/^\/([^\/\?#]+)/);
        if (match) {
          const handle = match[1].toLowerCase();
          return { accountId: handle, handle: match[1] };
        }
      }

      // 回退：时间线中的用户名链接
      // [data-testid="User-Name"] a[href^="/"]
      const userNameSelector = xs.userName || 'div[data-testid="User-Name"]';
      const userNameEl = document.querySelector(userNameSelector);
      if (userNameEl) {
        const nameLink = userNameEl.querySelector('a[href^="/"]');
        if (nameLink) {
          const href = nameLink.getAttribute('href') || '';
          const match = href.match(/^\/([^\/\?#]+)/);
          if (match) {
            const handle = match[1].toLowerCase();
            return { accountId: handle, handle: match[1] };
          }
        }
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  /*
   * 校验并清理存储对象。
   * 只保留 { persona, language, replyStyle, lastUsedAt } 字段；
   * 丢弃无效条目和非字符串 key。
   */
  function normalizeAccountMemoryStore(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const key of Object.keys(value)) {
      if (typeof key !== 'string' || !key) continue;
      const entry = value[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const clean = {};
      let hasAny = false;
      for (const field of ALLOWED_ENTRY_KEYS) {
        if (entry[field] !== undefined && entry[field] !== null) {
          if (field === 'lastUsedAt') {
            const ts = Number(entry[field]);
            if (Number.isFinite(ts)) {
              clean[field] = ts;
              hasAny = true;
            }
          } else {
            const str = String(entry[field]).trim();
            if (str) {
              clean[field] = str;
              hasAny = true;
            }
          }
        }
      }
      if (hasAny) result[key.toLowerCase()] = clean;
    }
    return result;
  }

  /*
   * 获取指定账号的默认设置条目。
   * accountId 做大小写不敏感匹配。
   * 返回条目对象或 null。
   */
  function getAccountDefaults(store, accountId) {
    if (!store || typeof store !== 'object') return null;
    const id = String(accountId || '').toLowerCase();
    if (!id) return null;
    const entry = store[id];
    if (!entry || typeof entry !== 'object') return null;
    return {
      persona: entry.persona || null,
      language: entry.language || null,
      replyStyle: entry.replyStyle || null,
      lastUsedAt: Number(entry.lastUsedAt) || 0
    };
  }

  /*
   * 设置/更新指定账号的默认设置。
   * 写入后按 lastUsedAt 排序，超出 MAX_ACCOUNTS 时裁剪最旧的条目。
   * 返回裁剪后的新 store（不修改原对象）。
   */
  function setAccountDefaults(store, accountId, defaults) {
    const id = String(accountId || '').toLowerCase();
    if (!id) return normalizeAccountMemoryStore(store);
    const base = normalizeAccountMemoryStore(store);
    const existing = base[id] || {};
    const now = Date.now();
    const entry = {
      persona: String(defaults?.persona || existing.persona || '').trim() || undefined,
      language: String(defaults?.language || existing.language || '').trim() || undefined,
      replyStyle: String(defaults?.replyStyle || existing.replyStyle || '').trim() || undefined,
      lastUsedAt: Number(defaults?.lastUsedAt) || now
    };
    // 删除 undefined 字段，保持存储干净
    for (const key of Object.keys(entry)) {
      if (entry[key] === undefined) delete entry[key];
    }
    base[id] = entry;

    // 按 lastUsedAt 降序裁剪到 MAX_ACCOUNTS
    const entries = Object.entries(base);
    if (entries.length > MAX_ACCOUNTS) {
      entries.sort((a, b) => {
        const tsA = Number(a[1]?.lastUsedAt) || 0;
        const tsB = Number(b[1]?.lastUsedAt) || 0;
        return tsB - tsA;
      });
      const pruned = {};
      for (const [key, value] of entries.slice(0, MAX_ACCOUNTS)) {
        pruned[key] = value;
      }
      return pruned;
    }
    return base;
  }

  /*
   * 将账号级默认设置合并到全局设置对象上。
   * 只覆盖 persona / replyLanguage / customReplyStyle 字段；
   * 账号条目为 null 时不修改。
   * 返回一个包含覆盖字段的新对象（供 Object.assign 使用）。
   */
  function mergeAccountOverrides(globalSettings, accountDefaults) {
    const overrides = {};
    if (!accountDefaults || typeof accountDefaults !== 'object') return overrides;
    if (accountDefaults.persona) {
      overrides.replyPersona = accountDefaults.persona;
    }
    if (accountDefaults.language) {
      overrides.replyLanguage = accountDefaults.language;
    }
    if (accountDefaults.replyStyle) {
      overrides.customReplyStyle = accountDefaults.replyStyle;
    }
    return overrides;
  }

  return {
    ACCOUNT_MEMORY_KEY,
    MAX_ACCOUNTS,
    detectCurrentXAccount,
    normalizeAccountMemoryStore,
    getAccountDefaults,
    setAccountDefaults,
    mergeAccountOverrides
  };
});
