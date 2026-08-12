/*
 * xg_cooldown.js - AI 生成冷却管理器（纯函数 + 内存状态）。
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

  const DEFAULT_COOLDOWN_SECONDS = 30;
  const ALLOWED_COOLDOWN_VALUES = Object.freeze([15, 30, 60, 120]);

  class CooldownManager {
    constructor(options) {
      const opts = options || {};
      this.cooldownMs = (Number(opts.cooldownSeconds) || DEFAULT_COOLDOWN_SECONDS) * 1000;
      this.lastAcquireMap = new Map();
    }

    /*
     * Try to acquire cooldown for a tweet.
     * Returns: { allowed: boolean, remainingMs: number }
     */
    tryAcquire(key) {
      const id = String(key || '');
      if (!id) return { allowed: true, remainingMs: 0 };
      const lastTime = this.lastAcquireMap.get(id) || 0;
      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed >= this.cooldownMs) {
        this.lastAcquireMap.set(id, now);
        return { allowed: true, remainingMs: 0 };
      }
      return { allowed: false, remainingMs: this.cooldownMs - elapsed };
    }

    /*
     * Release cooldown for a key (e.g., when generation is cancelled).
     */
    release(key) {
      const id = String(key || '');
      if (id) this.lastAcquireMap.delete(id);
    }

    /*
     * Get remaining cooldown time for a key.
     */
    getRemainingMs(key) {
      const id = String(key || '');
      if (!id) return 0;
      const lastTime = this.lastAcquireMap.get(id) || 0;
      const now = Date.now();
      const elapsed = now - lastTime;
      return Math.max(0, this.cooldownMs - elapsed);
    }

    /*
     * Update cooldown duration.
     */
    setCooldownSeconds(seconds) {
      const value = ALLOWED_COOLDOWN_VALUES.includes(Number(seconds)) ? Number(seconds) : DEFAULT_COOLDOWN_SECONDS;
      this.cooldownMs = value * 1000;
    }

    /*
     * Clear all cooldowns.
     */
    clear() {
      this.lastAcquireMap.clear();
    }
  }

  return {
    DEFAULT_COOLDOWN_SECONDS,
    ALLOWED_COOLDOWN_VALUES,
    CooldownManager
  };
});
