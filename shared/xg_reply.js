/*
 * xg_reply.js - 模型回复的最终规范化（前缀清理、去重、候选拆分、长度限制）。
 * 去重与候选拆分复用 xg_response.js / xg_prompt.js 的函数。
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

  const DP = (typeof globalThis !== 'undefined' && globalThis.DraftPulseShared) || {};

  function stripReplyPrefix(value) {
    return String(value || '')
      .replace(/^\s*(?:回复|reply)\s*[:：]\s*/i, '')
      .replace(/^(["“'‘])(.*)(["”'’])$/s, '$2')
      .trim();
  }

  function truncate(value, limit) {
    const codePoints = Array.from(value);
    if (codePoints.length <= limit) return value;
    return `${codePoints.slice(0, limit - 1).join('').trimEnd()}…`;
  }

  /*
   * 规范化模型回复为候选数组（至少一个元素）。
   * 抛出错误表示内容为空。
   */
  function normalizeReplyCandidates(value, providerLabel, options) {
    const opts = options || {};
    const replyCount = Number(opts.replyCount) === 3 ? 3 : 1;
    const limit = Number(opts.maxReplyLength) || 200;
    let text = stripReplyPrefix(value);
    if (!text) throw new Error(`${providerLabel} 返回了空内容。`);
    text = DP.dedupeResponseText ? DP.dedupeResponseText(text) : text.trim();

    const split = DP.splitReplyCandidates || ((replyText) => [replyText]);
    const candidates = split(text, replyCount)
      .map((candidate) => truncate(candidate, limit))
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (!candidates.length) throw new Error(`${providerLabel} 返回了空内容。`);
    return candidates;
  }

  return {
    stripReplyPrefix,
    normalizeReplyCandidates
  };
});
