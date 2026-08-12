/*
 * xg_editor.js - X 回复框回填决策（纯函数，可测试）。
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

  function normalizeForCompare(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeReplyForEditor(reply) {
    return String(reply || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  }

  /*
   * 决策：
   * - 'fill'：空框，直接填入
   * - 'skip'：已有相同内容，不重复插入
   * - 'blocked'：已有用户手写内容，不得覆盖
   */
  function decideFill(input) {
    const editorText = String(input?.editorText || '').trim();
    const replyText = sanitizeReplyForEditor(input?.replyText);
    if (!replyText) return { action: 'blocked', reason: '生成内容为空。' };
    if (!editorText) return { action: 'fill', reason: 'empty' };
    if (editorText === replyText || normalizeForCompare(editorText) === normalizeForCompare(replyText)) {
      return { action: 'skip', reason: 'already_present' };
    }
    return { action: 'blocked', reason: 'user_content' };
  }

  /*
   * 从候选编辑器中挑选一个可见的回复框（调用方已过滤可见性）。
   * 多个回复弹窗时取第一个可见编辑器。
   */
  function pickReplyEditor(candidates) {
    if (!Array.isArray(candidates)) return null;
    return candidates.find((element) => element) || null;
  }

  return {
    normalizeForCompare,
    sanitizeReplyForEditor,
    decideFill,
    pickReplyEditor
  };
});
