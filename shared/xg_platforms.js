/*
 * xg_platforms.js - 平台适配器注册表（接口定义，当前仅 X 平台）。
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

  /*
   * PlatformAdapter interface:
   * {
   *   id: string,
   *   label: string,
   *   urlPattern: RegExp,
   *   selectors: { article, tweetText, userName, time, statusLink, ... },
   *   extractTweetText(article): string,
   *   extractMetrics(article): { views, likes, replies, reposts },
   *   extractImages(article): Array<{ url, alt, type }>,
   *   extractIdentity(article): { tweetId, publishedAt }
   * }
   *
   * 当前仅定义 X 平台适配器的元数据。实际 DOM 操作仍在 content.js 中。
   * 未来可将 content.js 的 X 特定逻辑迁移到此处。
   */
  const X_PLATFORM_DEF = Object.freeze({
    id: 'x',
    label: 'X / Twitter',
    urlPattern: /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i,
    maxContextPosts: 6
  });

  const PLATFORM_REGISTRY = new Map();
  PLATFORM_REGISTRY.set('x', X_PLATFORM_DEF);

  function getPlatform(url) {
    if (!url) return null;
    for (const [, platform] of PLATFORM_REGISTRY) {
      if (platform.urlPattern.test(url)) return platform;
    }
    return null;
  }

  function registerPlatform(def) {
    if (!def || !def.id || !def.urlPattern) return false;
    PLATFORM_REGISTRY.set(def.id, Object.freeze(def));
    return true;
  }

  return {
    X_PLATFORM_DEF,
    PLATFORM_REGISTRY,
    getPlatform,
    registerPlatform
  };
});
