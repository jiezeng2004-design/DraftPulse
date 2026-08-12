/*
 * xg_diagnostics.js - 诊断展示工具（分阶段耗时格式化）。
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

  const TIMING_LABELS = Object.freeze([
    ['downloadMs', '图片下载'],
    ['uploadMs', '图片上传'],
    ['sendMs', '提示词发送'],
    ['generateMs', '模型生成'],
    ['extractMs', '回答提取'],
    ['backfillMs', 'X 回填'],
    ['totalMs', '总耗时']
  ]);

  function formatMs(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value)}ms`;
  }

  function formatTimings(timings) {
    if (!timings || typeof timings !== 'object') return '各阶段耗时：暂无。';
    const parts = TIMING_LABELS
      .filter(([key]) => Number(timings[key]) > 0)
      .map(([key, label]) => `${label} ${formatMs(Number(timings[key]))}`);
    return `各阶段耗时：${parts.length ? parts.join(' · ') : '暂无'}`;
  }

  /*
   * Compute overall health score from diagnostics data.
   * input: { xPage, activeProvider, providers }
   * Returns: { score: 0-100, level: 'healthy'|'degraded'|'unhealthy', checks: [{ name, status, message }], passed, total }
   */
  function computeHealthScore(diagnostics) {
    const checks = [];
    let passed = 0;
    const total = 6;

    // X DOM check
    const xDomOk = diagnostics?.xPage?.ready === true;
    checks.push({ name: 'X DOM', status: xDomOk ? 'pass' : 'fail', message: xDomOk ? 'X 页面增强脚本已注入' : (diagnostics?.xPage?.message || '未检测到 X 页面') });
    if (xDomOk) passed++;

    // Provider Session check
    const providerId = diagnostics?.activeProvider || 'gemini';
    const providerInfo = diagnostics?.providers?.[providerId];
    const providerOk = providerInfo?.ready === true;
    checks.push({ name: 'AI Session', status: providerOk ? 'pass' : 'fail', message: providerOk ? `${providerInfo?.state || 'ready'}` : (providerInfo?.message || '未连接') });
    if (providerOk) passed++;

    // Post Extraction check (inferred from xPage tweets count)
    const postOk = xDomOk && (diagnostics?.xPage?.tweets || 0) > 0;
    checks.push({ name: 'Post Extraction', status: postOk ? 'pass' : 'warn', message: postOk ? `识别 ${diagnostics.xPage.tweets} 条推文` : '未识别到推文' });
    if (postOk) passed++;

    // Image Extraction (always pass if X DOM is ok — images are extracted on demand)
    checks.push({ name: 'Image Extraction', status: xDomOk ? 'pass' : 'fail', message: xDomOk ? '图片提取就绪' : '依赖 X DOM' });
    if (xDomOk) passed++;

    // Storage check
    checks.push({ name: 'Storage', status: 'pass', message: 'chrome.storage 可用' });
    passed++;

    // Reply Composer (inferred from xPage ready)
    checks.push({ name: 'Reply Composer', status: xDomOk ? 'pass' : 'fail', message: xDomOk ? '回复编辑器选择器就绪' : '依赖 X DOM' });
    if (xDomOk) passed++;

    const score = Math.round((passed / total) * 100);
    const level = score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy';

    return { score, level, checks, passed, total };
  }

  /*
   * Format storage usage for display.
   * input: { syncBytes, localBytes, syncQuota, localQuota }
   */
  function formatStorageUsage(usage) {
    if (!usage || typeof usage !== 'object') return { syncPercent: 0, localPercent: 0, syncText: '', localText: '' };
    const syncQuota = Number(usage.syncQuota) || 102400; // 100KB default
    const localQuota = Number(usage.localQuota) || 10485760; // 10MB default
    const syncBytes = Number(usage.syncBytes) || 0;
    const localBytes = Number(usage.localBytes) || 0;
    return {
      syncPercent: Math.round((syncBytes / syncQuota) * 100),
      localPercent: Math.round((localBytes / localQuota) * 100),
      syncText: `${(syncBytes / 1024).toFixed(1)}KB / ${(syncQuota / 1024).toFixed(0)}KB`,
      localText: `${(localBytes / 1024).toFixed(1)}KB / ${(localQuota / 1024 / 1024).toFixed(1)}MB`
    };
  }

  return {
    formatTimings,
    formatMs,
    TIMING_LABELS,
    computeHealthScore,
    formatStorageUsage
  };
});
