'use strict';

const assert = require('node:assert');

/* ── 加载各模块 ── */
const { buildPrompt, splitReplyCandidates } = require('../shared/xg_prompt.js');
const {
  normalizeSettings,
  DEFAULT_SETTINGS,
  getPersonaInstruction,
  getLanguageInstruction,
  PERSONA_INSTRUCTIONS,
  LANGUAGE_INSTRUCTIONS
} = require('../shared/xg_settings.js');
const {
  computeViewGrowth,
  normalizeSnapshotStore,
  pruneSnapshotStore,
  migrateLegacySnapshot
} = require('../shared/xg_growth.js');
const { parseMetric, formatMetric, formatRate, formatAge } = require('../shared/xg_parse.js');
const { dedupeResponseText, findNewResponse, isResponseStable } = require('../shared/xg_response.js');
const { stripReplyPrefix, normalizeReplyCandidates } = require('../shared/xg_reply.js');

/* ── 为 xg_reply.js 的 DP 依赖注入全局 ── */
if (!globalThis.DraftPulseShared) globalThis.DraftPulseShared = {};
Object.assign(globalThis.DraftPulseShared, {
  dedupeResponseText,
  splitReplyCandidates
});

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN_INTERVAL = 3 * 60 * 1000;

/* ═══════════════════════════════════════════
 * 1. buildPrompt() characterization
 * ═══════════════════════════════════════════ */
const buildPromptTests = [
  {
    name: 'buildPrompt: 默认设置产出包含 <tweet>、<author> 与要求列表',
    fn() {
      const prompt = buildPrompt({
        tweetText: '测试推文',
        author: '测试作者',
        persona: '专业、简洁',
        language: '简体中文',
        settings: { maxReplyLength: 200, useEmoji: true, askQuestion: false, allowDisagreement: true, replyCount: 1 }
      });
      assert.ok(prompt.includes('<tweet>'), '应包含 <tweet>');
      assert.ok(prompt.includes('</tweet>'), '应包含 </tweet>');
      assert.ok(prompt.includes('<author>测试作者</author>'), '应包含 <author>');
      assert.ok(prompt.includes('要求：'), '应包含要求列表');
      assert.ok(prompt.includes('测试推文'), '应包含推文正文');
    }
  },
  {
    name: 'buildPrompt: persona 字符串出现在输出中',
    fn() {
      const prompt = buildPrompt({
        tweetText: '推文',
        persona: '幽默、机智',
        language: '中文',
        settings: { maxReplyLength: 200, replyCount: 1 }
      });
      assert.ok(prompt.includes('幽默、机智'), 'persona 应出现在提示词中');
    }
  },
  {
    name: 'buildPrompt: language 指令出现在输出中',
    fn() {
      const prompt = buildPrompt({
        tweetText: '推文',
        persona: '专业',
        language: 'English',
        settings: { maxReplyLength: 200, replyCount: 1 }
      });
      assert.ok(prompt.includes('English'), 'language 应出现在提示词中');
    }
  },
  {
    name: 'buildPrompt: replyCount=3 添加 "3 条" 候选要求',
    fn() {
      const prompt = buildPrompt({
        tweetText: '推文',
        persona: '专业',
        language: '中文',
        settings: { maxReplyLength: 200, replyCount: 3 }
      });
      assert.ok(prompt.includes('3 条'), '应包含 3 条候选要求');
      assert.ok(prompt.includes('[候选1]'), '应包含 [候选1] 标记说明');
    }
  },
  {
    name: 'buildPrompt: 图片出现在 <attached_images> 区域',
    fn() {
      const prompt = buildPrompt({
        tweetText: '推文',
        persona: '专业',
        language: '中文',
        images: [{ alt: '一只猫' }, { alt: '' }],
        settings: { maxReplyLength: 200, replyCount: 1 }
      });
      assert.ok(prompt.includes('<attached_images>'), '应包含 <attached_images>');
      assert.ok(prompt.includes('图片 1'), '应包含图片 1');
      assert.ok(prompt.includes('图片 2'), '应包含图片 2');
      assert.ok(prompt.includes('一只猫'), '应包含图片 alt 文本');
    }
  },
  {
    name: 'buildPrompt: 空 tweetText 产出回退消息',
    fn() {
      const prompt = buildPrompt({
        tweetText: '',
        persona: '专业',
        language: '中文',
        settings: { maxReplyLength: 200, replyCount: 1 }
      });
      assert.ok(prompt.includes('该推文没有可读取的正文'), '空推文应有回退消息');
    }
  },
  {
    name: 'buildPrompt: 自定义要求出现在输出中',
    fn() {
      const prompt = buildPrompt({
        tweetText: '推文',
        persona: '专业',
        language: '中文',
        settings: { maxReplyLength: 200, replyCount: 1, customRequirements: '不要使用感叹号' }
      });
      assert.ok(prompt.includes('不要使用感叹号'), '自定义要求应出现');
      assert.ok(prompt.includes('附加要求'), '应标记为附加要求');
    }
  }
];

/* ═══════════════════════════════════════════
 * 2. splitReplyCandidates() characterization
 * ═══════════════════════════════════════════ */
const splitTests = [
  {
    name: 'splitReplyCandidates: 单条回复返回单元素数组',
    fn() {
      const result = splitReplyCandidates('一条普通回复', 1);
      assert.deepStrictEqual(result, ['一条普通回复']);
    }
  },
  {
    name: 'splitReplyCandidates: 3 候选带标记正确拆分',
    fn() {
      const reply = '[候选1] 第一条\n\n[候选2] 第二条\n\n[候选3] 第三条';
      const result = splitReplyCandidates(reply, 3);
      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result, ['第一条', '第二条', '第三条']);
    }
  },
  {
    name: 'splitReplyCandidates: 无标记返回单元素数组',
    fn() {
      const result = splitReplyCandidates('没有标记的回复', 3);
      assert.deepStrictEqual(result, ['没有标记的回复']);
    }
  },
  {
    name: 'splitReplyCandidates: 空输入返回空数组',
    fn() {
      assert.deepStrictEqual(splitReplyCandidates('', 3), []);
      assert.deepStrictEqual(splitReplyCandidates('', 1), []);
      assert.deepStrictEqual(splitReplyCandidates(null, 1), []);
      assert.deepStrictEqual(splitReplyCandidates(undefined, 3), []);
    }
  },
  {
    name: 'splitReplyCandidates: 重复候选去重',
    fn() {
      const reply = '[候选1] 相同内容\n[候选2] 相同内容';
      const result = splitReplyCandidates(reply, 3);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0], '相同内容');
    }
  }
];

/* ═══════════════════════════════════════════
 * 3. normalizeSettings() characterization
 * ═══════════════════════════════════════════ */
const settingsTests = [
  {
    name: 'normalizeSettings: 空输入返回默认值',
    fn() {
      const s = normalizeSettings({});
      assert.strictEqual(s.extensionEnabled, true);
      assert.strictEqual(s.selectedProvider, 'gemini');
      assert.strictEqual(s.replyPersona, 'professional');
      assert.strictEqual(s.replyLanguage, 'auto');
      assert.strictEqual(s.maxReplyLength, 200);
      assert.strictEqual(s.useEmoji, true);
      assert.strictEqual(s.askQuestion, false);
      assert.strictEqual(s.allowDisagreement, true);
      assert.strictEqual(s.replyCount, 1);
    }
  },
  {
    name: 'normalizeSettings: 未知 provider 回退 gemini',
    fn() {
      assert.strictEqual(normalizeSettings({ selectedProvider: 'unknown' }).selectedProvider, 'gemini');
      assert.strictEqual(normalizeSettings({ selectedProvider: '' }).selectedProvider, 'gemini');
      assert.strictEqual(normalizeSettings({ selectedProvider: 'GEMINI' }).selectedProvider, 'gemini');
    }
  },
  {
    name: 'normalizeSettings: 未知 persona 回退 professional',
    fn() {
      assert.strictEqual(normalizeSettings({ replyPersona: 'nonexistent' }).replyPersona, 'professional');
      assert.strictEqual(normalizeSettings({ replyPersona: '' }).replyPersona, 'professional');
    }
  },
  {
    name: 'normalizeSettings: maxReplyLength 钳位到 20-500',
    fn() {
      assert.strictEqual(normalizeSettings({ maxReplyLength: 5 }).maxReplyLength, 20);
      assert.strictEqual(normalizeSettings({ maxReplyLength: 99999 }).maxReplyLength, 500);
      assert.strictEqual(normalizeSettings({ maxReplyLength: 100 }).maxReplyLength, 100);
      assert.strictEqual(normalizeSettings({ maxReplyLength: 20 }).maxReplyLength, 20);
      assert.strictEqual(normalizeSettings({ maxReplyLength: 500 }).maxReplyLength, 500);
    }
  },
  {
    name: 'normalizeSettings: replyCount 只允许 1 或 3',
    fn() {
      assert.strictEqual(normalizeSettings({ replyCount: 1 }).replyCount, 1);
      assert.strictEqual(normalizeSettings({ replyCount: 3 }).replyCount, 3);
      assert.strictEqual(normalizeSettings({ replyCount: '3' }).replyCount, 3);
      assert.strictEqual(normalizeSettings({ replyCount: 2 }).replyCount, 1);
      assert.strictEqual(normalizeSettings({ replyCount: 0 }).replyCount, 1);
      assert.strictEqual(normalizeSettings({ replyCount: 5 }).replyCount, 1);
    }
  },
  {
    name: 'normalizeSettings: 布尔值强制转换',
    fn() {
      // '0' → false
      assert.strictEqual(normalizeSettings({ useEmoji: '0' }).useEmoji, false);
      // '1' → true
      assert.strictEqual(normalizeSettings({ useEmoji: '1' }).useEmoji, true);
      // 'true' → true
      assert.strictEqual(normalizeSettings({ useEmoji: 'true' }).useEmoji, true);
      // 'false' → false
      assert.strictEqual(normalizeSettings({ useEmoji: 'false' }).useEmoji, false);
      // 0 → false
      assert.strictEqual(normalizeSettings({ useEmoji: 0 }).useEmoji, false);
      // 1 → true
      assert.strictEqual(normalizeSettings({ useEmoji: 1 }).useEmoji, true);
      // true → true
      assert.strictEqual(normalizeSettings({ useEmoji: true }).useEmoji, true);
      // false → false
      assert.strictEqual(normalizeSettings({ useEmoji: false }).useEmoji, false);
    }
  },
  {
    name: 'normalizeSettings: null/非对象输入返回默认值',
    fn() {
      const s = normalizeSettings(null);
      assert.strictEqual(s.extensionEnabled, true);
      assert.strictEqual(s.replyPersona, 'professional');
    }
  }
];

/* ═══════════════════════════════════════════
 * 4. computeViewGrowth() characterization
 * ═══════════════════════════════════════════ */
function growthInput(overrides) {
  return {
    tweetId: '111',
    publishedAt: NOW - 4 * 3600000,
    views: 6200,
    now: NOW,
    minIntervalMs: MIN_INTERVAL,
    ...overrides
  };
}

const growthTests = [
  {
    name: 'computeViewGrowth: 缺失 tweetId 返回 unavailable',
    fn() {
      const result = computeViewGrowth(growthInput({ tweetId: '' }));
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.source, 'unavailable');
    }
  },
  {
    name: 'computeViewGrowth: 负数 views 返回 unavailable',
    fn() {
      const result = computeViewGrowth(growthInput({ views: -100 }));
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.source, 'unavailable');
    }
  },
  {
    name: 'computeViewGrowth: 未来 publishedAt 返回 unavailable',
    fn() {
      const result = computeViewGrowth(growthInput({ publishedAt: NOW + 3600000 }));
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.source, 'unavailable');
    }
  },
  {
    name: 'computeViewGrowth: 刚发布推文 (< 1 min) 返回 source=fresh, rate=null',
    fn() {
      const result = computeViewGrowth(growthInput({ publishedAt: NOW - 30 * 1000, views: 5000 }));
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.source, 'fresh');
      assert.strictEqual(result.rate, null);
      assert.ok(result.snapshot, '应产出快照');
      assert.strictEqual(result.snapshot.views, 5000);
    }
  },
  {
    name: 'computeViewGrowth: 无已有快照返回 source=average',
    fn() {
      const result = computeViewGrowth(growthInput({}));
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.source, 'average');
      assert.strictEqual(result.rate, 6200 / 4);
      assert.ok(result.snapshot, '应产出快照');
    }
  },
  {
    name: 'computeViewGrowth: 已有快照且间隔充足返回 source=observed',
    fn() {
      const previous = { tweetId: '111', views: 5000, observedAt: NOW - 12 * 60 * 1000, publishedAt: NOW - 4 * 3600000 };
      const result = computeViewGrowth(growthInput({ views: 6200, snapshot: previous }));
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.source, 'observed');
      assert.strictEqual(result.rate, 1200 / 0.2);
      assert.strictEqual(result.intervalMinutes, 12);
    }
  },
  {
    name: 'computeViewGrowth: 浏览量下降回退 average',
    fn() {
      const previous = { tweetId: '111', views: 6200, observedAt: NOW - 12 * 60 * 1000, publishedAt: NOW - 4 * 3600000 };
      const result = computeViewGrowth(growthInput({ views: 6000, snapshot: previous }));
      assert.strictEqual(result.source, 'average');
      assert.strictEqual(result.rate, 6000 / 4);
      // 保留旧 views 基线
      assert.strictEqual(result.snapshot.views, 6200);
    }
  },
  {
    name: 'computeViewGrowth: 间隔过短回退 average',
    fn() {
      const previous = { tweetId: '111', views: 5000, observedAt: NOW - 60 * 1000, publishedAt: NOW - 4 * 3600000 };
      const result = computeViewGrowth(growthInput({ views: 6200, snapshot: previous }));
      assert.strictEqual(result.source, 'average');
      assert.strictEqual(result.rate, 6200 / 4);
      assert.strictEqual(result.snapshot, null);
    }
  },
  {
    name: 'computeViewGrowth: null 输入返回 unavailable',
    fn() {
      const result = computeViewGrowth(null);
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.source, 'unavailable');
    }
  }
];

/* ═══════════════════════════════════════════
 * 5. normalizeSnapshotStore() characterization
 * ═══════════════════════════════════════════ */
const snapshotTests = [
  {
    name: 'normalizeSnapshotStore: null 输入返回空对象',
    fn() {
      const result = normalizeSnapshotStore(null);
      assert.deepStrictEqual(Object.keys(result), []);
    }
  },
  {
    name: 'normalizeSnapshotStore: 非数字键被过滤',
    fn() {
      const result = normalizeSnapshotStore({
        'abc': { views: 100, observedAt: NOW, publishedAt: NOW - 3600000 },
        '123': { views: 200, observedAt: NOW, publishedAt: NOW - 3600000 }
      });
      assert.strictEqual(Object.keys(result).length, 1);
      assert.ok(result['123'], '数字键应保留');
      assert.ok(!result['abc'], '非数字键应被过滤');
    }
  },
  {
    name: 'normalizeSnapshotStore: 旧格式快照被迁移',
    fn() {
      const result = normalizeSnapshotStore({
        '1': { first: { views: 100, timestamp: NOW - 3600000 }, last: { views: 200, timestamp: NOW - 60000 }, recentRate: 3, updatedAt: NOW - 60000 }
      });
      assert.ok(result['1'], '迁移后应存在键');
      assert.strictEqual(result['1'].views, 200);
      assert.strictEqual(result['1'].observedAt, NOW - 60000);
    }
  },
  {
    name: 'normalizeSnapshotStore: 无效条目被跳过',
    fn() {
      const result = normalizeSnapshotStore({
        '1': 'junk',
        '2': null,
        '3': { views: 100, observedAt: NOW, publishedAt: NOW - 3600000 }
      });
      assert.strictEqual(Object.keys(result).length, 1);
      assert.ok(result['3'], '有效条目应保留');
    }
  },
  {
    name: 'normalizeSnapshotStore: 数组输入返回空对象',
    fn() {
      const result = normalizeSnapshotStore([1, 2, 3]);
      assert.deepStrictEqual(Object.keys(result), []);
    }
  }
];

/* ═══════════════════════════════════════════
 * 6. parseMetric() characterization
 * ═══════════════════════════════════════════ */
const parseTests = [
  {
    name: 'parseMetric: K 后缀',
    fn() {
      assert.strictEqual(parseMetric('1.5K'), 1500);
      assert.strictEqual(parseMetric('2K'), 2000);
    }
  },
  {
    name: 'parseMetric: M 后缀',
    fn() {
      assert.strictEqual(parseMetric('1.2M'), 1200000);
      assert.strictEqual(parseMetric('3M'), 3000000);
    }
  },
  {
    name: 'parseMetric: 万 后缀',
    fn() {
      assert.strictEqual(parseMetric('1.5万'), 15000);
      assert.strictEqual(parseMetric('10万'), 100000);
    }
  },
  {
    name: 'parseMetric: 纯数字',
    fn() {
      assert.strictEqual(parseMetric('1234'), 1234);
      assert.strictEqual(parseMetric('0'), 0);
      assert.strictEqual(parseMetric('999'), 999);
    }
  },
  {
    name: 'parseMetric: 逗号分隔数字',
    fn() {
      assert.strictEqual(parseMetric('1,234'), 1234);
      assert.strictEqual(parseMetric('1,234,567'), 1234567);
    }
  },
  {
    name: 'parseMetric: 空值返回 0',
    fn() {
      assert.strictEqual(parseMetric(''), 0);
      assert.strictEqual(parseMetric(null), 0);
      assert.strictEqual(parseMetric(undefined), 0);
    }
  },
  {
    name: 'parseMetric: 中文逗号分隔',
    fn() {
      assert.strictEqual(parseMetric('1，234'), 1234);
    }
  }
];

/* ═══════════════════════════════════════════
 * 7. formatMetric / formatRate / formatAge characterization
 * ═══════════════════════════════════════════ */
const formatTests = [
  {
    name: 'formatMetric: 小数字标准格式',
    fn() {
      const result = formatMetric(500);
      assert.strictEqual(typeof result, 'string');
      assert.ok(result.length > 0, '应返回非空字符串');
    }
  },
  {
    name: 'formatMetric: 大数字紧凑格式',
    fn() {
      const result = formatMetric(50000);
      assert.strictEqual(typeof result, 'string');
      assert.ok(result.length > 0, '应返回非空字符串');
    }
  },
  {
    name: 'formatMetric: 0 返回 "0"',
    fn() {
      assert.strictEqual(formatMetric(0), '0');
      assert.strictEqual(formatMetric(null), '0');
    }
  },
  {
    name: 'formatRate: 小数保留一位',
    fn() {
      const result = formatRate(12.345);
      assert.strictEqual(typeof result, 'string');
      // 12.345 → round to 12.3 → "12.3"
      assert.ok(result.includes('12'), '应包含数值');
    }
  },
  {
    name: 'formatRate: 大数字取整',
    fn() {
      const result = formatRate(150.7);
      // 150.7 >= 100 → Math.round → 151
      assert.ok(result.includes('151'), '大数字应取整');
    }
  },
  {
    name: 'formatAge: 分钟',
    fn() {
      assert.ok(formatAge(0.5).includes('分钟'), '小于 1 小时应显示分钟');
      assert.ok(formatAge(0).includes('分钟'), '0 小时应显示分钟');
    }
  },
  {
    name: 'formatAge: 小时',
    fn() {
      assert.ok(formatAge(2).includes('小时'), '2 小时应显示小时');
      assert.ok(formatAge(23).includes('小时'), '23 小时应显示小时');
    }
  },
  {
    name: 'formatAge: 天',
    fn() {
      assert.ok(formatAge(24).includes('天'), '24 小时应显示天');
      assert.ok(formatAge(48).includes('天'), '48 小时应显示天');
    }
  }
];

/* ═══════════════════════════════════════════
 * 8. dedupeResponseText() characterization
 * ═══════════════════════════════════════════ */
const dedupeTests = [
  {
    name: 'dedupeResponseText: 空输入返回空字符串',
    fn() {
      assert.strictEqual(dedupeResponseText(''), '');
      assert.strictEqual(dedupeResponseText(null), '');
    }
  },
  {
    name: 'dedupeResponseText: 非重复文本保持不变',
    fn() {
      assert.strictEqual(dedupeResponseText('这是一段正常的回复'), '这是一段正常的回复');
    }
  },
  {
    name: 'dedupeResponseText: 完整段落重复被压缩',
    fn() {
      const text = '第一行\n第二行\n第一行\n第二行';
      const result = dedupeResponseText(text);
      assert.strictEqual(result, '第一行\n第二行');
    }
  },
  {
    name: 'dedupeResponseText: 全文重复拼接被压缩',
    fn() {
      const text = '这是一段很长的文本内容，用于测试重复检测功能。这是一段很长的文本内容，用于测试重复检测功能。';
      const result = dedupeResponseText(text);
      assert.ok(result.length < text.length, '重复文本应被压缩');
    }
  }
];

/* ═══════════════════════════════════════════
 * 9. findNewResponse() characterization
 * ═══════════════════════════════════════════ */
const findNewTests = [
  {
    name: 'findNewResponse: 空候选返回 null',
    fn() {
      assert.strictEqual(findNewResponse([], { lastIndex: 0, lastText: '' }), null);
      assert.strictEqual(findNewResponse(null, { lastIndex: 0, lastText: '' }), null);
    }
  },
  {
    name: 'findNewResponse: 无基线时返回首个非用户候选',
    fn() {
      const candidates = [
        { index: 0, text: '用户问题', isUser: true },
        { index: 1, text: '模型回答', isUser: false }
      ];
      const result = findNewResponse(candidates, { lastIndex: 0, lastText: '' });
      assert.strictEqual(result.text, '模型回答');
    }
  },
  {
    name: 'findNewResponse: 基线之后的首个非用户候选',
    fn() {
      const candidates = [
        { index: 0, text: '旧回答', isUser: false },
        { index: 1, text: '新回答', isUser: false }
      ];
      const result = findNewResponse(candidates, { lastIndex: 0, lastText: '旧回答' });
      assert.strictEqual(result.text, '新回答');
    }
  },
  {
    name: 'findNewResponse: 节点复用兜底——最后节点文本变化',
    fn() {
      const candidates = [
        { index: 0, text: '旧内容', isUser: false }
      ];
      // 没有 index > lastIndex 的候选，但最后节点文本已变化
      const result = findNewResponse(candidates, { lastIndex: 0, lastText: '更早的内容' });
      assert.strictEqual(result.text, '旧内容');
    }
  }
];

/* ═══════════════════════════════════════════
 * 10. isResponseStable() characterization
 * ═══════════════════════════════════════════ */
const stableTests = [
  {
    name: 'isResponseStable: 空闲超过阈值返回 true',
    fn() {
      assert.strictEqual(
        isResponseStable({ lastChangedAt: 1000, now: 2000, isGenerating: false }, { idleMs: 400 }),
        true
      );
    }
  },
  {
    name: 'isResponseStable: 空闲不足阈值返回 false',
    fn() {
      assert.strictEqual(
        isResponseStable({ lastChangedAt: 1000, now: 1200, isGenerating: false }, { idleMs: 400 }),
        false
      );
    }
  },
  {
    name: 'isResponseStable: 生成中使用更长的阈值',
    fn() {
      // 生成中，idle=1000 < whileGeneratingIdleMs=1500
      assert.strictEqual(
        isResponseStable({ lastChangedAt: 1000, now: 2000, isGenerating: true }, { whileGeneratingIdleMs: 1500 }),
        false
      );
      // 生成中，idle=2000 >= whileGeneratingIdleMs=1500
      assert.strictEqual(
        isResponseStable({ lastChangedAt: 1000, now: 3000, isGenerating: true }, { whileGeneratingIdleMs: 1500 }),
        true
      );
    }
  }
];

/* ═══════════════════════════════════════════
 * 11. stripReplyPrefix() characterization
 * ═══════════════════════════════════════════ */
const stripTests = [
  {
    name: 'stripReplyPrefix: 移除 "回复：" 前缀',
    fn() {
      assert.strictEqual(stripReplyPrefix('回复：这是回复内容'), '这是回复内容');
      assert.strictEqual(stripReplyPrefix('回复: 这是回复内容'), '这是回复内容');
    }
  },
  {
    name: 'stripReplyPrefix: 移除 "Reply:" 前缀',
    fn() {
      assert.strictEqual(stripReplyPrefix('Reply: this is a reply'), 'this is a reply');
    }
  },
  {
    name: 'stripReplyPrefix: 移除引号包裹',
    fn() {
      assert.strictEqual(stripReplyPrefix('"引号内容"'), '引号内容');
      assert.strictEqual(stripReplyPrefix('"引号内容"'), '引号内容');
    }
  },
  {
    name: 'stripReplyPrefix: 无前缀保持不变',
    fn() {
      assert.strictEqual(stripReplyPrefix('正常文本'), '正常文本');
    }
  },
  {
    name: 'stripReplyPrefix: 空值返回空字符串',
    fn() {
      assert.strictEqual(stripReplyPrefix(''), '');
      assert.strictEqual(stripReplyPrefix(null), '');
    }
  }
];

/* ═══════════════════════════════════════════
 * 12. getPersonaInstruction / getLanguageInstruction characterization
 * ═══════════════════════════════════════════ */
const instructionTests = [
  {
    name: 'getPersonaInstruction: 已知 persona 返回预设指令',
    fn() {
      assert.strictEqual(getPersonaInstruction('professional'), PERSONA_INSTRUCTIONS.professional);
      assert.strictEqual(getPersonaInstruction('humorous'), PERSONA_INSTRUCTIONS.humorous);
      assert.strictEqual(getPersonaInstruction('counter'), PERSONA_INSTRUCTIONS.counter);
    }
  },
  {
    name: 'getPersonaInstruction: 未知 persona 回退 professional',
    fn() {
      assert.strictEqual(getPersonaInstruction('nonexistent'), PERSONA_INSTRUCTIONS.professional);
    }
  },
  {
    name: 'getPersonaInstruction: custom 使用自定义值',
    fn() {
      assert.strictEqual(getPersonaInstruction('custom', '我的风格'), '我的风格');
    }
  },
  {
    name: 'getPersonaInstruction: custom 空值回退 professional',
    fn() {
      assert.strictEqual(getPersonaInstruction('custom', ''), PERSONA_INSTRUCTIONS.professional);
      assert.strictEqual(getPersonaInstruction('custom', '  '), PERSONA_INSTRUCTIONS.professional);
    }
  },
  {
    name: 'getLanguageInstruction: 已知语言返回预设指令',
    fn() {
      assert.strictEqual(getLanguageInstruction('auto'), LANGUAGE_INSTRUCTIONS.auto);
      assert.strictEqual(getLanguageInstruction('zh-CN'), LANGUAGE_INSTRUCTIONS['zh-CN']);
      assert.strictEqual(getLanguageInstruction('en'), LANGUAGE_INSTRUCTIONS.en);
    }
  },
  {
    name: 'getLanguageInstruction: 未知语言回退 auto',
    fn() {
      assert.strictEqual(getLanguageInstruction('xx'), LANGUAGE_INSTRUCTIONS.auto);
    }
  },
  {
    name: 'getLanguageInstruction: custom 使用自定义值',
    fn() {
      assert.strictEqual(getLanguageInstruction('custom', '法语'), '法语');
    }
  },
  {
    name: 'getLanguageInstruction: custom 空值回退 auto',
    fn() {
      assert.strictEqual(getLanguageInstruction('custom', ''), LANGUAGE_INSTRUCTIONS.auto);
    }
  }
];

/* ═══════════════════════════════════════════
 * 13. pruneSnapshotStore() characterization
 * ═══════════════════════════════════════════ */
const pruneTests = [
  {
    name: 'pruneSnapshotStore: 过期条目被移除',
    fn() {
      const store = {
        '1': { tweetId: '1', views: 10, observedAt: NOW - 60000, publishedAt: NOW - 3600000 },
        '2': { tweetId: '2', views: 20, observedAt: NOW - 20 * 24 * 3600000, publishedAt: NOW - 30 * 24 * 3600000 }
      };
      const pruned = pruneSnapshotStore(store, { now: NOW });
      assert.deepStrictEqual(Object.keys(pruned), ['1']);
    }
  },
  {
    name: 'pruneSnapshotStore: maxEntries 限制',
    fn() {
      const store = {
        '1': { observedAt: NOW },
        '2': { observedAt: NOW - 1000 }
      };
      const capped = pruneSnapshotStore(store, { now: NOW, maxEntries: 1 });
      assert.strictEqual(Object.keys(capped).length, 1);
    }
  }
];

/* ═══════════════════════════════════════════
 * 合并所有测试
 * ═══════════════════════════════════════════ */
const tests = [
  ...buildPromptTests,
  ...splitTests,
  ...settingsTests,
  ...growthTests,
  ...snapshotTests,
  ...parseTests,
  ...formatTests,
  ...dedupeTests,
  ...findNewTests,
  ...stableTests,
  ...stripTests,
  ...instructionTests,
  ...pruneTests
];

module.exports = { tests };
