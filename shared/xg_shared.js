/*
 * xg_shared.js - 全局命名空间初始化与消息来源可信校验。
 *
 * UMD 模板说明：所有 shared/xg_*.js 模块使用相同的 UMD 包装器，
 * 浏览器环境合并到 globalThis.DraftPulseShared，Node.js 测试环境走 module.exports。
 * 加载顺序由 manifest.json content_scripts.js 数组决定，不可调换。
 */
(function (global, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    if (!global.DraftPulseShared) global.DraftPulseShared = {};
    Object.assign(global.DraftPulseShared, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isTrustedRuntimeSender(sender, extensionId, allowedPagePattern) {
    const expectedId = String(extensionId || '');
    if (!expectedId || !sender || sender.id !== expectedId) return false;

    const senderUrl = String(sender.url || sender.tab?.url || '');
    // Chrome 版本与消息路径不同，SW -> content 的 sender URL 可能为空，
    // 也可能明确指向 chrome-extension://<本扩展 ID>/background.js。
    if (!senderUrl) return true;
    if (senderUrl.startsWith(`chrome-extension://${expectedId}/`)) return true;

    return allowedPagePattern instanceof RegExp && allowedPagePattern.test(senderUrl);
  }

  return { isTrustedRuntimeSender };
});
