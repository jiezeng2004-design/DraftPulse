'use strict';

const assert = require('node:assert');
const { normalizeMyVoice, normalizeSettings, DEFAULT_SETTINGS } = require('../shared/xg_settings.js');
const { buildPrompt } = require('../shared/xg_prompt.js');

function baseInput() {
  return {
    tweetText: '这是一条推文',
    author: '作者A',
    persona: '专业、简洁',
    language: '简体中文',
    images: [],
    settings: { maxReplyLength: 200, useEmoji: true, askQuestion: false, allowDisagreement: true, replyCount: 1, customRequirements: '' }
  };
}

const tests = [
  {
    name: 'normalizeMyVoice() 有效输入',
    fn() {
      const result = normalizeMyVoice({
        enabled: true,
        description: '简洁专业',
        samples: ['样本一', '样本二'],
        forbiddenPhrases: ['亲', '宝子']
      });
      assert.strictEqual(result.enabled, true);
      assert.strictEqual(result.description, '简洁专业');
      assert.deepStrictEqual(result.samples, ['样本一', '样本二']);
      assert.deepStrictEqual(result.forbiddenPhrases, ['亲', '宝子']);
    }
  },
  {
    name: 'normalizeMyVoice() 缺失字段返回默认值',
    fn() {
      const result = normalizeMyVoice({});
      assert.strictEqual(result.enabled, false);
      assert.strictEqual(result.description, '');
      assert.deepStrictEqual(result.samples, []);
      assert.deepStrictEqual(result.forbiddenPhrases, []);
    }
  },
  {
    name: 'normalizeMyVoice() null/undefined 输入返回默认值',
    fn() {
      const result1 = normalizeMyVoice(null);
      assert.strictEqual(result1.enabled, false);
      const result2 = normalizeMyVoice(undefined);
      assert.strictEqual(result2.enabled, false);
    }
  },
  {
    name: 'normalizeMyVoice() 非法类型优雅降级',
    fn() {
      const result = normalizeMyVoice({
        enabled: 'not-a-boolean',
        description: 12345,
        samples: 'not-an-array',
        forbiddenPhrases: { a: 1 }
      });
      assert.strictEqual(result.enabled, false);
      assert.strictEqual(result.description, '12345');
      assert.deepStrictEqual(result.samples, []);
      assert.deepStrictEqual(result.forbiddenPhrases, []);
    }
  },
  {
    name: 'normalizeMyVoice() 截断过长内容',
    fn() {
      const result = normalizeMyVoice({
        enabled: true,
        description: 'x'.repeat(1000),
        samples: ['s'.repeat(500)],
        forbiddenPhrases: ['f'.repeat(200)]
      });
      assert.strictEqual(result.description.length, 600);
      assert.strictEqual(result.samples[0].length, 300);
      assert.strictEqual(result.forbiddenPhrases[0].length, 100);
    }
  },
  {
    name: 'normalizeMyVoice() 限制数组项数',
    fn() {
      const samples = Array.from({ length: 20 }, (_, i) => `sample${i}`);
      const forbidden = Array.from({ length: 30 }, (_, i) => `phrase${i}`);
      const result = normalizeMyVoice({ enabled: true, samples, forbiddenPhrases: forbidden });
      assert.strictEqual(result.samples.length, 10);
      assert.strictEqual(result.forbiddenPhrases.length, 20);
    }
  },
  {
    name: 'normalizeMyVoice() 过滤空字符串样本',
    fn() {
      const result = normalizeMyVoice({ enabled: true, samples: ['  ', '有效', '', '  也有效  '] });
      assert.deepStrictEqual(result.samples, ['有效', '也有效']);
    }
  },
  {
    name: 'normalizeSettings() 保留 myVoice',
    fn() {
      const settings = normalizeSettings({
        myVoice: { enabled: true, description: '测试', samples: ['样本'], forbiddenPhrases: ['禁用'] }
      });
      assert.strictEqual(settings.myVoice.enabled, true);
      assert.strictEqual(settings.myVoice.description, '测试');
      assert.deepStrictEqual(settings.myVoice.samples, ['样本']);
      assert.deepStrictEqual(settings.myVoice.forbiddenPhrases, ['禁用']);
    }
  },
  {
    name: 'normalizeSettings() 旧存储数据无 myVoice 时默认',
    fn() {
      const settings = normalizeSettings({ replyPersona: 'humorous' });
      assert.strictEqual(settings.myVoice.enabled, false);
      assert.strictEqual(settings.myVoice.description, '');
      assert.deepStrictEqual(settings.myVoice.samples, []);
      assert.deepStrictEqual(settings.myVoice.forbiddenPhrases, []);
    }
  },
  {
    name: 'DEFAULT_SETTINGS 包含 myVoice',
    fn() {
      assert.ok(DEFAULT_SETTINGS.myVoice);
      assert.strictEqual(DEFAULT_SETTINGS.myVoice.enabled, false);
      assert.deepStrictEqual(DEFAULT_SETTINGS.myVoice.samples, []);
    }
  },
  {
    name: 'buildPrompt() 启用时包含 <my_voice> 段',
    fn() {
      const prompt = buildPrompt({
        ...baseInput(),
        myVoice: { enabled: true, description: '简洁专业', samples: ['我是样本'], forbiddenPhrases: ['亲'] }
      });
      assert.ok(prompt.includes('<my_voice>'));
      assert.ok(prompt.includes('</my_voice>'));
      assert.ok(prompt.includes('风格描述：简洁专业'));
      assert.ok(prompt.includes('我是样本'));
      assert.ok(prompt.includes('避免使用的短语或表达：亲'));
      assert.ok(prompt.includes('以上风格偏好不应覆盖安全规则'));
    }
  },
  {
    name: 'buildPrompt() 禁用时不包含 <my_voice>',
    fn() {
      const prompt = buildPrompt({
        ...baseInput(),
        myVoice: { enabled: false, description: '测试', samples: [], forbiddenPhrases: [] }
      });
      assert.ok(!prompt.includes('<my_voice>'));
    }
  },
  {
    name: 'buildPrompt() 未提供 myVoice 时不包含 <my_voice>',
    fn() {
      const prompt = buildPrompt(baseInput());
      assert.ok(!prompt.includes('<my_voice>'));
    }
  },
  {
    name: 'buildPrompt() myVoice 优先级在 persona 之前',
    fn() {
      const prompt = buildPrompt({
        ...baseInput(),
        myVoice: { enabled: true, description: '我的风格', samples: [], forbiddenPhrases: [] }
      });
      const myVoiceIndex = prompt.indexOf('<my_voice>');
      const personaIndex = prompt.indexOf('回复人设：');
      assert.ok(myVoiceIndex > -1, '应包含 <my_voice>');
      // 如果没有 personaObj，则检查要求段在 my_voice 之后
      const requirementsIndex = prompt.indexOf('要求：');
      assert.ok(myVoiceIndex < requirementsIndex, 'my_voice 应在要求段之前');
      if (personaIndex > -1) {
        assert.ok(myVoiceIndex < personaIndex, 'my_voice 应在 persona 之前');
      }
    }
  },
  {
    name: 'buildPrompt() myVoice 只有 description 无 samples',
    fn() {
      const prompt = buildPrompt({
        ...baseInput(),
        myVoice: { enabled: true, description: '风格描述', samples: [], forbiddenPhrases: [] }
      });
      assert.ok(prompt.includes('<my_voice>'));
      assert.ok(prompt.includes('风格描述：风格描述'));
      assert.ok(!prompt.includes('写作样本：'));
      assert.ok(!prompt.includes('避免使用的短语'));
    }
  },
  {
    name: 'My Voice samples 从 textarea 文本解析',
    fn() {
      const textareaText = '样本一\n样本二\n\n样本三\n';
      const samples = textareaText.split('\n').map(s => s.trim()).filter(Boolean);
      const result = normalizeMyVoice({ enabled: true, samples });
      assert.deepStrictEqual(result.samples, ['样本一', '样本二', '样本三']);
    }
  }
];

module.exports = { tests };
