'use strict';

const assert = require('node:assert');
const {
  normalizeSettings,
  DEFAULT_SETTINGS,
  getPersonaInstruction,
  getLanguageInstruction
} = require('../shared/xg_settings.js');

const tests = [
  {
    name: '默认值',
    fn() {
      const settings = normalizeSettings({});
      assert.strictEqual(settings.extensionEnabled, true);
      assert.strictEqual(settings.replyPersona, 'professional');
      assert.strictEqual(settings.replyLanguage, 'auto');
      assert.strictEqual(settings.maxReplyLength, 200);
      assert.strictEqual(settings.replyCount, 1);
      assert.strictEqual(settings.useEmoji, true);
      assert.strictEqual(settings.askQuestion, false);
      assert.strictEqual(settings.allowDisagreement, true);
    }
  },
  {
    name: '插件暂停状态可持久化且非法值回退默认',
    fn() {
      assert.strictEqual(normalizeSettings({ extensionEnabled: false }).extensionEnabled, false);
      assert.strictEqual(normalizeSettings({ extensionEnabled: 'false' }).extensionEnabled, false);
      assert.strictEqual(normalizeSettings({ extensionEnabled: 'invalid' }).extensionEnabled, true);
    }
  },
  {
    name: '自定义风格与自定义语言',
    fn() {
      const settings = normalizeSettings({ replyPersona: 'custom', customReplyStyle: '像开发者一样简洁', replyLanguage: 'custom', customReplyLanguage: '法语' });
      assert.strictEqual(settings.replyPersona, 'custom');
      assert.strictEqual(settings.customReplyStyle, '像开发者一样简洁');
      assert.strictEqual(settings.customReplyLanguage, '法语');
      assert.strictEqual(getPersonaInstruction('custom', '像开发者一样简洁'), '像开发者一样简洁');
      assert.strictEqual(getLanguageInstruction('custom', '法语'), '法语');
    }
  },
  {
    name: '自定义风格为空回退预设',
    fn() {
      assert.strictEqual(getPersonaInstruction('custom', ''), getPersonaInstruction('professional'));
      assert.strictEqual(getLanguageInstruction('custom', ''), getLanguageInstruction('auto'));
    }
  },
  {
    name: '非法值回退默认',
    fn() {
      const settings = normalizeSettings({ replyPersona: 'unknown', replyLanguage: 'xx', replyCount: 2, maxReplyLength: 99999, useEmoji: 'false', askQuestion: 'true', allowDisagreement: 0 });
      assert.strictEqual(settings.replyPersona, 'professional');
      assert.strictEqual(settings.replyLanguage, 'auto');
      assert.strictEqual(settings.replyCount, 1);
      assert.strictEqual(settings.maxReplyLength, 500);
      assert.strictEqual(settings.useEmoji, false);
      assert.strictEqual(settings.askQuestion, true);
      assert.strictEqual(settings.allowDisagreement, false);
    }
  },
  {
    name: '新增风格与候选数量',
    fn() {
      assert.strictEqual(getPersonaInstruction('counter'), '提出一个有理有据的反方视角，礼貌但直接');
      assert.strictEqual(getPersonaInstruction('pithy'), '简短锐评，一两句话内点出重点');
      assert.strictEqual(normalizeSettings({ replyCount: '3' }).replyCount, 3);
    }
  },
  {
    name: '旧版本 storage 数据兼容',
    fn() {
      const legacy = { replyPersona: 'questioning', replyLanguage: 'zh-CN', selectedProvider: 'chatgpt' };
      const settings = normalizeSettings(legacy);
      assert.strictEqual(settings.replyPersona, 'questioning');
      assert.strictEqual(settings.replyLanguage, 'zh-CN');
      assert.strictEqual(settings.selectedProvider, 'chatgpt');
      assert.strictEqual(settings.maxReplyLength, DEFAULT_SETTINGS.maxReplyLength);
    }
  },
  {
    name: '长度限制与清理',
    fn() {
      const settings = normalizeSettings({ customRequirements: 'x'.repeat(1000), customReplyStyle: 'y'.repeat(1000) });
      assert.strictEqual(settings.customRequirements.length, 600);
      assert.strictEqual(settings.customReplyStyle.length, 600);
    }
  }
];

module.exports = { tests };
