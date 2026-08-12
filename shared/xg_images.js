/*
 * xg_images.js - 图片 URL 规范化、推文图片收集与下载约束校验。
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

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;
  const ALLOWED_IMAGE_HOST = 'pbs.twimg.com';
  const ALLOWED_IMAGE_PATH_PREFIX = '/media/';
  const ALLOWED_IMAGE_PROTOCOL = 'https:';
  const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  function isAllowedImageUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === ALLOWED_IMAGE_PROTOCOL &&
        url.hostname === ALLOWED_IMAGE_HOST &&
        url.pathname.startsWith(ALLOWED_IMAGE_PATH_PREFIX);
    } catch (_) {
      return false;
    }
  }

  function normalizeXImageUrl(value) {
    if (!isAllowedImageUrl(value)) return '';
    const url = new URL(String(value));
    url.searchParams.set('name', 'large');
    return url.toString();
  }

  function imageIdentityKey(value) {
    try { return new URL(value).pathname; } catch (_) { return String(value || ''); }
  }

  function normalizeImageAlt(value) {
    const alt = String(value || '').replace(/\s+/g, ' ').trim();
    if (!alt || /^(image|photo|图片|照片)$/i.test(alt)) return '';
    return alt.slice(0, 500);
  }

  function normalizeImageMimeType(value) {
    const mimeType = String(value || '').split(';', 1)[0].trim().toLowerCase();
    return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  }

  function buildImageFileName(value, mimeType, index) {
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    let stem = `x-image-${index + 1}`;
    try {
      const pathStem = new URL(value).pathname.split('/').filter(Boolean).pop();
      if (pathStem) stem = pathStem.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || stem;
    } catch (_) {}
    return `${stem}.${extensions[mimeType] || 'img'}`;
  }

  /*
   * 从预分类的描述符中收集推文配图。
   * descriptor: { url, alt, type }
   * type 取值：image（普通配图）、gif、videoThumb、card、avatar、quoted、emoji、icon。
   * 仅 type === 'image' 且 URL 合法才收集；按媒体 ID（pathname）去重；最多 max 张。
   */
  function collectTweetImages(descriptors, max) {
    const limit = Number.isInteger(max) && max > 0 ? max : MAX_IMAGES;
    if (!Array.isArray(descriptors)) return [];
    const images = [];
    const seen = new Set();
    for (const descriptor of descriptors) {
      if (images.length >= limit) break;
      if (!descriptor || typeof descriptor !== 'object') continue;
      if (descriptor.type && descriptor.type !== 'image') continue;
      const normalized = normalizeXImageUrl(descriptor.url);
      if (!normalized) continue;
      const key = imageIdentityKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      images.push({ url: normalized, alt: normalizeImageAlt(descriptor.alt) });
    }
    return images;
  }

  /*
   * 纯函数：校验一次图片下载结果是否满足安全与体积约束。
   * input: { finalProtocol, finalHostname, finalPathname, declaredLength,
   *          blobSize, mimeType, totalBytesSoFar }
   */
  function validateDownloadResult(input) {
    if (!input) return { ok: false, error: '下载结果缺失。' };
    if (input.finalProtocol !== ALLOWED_IMAGE_PROTOCOL ||
        input.finalHostname !== ALLOWED_IMAGE_HOST ||
        !String(input.finalPathname || '').startsWith(ALLOWED_IMAGE_PATH_PREFIX)) {
      return { ok: false, error: '图片发生了不允许的跨站重定向。' };
    }
    if (Number(input.declaredLength) > MAX_IMAGE_BYTES) return { ok: false, error: '图片体积超过限制。' };
    const mimeType = normalizeImageMimeType(input.mimeType);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) return { ok: false, error: '图片格式不受支持。' };
    const size = Number(input.blobSize);
    if (!(size > 0) || size > MAX_IMAGE_BYTES) return { ok: false, error: '图片体积无效或超过限制。' };
    if (Number(input.totalBytesSoFar) + size > MAX_TOTAL_IMAGE_BYTES) {
      return { ok: false, error: '图片总体积超过限制。' };
    }
    return { ok: true, mimeType };
  }

  function toDataUrl(bytes, mimeType) {
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
    }
    return `data:${mimeType};base64,${btoa(chunks.join(''))}`;
  }

  function dataUrlToFile(image, index) {
    const match = String(image?.dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error('图片数据无法解析。');
    const mimeType = String(image?.mimeType || match[1]).toLowerCase();
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const fileName = String(image?.fileName || `x-image-${index + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    return new File([bytes], fileName, { type: mimeType, lastModified: Date.now() });
  }

  return {
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    MAX_TOTAL_IMAGE_BYTES,
    MAX_DATA_URL_LENGTH,
    ALLOWED_IMAGE_HOST,
    ALLOWED_IMAGE_PATH_PREFIX,
    ALLOWED_IMAGE_PROTOCOL,
    ALLOWED_IMAGE_MIME_TYPES,
    isAllowedImageUrl,
    normalizeXImageUrl,
    imageIdentityKey,
    normalizeImageAlt,
    normalizeImageMimeType,
    buildImageFileName,
    collectTweetImages,
    validateDownloadResult,
    toDataUrl,
    dataUrlToFile
  };
});
