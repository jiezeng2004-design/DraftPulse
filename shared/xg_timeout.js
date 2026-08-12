/*
 * xg_timeout.js - 超时与延时工具（background 与 content 共用）。
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

  function withTimeout(promise, timeoutMs, timeoutMessage) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    withTimeout,
    sleep
  };
});
