/*
 * xg_parse.js - 纯解析与格式化工具（可在 Node 测试中直接加载）。
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

  const SUFFIX_MULTIPLIERS = Object.freeze({ K: 1e3, M: 1e6, B: 1e9, '万': 1e4, '萬': 1e4, '亿': 1e8, '億': 1e8 });
  const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const standardFormatter = new Intl.NumberFormat(undefined, { notation: 'standard', maximumFractionDigits: 1 });

  function parseMetric(value) {
    const text = String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/，/g, ',')
      .trim();
    if (!text) return 0;

    const matches = [...text.matchAll(/([0-9]+(?:[.,][0-9]+)*)\s*([KMB]|万|萬|亿|億)?/gi)];
    if (!matches.length) return 0;
    const match = matches[0];
    let numberText = match[1];
    const suffix = (match[2] || '').toUpperCase();

    if (numberText.includes(',') && numberText.includes('.')) numberText = numberText.replace(/,/g, '');
    else if ((numberText.match(/,/g) || []).length > 1) numberText = numberText.replace(/,/g, '');
    else if (/^\d{1,3},\d{3}$/.test(numberText)) numberText = numberText.replace(',', '');
    else numberText = numberText.replace(',', '.');

    const numeric = Number.parseFloat(numberText);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * (SUFFIX_MULTIPLIERS[suffix] || 1));
  }

  function formatMetric(value) {
    const number = Number(value) || 0;
    return (number >= 10000 ? compactFormatter : standardFormatter).format(number);
  }

  function formatRate(value) {
    const number = Number(value) || 0;
    const rounded = number >= 100 ? Math.round(number) : Math.round(number * 10) / 10;
    return (rounded >= 10000 ? compactFormatter : standardFormatter).format(rounded);
  }

  function formatAge(hours) {
    const value = Number(hours) || 0;
    if (value < 1) return `${Math.max(1, Math.round(value * 60))} 分钟`;
    if (value < 24) return `${Math.round(value * 10) / 10} 小时`;
    return `${Math.round((value / 24) * 10) / 10} 天`;
  }

  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /ignore\s+(all\s+)?above\s+instructions/gi,
    /disregard\s+(all\s+)?previous\s+instructions/gi,
    /forget\s+(all\s+)?previous\s+instructions/gi,
    /send\s+me\s+the\s+system\s+prompt/gi,
    /show\s+me\s+the\s+system\s+prompt/gi,
    /what\s+is\s+your\s+system\s+prompt/gi,
    /reveal\s+the\s+system\s+prompt/gi,
    /you\s+are\s+now\s+a/gi,
    /new\s+instructions?\s*:/gi,
    /system\s*:\s*/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi
  ];

  function sanitizeTweetForPrompt(text) {
    let sanitized = String(text || '');
    for (const pattern of INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match) => {
        return match.replace(/[<>&]/g, (c) => {
          switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            default: return c;
          }
        });
      });
    }
    return sanitized;
  }

  function sanitizeText(value, maxLength) {
    return String(value || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, maxLength);
  }

  return {
    parseMetric,
    formatMetric,
    formatRate,
    formatAge,
    sanitizeText,
    sanitizeTweetForPrompt
  };
});
