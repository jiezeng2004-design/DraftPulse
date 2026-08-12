'use strict';

const assert = require('node:assert');
const {
  collectTweetImages,
  normalizeXImageUrl,
  imageIdentityKey,
  validateDownloadResult,
  MAX_IMAGES
} = require('../shared/xg_images.js');

const BASE = 'https://pbs.twimg.com/media/ABC123?format=jpg&name=large';

function descriptor(url, type) {
  return { url, alt: '', type: type || 'image' };
}

const tests = [
  {
    name: '单张图片',
    fn() {
      const images = collectTweetImages([descriptor(BASE)]);
      assert.strictEqual(images.length, 1);
      assert.strictEqual(images[0].url.includes('name=large'), true);
    }
  },
  {
    name: '最多 4 张',
    fn() {
      const urls = Array.from({ length: 6 }, (_, i) => `https://pbs.twimg.com/media/IMG${i}?format=jpg&name=large`);
      const images = collectTweetImages(urls.map((url) => descriptor(url)));
      assert.strictEqual(images.length, MAX_IMAGES);
    }
  },
  {
    name: '重复 URL 去重',
    fn() {
      const images = collectTweetImages([descriptor(BASE), descriptor(BASE)]);
      assert.strictEqual(images.length, 1);
    }
  },
  {
    name: '不同清晰度 URL 按媒体 ID 去重',
    fn() {
      const images = collectTweetImages([
        descriptor('https://pbs.twimg.com/media/ABC123?format=jpg&name=small'),
        descriptor('https://pbs.twimg.com/media/ABC123?format=jpg&name=900x900'),
        descriptor('https://pbs.twimg.com/media/ABC123?format=png&name=large')
      ]);
      assert.strictEqual(images.length, 1);
    }
  },
  {
    name: '头像排除',
    fn() {
      const images = collectTweetImages([
        descriptor('https://pbs.twimg.com/profile_images/123/avatar.jpg', 'avatar'),
        descriptor(BASE)
      ]);
      assert.strictEqual(images.length, 1);
      assert.strictEqual(images[0].url.includes('/media/'), true);
    }
  },
  {
    name: '引用推文图片排除',
    fn() {
      const images = collectTweetImages([
        descriptor(BASE, 'quoted'),
        descriptor('https://pbs.twimg.com/media/IMG9?format=jpg&name=large')
      ]);
      assert.strictEqual(images.length, 1);
    }
  },
  {
    name: 'GIF/视频缩略图/卡片图排除',
    fn() {
      const images = collectTweetImages([
        descriptor(BASE, 'videoThumb'),
        descriptor(BASE, 'gif'),
        descriptor(BASE, 'card'),
        descriptor(BASE, 'emoji'),
        descriptor('https://pbs.twimg.com/media/IMG8?format=jpg&name=large')
      ]);
      assert.strictEqual(images.length, 1);
    }
  },
  {
    name: '非法域名与非法路径',
    fn() {
      assert.strictEqual(normalizeXImageUrl('https://evil.example.com/media/ABC'), '');
      assert.strictEqual(normalizeXImageUrl('http://pbs.twimg.com/media/ABC'), '');
      assert.strictEqual(normalizeXImageUrl('https://pbs.twimg.com/profile_images/ABC'), '');
      assert.strictEqual(normalizeXImageUrl('not a url'), '');
    }
  },
  {
    name: '下载校验：非法重定向域名',
    fn() {
      const result = validateDownloadResult({
        finalProtocol: 'https:',
        finalHostname: 'evil.example.com',
        finalPathname: '/media/ABC',
        declaredLength: 100,
        blobSize: 100,
        mimeType: 'image/jpeg',
        totalBytesSoFar: 0
      });
      assert.strictEqual(result.ok, false);
    }
  },
  {
    name: '下载校验：重定向后路径偏离 /media/',
    fn() {
      const result = validateDownloadResult({
        finalProtocol: 'https:',
        finalHostname: 'pbs.twimg.com',
        finalPathname: '/other/ABC',
        declaredLength: 100,
        blobSize: 100,
        mimeType: 'image/jpeg',
        totalBytesSoFar: 0
      });
      assert.strictEqual(result.ok, false);
    }
  },
  {
    name: '下载校验：超大图片',
    fn() {
      const result = validateDownloadResult({
        finalProtocol: 'https:',
        finalHostname: 'pbs.twimg.com',
        finalPathname: '/media/ABC',
        declaredLength: 0,
        blobSize: 9 * 1024 * 1024,
        mimeType: 'image/jpeg',
        totalBytesSoFar: 0
      });
      assert.strictEqual(result.ok, false);
    }
  },
  {
    name: '下载校验：MIME 不匹配',
    fn() {
      const result = validateDownloadResult({
        finalProtocol: 'https:',
        finalHostname: 'pbs.twimg.com',
        finalPathname: '/media/ABC',
        declaredLength: 100,
        blobSize: 100,
        mimeType: 'text/html',
        totalBytesSoFar: 0
      });
      assert.strictEqual(result.ok, false);
    }
  },
  {
    name: '下载校验：总体积超限',
    fn() {
      const result = validateDownloadResult({
        finalProtocol: 'https:',
        finalHostname: 'pbs.twimg.com',
        finalPathname: '/media/ABC',
        declaredLength: 0,
        blobSize: 8 * 1024 * 1024,
        mimeType: 'image/png',
        totalBytesSoFar: 18 * 1024 * 1024
      });
      assert.strictEqual(result.ok, false);
    }
  },
  {
    name: '下载校验：合法结果',
    fn() {
      const result = validateDownloadResult({
        finalProtocol: 'https:',
        finalHostname: 'pbs.twimg.com',
        finalPathname: '/media/ABC',
        declaredLength: 1024,
        blobSize: 1024,
        mimeType: 'image/jpeg',
        totalBytesSoFar: 0
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.mimeType, 'image/jpeg');
    }
  },
  {
    name: '媒体 ID 标识',
    fn() {
      assert.strictEqual(
        imageIdentityKey('https://pbs.twimg.com/media/ABC123?format=jpg&name=large'),
        imageIdentityKey('https://pbs.twimg.com/media/ABC123?format=png&name=small')
      );
      assert.notStrictEqual(
        imageIdentityKey('https://pbs.twimg.com/media/ABC123?format=jpg&name=large'),
        imageIdentityKey('https://pbs.twimg.com/media/XYZ?format=jpg&name=large')
      );
    }
  }
];

module.exports = { tests };
