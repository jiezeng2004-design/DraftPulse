'use strict';

const assert = require('node:assert');
const { shouldCollectImage, pickBestSrcset } = require('../shared/xg_xdom.js');

const MEDIA_SRC = 'https://pbs.twimg.com/media/ABC123?format=jpg&name=large';

const tests = [
  {
    name: '普通配图可收集',
    fn() {
      assert.strictEqual(shouldCollectImage({ src: MEDIA_SRC }), true);
      assert.strictEqual(shouldCollectImage({ src: MEDIA_SRC, inVideo: false, inCard: false, inQuote: false, inAvatar: false }), true);
    }
  },
  {
    name: '视频/卡片/引用/头像上下文排除',
    fn() {
      assert.strictEqual(shouldCollectImage({ src: MEDIA_SRC, inVideo: true }), false);
      assert.strictEqual(shouldCollectImage({ src: MEDIA_SRC, inCard: true }), false);
      assert.strictEqual(shouldCollectImage({ src: MEDIA_SRC, inQuote: true }), false);
      assert.strictEqual(shouldCollectImage({ src: MEDIA_SRC, inAvatar: true }), false);
    }
  },
  {
    name: '头像/表情/图标 URL 排除',
    fn() {
      assert.strictEqual(shouldCollectImage({ src: 'https://pbs.twimg.com/profile_images/123/x.jpg' }), false);
      assert.strictEqual(shouldCollectImage({ src: 'https://abs.twimg.com/emoji/v2/72x72/1f600.png' }), false);
      assert.strictEqual(shouldCollectImage({ src: 'https://pbs.twimg.com/media/icon_123.png' }), false);
      assert.strictEqual(shouldCollectImage({ src: 'https://pbs.twimg.com/media/logo.png' }), false);
    }
  },
  {
    name: '空输入不可收集',
    fn() {
      assert.strictEqual(shouldCollectImage(null), false);
      assert.strictEqual(shouldCollectImage({}), false);
    }
  },
  {
    name: 'srcset 取最高宽度',
    fn() {
      const srcset = 'https://pbs.twimg.com/media/A?format=jpg&name=small 320w, https://pbs.twimg.com/media/A?format=jpg&name=large 1024w, https://pbs.twimg.com/media/A?format=jpg&name=orig 2048w';
      assert.strictEqual(pickBestSrcset(srcset), 'https://pbs.twimg.com/media/A?format=jpg&name=orig');
    }
  },
  {
    name: 'srcset x 描述符按倍数排序',
    fn() {
      const srcset = 'https://pbs.twimg.com/media/A 1x, https://pbs.twimg.com/media/B 2x';
      assert.strictEqual(pickBestSrcset(srcset), 'https://pbs.twimg.com/media/B');
    }
  },
  {
    name: 'srcset 空值与非法项',
    fn() {
      assert.strictEqual(pickBestSrcset(''), '');
      assert.strictEqual(pickBestSrcset(null), '');
      assert.strictEqual(pickBestSrcset('not a srcset'), '');
      assert.strictEqual(pickBestSrcset('https://pbs.twimg.com/media/A 1024w, junk'), 'https://pbs.twimg.com/media/A');
    }
  }
];

module.exports = { tests };
