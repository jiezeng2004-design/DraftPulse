/*
 * xg_response.js - 回答文本去重、新回答定位、稳定性判断与单飞请求守卫。
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
   * 清理重复回答：
   * - 完整段落重复（前一半与后一半逐行相同）
   * - 两次相同文本拼接（压缩空白后的前半与后半相同）
   * - DOM 嵌套导致的重复 innerText（全文中出现两次的完整段落只保留一次）
   */
  function dedupeResponseText(value) {
    let text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';

    const lines = text.split('\n').map((line) => line.trimEnd());
    if (lines.length >= 2 && lines.length % 2 === 0) {
      const midpoint = lines.length / 2;
      const first = lines.slice(0, midpoint).join('\n').trim();
      const second = lines.slice(midpoint).join('\n').trim();
      if (first && first === second) text = first;
    }

    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length >= 20) {
      const half = Math.floor(compact.length / 2);
      const left = compact.slice(0, half).trim();
      const right = compact.slice(compact.length - half).trim();
      if (left && left === right) text = left;
    }

    const collapsedLines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const seen = new Set();
    const uniqueLines = [];
    for (const line of collapsedLines) {
      if (seen.has(line)) continue;
      seen.add(line);
      uniqueLines.push(line);
    }
    const joined = uniqueLines.join('\n');
    if (joined !== text) text = joined;
    return text.trim();
  }

  /*
   * 在候选节点中定位“本次请求新增”的回答。
   * candidates: [{ index, text, isUser }]，按文档顺序排列。
   * baseline: { lastIndex, lastText }。
   * 策略：
   * 1. 优先取 index 大于基线的首个非用户非空候选；
   * 2. 若节点数未增加（Gemini 流式回答复用最后一个节点），
   *    最后一个非用户节点的文本与基线最后文本不同也视为新回答。
   */
  function findNewResponse(candidates, baseline) {
    if (!Array.isArray(candidates) || !baseline) return null;
    const lastIndex = Number(baseline.lastIndex) || 0;
    const lastText = String(baseline.lastText || '');
    for (const candidate of candidates) {
      if (Number(candidate.index) <= lastIndex) continue;
      if (candidate.isUser) continue;
      const text = String(candidate.text || '').trim();
      if (!text) continue;
      if (text === lastText && Number(candidate.index) === lastIndex) continue;
      return candidate;
    }
    // 节点复用兜底：无新增序号但最后节点文本已变化。
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = candidates[i];
      if (candidate.isUser) continue;
      const text = String(candidate.text || '').trim();
      if (!text) continue;
      if (text !== lastText) return candidate;
      break;
    }
    return null;
  }

  /*
   * 判断回答是否已稳定可返回。
   * input: { lastChangedAt, now, isGenerating }
   * options: { idleMs=400, whileGeneratingIdleMs=1500 }
   */
  function isResponseStable(input, options) {
    const opts = options || {};
    const idleMs = Number(opts.idleMs) || 400;
    const whileGeneratingIdleMs = Number(opts.whileGeneratingIdleMs) || 1500;
    const now = Number(input?.now) || Date.now();
    const lastChangedAt = Number(input?.lastChangedAt) || now;
    const idle = now - lastChangedAt;
    return input?.isGenerating ? idle >= whileGeneratingIdleMs : idle >= idleMs;
  }

  /*
   * 单飞守卫：同一页面同一时刻只允许一个进行中的请求。
   */
  function createRequestGuard() {
    let activeRequestId = null;
    let cancelledReason = null;

    function tryAcquire(requestId) {
      if (activeRequestId !== null) return false;
      activeRequestId = String(requestId || '');
      cancelledReason = null;
      return true;
    }

    function release(requestId) {
      if (activeRequestId === String(requestId || '')) activeRequestId = null;
    }

    function isActive(requestId) {
      return activeRequestId !== null && activeRequestId === String(requestId || '');
    }

    function cancel(requestId, reason) {
      if (!isActive(requestId)) return false;
      cancelledReason = String(reason || '请求已取消。');
      return true;
    }

    function takeCancellation(requestId) {
      if (!isActive(requestId) || cancelledReason === null) return null;
      const reason = cancelledReason;
      cancelledReason = null;
      return reason;
    }

    return { tryAcquire, release, isActive, cancel, takeCancellation, get activeRequestId() { return activeRequestId; } };
  }

  return {
    dedupeResponseText,
    findNewResponse,
    isResponseStable,
    createRequestGuard
  };
});
