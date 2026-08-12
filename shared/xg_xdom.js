/*
 * xg_xdom.js - X 页面 DOM 判定纯函数：图片上下文分类与 srcset 择优。
 * 便于在 Node 中直接测试，不依赖真实 DOM。
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
   * 判定一个图片元素是否应被当作主推文配图。
   * input: { inVideo, inCard, inQuote, inAvatar, src }
   * 返回 true 表示可收集；false 表示头像/引用/视频/卡片/表情图标等。
   */
  function shouldCollectImage(input) {
    if (!input || typeof input !== 'object') return false;
    if (input.inVideo) return false;
    if (input.inCard) return false;
    if (input.inQuote) return false;
    if (input.inAvatar) return false;
    const src = String(input.src || '');
    if (!src) return false;
    if (/\/profile_images\//i.test(src)) return false;
    if (/\/emoji\//i.test(src)) return false;
    if (/(?:^|\/)(?:emoji|icon|logo|badge)(?:[/._-]|$)/i.test(src)) return false;
    return true;
  }

  /*
   * 从 srcset 文本中挑出最高分辨率的 URL。
   * 支持 w 描述符（按宽度排序）与 x 描述符（按倍数排序）。
   * 返回 URL 或空字符串。
   */
  function pickBestSrcset(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const candidates = text.split(',').map((part) => {
      const match = part.trim().match(/^(\S+)\s+(\d+(?:\.\d+)?)(w|x)$/);
      if (!match) return null;
      return { url: match[1], score: Number(match[2]) * (match[3] === 'x' ? 10000 : 1) };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return candidates[0]?.url || '';
  }

  return {
    shouldCollectImage,
    pickBestSrcset
  };
});
